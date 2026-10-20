-- Limiti di frequenza applicati dal database: valgono anche chiamando PostgREST direttamente.
-- Soglie uguali a quelle del server (src/lib/rate-limit.ts): friend_request 30/giorno, report 20/giorno.
-- Il contatore giornaliero e' per utente; non scende se la riga viene poi cancellata.

create table public.daily_action_counts (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  day date not null default (now() at time zone 'utc')::date,
  n int not null default 0,
  primary key (user_id, action, day)
);
alter table public.daily_action_counts enable row level security;
revoke all on table public.daily_action_counts from anon, authenticated;

create or replace function public.enforce_daily_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_max int := tg_argv[1]::int;
  v_n int;
begin
  v_user := case tg_argv[0] when 'friend_request' then new.requester_id else new.reporter_id end;
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

create trigger friendships_daily_limit before insert on public.friendships
  for each row execute function public.enforce_daily_limit('friend_request', '30');
create trigger reports_daily_limit before insert on public.reports
  for each row execute function public.enforce_daily_limit('report', '20');
