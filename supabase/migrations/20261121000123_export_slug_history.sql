-- G-12: l'export dell'account include lo storico degli slug delle ricette dell'utente.
-- La tabella non e leggibile da authenticated (revoke all): RPC dedicata, limitata alle ricette proprie.
create or replace function public.my_recipe_slug_history()
returns table (slug text, recipe_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.slug, h.recipe_id, h.created_at
  from public.recipe_slug_history h
  join public.recipes r on r.id = h.recipe_id
  where r.owner_id = auth.uid()
  order by h.slug;
$$;
revoke all on function public.my_recipe_slug_history() from public, anon;
grant execute on function public.my_recipe_slug_history() to authenticated;
