-- Audit: slug pubblico occupabile in anticipo. Il suffisso dello slug era l'id (scelto dal
-- client, creazione offline-first): chi conosceva/prevedeva un id poteva pre-creare una ricetta
-- e prenotare lo slug. Ora il suffisso e' casuale, generato dal database alla pubblicazione;
-- gli slug esistenti restano invariati (e continuano a risolvere).

-- Base normalizzata dal titolo (stessa normalizzazione di make_recipe_slug, senza suffisso)
create or replace function public.make_recipe_slug_base(p_title text)
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
  return base;
end;
$$;

-- Slug con suffisso casuale; in caso di collisione (con slug attivi o storici) ritenta.
-- p_suffix: se valorizzato lo si prova per primo (stabilita' al cambio titolo).
create or replace function public.make_recipe_slug_random(p_title text, p_suffix text default null)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  base text := public.make_recipe_slug_base(p_title);
  suf text := p_suffix;
  cand text;
begin
  loop
    if suf is null or suf !~ '^[a-f0-9]{8}$' then
      suf := left(replace(gen_random_uuid()::text, '-', ''), 8);
    end if;
    cand := base || '-' || suf;
    if not exists (select 1 from public.recipes where public_slug = cand)
       and not exists (select 1 from public.recipe_slug_history where slug = cand) then
      return cand;
    end if;
    suf := null;
  end loop;
end;
$$;
revoke all on function public.make_recipe_slug_random(text, text) from public, anon, authenticated;

create or replace function public.recipes_public_page_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new text;
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
    new.public_slug := public.make_recipe_slug_random(new.title);
  elsif tg_op = 'UPDATE' and new.public_slug is not null and new.title is distinct from old.title then
    -- Il suffisso resta quello gia' assegnato; cambia solo la parte derivata dal titolo.
    v_new := public.make_recipe_slug_random(new.title, substring(new.public_slug from '([a-f0-9]{8})$'));
    if v_new <> new.public_slug then
      insert into public.recipe_slug_history (slug, recipe_id) values (new.public_slug, new.id) on conflict do nothing;
      delete from public.recipe_slug_history where slug = v_new and recipe_id = new.id;
      new.public_slug := v_new;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.recipes_public_page_guard() from public, anon, authenticated;
