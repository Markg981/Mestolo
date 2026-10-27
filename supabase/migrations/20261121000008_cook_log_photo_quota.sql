-- L-01: le foto dei cook log non contavano nel tetto di byte e il controllo (app) non era atomico.
-- cook_logs.size_bytes = byte reali della foto elaborata dal server (0 per le righe preesistenti e senza foto).
-- insert_cook_log fa controllo quota + inserimento nella stessa transazione, sotto lo stesso advisory lock
-- per utente di insert_recipe_image: conta immagini (recipe_images + foto dei log) e somma i byte di entrambe.
-- E' security invoker: la RLS di cook_logs (ricetta leggibile, user_id = auth.uid()) resta valida.
-- Nota: il numero versione 000008 evita il conflitto con 20261121000006_anon_default_privileges gia' presente.

alter table public.cook_logs add column if not exists size_bytes bigint not null default 0 check (size_bytes >= 0);

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
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_bytes bigint;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
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
