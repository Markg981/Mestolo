-- Indici per la paginazione keyset (created_at/updated_at + id come tie-breaker).
create index if not exists recipes_owner_created_idx on public.recipes (owner_id, created_at desc, id desc);
create index if not exists recipes_owner_updated_id_idx on public.recipes (owner_id, updated_at desc, id desc);
create index if not exists recipes_public_created_id_idx on public.recipes (created_at desc, id desc) where not is_hidden and visibility in ('public', 'friends');
