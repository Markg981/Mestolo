-- Sincronizzazione in tempo reale (Supabase Realtime, postgres_changes).
-- Aggiunge alla publication supabase_realtime le tabelle personali per cui il
-- client ricarica i dati quando cambiano su un altro dispositivo.
-- Realtime applica la RLS dell'abbonato: le policy SELECT esistenti
-- (owner_id / user_id = auth.uid()) restano l'unico controllo di accesso.
-- REPLICA IDENTITY resta DEFAULT: il client si limita a rifare il fetch, quindi
-- per i DELETE basta la chiave primaria (nessun dato della riga viene esposto).
-- Su Postgres "nudo" (CI) la publication puo non esistere: la si crea vuota.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime assente: la creo';
    create publication supabase_realtime;
  end if;
  foreach t in array array['shopping_items', 'meal_plan_entries', 'recipes', 'favorites'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
