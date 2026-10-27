-- M-11: search_recipes con p_limit null leggeva tutte le righe visibili. Ora null
-- viene limitato a 1000 (stesso valore di max_rows di PostgREST); un p_limit esplicito
-- resta clampato a 200.
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
    limit case when p_limit is null then 1000 else least(greatest(p_limit, 1), 200) end
    offset greatest(p_offset, 0);
end $$;
