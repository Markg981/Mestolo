-- D-07: le policy insert/update su push_subscriptions permettevano scritture dirette che aggirano la RPC
-- save_push_subscription (e il rate limit push_subscribe applicato dalla server action) e, in caso di
-- conflitto sull'endpoint, un 23505 rivelava che l'endpoint e' registrato da un altro account.
-- L'app scrive solo tramite la RPC (security definer, quindi non soggetta a RLS ne' ai grant del chiamante)
-- e il cron usa il service role. Restano select e delete per authenticated (disiscrizione).
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
revoke insert, update on public.push_subscriptions from authenticated, anon;
