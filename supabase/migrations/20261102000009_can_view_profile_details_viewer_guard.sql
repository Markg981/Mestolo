-- A-19: can_view_profile_details(target, viewer) accettava un viewer arbitrario, rivelando se un UUID
-- esiste e se il profilo è pubblico. Le policy RLS/storage la chiamano come `authenticated` con auth.uid(),
-- quindi la firma resta: un viewer diverso da auth.uid() è ammesso solo per service_role.
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
            (viewer is null or not public.is_blocked_between(p.id, viewer))
            and (
              p.profile_visibility = 'public'
              or (viewer is not null and p.profile_visibility = 'friends' and public.are_friends(p.id, viewer))
            )
          )
        )
    )
  end;
$$;
