-- recipe_images: la modifica ha gli stessi vincoli dell'inserimento e i campi
-- che legano la riga al file e alla ricetta sono immutabili.

drop policy recipe_images_update on public.recipe_images;
create policy recipe_images_update on public.recipe_images for update to authenticated
  using (
    owner_id = auth.uid()
    and storage_path like auth.uid()::text || '/%'
    and exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    and storage_path like auth.uid()::text || '/%'
    and (thumb_path is null or thumb_path like auth.uid()::text || '/%')
    and exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );

-- Ricetta e percorsi dei file non cambiano dopo l'inserimento
-- (vale anche per i ruoli che aggirano le policy, es. service role)
create or replace function public.recipe_images_lock_refs()
returns trigger language plpgsql as $$
begin
  if new.recipe_id is distinct from old.recipe_id then
    raise exception 'recipe_images.recipe_id is immutable' using errcode = '42501';
  end if;
  if new.storage_path is distinct from old.storage_path then
    raise exception 'recipe_images.storage_path is immutable' using errcode = '42501';
  end if;
  if new.thumb_path is distinct from old.thumb_path and old.thumb_path is not null then
    raise exception 'recipe_images.thumb_path is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger recipe_images_lock_refs before update on public.recipe_images
  for each row execute function public.recipe_images_lock_refs();
