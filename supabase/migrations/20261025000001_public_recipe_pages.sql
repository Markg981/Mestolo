-- Pagine pubbliche indicizzabili (SEO), per ricetta e solo su scelta del proprietario.
--
-- Modello di sicurezza: il ruolo anon NON riceve alcun accesso alle tabelle e la RLS di
-- public.recipes non viene allargata. L'accesso anonimo passa solo da funzioni
-- SECURITY DEFINER che restituiscono colonne esplicitamente elencate (niente email,
-- note personali, id del proprietario, versioni, flag interni) e solo per le ricette con
-- visibility = 'public', pagina pubblica attiva e non nascoste dalla moderazione.

alter table public.recipes
  add column public_page_enabled boolean not null default false,
  add column public_slug text;

alter table public.recipes
  add constraint recipes_public_slug_format check (
    public_slug is null or (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(public_slug) <= 120)
  );
create unique index recipes_public_slug_uidx on public.recipes (public_slug) where public_slug is not null;
create index recipes_public_page_idx on public.recipes (created_at, id) where public_page_enabled and visibility = 'public' and not is_hidden;

-- Slug leggibile: titolo normalizzato + primi 8 caratteri dell'id (mirror di src/lib/recipes/slug.ts)
create or replace function public.make_recipe_slug(p_title text, p_id uuid)
returns text language plpgsql immutable set search_path = public as $$
declare
  base text;
begin
  base := lower(coalesce(p_title, ''));
  base := replace(base, 'ß', 'ss');
  base := translate(base, 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç', 'aaaaaaeeeeiiiiooooouuuuyync');
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from base);
  base := trim(both '-' from left(base, 60));
  if base = '' then base := 'ricetta'; end if;
  return base || '-' || left(replace(p_id::text, '-', ''), 8);
end;
$$;

-- Lo slug lo decide solo il database: è stabile (mai riscritto) e non falsificabile dal client.
-- La pagina pubblica può restare attiva solo se la ricetta è pubblica.
create or replace function public.recipes_public_page_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.public_slug := old.public_slug;
  else
    new.public_slug := null;
  end if;
  if new.visibility <> 'public' then
    new.public_page_enabled := false;
  end if;
  if new.public_page_enabled and new.public_slug is null then
    new.public_slug := public.make_recipe_slug(new.title, new.id);
  end if;
  return new;
end;
$$;
create trigger recipes_public_page_guard before insert or update on public.recipes
  for each row execute function public.recipes_public_page_guard();

-- ---------- Lettura anonima: solo funzioni, solo colonne sicure ---------------

create or replace function public.get_public_recipe(p_slug text)
returns table (
  id uuid, slug text, title text, description text, original_language text,
  servings numeric, prep_minutes int, cook_minutes int, total_minutes int,
  ingredients jsonb, steps jsonb, tags text[], category_slug text,
  source_name text, source_url text,
  author_name text, author_username text,
  cover_image_id uuid, cover_alt text, cover_kind public.image_kind, cover_attribution text,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.public_slug, r.title, r.description, r.original_language,
         r.servings, r.prep_minutes, r.cook_minutes, r.total_minutes,
         r.ingredients, r.steps, r.tags, c.slug,
         r.source_name, r.source_url,
         coalesce(r.original_author_name, case when p.discoverable then nullif(p.display_name, '') end),
         case when p.discoverable and r.original_author_name is null then p.username end,
         ci.id, ci.alt_text, ci.kind, ci.attribution,
         r.created_at, r.updated_at
  from public.recipes r
  join public.profiles p on p.id = r.owner_id
  left join public.categories c on c.id = r.category_id and c.owner_id is null
  left join lateral (
    select i.id, i.alt_text, i.kind, i.attribution from public.recipe_images i
    where i.recipe_id = r.id and i.kind <> 'imported' order by i.position, i.created_at, i.id limit 1
  ) ci on true
  where r.public_slug = p_slug
    and r.public_page_enabled and r.visibility = 'public' and not r.is_hidden;
$$;

-- Elenco per sitemap.xml (paginato)
create or replace function public.list_public_recipe_slugs(p_offset int, p_limit int)
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.public_slug, r.updated_at
  from public.recipes r
  where r.public_page_enabled and r.visibility = 'public' and not r.is_hidden and r.public_slug is not null
  order by r.created_at, r.id
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 0), 5000);
$$;

create or replace function public.count_public_recipes()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.recipes r
  where r.public_page_enabled and r.visibility = 'public' and not r.is_hidden and r.public_slug is not null;
$$;

-- La copertina pubblica è la prima immagine caricata dall'autore o generata (mai quelle
-- importate da fonti terze: i diritti non sono dell'autore).
-- Percorsi del file della sola immagine di copertina di una pagina pubblica attiva
create or replace function public.public_cover_paths(p_image_id uuid)
returns table (storage_path text, thumb_path text)
language sql stable security definer set search_path = public as $$
  select i.storage_path, i.thumb_path
  from public.recipe_images i
  join public.recipes r on r.id = i.recipe_id
  where i.id = p_image_id
    and r.public_page_enabled and r.visibility = 'public' and not r.is_hidden
    and i.id = (select i2.id from public.recipe_images i2 where i2.recipe_id = r.id and i2.kind <> 'imported' order by i2.position, i2.created_at, i2.id limit 1);
$$;

create or replace function public.is_public_cover_object(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.recipe_images i
    join public.recipes r on r.id = i.recipe_id
    where (i.storage_path = p_name or i.thumb_path = p_name)
      and r.public_page_enabled and r.visibility = 'public' and not r.is_hidden
      and i.id = (select i2.id from public.recipe_images i2 where i2.recipe_id = r.id and i2.kind <> 'imported' order by i2.position, i2.created_at, i2.id limit 1)
  );
$$;

revoke all on function public.get_public_recipe(text) from public;
revoke all on function public.list_public_recipe_slugs(int, int) from public;
revoke all on function public.count_public_recipes() from public;
revoke all on function public.public_cover_paths(uuid) from public;
revoke all on function public.is_public_cover_object(text) from public;
grant execute on function public.get_public_recipe(text) to anon, authenticated, service_role;
grant execute on function public.list_public_recipe_slugs(int, int) to anon, authenticated, service_role;
grant execute on function public.count_public_recipes() to anon, authenticated, service_role;
grant execute on function public.public_cover_paths(uuid) to anon, authenticated, service_role;
grant execute on function public.is_public_cover_object(text) to anon, authenticated, service_role;

-- Il file della copertina è scaricabile dal ruolo anon solo se la pagina pubblica è attiva
create policy recipe_images_storage_public_cover on storage.objects for select to anon
  using (bucket_id = 'recipe-images' and public.is_public_cover_object(name));
