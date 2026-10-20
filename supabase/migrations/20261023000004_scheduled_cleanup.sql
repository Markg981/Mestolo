-- Pulizia programmata.
-- 1) cleanup_old_usage(): elimina dal database i dati di quota/rate limit piu' vecchi di p_days giorni.
--    La logica di quota usa solo il giorno UTC corrente (ai_usage, daily_action_counts) e finestre
--    brevi (rate_limit_events), quindi 90 giorni di storico sono ampiamente sufficienti.
-- 2) list_orphan_images(): elenca i file del bucket recipe-images senza riga in recipe_images
--    (ne' come immagine ne' come miniatura), piu' vecchi di 24 ore per non interferire con upload in corso.
--    Cancellare le righe di storage.objects via SQL NON elimina il file: la rimozione avviene
--    dalla route /api/cron/cleanup tramite la Storage API.
-- Le righe di recipe_images senza ricetta non esistono: la FK ha on delete cascade.

create or replace function public.cleanup_old_usage(p_days integer default 90)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 90), 7));
  v_ai bigint;
  v_counts bigint;
  v_rl bigint;
begin
  delete from public.ai_usage where created_at < v_cutoff;
  get diagnostics v_ai = row_count;
  delete from public.daily_action_counts where day < (v_cutoff at time zone 'utc')::date;
  get diagnostics v_counts = row_count;
  delete from public.rate_limit_events where created_at < v_cutoff;
  get diagnostics v_rl = row_count;
  return jsonb_build_object('ai_usage', v_ai, 'daily_action_counts', v_counts, 'rate_limit_events', v_rl);
end $$;
revoke all on function public.cleanup_old_usage(integer) from public, anon, authenticated;

create or replace function public.list_orphan_images(p_limit integer default 200)
returns table (name text)
language sql stable security definer set search_path = public, storage, pg_temp as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'recipe-images'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.recipe_images i
      where i.storage_path = o.name or i.thumb_path = o.name
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
revoke all on function public.list_orphan_images(integer) from public, anon, authenticated;
grant execute on function public.list_orphan_images(integer) to service_role;

-- pg_cron solo se l'estensione e' disponibile (su Supabase va abilitata dalla dashboard);
-- altrove (es. CI con postgres:16 semplice) la migrazione si applica comunque.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule(jobid) from cron.job where jobname = 'mestolo-cleanup-usage';
      perform cron.schedule('mestolo-cleanup-usage', '17 3 * * *', 'select public.cleanup_old_usage(90)');
    exception when others then
      raise notice 'pg_cron non configurato (%): pianificare manualmente cleanup_old_usage()', sqlerrm;
    end;
  else
    raise notice 'pg_cron non disponibile: pianificare manualmente public.cleanup_old_usage()';
  end if;
end $$;
