-- Gli upload nel bucket delle immagini passano solo dal server (service role),
-- che applica dimensione, tipo MIME e limite giornaliero per utente.
-- Gli utenti authenticated non possono scrivere direttamente via Supabase.
drop policy if exists recipe_images_storage_insert on storage.objects;
drop policy if exists recipe_images_storage_update on storage.objects;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
where id = 'recipe-images';
