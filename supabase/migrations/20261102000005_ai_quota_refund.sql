-- Rimborso della quota AI: consume_ai_quota consuma prima della chiamata al provider;
-- se il provider fallisce o l'output non e' valido la riga va restituita.
-- Rimuove al massimo UNA riga (la piu' recente dell'utente, per gruppo+azione, del giorno
-- corrente, solo chiave app), con lo stesso advisory lock di consume_ai_quota.
-- Solo service role (come consume_ai_quota, C-20): se fosse chiamabile da authenticated
-- un utente potrebbe cancellare le proprie righe di ai_usage e azzerare la quota.
-- Il server passa esplicitamente l'utente.

create or replace function public.refund_ai_quota(
  p_user_id uuid,
  p_group text,
  p_action text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_group not in ('text', 'vision', 'image', 'translate') then
    raise exception 'invalid quota group' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_user_id::text || ':' || p_group, 0));

  select id into v_id
  from public.ai_usage
  where user_id = p_user_id
    and key_source = 'app'
    and action = p_group || ':' || p_action
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  order by created_at desc, id desc
  limit 1;

  if v_id is null then
    return false;
  end if;
  delete from public.ai_usage where id = v_id;
  return true;
end;
$$;

revoke all on function public.refund_ai_quota(uuid, text, text) from public, anon, authenticated;
grant execute on function public.refund_ai_quota(uuid, text, text) to service_role;
