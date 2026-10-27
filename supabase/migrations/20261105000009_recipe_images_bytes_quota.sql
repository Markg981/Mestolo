-- C-09: lo storage delle immagini era limitato solo dal numero di file (2000), non dai byte.
-- recipe_images.size_bytes = byte reali di file + miniatura, misurati dal server sui buffer
-- già elaborati (mai il valore dichiarato dal client). insert_recipe_image somma i byte dell'utente
-- sotto lo stesso advisory lock della quota per numero e rifiuta oltre il tetto (p_max_bytes,
-- con un massimo assoluto di 1 GiB lato DB). Le righe preesistenti hanno 0 (dimensione ignota).

alter table public.recipe_images add column if not exists size_bytes bigint not null default 0 check (size_bytes >= 0);

drop function if exists public.insert_recipe_image(uuid, text, text, public.image_kind, text, text, text, int, int, int);

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
  p_max_images int,
  p_size_bytes bigint,
  p_max_bytes bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text;
  v_total int;
  v_bytes bigint;
  v_pos int;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_size_bytes is null or p_size_bytes < 0 then
    raise exception 'invalid size' using errcode = '22023';
  end if;
  if not exists (select 1 from public.recipes r where r.id = p_recipe_id and r.owner_id = v_uid) then
    raise exception 'recipe not found' using errcode = '42501';
  end if;
  v_prefix := v_uid::text || '/' || p_recipe_id::text || '/';
  if p_storage_path is null or left(p_storage_path, length(v_prefix)) <> v_prefix
     or (p_thumb_path is not null and left(p_thumb_path, length(v_prefix)) <> v_prefix) then
    raise exception 'invalid storage path' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recipe_images:' || v_uid::text, 0));
  select (select count(*) from public.recipe_images where owner_id = v_uid)
       + (select count(*) from public.cook_logs where user_id = v_uid and photo_path is not null)
    into v_total;
  if v_total >= least(p_max_images, 2000) then
    return null;
  end if;
  select coalesce(sum(size_bytes), 0) into v_bytes from public.recipe_images where owner_id = v_uid;
  if v_bytes + p_size_bytes > least(p_max_bytes, 1073741824) then
    return null;
  end if;
  select coalesce(max(position) + 1, 0) into v_pos from public.recipe_images where recipe_id = p_recipe_id;
  insert into public.recipe_images (recipe_id, owner_id, storage_path, thumb_path, kind, source_url, attribution, alt_text, width, height, position, size_bytes)
  values (p_recipe_id, v_uid, p_storage_path, p_thumb_path, p_kind, p_source_url, p_attribution, p_alt, p_width, p_height, v_pos, p_size_bytes)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.insert_recipe_image(uuid, text, text, public.image_kind, text, text, text, int, int, int, bigint, bigint) from public, anon;
grant execute on function public.insert_recipe_image(uuid, text, text, public.image_kind, text, text, text, int, int, int, bigint, bigint) to authenticated;
