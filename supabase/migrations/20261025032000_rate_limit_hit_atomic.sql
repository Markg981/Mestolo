-- rate_limit_hit atomico: con richieste parallele il count+insert non
-- serializzato permetteva di superare il limite. Si prende un advisory lock
-- di transazione per bucket prima del count, cosi' check+insert sono
-- serializzati per lo stesso bucket (bucket diversi restano concorrenti).
-- Firma, semantica, security definer, search_path e grant invariati.
create or replace function public.rate_limit_hit(p_bucket text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_bucket));
  select count(*) into n from public.rate_limit_events
  where bucket = p_bucket and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_limit_events (bucket) values (p_bucket);
  if random() < 0.01 then
    delete from public.rate_limit_events where created_at < now() - interval '2 days';
  end if;
  return true;
end;
$$;

revoke execute on function public.rate_limit_hit(text, int, int) from public, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
