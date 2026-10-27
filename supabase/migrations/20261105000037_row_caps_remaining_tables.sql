-- A-04: tetti di righe anche sulle tabelle scrivibili direttamente via PostgREST che ne erano prive.
-- Senza tetto un utente col proprio JWT poteva fare INSERT in loop (ricette da ~2,4 MB, ognuna con una riga in
-- recipe_versions; claim_due_meal_reminders scansiona tutti i piani). Riusa enforce_row_cap / enforce_daily_limit.

-- enforce_row_cap generalizzato: la colonna di raggruppamento (arg 1) puo' essere qualunque colonna uuid
-- (prima solo owner_id / list_id). Il comportamento per i trigger esistenti non cambia.
create or replace function public.enforce_row_cap()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap int := tg_argv[0]::int;
  col text := tg_argv[1];
  key uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  cnt int;
begin
  if tg_table_name = 'categories' and new.owner_id is null then
    return new; -- categorie di sistema
  end if;
  if key is null then
    return new;
  end if;
  execute format('select count(*) from public.%I where %I = $1', tg_table_name, col) into cnt using key;
  if cnt >= cap then
    raise exception 'limit reached for %', tg_table_name using errcode = '54000';
  end if;
  return new;
end $$;
revoke all on function public.enforce_row_cap() from public, anon, authenticated;

-- Per utente (owner = chi inserisce).
create trigger recipes_row_cap before insert on public.recipes
  for each row execute function public.enforce_row_cap(10000, 'owner_id');
create trigger meal_plan_entries_row_cap before insert on public.meal_plan_entries
  for each row execute function public.enforce_row_cap(20000, 'owner_id');
create trigger recipe_notes_row_cap before insert on public.recipe_notes
  for each row execute function public.enforce_row_cap(10000, 'owner_id');
create trigger favorites_row_cap before insert on public.favorites
  for each row execute function public.enforce_row_cap(20000, 'user_id');
create trigger blocks_row_cap before insert on public.blocks
  for each row execute function public.enforce_row_cap(1000, 'blocker_id');

-- Per contenitore (la riga non appartiene a chi inserisce: invitato / ricetta aggiunta).
create trigger collection_recipes_row_cap before insert on public.collection_recipes
  for each row execute function public.enforce_row_cap(5000, 'collection_id');
create trigger collection_members_row_cap before insert on public.collection_members
  for each row execute function public.enforce_row_cap(200, 'collection_id');
create trigger shopping_list_members_row_cap before insert on public.shopping_list_members
  for each row execute function public.enforce_row_cap(50, 'list_id');

-- Tetto giornaliero sulla creazione di ricette (generoso: import in blocco reale resta ben sotto).
create trigger recipes_daily_limit before insert on public.recipes
  for each row execute function public.enforce_daily_limit('recipe_create', '500', 'owner_id');
