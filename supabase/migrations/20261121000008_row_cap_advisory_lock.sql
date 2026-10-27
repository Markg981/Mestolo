-- L-15: enforce_row_cap contava le righe senza alcun lock: N INSERT concorrenti dello stesso utente vedevano tutti
-- count < cap e superavano il tetto. Ora il trigger prende un advisory lock transazionale per (tabella, chiave)
-- prima del conteggio, serializzando gli inserimenti dello stesso utente/lista senza toccare gli altri.
create or replace function public.enforce_row_cap()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap int := tg_argv[0]::int;
  col text := tg_argv[1];
  key uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  cnt int;
begin
  if key is null then
    return new; -- es. categorie di sistema (owner_id nullo)
  end if;
  perform pg_advisory_xact_lock(hashtextextended('row_cap:' || tg_table_name || ':' || key::text, 0));
  execute format('select count(*) from public.%I where %I = $1', tg_table_name, col) into cnt using key;
  if cnt >= cap then
    raise exception 'limit reached for %', tg_table_name using errcode = '54000';
  end if;
  return new;
end $$;
revoke all on function public.enforce_row_cap() from public, anon, authenticated;
