-- Grafo sociale: are_friends / is_blocked_between sono chiamabili via RPC e,
-- con security definer, permettevano a chiunque di ricostruire chi e' amico o
-- ha bloccato chi. Le policy RLS le usano con il ruolo dell'utente, quindi non
-- si puo' revocare EXECUTE ad authenticated: le funzioni rispondono true solo
-- se auth.uid() e' una delle due parti (in tutte le policy lo e' sempre).

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and auth.uid() in (a, b)
    and exists (
      select 1 from public.blocks
      where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
    );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null
    and auth.uid() is not null
    and auth.uid() in (a, b)
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and least(f.requester_id, f.addressee_id) = least(a, b)
        and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
    );
$$;

revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
