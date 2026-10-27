-- C-15: save_push_subscription riassegnava un endpoint esistente a chi lo ri-registrava (bastava conoscerlo).
-- Ora il conflitto aggiorna la riga solo se appartiene gia' all'utente corrente. Se appartiene a un altro utente
-- non viene modificato nulla e non viene sollevato alcun errore: il chiamante TS (savePushSubscription) resta ok(),
-- e non si rivela a B che l'endpoint e' registrato da un altro account. Firma e grant invariati.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
    where push_subscriptions.user_id = auth.uid();
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
