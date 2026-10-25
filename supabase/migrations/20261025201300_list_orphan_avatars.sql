-- C-13: rete di sicurezza per il bucket avatars, come list_orphan_images() per recipe-images.
-- Elenca i file di avatars che nessun profilo referenzia (profiles.avatar_path) e piu' vecchi di
-- 24 ore, per non toccare un upload in corso. La rimozione avviene dalla route /api/cron/cleanup
-- tramite la Storage API (cancellare le righe di storage.objects via SQL non elimina il file).

create or replace function public.list_orphan_avatars(p_limit integer default 200)
returns table (name text)
language sql stable security definer set search_path = public, storage, pg_temp as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'avatars'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.profiles p where p.avatar_path = o.name
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
revoke all on function public.list_orphan_avatars(integer) from public, anon, authenticated;
grant execute on function public.list_orphan_avatars(integer) to service_role;
