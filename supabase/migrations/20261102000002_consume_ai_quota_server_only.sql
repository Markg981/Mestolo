-- C-20: consume_ai_quota accettava p_limit dal client, quindi un utente autenticato
-- poteva chiamarla direttamente e scrivere righe in ai_usage. Ora la funzione e'
-- eseguibile solo dal service role (server) e riceve esplicitamente l'utente.

drop function if exists public.consume_ai_quota(text, integer, text, text);

create or replace function public.consume_ai_quota(
  p_user_id uuid,
  p_group text,
  p_limit integer,
  p_action text,
  p_provider text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_group not in ('text', 'vision', 'image', 'translate') then
    raise exception 'invalid quota group' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  -- Serializza le richieste dello stesso utente e gruppo fino al commit.
  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_user_id::text || ':' || p_group, 0));

  select count(*) into v_used
  from public.ai_usage
  where user_id = p_user_id
    and key_source = 'app'
    and action like p_group || ':%'
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  if v_used >= p_limit then
    return false;
  end if;

  insert into public.ai_usage (user_id, action, provider, key_source)
  values (p_user_id, p_group || ':' || p_action, p_provider, 'app');
  return true;
end;
$$;

revoke all on function public.consume_ai_quota(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, integer, text, text) to service_role;
