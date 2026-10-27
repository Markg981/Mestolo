-- DB-02: la quota sui byte somma recipe_images.size_bytes, ma la policy UPDATE non restringe le
-- colonne e il trigger lock_refs (ridefinito prima di size_bytes) non la proteggeva: un utente
-- authenticated poteva fare UPDATE size_bytes = 0 e aggirare la quota. Ora size_bytes e' immutabile
-- per i ruoli client (authenticated/anon); restano modificabili da ruoli di servizio/manutenzione.
-- I limiti p_max_* sono gia' vincolati lato DB da 20261121000004 (il client puo' solo restringere).
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
  if new.size_bytes is distinct from old.size_bytes and current_user in ('authenticated', 'anon') then
    raise exception 'recipe_images.size_bytes is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
