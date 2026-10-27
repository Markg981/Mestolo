-- DB-03: categories_select esponeva il nome di una categoria personalizzata a chiunque
-- se esisteva una qualunque ricetta con quella categoria, anche privata di un altro utente.
-- Ora la ricetta deve essere visibile a chi interroga (can_view_recipe: security definer,
-- quindi nessuna ricorsione RLS tra categories e recipes).
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (
    owner_id is null or owner_id = (select auth.uid())
    or exists (
      select 1 from public.recipes r
      where r.category_id = categories.id and public.can_view_recipe(r.id)
    )
  );
