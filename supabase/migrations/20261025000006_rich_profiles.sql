-- =====================================================================
-- Mestolo – profili ricchi
--  * nuove colonne: avatar_path, location, website, favorite_cuisines,
--    profile_visibility (public | friends | private, default friends)
--  * agli altri utenti restano leggibili SOLO id, username, display_name
--    (servono per liste e menzioni); tutto il resto passa da get_profile_card()
--    che rispetta profile_visibility e i blocchi. Mai l'email.
--  * avatar in un bucket dedicato: scrive solo il server (service role),
--    legge chi può vedere il profilo
-- =====================================================================

create type public.profile_visibility as enum ('public', 'friends', 'private');

alter table public.profiles
  add column avatar_path text,
  add column location text not null default '',
  add column website text,
  add column favorite_cuisines text[] not null default '{}',
  add column profile_visibility public.profile_visibility not null default 'friends';

alter table public.profiles
  add constraint profiles_location_len check (char_length(location) <= 80),
  add constraint profiles_website_https check (website is null or (website ~* '^https://[^\s]+$' and char_length(website) <= 200)),
  add constraint profiles_cuisines_limits check (
    cardinality(favorite_cuisines) <= 8
    and char_length(array_to_string(favorite_cuisines, ',')) <= 200
  ),
  add constraint profiles_avatar_own_folder check (avatar_path is null or avatar_path like id::text || '/%');

-- Il bio non è più leggibile direttamente: passa da get_profile_card()
revoke select on public.profiles from anon, authenticated;
grant select (id, username, display_name) on public.profiles to authenticated;

-- L'avatar si imposta solo dal server (service role): l'utente non può puntare a file altrui
revoke update on public.profiles from authenticated;
grant update (username, display_name, bio, locale, discoverable, dietary_preferences, avoided_ingredients,
              hidden_categories, location, website, favorite_cuisines, profile_visibility)
  on public.profiles to authenticated;

-- Chi può vedere i dettagli del profilo di `target`
create or replace function public.can_view_profile_details(target uuid, viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target
      and (
        p.id = viewer
        or (
          (viewer is null or not public.is_blocked_between(p.id, viewer))
          and (
            p.profile_visibility = 'public'
            or (viewer is not null and p.profile_visibility = 'friends' and public.are_friends(p.id, viewer))
          )
        )
      )
  );
$$;
revoke all on function public.can_view_profile_details(uuid, uuid) from public;
grant execute on function public.can_view_profile_details(uuid, uuid) to authenticated, service_role;

-- Scheda profilo: i campi ricchi solo se `can_view`, altrimenti solo nome e username
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
  where auth.uid() is not null or p.ok;  -- gli anonimi vedono solo profili pubblici
$$;
revoke all on function public.get_profile_card(text) from public;
grant execute on function public.get_profile_card(text) to anon, authenticated, service_role;

-- Avatar di più utenti in una volta (liste): solo quelli che il chiamante può vedere
create or replace function public.get_avatar_paths(p_ids uuid[])
returns table (id uuid, avatar_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.avatar_path from public.profiles p
  where p.id = any (p_ids) and p.avatar_path is not null
    and public.can_view_profile_details(p.id, auth.uid())
  limit 200;
$$;
revoke all on function public.get_avatar_paths(uuid[]) from public, anon;
grant execute on function public.get_avatar_paths(uuid[]) to authenticated;

-- ---------- Storage: bucket avatar ---------------------------------------
-- Percorso: <owner_id>/<file>.webp. Nessuna policy di INSERT/UPDATE per gli
-- utenti: scrive solo il server dopo aver validato e ridimensionato l'immagine.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/webp'])
on conflict (id) do nothing;

create policy avatars_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_view_profile_details(((storage.foldername(name))[1])::uuid, auth.uid())
    )
  );
create policy avatars_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
