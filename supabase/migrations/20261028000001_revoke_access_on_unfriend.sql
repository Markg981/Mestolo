-- A7: togliere l'amicizia deve revocare l'accesso a liste della spesa e raccolte condivise.
-- Modello: i membri (shopping_list_members, collection_members) sono sempre amici
-- accettati del proprietario. Se l'amicizia sparisce (delete) o non e piu 'accepted',
-- le righe membro tra le due parti (in entrambe le direzioni) vengono rimosse.
-- Difesa in profondita: le funzioni di accesso richiedono comunque l'amicizia corrente,
-- cosi righe orfane non concedono nulla. Non esiste un concetto di famiglia separato:
-- la "famiglia" della lista e shopping_list_members, quindi viene revocata uguale.

-- Amicizia accettata tra a e b, indipendente da auth.uid() (uso interno alle funzioni definer)
create or replace function public.friendship_accepted(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(a, b)
      and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
  );
$$;
revoke execute on function public.friendship_accepted(uuid, uuid) from public, anon, authenticated;
grant execute on function public.friendship_accepted(uuid, uuid) to service_role;

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
            and public.friendship_accepted(l.owner_id, auth.uid())
            and not public.is_blocked_between(l.owner_id, auth.uid())
          )
        )
    ),
    false
  );
$$;

create or replace function public.collection_role_for(cid uuid, uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when uid is null then null
    when c.owner_id = uid then 'owner'
    when public.is_blocked_between(c.owner_id, uid) then null
    when m.role is not null and public.friendship_accepted(c.owner_id, uid) then m.role
    when c.visibility = 'public' then 'viewer'
    when c.visibility = 'friends' and public.friendship_accepted(c.owner_id, uid) then 'viewer'
    else null
  end
  from public.collections c
  left join public.collection_members m on m.collection_id = c.id and m.user_id = uid
  where c.id = cid;
$$;

-- Rimuove i membri tra due utenti, in entrambe le direzioni
create or replace function public.revoke_shared_access_between(a uuid, b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.shopping_list_members m
  using public.shopping_lists l
  where m.list_id = l.id
    and ((l.owner_id = a and m.user_id = b) or (l.owner_id = b and m.user_id = a));
  delete from public.collection_members m
  using public.collections c
  where m.collection_id = c.id
    and ((c.owner_id = a and m.user_id = b) or (c.owner_id = b and m.user_id = a));
end;
$$;
revoke execute on function public.revoke_shared_access_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.friendships_revoke_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'accepted' then
      perform public.revoke_shared_access_between(old.requester_id, old.addressee_id);
    end if;
    return old;
  end if;
  if old.status = 'accepted' and new.status <> 'accepted' then
    perform public.revoke_shared_access_between(new.requester_id, new.addressee_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.friendships_revoke_access() from public, anon, authenticated;

create trigger friendships_revoke_access_del after delete on public.friendships
  for each row execute function public.friendships_revoke_access();
create trigger friendships_revoke_access_upd after update of status on public.friendships
  for each row execute function public.friendships_revoke_access();

-- Pulizia una tantum delle righe membro rimaste senza amicizia accettata
delete from public.shopping_list_members m
using public.shopping_lists l
where m.list_id = l.id and not public.friendship_accepted(l.owner_id, m.user_id);

delete from public.collection_members m
using public.collections c
where m.collection_id = c.id and not public.friendship_accepted(c.owner_id, m.user_id);
