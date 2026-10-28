-- B-07: can_see_profile valuta fino a 9 EXISTS per riga (costo alto nelle liste di profili).
-- Semantica e contratto INVARIATI (stessa firma, grant, search_path, stesso insieme di rami
-- in OR); cambia solo l'ordine, dal ramo piu' economico/frequente al piu' costoso, cosi'
-- l'OR si ferma prima. Ordine: discoverable (lookup PK), amicizia (indici requester/addressee),
-- ricette pubbliche (indice parziale nuovo), moderatore, poi i rami che richiamano
-- can_view_recipe/can_view_collection/can_access_shopping_list.
-- Indici mancanti sulle colonne owner_id usate dagli EXISTS.
--
-- Misura: EXPLAIN (ANALYZE, BUFFERS) select count(*) from public.profiles p
--   where public.can_see_profile(p.id);   -- con request.jwt.claims impostato e role authenticated
-- prima/dopo la migrazione; verificare Index Scan su collections_owner_idx,
-- shopping_lists_owner_idx e recipes_owner_public_idx nei piani dei sotto-EXISTS.

create index if not exists collections_owner_idx on public.collections (owner_id);
create index if not exists shopping_lists_owner_idx on public.shopping_lists (owner_id);
create index if not exists recipes_owner_public_idx on public.recipes (owner_id)
  where visibility = 'public' and not is_hidden;

create or replace function public.can_see_profile(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    target = auth.uid()
    or (
      not private.is_blocked_between(target, auth.uid())
      and (
        exists (select 1 from public.profiles p where p.id = target and p.discoverable)
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
        or public.is_moderator()
        or exists (
          select 1 from public.collections c
          where c.owner_id = target and public.can_view_collection(c.id)
        )
        or exists (
          select 1 from public.collection_members cm
          where cm.user_id = target and public.can_view_collection(cm.collection_id)
        )
        or exists (
          select 1 from public.cook_logs cl
          where cl.user_id = target and cl.visibility = 'recipe' and public.can_view_recipe(cl.recipe_id)
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
