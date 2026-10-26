-- A-12: concorrenza e doppio invio.
-- 1) recipes.idempotency_key: chiave generata dal client alla creazione; un secondo invio
--    con la stessa chiave non crea un duplicato. Colonna nullable: le righe esistenti restano valide.
-- 2) insert_recipe_image: posizione e quota delle immagini calcolate in modo atomico
--    (advisory lock per utente), al posto di count + insert separati.

alter table public.recipes add column if not exists idempotency_key uuid;
create unique index if not exists recipes_owner_idempotency_key_uq
  on public.recipes (owner_id, idempotency_key) where idempotency_key is not null;

create or replace function public.insert_recipe_image(
  p_recipe_id uuid,
  p_storage_path text,
  p_thumb_path text,
  p_kind public.image_kind,
  p_source_url text,
  p_attribution text,
  p_alt text,
  p_width int,
  p_height int,
  p_max_images int
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_pos int;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- serializza gli inserimenti dello stesso utente: quota e posizione non possono correre
  perform pg_advisory_xact_lock(hashtextextended('recipe_images:' || v_uid::text, 0));
  select (select count(*) from public.recipe_images where owner_id = v_uid)
       + (select count(*) from public.cook_logs where user_id = v_uid and photo_path is not null)
    into v_total;
  if v_total >= p_max_images then
    return null;
  end if;
  select coalesce(max(position) + 1, 0) into v_pos from public.recipe_images where recipe_id = p_recipe_id;
  insert into public.recipe_images (recipe_id, owner_id, storage_path, thumb_path, kind, source_url, attribution, alt_text, width, height, position)
  values (p_recipe_id, v_uid, p_storage_path, p_thumb_path, p_kind, p_source_url, p_attribution, p_alt, p_width, p_height, v_pos)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.insert_recipe_image(uuid, text, text, public.image_kind, text, text, text, int, int, int) from public, anon;
grant execute on function public.insert_recipe_image(uuid, text, text, public.image_kind, text, text, text, int, int, int) to authenticated;
