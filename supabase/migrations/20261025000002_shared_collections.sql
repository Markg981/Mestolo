-- Raccolte condivise: visibilita (private | friends | public) e membri invitati
-- come lettori (viewer) o co-editor (editor).
-- Modello:
--   * il proprietario ha pieno controllo (raccolta, ricette, membri);
--   * l'editor aggiunge/rimuove ricette ma non elimina la raccolta ne cambia i membri;
--   * il viewer legge; con visibility 'friends' leggono gli amici del proprietario,
--     con 'public' tutti gli utenti autenticati;
--   * i blocchi tra proprietario e utente tolgono ogni accesso (tranne al proprietario);
--   * una ricetta dentro una raccolta condivisa resta soggetta alla RLS della ricetta:
--     il collegamento e visibile, la ricetta no (la UI mostra "non disponibile").
-- Le funzioni helper sono security definer con search_path fisso, cosi le policy
-- non si richiamano a vicenda (niente ricorsione RLS).

alter table public.collections
  add column visibility text not null default 'private' check (visibility in ('private', 'friends', 'public'));

create table public.collection_members (
  collection_id uuid not null references public.collections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  invited_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create index collection_members_user_idx on public.collection_members (user_id);
create index collections_visibility_idx on public.collections (visibility) where visibility <> 'private';

alter table public.collection_members enable row level security;

-- Ruolo dell'utente corrente sulla raccolta: owner | editor | viewer | null
create or replace function public.collection_role_for(cid uuid, uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when uid is null then null
    when c.owner_id = uid then 'owner'
    when public.is_blocked_between(c.owner_id, uid) then null
    when m.role is not null then m.role
    when c.visibility = 'public' then 'viewer'
    when c.visibility = 'friends' and public.are_friends(c.owner_id, uid) then 'viewer'
    else null
  end
  from public.collections c
  left join public.collection_members m on m.collection_id = c.id and m.user_id = uid
  where c.id = cid;
$$;

create or replace function public.collection_role(cid uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.collection_role_for(cid, auth.uid());
$$;

create or replace function public.can_view_collection(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.collection_role_for(cid, auth.uid()) is not null, false);
$$;

create or replace function public.can_edit_collection(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.collection_role_for(cid, auth.uid()) in ('owner', 'editor'), false);
$$;

create or replace function public.collection_owner(cid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from public.collections where id = cid;
$$;

revoke execute on function public.collection_role_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.collection_role_for(uuid, uuid) to service_role;
revoke execute on function public.collection_role(uuid) from public, anon;
revoke execute on function public.can_view_collection(uuid) from public, anon;
revoke execute on function public.can_edit_collection(uuid) from public, anon;
revoke execute on function public.collection_owner(uuid) from public, anon;
grant execute on function public.collection_role(uuid) to authenticated;
grant execute on function public.can_view_collection(uuid) to authenticated;
grant execute on function public.can_edit_collection(uuid) to authenticated;
grant execute on function public.collection_owner(uuid) to authenticated;

-- Raccolte: collections_all (solo proprietario) resta; aggiunge la lettura condivisa
create policy collections_select_shared on public.collections for select to authenticated
  using (public.can_view_collection(id));

-- Membri: li vede il proprietario e il diretto interessato; li gestisce il proprietario
create policy collection_members_select on public.collection_members for select to authenticated
  using (user_id = auth.uid() or public.collection_owner(collection_id) = auth.uid());
create policy collection_members_insert on public.collection_members for insert to authenticated
  with check (
    public.collection_owner(collection_id) = auth.uid()
    and user_id <> auth.uid()
    and invited_by = auth.uid()
    and public.are_friends(auth.uid(), user_id)
    and not public.is_blocked_between(auth.uid(), user_id)
  );
create policy collection_members_update on public.collection_members for update to authenticated
  using (public.collection_owner(collection_id) = auth.uid())
  with check (public.collection_owner(collection_id) = auth.uid());
-- il proprietario rimuove, il membro puo abbandonare
create policy collection_members_delete on public.collection_members for delete to authenticated
  using (user_id = auth.uid() or public.collection_owner(collection_id) = auth.uid());

-- Ricette nelle raccolte: sostituisce le policy solo-proprietario
drop policy collection_recipes_select on public.collection_recipes;
drop policy collection_recipes_insert on public.collection_recipes;
drop policy collection_recipes_delete on public.collection_recipes;
create policy collection_recipes_select on public.collection_recipes for select to authenticated
  using (public.can_view_collection(collection_id));
create policy collection_recipes_insert on public.collection_recipes for insert to authenticated
  with check (public.can_edit_collection(collection_id) and public.can_view_recipe(recipe_id));
create policy collection_recipes_delete on public.collection_recipes for delete to authenticated
  using (public.can_edit_collection(collection_id));
-- Realtime: le nuove tabelle non sono aggiunte alla publication (nessun client in ascolto).
