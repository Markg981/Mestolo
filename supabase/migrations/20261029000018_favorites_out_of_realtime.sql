-- M18: favorites fuori dalla publication supabase_realtime.
-- Realtime non applica la RLS agli eventi DELETE e la PK di favorites e
-- (user_id, recipe_id): un abbonato qualsiasi poteva sottoscrivere i DELETE
-- (anche con filtro user_id=eq.<altro utente>) e leggere la coppia
-- utente/ricetta rimossa. La tabella non viene piu trasmessa; il client non
-- si abbona piu ai suoi eventi (i preferiti si aggiornano al prossimo fetch).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'favorites'
  ) then
    alter publication supabase_realtime drop table public.favorites;
  end if;
end $$;
