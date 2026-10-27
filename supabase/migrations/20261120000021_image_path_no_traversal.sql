-- M-21: insert_recipe_image controlla solo il prefisso '<uid>/<recipe>/', quindi
-- '<uid>/<recipe>/../../<altro>/x' passerebbe. Vincolo difensivo sui path (senza
-- ridefinire la funzione): niente '..', '//', '\' o '/' iniziale.
-- not valid + validate: il vincolo vale subito per le nuove scritture; la validate
-- fallisce (e blocca la migrazione) se esistono righe non conformi, da ripulire a mano.
alter table public.recipe_images
  add constraint recipe_images_path_safe check (
    storage_path !~ '(^/|//|\\|(^|/)\.\.(/|$))'
    and (thumb_path is null or thumb_path !~ '(^/|//|\\|(^|/)\.\.(/|$))')
  ) not valid;
alter table public.recipe_images validate constraint recipe_images_path_safe;

alter table public.cook_logs
  add constraint cook_logs_photo_path_safe check (
    photo_path is null or photo_path !~ '(^/|//|\\|(^|/)\.\.(/|$))'
  ) not valid;
alter table public.cook_logs validate constraint cook_logs_photo_path_safe;
