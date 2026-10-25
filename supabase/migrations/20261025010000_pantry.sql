-- Dispensa personale: articoli con scadenza e posizione. Solo il proprietario
-- puo leggere/scrivere (RLS); owner_id e immutabile (trigger keep_owner).
create type public.pantry_location as enum ('fridge', 'freezer', 'pantry');

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 200),
  quantity numeric(12, 3) check (quantity is null or quantity >= 0),
  unit text check (unit is null or char_length(unit) <= 40),
  expires_on date,
  location public.pantry_location not null default 'pantry',
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index pantry_items_owner_expiry_idx on public.pantry_items (owner_id, expires_on);

create trigger pantry_items_keep_owner before update on public.pantry_items
  for each row execute function public.keep_owner();

alter table public.pantry_items enable row level security;

create policy pantry_items_select on public.pantry_items for select to authenticated using (owner_id = auth.uid());
create policy pantry_items_insert on public.pantry_items for insert to authenticated with check (owner_id = auth.uid());
create policy pantry_items_update on public.pantry_items for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pantry_items_delete on public.pantry_items for delete to authenticated using (owner_id = auth.uid());
