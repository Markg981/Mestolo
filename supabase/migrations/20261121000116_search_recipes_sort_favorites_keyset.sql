-- G-01: search_recipes troncava a 200 righe (created_at desc) PRIMA che PostgREST applicasse
-- ordinamento, filtro preferiti e keyset: con >200 corrispondenze i preferiti/le pagine oltre
-- il taglio sparivano. Ora ordinamento, preferiti e cursore keyset sono dentro la funzione e
-- valgono prima del limit. Nuovi parametri in coda, tutti con default: i chiamanti esistenti
-- non cambiano comportamento.
drop function if exists public.search_recipes(text, uuid, uuid, text, boolean, int, int, timestamptz, uuid);

create or replace function public.search_recipes(
  p_query text default null,
  p_owner uuid default null,
  p_category uuid default null,
  p_tag text default null,
  p_needs_review boolean default false,
  p_limit int default 120,
  p_offset int default 0,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_sort text default 'recent',
  p_only_favorites boolean default false,
  p_after_value text default null,
  p_after_is_null boolean default false
) returns setof public.recipes
language plpgsql stable security invoker set search_path = public as $$
declare
  norm text := lower(public.f_unaccent(coalesce(p_query, '')));
  tsq tsquery;
  n int;
  lim int := case when p_limit is null then 1000 else least(greatest(p_limit, 1), 200) end;
  off int := greatest(p_offset, 0);
  sort_key text := case when p_sort in ('updated', 'title', 'quick') then p_sort else 'recent' end;
  last_id uuid := coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  after_value text := p_after_value;
  has_cursor boolean := p_after_value is not null or p_after_is_null;
begin
  select to_tsquery('simple', string_agg(w || ':*', ' & ')), count(*)
    into tsq, n
    from (select w from regexp_split_to_table(norm, '[^[:alnum:]]+') w where w <> '' limit 6) s;

  -- compatibilita: il vecchio cursore (created_at, id) vale per l'ordinamento 'recent'
  if sort_key = 'recent' and not has_cursor and p_after_created_at is not null then
    after_value := p_after_created_at::text;
    has_cursor := true;
  end if;

  return query
    select r.* from public.recipes r
    where (p_owner is null or r.owner_id = p_owner)
      and (p_category is null or r.category_id = p_category)
      and (p_tag is null or r.tags @> array[p_tag])
      and (not p_needs_review or r.verification_status = 'needs_review')
      and (not p_only_favorites or exists (
            select 1 from public.favorites f where f.recipe_id = r.id and f.user_id = auth.uid()))
      and (tsq is null or r.search_tsv @@ tsq
           or (n = 1 and public.f_unaccent(lower(r.title)) operator(public.%) norm))
      and (not has_cursor or case sort_key
            when 'recent' then (r.created_at, r.id) < (after_value::timestamptz, last_id)
            when 'updated' then (r.updated_at, r.id) < (after_value::timestamptz, last_id)
            when 'title' then (r.title, r.id) > (after_value, last_id)
            else case
              when p_after_is_null then r.total_minutes is null and r.id > last_id
              else r.total_minutes is null
                   or (r.total_minutes, r.id) > (after_value::int, last_id)
            end
          end)
    order by
      case when sort_key = 'recent' then r.created_at end desc,
      case when sort_key = 'updated' then r.updated_at end desc,
      case when sort_key = 'title' then r.title end asc,
      case when sort_key = 'quick' then r.total_minutes end asc nulls last,
      case when sort_key in ('recent', 'updated') then r.id end desc,
      case when sort_key in ('title', 'quick') then r.id end asc
    limit lim
    offset off;
end $$;

revoke execute on function public.search_recipes(text, uuid, uuid, text, boolean, int, int, timestamptz, uuid, text, boolean, text, boolean) from public, anon;
grant execute on function public.search_recipes(text, uuid, uuid, text, boolean, int, int, timestamptz, uuid, text, boolean, text, boolean) to authenticated;
