-- M-18: can_view_recipe_for(rid, uid) applicava i blocchi tramite
-- public.is_blocked_between, che dopo C-19 considera solo i blocchi fatti da
-- auth.uid(): con uid diverso da auth.uid() (service_role, trigger) i blocchi
-- venivano ignorati. Ora la verifica e' esplicita sull'uid passato, in
-- entrambe le direzioni tra uid e proprietario. Grant e search_path invariati.

create or replace function public.can_view_recipe_for(rid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and exists (
    select 1 from public.recipes r
    where r.id = rid
      and (
        r.owner_id = uid
        or (
          not r.is_hidden
          and not exists (
            select 1 from public.blocks b
            where (b.blocker_id = r.owner_id and b.blocked_id = uid)
               or (b.blocker_id = uid and b.blocked_id = r.owner_id)
          )
          and (
            r.visibility = 'public'
            or (r.visibility = 'friends' and public.are_friends(r.owner_id, uid))
          )
        )
      )
  );
$$;

revoke execute on function public.can_view_recipe_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_view_recipe_for(uuid, uuid) to service_role;
