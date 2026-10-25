-- M17 bis: il FOR UPDATE introdotto in 20261025025000 causava deadlock con voti simultanei.
-- L'insert in recipe_ratings prende gia' FOR KEY SHARE sulla riga di recipes (controllo della FK
-- recipe_id); due transazioni concorrenti lo ottengono entrambe, poi il trigger chiede FOR UPDATE,
-- che confligge con il KEY SHARE dell'altra: ognuna aspetta l'altra (40P01, il voto fallisce).
-- FOR NO KEY UPDATE non confligge con KEY SHARE ma confligge con se stesso: il ricalcolo resta
-- serializzato per ricetta, senza deadlock. E' anche il lock che prende l'UPDATE successivo.
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
    perform 1 from public.recipes where id = v_id for no key update;
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
