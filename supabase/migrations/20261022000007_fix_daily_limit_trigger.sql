-- Correzione di enforce_daily_limit: il CASE su new.requester_id / new.reporter_id falliva
-- ("record "new" has no field ...") perche' PL/pgSQL risolve entrambi i campi sulla riga reale.
-- Ora la colonna dell'utente arriva come terzo argomento del trigger e si legge via jsonb.

create or replace function public.enforce_daily_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := (to_jsonb(new) ->> tg_argv[2])::uuid;
  v_max int := tg_argv[1]::int;
  v_n int;
begin
  insert into public.daily_action_counts as c (user_id, action, day, n)
  values (v_user, tg_argv[0], (now() at time zone 'utc')::date, 1)
  on conflict (user_id, action, day) do update set n = c.n + 1
  returning c.n into v_n;
  -- se la soglia e' superata l'eccezione annulla anche l'incremento del contatore
  if v_n > v_max then
    raise exception 'rate_limited' using errcode = 'RL001';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_daily_limit() from public, anon, authenticated;

drop trigger friendships_daily_limit on public.friendships;
create trigger friendships_daily_limit before insert on public.friendships
  for each row execute function public.enforce_daily_limit('friend_request', '30', 'requester_id');
drop trigger reports_daily_limit on public.reports;
create trigger reports_daily_limit before insert on public.reports
  for each row execute function public.enforce_daily_limit('report', '20', 'reporter_id');
