-- B-01: cook_logs non si inserisce piu' direttamente.
-- La policy INSERT permetteva a un utente autenticato di aggirare con un INSERT diretto il tetto di
-- immagini/byte applicato da insert_cook_log, e di scegliere size_bytes a piacere (anche 0 con foto).
-- Ora l'unico ingresso e' insert_cook_log (SECURITY DEFINER, come insert_recipe_image in 20261105000211),
-- che ripete il controllo "ricetta leggibile" gia' fatto dalla policy. I CHECK di tabella e il trigger
-- del limite giornaliero restano validi anche per l'INSERT eseguito dalla funzione.
-- Inoltre il trigger di lock rende immutabile anche size_bytes (con la foto, e' parte della quota).

drop policy if exists cook_logs_insert on public.cook_logs;
revoke insert on public.cook_logs from authenticated;

create or replace function public.insert_cook_log(
  p_recipe_id uuid,
  p_cooked_at timestamptz,
  p_note text,
  p_visibility text,
  p_photo_path text,
  p_size_bytes bigint,
  p_max_images int,
  p_max_bytes bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_bytes bigint;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- prima era la policy cook_logs_insert: si registra solo una ricetta che si e' autorizzati a vedere
  if not public.can_view_recipe(p_recipe_id) then
    raise exception 'recipe not accessible' using errcode = '42501';
  end if;
  if p_size_bytes is null or p_size_bytes < 0 or p_size_bytes > 10485760 then
    raise exception 'invalid size' using errcode = '22023';
  end if;
  if p_photo_path is not null then
    perform pg_advisory_xact_lock(hashtextextended('recipe_images:' || v_uid::text, 0));
    select (select count(*) from public.recipe_images where owner_id = v_uid)
         + (select count(*) from public.cook_logs where user_id = v_uid and photo_path is not null)
      into v_total;
    if v_total >= least(coalesce(p_max_images, 2000), 2000) then
      return null;
    end if;
    select (select coalesce(sum(size_bytes), 0) from public.recipe_images where owner_id = v_uid)
         + (select coalesce(sum(size_bytes), 0) from public.cook_logs where user_id = v_uid)
      into v_bytes;
    if v_bytes + p_size_bytes > least(coalesce(p_max_bytes, 524288000), 524288000) then
      return null;
    end if;
  end if;
  insert into public.cook_logs (recipe_id, user_id, cooked_at, note, visibility, photo_path, size_bytes)
  values (p_recipe_id, v_uid, p_cooked_at, p_note, p_visibility, p_photo_path, case when p_photo_path is null then 0 else p_size_bytes end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.insert_cook_log(uuid, timestamptz, text, text, text, bigint, int, bigint) from public, anon;
grant execute on function public.insert_cook_log(uuid, timestamptz, text, text, text, bigint, int, bigint) to authenticated;

create or replace function public.cook_logs_lock_refs()
returns trigger language plpgsql as $$
begin
  if new.recipe_id is distinct from old.recipe_id then
    raise exception 'cook_logs.recipe_id is immutable' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'cook_logs.user_id is immutable' using errcode = '42501';
  end if;
  if new.photo_path is distinct from old.photo_path then
    raise exception 'cook_logs.photo_path is immutable' using errcode = '42501';
  end if;
  if new.size_bytes is distinct from old.size_bytes then
    raise exception 'cook_logs.size_bytes is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
