-- A-05: recipe_images non si inserisce più direttamente.
-- La policy INSERT controllava solo proprietario, prefisso e ricetta: kind, posizione e quota
-- (2000 immagini) esistevano solo nella RPC, aggirabile con un INSERT diretto (es. kind 'upload'
-- su un'immagine importata, poi pubblicabile come copertina, o percorsi <uid>/cook/...).
-- Ora l'unico ingresso è insert_recipe_image (SECURITY DEFINER) che ripete i controlli.

drop policy if exists recipe_images_insert on public.recipe_images;
revoke insert on public.recipe_images from authenticated;

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
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text;
  v_total int;
  v_pos int;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.recipes r where r.id = p_recipe_id and r.owner_id = v_uid) then
    raise exception 'recipe not found' using errcode = '42501';
  end if;
  -- il file deve stare nella cartella della ricetta dell'utente (no cook/, no altre cartelle)
  v_prefix := v_uid::text || '/' || p_recipe_id::text || '/';
  if p_storage_path is null or left(p_storage_path, length(v_prefix)) <> v_prefix
     or (p_thumb_path is not null and left(p_thumb_path, length(v_prefix)) <> v_prefix) then
    raise exception 'invalid storage path' using errcode = '42501';
  end if;
  -- serializza gli inserimenti dello stesso utente: quota e posizione non possono correre
  perform pg_advisory_xact_lock(hashtextextended('recipe_images:' || v_uid::text, 0));
  select (select count(*) from public.recipe_images where owner_id = v_uid)
       + (select count(*) from public.cook_logs where user_id = v_uid and photo_path is not null)
    into v_total;
  if v_total >= least(p_max_images, 2000) then
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

-- kind non cambia dopo l'inserimento (un'immagine importata non diventa 'upload')
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
  if new.kind is distinct from old.kind then
    raise exception 'recipe_images.kind is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
