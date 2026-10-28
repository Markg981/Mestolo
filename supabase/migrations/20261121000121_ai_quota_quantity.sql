-- C-02: l'import foto consumava 1 unita di quota vision anche con 8 pagine.
-- consume_ai_quota e refund_ai_quota ricevono una quantita' (p_qty, default 1):
-- il consumo e' atomico (tutte le unita' o nessuna: used + qty > limit => false)
-- e il rimborso rimuove fino a p_qty righe dello stesso gruppo+azione.
-- Resta eseguibile solo dal service role (C-20).

drop function if exists public.consume_ai_quota(uuid, text, integer, text, text);
drop function if exists public.refund_ai_quota(uuid, text, text);

create or replace function public.consume_ai_quota(
  p_user_id uuid,
  p_group text,
  p_limit integer,
  p_action text,
  p_provider text,
  p_qty integer default 1
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
  if p_qty is null or p_qty < 1 or p_qty > 50 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_user_id::text || ':' || p_group, 0));

  select count(*) into v_used
  from public.ai_usage
  where user_id = p_user_id
    and key_source = 'app'
    and action like p_group || ':%'
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  if v_used + p_qty > p_limit then
    return false;
  end if;

  insert into public.ai_usage (user_id, action, provider, key_source)
  select p_user_id, p_group || ':' || p_action, p_provider, 'app'
  from generate_series(1, p_qty);
  return true;
end;
$$;

revoke all on function public.consume_ai_quota(uuid, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, integer, text, text, integer) to service_role;

create or replace function public.refund_ai_quota(
  p_user_id uuid,
  p_group text,
  p_action text,
  p_qty integer default 1
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_group not in ('text', 'vision', 'image', 'translate') then
    raise exception 'invalid quota group' using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_user_id::text || ':' || p_group, 0));

  with victims as (
    select id from public.ai_usage
    where user_id = p_user_id
      and key_source = 'app'
      and action = p_group || ':' || p_action
      and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    order by created_at desc, id desc
    limit p_qty
  )
  delete from public.ai_usage u using victims v where u.id = v.id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.refund_ai_quota(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.refund_ai_quota(uuid, text, text, integer) to service_role;
