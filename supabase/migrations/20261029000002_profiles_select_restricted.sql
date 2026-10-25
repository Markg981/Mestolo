-- M2: la policy profiles_select permetteva a qualunque utente autenticato di leggere
-- id, username e display_name di TUTTI i profili, anche con discoverable = false.
-- Ora un profilo e' leggibile solo se: e' il proprio, l'utente e' moderatore, il profilo e'
-- discoverable, c'e' un'amicizia (anche pendente), l'autore ha ricette pubbliche o log di
-- cottura visibili, oppure condivide una raccolta / lista della spesa accessibile.
-- I blocchi continuano a nascondere il profilo (tranne il proprio).

create or replace function public.can_see_profile(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    target = auth.uid()
    or (
      not public.is_blocked_between(target, auth.uid())
      and (
        public.is_moderator()
        or exists (select 1 from public.profiles p where p.id = target and p.discoverable)
        or exists (
          select 1 from public.friendships f
          where (f.requester_id = target and f.addressee_id = auth.uid())
             or (f.addressee_id = target and f.requester_id = auth.uid())
        )
        or exists (
          select 1 from public.recipes r
          where r.owner_id = target and r.visibility = 'public' and not r.is_hidden
        )
        or exists (
          select 1 from public.cook_logs cl
          where cl.user_id = target and cl.visibility = 'recipe' and public.can_view_recipe(cl.recipe_id)
        )
        or exists (
          select 1 from public.collections c
          where c.owner_id = target and public.can_view_collection(c.id)
        )
        or exists (
          select 1 from public.collection_members cm
          where cm.user_id = target and public.can_view_collection(cm.collection_id)
        )
        or exists (
          select 1 from public.shopping_lists l
          where l.owner_id = target and public.can_access_shopping_list(l.id)
        )
        or exists (
          select 1 from public.shopping_list_members m
          where m.user_id = target and public.can_access_shopping_list(m.list_id)
        )
      )
    )
  );
$$;
revoke all on function public.can_see_profile(uuid) from public;
grant execute on function public.can_see_profile(uuid) to authenticated, service_role;

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_see_profile(id));
