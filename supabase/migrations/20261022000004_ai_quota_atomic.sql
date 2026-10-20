-- Quota AI giornaliera atomica.
-- Prima: l'app contava le righe di ai_usage e inseriva dopo la chiamata AI, quindi
-- richieste parallele superavano il limite. Ora conteggio e inserimento avvengono
-- nella stessa transazione, serializzati da un advisory lock per (utente, gruppo).

create or replace function public.consume_ai_quota(
  p_group text,
  p_limit integer,
  p_action text,
  p_provider text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_used integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_group not in ('text', 'vision', 'image', 'translate') then
    raise exception 'invalid quota group' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  -- Serializza le richieste dello stesso utente e gruppo fino al commit.
  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || v_uid::text || ':' || p_group, 0));

  select count(*) into v_used
  from public.ai_usage
  where user_id = v_uid
    and key_source = 'app'
    and action like p_group || ':%'
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  if v_used >= p_limit then
    return false;
  end if;

  insert into public.ai_usage (user_id, action, provider, key_source)
  values (v_uid, p_group || ':' || p_action, p_provider, 'app');
  return true;
end;
$$;

revoke all on function public.consume_ai_quota(text, integer, text, text) from public, anon;
grant execute on function public.consume_ai_quota(text, integer, text, text) to authenticated;
