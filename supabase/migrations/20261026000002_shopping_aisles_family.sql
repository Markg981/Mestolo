-- Lista della spesa condivisa con la famiglia + reparti.
-- Modello:
--   * il proprietario della lista (shopping_lists.owner_id) invita come membri
--     solo i propri amici (friendships accepted) non bloccati;
--   * i membri vedono la lista, aggiungono, spuntano e rimuovono articoli e
--     cambiano il reparto di un articolo; NON gestiscono i membri, non
--     rinominano ne cancellano la lista;
--   * un membro puo lasciare la lista (delete della propria riga);
--   * shopping_items.owner_id resta l'autore dell'articolo ("aggiunto da"),
--     checked_by registra chi lo ha spuntato (impostato da trigger);
--   * bloccare un utente lo toglie dalle liste in comune (in entrambe le direzioni);
--   * helper security definer con search_path fisso: le policy non si
--     richiamano a vicenda (niente ricorsione RLS).

create table public.shopping_list_members (
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index shopping_list_members_user_idx on public.shopping_list_members (user_id);

-- Reparto scelto dall'utente per un prodotto (chiave = nome normalizzato), per lista
create table public.shopping_aisle_overrides (
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  name_key text not null check (char_length(name_key) between 1 and 200),
  aisle text not null check (aisle in ('produce', 'bakery', 'meat', 'fish', 'dairy', 'pantry', 'frozen', 'beverages', 'household', 'other')),
  set_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (list_id, name_key)
);

alter table public.shopping_items
  add column checked_by uuid references auth.users (id) on delete set null;

alter table public.shopping_list_members enable row level security;
alter table public.shopping_aisle_overrides enable row level security;

create or replace function public.shopping_list_owner(lid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from public.shopping_lists where id = lid;
$$;

-- Proprietario oppure membro non bloccato dal proprietario
create or replace function public.can_access_shopping_list(lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    auth.uid() is not null and exists (
      select 1 from public.shopping_lists l
      where l.id = lid
        and (
          l.owner_id = auth.uid()
          or (
            exists (select 1 from public.shopping_list_members m where m.list_id = l.id and m.user_id = auth.uid())
            and not public.is_blocked_between(l.owner_id, auth.uid())
          )
        )
    ),
    false
  );
$$;

revoke execute on function public.shopping_list_owner(uuid) from public, anon;
revoke execute on function public.can_access_shopping_list(uuid) from public, anon;
grant execute on function public.shopping_list_owner(uuid) to authenticated;
grant execute on function public.can_access_shopping_list(uuid) to authenticated;

-- Liste: lettura anche ai membri; modifica/cancellazione solo al proprietario
drop policy shopping_lists_all on public.shopping_lists;
create policy shopping_lists_select on public.shopping_lists for select to authenticated
  using (public.can_access_shopping_list(id));
create policy shopping_lists_insert on public.shopping_lists for insert to authenticated
  with check (owner_id = auth.uid());
create policy shopping_lists_update on public.shopping_lists for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy shopping_lists_delete on public.shopping_lists for delete to authenticated
  using (owner_id = auth.uid());

-- Membri: li vede chi ha accesso alla lista; li aggiunge solo il proprietario
-- (amici non bloccati); li rimuove il proprietario o il membro stesso (uscita)
create policy shopping_list_members_select on public.shopping_list_members for select to authenticated
  using (user_id = auth.uid() or public.can_access_shopping_list(list_id));
create policy shopping_list_members_insert on public.shopping_list_members for insert to authenticated
  with check (
    public.shopping_list_owner(list_id) = auth.uid()
    and user_id <> auth.uid()
    and added_by = auth.uid()
    and public.are_friends(auth.uid(), user_id)
    and not public.is_blocked_between(auth.uid(), user_id)
  );
create policy shopping_list_members_delete on public.shopping_list_members for delete to authenticated
  using (user_id = auth.uid() or public.shopping_list_owner(list_id) = auth.uid());

-- Articoli: accesso a proprietario e membri della lista
drop policy shopping_items_select on public.shopping_items;
drop policy shopping_items_insert on public.shopping_items;
drop policy shopping_items_update on public.shopping_items;
drop policy shopping_items_delete on public.shopping_items;
create policy shopping_items_select on public.shopping_items for select to authenticated
  using (public.can_access_shopping_list(list_id));
create policy shopping_items_insert on public.shopping_items for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.can_access_shopping_list(list_id)
    and (recipe_id is null or public.can_view_recipe(recipe_id))
  );
create policy shopping_items_update on public.shopping_items for update to authenticated
  using (public.can_access_shopping_list(list_id))
  with check (public.can_access_shopping_list(list_id));
create policy shopping_items_delete on public.shopping_items for delete to authenticated
  using (public.can_access_shopping_list(list_id));

-- Un articolo non cambia lista; checked_by segue lo stato "spuntato"
create or replace function public.shopping_items_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.checked_by := case when new.checked then auth.uid() else null end;
  else
    new.list_id := old.list_id;
    if new.checked is distinct from old.checked then
      new.checked_by := case when new.checked then auth.uid() else null end;
    else
      new.checked_by := old.checked_by;
    end if;
  end if;
  return new;
end;
$$;
create trigger shopping_items_before_write before insert or update on public.shopping_items
  for each row execute function public.shopping_items_before_write();

-- Reparti scelti: stessa regola di accesso della lista
create policy shopping_aisle_overrides_select on public.shopping_aisle_overrides for select to authenticated
  using (public.can_access_shopping_list(list_id));
create policy shopping_aisle_overrides_insert on public.shopping_aisle_overrides for insert to authenticated
  with check (public.can_access_shopping_list(list_id) and set_by = auth.uid());
create policy shopping_aisle_overrides_update on public.shopping_aisle_overrides for update to authenticated
  using (public.can_access_shopping_list(list_id))
  with check (public.can_access_shopping_list(list_id) and set_by = auth.uid());
create policy shopping_aisle_overrides_delete on public.shopping_aisle_overrides for delete to authenticated
  using (public.can_access_shopping_list(list_id));

-- Bloccare un utente lo rimuove dalle liste in comune (entrambe le direzioni)
create or replace function public.shopping_members_on_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.shopping_list_members m
  using public.shopping_lists l
  where m.list_id = l.id
    and ((l.owner_id = new.blocker_id and m.user_id = new.blocked_id)
      or (l.owner_id = new.blocked_id and m.user_id = new.blocker_id));
  return new;
end;
$$;
create trigger shopping_members_on_block after insert on public.blocks
  for each row execute function public.shopping_members_on_block();

-- Realtime: i reparti scelti si propagano ai membri (RLS dell'abbonato applicata)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopping_aisle_overrides'
     ) then
    alter publication supabase_realtime add table public.shopping_aisle_overrides;
  end if;
end $$;
