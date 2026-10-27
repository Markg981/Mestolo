-- M-10: indici su colonne FK usate in join/cascade/filtri senza indice di appoggio.
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);
create index if not exists reports_recipe_idx on public.reports (recipe_id);
create index if not exists recipes_original_author_idx on public.recipes (original_author_id);
create index if not exists recipes_copied_from_idx on public.recipes (copied_from_recipe_id);
create index if not exists recipes_category_idx on public.recipes (category_id);
create index if not exists recipe_images_owner_idx on public.recipe_images (owner_id);
