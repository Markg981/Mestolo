-- Promemoria dei pasti pianificati.
-- 1) notification_preferences: opt-in, fuso orario IANA dell'utente e orario del promemoria per ogni
--    slot (NULL = nessun promemoria per quello slot). Usata sia dalle notifiche locali dell'app nativa
--    sia dal cron Web Push.
-- 2) push_subscriptions: sottoscrizioni Web Push (una per browser/dispositivo). L'endpoint e' univoco:
--    save_push_subscription() lo riassegna all'utente corrente se lo stesso browser cambia account.
-- 3) meal_reminders_sent: registro dei promemoria gia' inviati (dedup). Scrive solo
--    claim_due_meal_reminders(), richiamabile solo dal service role (route /api/cron/meal-reminders).

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  enabled boolean not null default false,
  timezone text not null default 'Europe/Rome' check (char_length(timezone) between 1 and 64),
  breakfast_time time,
  lunch_time time default '11:30',
  dinner_time time default '18:30',
  snack_time time,
  updated_at timestamptz not null default now()
);

-- Un fuso sconosciuto farebbe fallire l'intera query dei promemoria: lo rifiuta la scrittura (22023).
create function public.notification_preferences_check_tz() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  perform now() at time zone new.timezone;
  new.updated_at := now();
  return new;
end $$;
create trigger notification_preferences_check_tz before insert or update on public.notification_preferences
  for each row execute function public.notification_preferences_check_tz();

alter table public.notification_preferences enable row level security;
create policy notification_preferences_select on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated with check (user_id = auth.uid());
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_preferences_delete on public.notification_preferences for delete to authenticated using (user_id = auth.uid());

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint text not null unique check (char_length(endpoint) between 10 and 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth text not null check (char_length(auth) between 1 and 256),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create table public.meal_reminders_sent (
  entry_id uuid primary key references public.meal_plan_entries (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.meal_reminders_sent enable row level security;
-- nessuna policy: accesso solo tramite service role / funzioni security definer

-- Seleziona e "prenota" (in un'unica istruzione, senza race tra invocazioni parallele) i pasti il cui
-- orario di promemoria, nel fuso dell'utente, e' caduto negli ultimi p_window_minutes minuti.
-- Considera solo utenti con opt-in e almeno una sottoscrizione push.
create function public.claim_due_meal_reminders(p_now timestamptz default now(), p_window_minutes integer default 20)
returns table (entry_id uuid, user_id uuid, slot public.meal_slot, title text, locale text)
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select e.id, e.owner_id, e.slot, e.title, pr.locale
    from public.notification_preferences np
    join public.meal_plan_entries e on e.owner_id = np.user_id
    join public.profiles pr on pr.id = np.user_id
    cross join lateral (
      select case e.slot
        when 'breakfast' then np.breakfast_time
        when 'lunch' then np.lunch_time
        when 'dinner' then np.dinner_time
        when 'snack' then np.snack_time
      end as t
    ) st
    where np.enabled
      and st.t is not null
      and exists (select 1 from public.push_subscriptions s where s.user_id = np.user_id)
      and e.plan_date between (p_now at time zone np.timezone)::date - 1 and (p_now at time zone np.timezone)::date + 1
      and ((e.plan_date + st.t) at time zone np.timezone) <= p_now
      and ((e.plan_date + st.t) at time zone np.timezone) > p_now - make_interval(mins => least(greatest(coalesce(p_window_minutes, 20), 1), 120))
      and not exists (select 1 from public.meal_reminders_sent x where x.entry_id = e.id)
  ),
  claimed as (
    insert into public.meal_reminders_sent (entry_id) select id from due on conflict do nothing returning meal_reminders_sent.entry_id
  )
  select d.id, d.owner_id, d.slot, d.title, d.locale from due d join claimed c on c.entry_id = d.id;
$$;
revoke all on function public.claim_due_meal_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_meal_reminders(timestamptz, integer) to service_role;
