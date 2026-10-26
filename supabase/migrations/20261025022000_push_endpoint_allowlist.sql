-- M3: l'endpoint push e' scelto dal client (insert diretto consentito dalla RLS) e il cron vi invia una POST:
-- SSRF cieco verso URL arbitrari. Si restringe agli host dei push service noti (stessa lista di
-- src/lib/notifications/push-endpoint.ts).

-- Righe esistenti non conformi: non sono sottoscrizioni di browser reali, si eliminano.
delete from public.push_subscriptions
where endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)(/|\?|$)';

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_host_check
  check (endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)(/|\?|$)');
