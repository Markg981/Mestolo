-- DB-01: regressione del controllo blocchi. Dopo C-19 (20261102000001) policy e funzioni
-- devono usare private.is_blocked_between (simmetrica); public.is_blocked_between e' solo
-- RPC e unidirezionale (20261102000007). Due migrazioni successive l'hanno reintrodotta:
-- 20261102000010 (can_view_profile_details, da cui dipendono anche get_avatar_paths e la
-- policy storage avatars_storage_select) e 20261107000002 (get_profile_card).
-- Ridefinizione con corpo vigente invariato: cambia solo il controllo blocchi.
-- Firme, grant e search_path invariati. Idempotente.

create or replace function public.can_view_profile_details(target uuid, viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when viewer is distinct from auth.uid()
      and coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      ) is distinct from 'service_role'
    then false
    else exists (
      select 1 from public.profiles p
      where p.id = target
        and (
          p.id = viewer
          or (
            (viewer is null or not private.is_blocked_between(p.id, viewer))
            and (
              p.profile_visibility = 'public'
              or (viewer is not null and p.profile_visibility = 'friends' and public.are_friends(p.id, viewer))
            )
          )
        )
    )
  end;
$$;

create or replace function public.get_profile_card(p_username text)
returns table (
  id uuid, username text, display_name text, can_view boolean,
  bio text, avatar_path text, location text, website text,
  favorite_cuisines text[], profile_visibility public.profile_visibility,
  friends_count int, member_since timestamptz
)
language sql stable security definer set search_path = public as $$
  with p as (
    select pr.*, public.can_view_profile_details(pr.id, auth.uid()) as ok
    from public.profiles pr
    where pr.username = lower(p_username)
      and (auth.uid() is null or pr.id = auth.uid() or not private.is_blocked_between(pr.id, auth.uid()))
  )
  select p.id, p.username, p.display_name, p.ok,
    case when p.ok then p.bio else '' end,
    case when p.ok then p.avatar_path end,
    case when p.ok then p.location else '' end,
    case when p.ok then p.website end,
    case when p.ok then p.favorite_cuisines else '{}'::text[] end,
    case when p.id = auth.uid() then p.profile_visibility end,
    case when p.ok then (
      select count(*)::int from public.friendships f
      where f.status = 'accepted' and (f.requester_id = p.id or f.addressee_id = p.id)
    ) end,
    case when p.ok then p.created_at end
  from p
  where case when auth.uid() is null then p.ok else public.can_see_profile(p.id) end;
$$;
