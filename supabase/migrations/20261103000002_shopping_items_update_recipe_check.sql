-- Audit: shopping_items_update non validava recipe_id.
-- Con la sola WITH CHECK su list_id un membro poteva puntare un articolo a una
-- ricetta altrui non visibile. Si allinea alla policy di insert.
drop policy shopping_items_update on public.shopping_items;
create policy shopping_items_update on public.shopping_items for update to authenticated
  using (public.can_access_shopping_list(list_id))
  with check (
    public.can_access_shopping_list(list_id)
    and (recipe_id is null or public.can_view_recipe(recipe_id))
  );
