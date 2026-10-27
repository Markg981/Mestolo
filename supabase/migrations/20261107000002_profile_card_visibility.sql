-- C-02: get_profile_card restituiva id, username e display_name di qualunque profilo
-- a ogni utente autenticato (clausola `auth.uid() is not null or p.ok`), anche non
-- discoverable/privato, aggirando la policy profiles_select. Ora per gli autenticati
-- vale anche can_see_profile(); gli anonimi continuano a vedere solo profili pubblici.
-- Firma e grant invariati.
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
      and (auth.uid() is null or pr.id = auth.uid() or not public.is_blocked_between(pr.id, auth.uid()))
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
revoke all on function public.get_profile_card(text) from public;
grant execute on function public.get_profile_card(text) to anon, authenticated, service_role;
