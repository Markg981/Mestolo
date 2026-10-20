-- =====================================================================
-- Mestolo – privacy dei profili: permessi per colonna
--  * agli altri utenti sono leggibili solo id, username, display_name, bio
--  * preferenze alimentari, ingredienti evitati, lingua, visibilità e ruolo
--    di moderatore restano privati: il proprietario li legge con my_profile()
--  * le funzioni security definer esistenti (search_profiles, is_moderator)
--    continuano a funzionare perché girano con i privilegi del proprietario
-- =====================================================================

revoke select on public.profiles from anon, authenticated;
grant select (id, username, display_name, bio) on public.profiles to authenticated;

-- Profilo completo del solo utente corrente
create or replace function public.my_profile()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
