-- M17: il ricalcolo di rating_avg/rating_count non era serializzato per ricetta.
-- Sotto READ COMMITTED due voti concorrenti sulla stessa ricetta calcolavano l'aggregato
-- ciascuno senza vedere il voto non ancora committato dell'altro; l'ultimo UPDATE vinceva
-- con un valore stantio. Si blocca prima la riga di recipes (FOR UPDATE, rilasciato al commit):
-- la seconda transazione attende la prima e poi aggrega in uno statement nuovo, che vede
-- tutti i voti committati.
create or replace function public.recipe_ratings_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  perform set_config('mestolo.rating_sync', '1', true);
  -- ordine deterministico degli id per evitare deadlock tra transazioni che toccano due ricette
  for v_id in select distinct x from unnest(case tg_op
      when 'INSERT' then array[new.recipe_id]
      when 'DELETE' then array[old.recipe_id]
      else array[new.recipe_id, old.recipe_id] end) x order by x loop
    perform 1 from public.recipes where id = v_id for update;
    update public.recipes r set
      rating_count = s.n,
      rating_avg = s.avg
    from (
      select count(*)::int as n, round(avg(stars)::numeric, 2) as avg
      from public.recipe_ratings where recipe_id = v_id
    ) s
    where r.id = v_id;
  end loop;
  perform set_config('mestolo.rating_sync', '', true);
  return null;
end $$;

-- Ricalcolo una tantum degli aggregati eventualmente rimasti sbagliati
do $$
begin
  perform set_config('mestolo.rating_sync', '1', true);
  update public.recipes r set
    rating_count = coalesce(s.n, 0),
    rating_avg = s.avg
  from public.recipes r2
  left join (
    select recipe_id, count(*)::int as n, round(avg(stars)::numeric, 2) as avg
    from public.recipe_ratings group by recipe_id
  ) s on s.recipe_id = r2.id
  where r.id = r2.id
    and (r.rating_count is distinct from coalesce(s.n, 0) or r.rating_avg is distinct from s.avg);
  perform set_config('mestolo.rating_sync', '', true);
end $$;
