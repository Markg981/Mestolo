-- C-24: can_see_profile sbloccava il profilo anche con amicizie pending o declined.
-- Ora il ramo amici richiede status = 'accepted'; resta solo la richiesta pending in arrivo
-- (il destinatario vede il mittente), necessaria alla lista richieste di /friends.
-- Il controllo blocchi usa private.is_blocked_between (simmetrico, C-19): public.is_blocked_between
-- rivela solo "ho bloccato io l'altro" e farebbe riapparire i profili bloccati dall'altro lato.

create or replace function public.can_see_profile(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    target = auth.uid()
    or (
      not private.is_blocked_between(target, auth.uid())
      and (
        public.is_moderator()
        or exists (select 1 from public.profiles p where p.id = target and p.discoverable)
        or exists (
          select 1 from public.friendships f
          where (f.status = 'accepted'
                 and ((f.requester_id = target and f.addressee_id = auth.uid())
                   or (f.addressee_id = target and f.requester_id = auth.uid())))
             -- richiesta in arrivo ancora pendente: il destinatario vede il mittente (lista /friends)
             or (f.status = 'pending' and f.requester_id = target and f.addressee_id = auth.uid())
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
