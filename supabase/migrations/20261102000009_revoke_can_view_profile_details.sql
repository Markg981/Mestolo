-- A-19: can_view_profile_details(target, viewer) accettava un viewer arbitrario, rivelando se un UUID
-- esiste e se il profilo è pubblico. È usata solo da get_profile_card (security definer, passa auth.uid()),
-- quindi non serve esporla ai client.
revoke execute on function public.can_view_profile_details(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_view_profile_details(uuid, uuid) to service_role;
