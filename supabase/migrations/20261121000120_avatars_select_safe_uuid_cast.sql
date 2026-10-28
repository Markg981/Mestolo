-- B-05: avatars_storage_select (20261025000006) faceva (storage.foldername(name))[1]::uuid.
-- Un oggetto del bucket avatars con prima cartella non uuid faceva fallire con
-- "invalid input syntax for type uuid" l'intera select di chiunque la valutasse.
-- Ricreata la policy con cast protetto da CASE (a differenza di AND, CASE garantisce
-- l'ordine di valutazione): cartella non uuid -> riga semplicemente non visibile.
-- Semantica invariata per i percorsi validi. Idempotente.

drop policy if exists avatars_storage_select on storage.objects;
create policy avatars_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_view_profile_details(((storage.foldername(name))[1])::uuid, auth.uid())
        else false
      end
    )
  );
