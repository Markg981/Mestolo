-- Ricerca full-text sulle ricette: tsvector (config 'simple' + unaccent, le ricette
-- sono multilingua), indice GIN, indice trigram sul titolo per la ricerca fuzzy,
-- indici btree per filtri/ordinamenti e RPC search_recipes (security invoker: la RLS
-- continua a decidere cosa e' visibile).

create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

-- unaccent() e' solo STABLE: serve un wrapper IMMUTABLE per poterlo usare negli indici.
create or replace function public.f_unaccent(t text)
returns text language sql immutable parallel safe strict set search_path = public as $$
  select public.unaccent('public.unaccent'::regdictionary, t)
$$;

alter table public.recipes add column search_tsv tsvector;

create or replace function public.recipes_set_search_tsv()
returns trigger language plpgsql set search_path = public as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('simple', public.f_unaccent(coalesce(new.title, ''))), 'A') ||
    setweight(to_tsvector('simple', public.f_unaccent(array_to_string(new.tags, ' '))), 'B') ||
    setweight(to_tsvector('simple', public.f_unaccent(coalesce(
      (select string_agg(coalesce(e ->> 'name', ''), ' ') from jsonb_array_elements(new.ingredients) e), ''))), 'C') ||
    setweight(to_tsvector('simple', public.f_unaccent(coalesce(new.description, ''))), 'D');
  return new;
end $$;

create trigger recipes_search_tsv
  before insert or update of title, description, tags, ingredients on public.recipes
  for each row execute function public.recipes_set_search_tsv();

-- backfill: l'update fa scattare il trigger (nessun cambio di contenuto => nessuna nuova versione)
update public.recipes set title = title;

create index recipes_search_tsv_idx on public.recipes using gin (search_tsv);
create index recipes_title_trgm_idx on public.recipes using gin (public.f_unaccent(lower(title)) public.gin_trgm_ops);

-- indici per filtri e ordinamenti delle liste
create index recipes_owner_created_idx on public.recipes (owner_id, created_at desc, id desc);
create index recipes_owner_category_idx on public.recipes (owner_id, category_id);
create index recipes_tags_idx on public.recipes using gin (tags);
create index recipes_needs_review_idx on public.recipes (owner_id) where verification_status = 'needs_review';

-- Cerca ricette. Security invoker: la RLS di recipes si applica a chi chiama.
-- Ogni parola e' un prefisso (AND); con una sola parola basta anche un titolo simile (trigram, tolleranza ai refusi).
-- Paginazione: p_limit/p_offset oppure cursore keyset (p_after_created_at, p_after_id).
-- p_limit null = nessun limite: l'app ordina e pagina sul risultato via PostgREST.
-- Ordine: created_at desc, id desc (coerente con il cursore).
create or replace function public.search_recipes(
  p_query text default null,
  p_owner uuid default null,
  p_category uuid default null,
  p_tag text default null,
  p_needs_review boolean default false,
  p_limit int default 120,
  p_offset int default 0,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
) returns setof public.recipes
language plpgsql stable security invoker set search_path = public as $$
declare
  norm text := lower(public.f_unaccent(coalesce(p_query, '')));
  tsq tsquery;
  n int;
begin
  select to_tsquery('simple', string_agg(w || ':*', ' & ')), count(*)
    into tsq, n
    from (select w from regexp_split_to_table(norm, '[^[:alnum:]]+') w where w <> '' limit 6) s;

  return query
    select r.* from public.recipes r
    where (p_owner is null or r.owner_id = p_owner)
      and (p_category is null or r.category_id = p_category)
      and (p_tag is null or r.tags @> array[p_tag])
      and (not p_needs_review or r.verification_status = 'needs_review')
      and (tsq is null or r.search_tsv @@ tsq
           or (n = 1 and public.f_unaccent(lower(r.title)) operator(public.%) norm))
      and (p_after_created_at is null or (r.created_at, r.id) < (p_after_created_at, coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by r.created_at desc, r.id desc
    limit case when p_limit is null then null else least(greatest(p_limit, 1), 200) end
    offset greatest(p_offset, 0);
end $$;

revoke execute on function public.search_recipes(text, uuid, uuid, text, boolean, int, int, timestamptz, uuid) from public, anon;
grant execute on function public.search_recipes(text, uuid, uuid, text, boolean, int, int, timestamptz, uuid) to authenticated;
