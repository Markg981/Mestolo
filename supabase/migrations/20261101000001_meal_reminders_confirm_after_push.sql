-- Promemoria dei pasti: "prenota" (claim) e "conferma" separati.
-- Prima claim_due_meal_reminders() segnava il pasto come inviato PRIMA del push: un errore transitorio
-- (rete, 5xx del servizio push, crash della funzione) perdeva il promemoria per sempre.
-- Ora il claim prende un lease di 5 minuti (anti-duplicati tra invocazioni parallele) e la route chiama
-- confirm_meal_reminders() solo dopo l'esito del push. Se non viene confermato, dopo il lease il pasto
-- torna selezionabile (finche' e' nella finestra temporale) fino a un massimo di 3 tentativi.

alter table public.meal_reminders_sent
  add column claimed_at timestamptz not null default now(),
  add column attempts integer not null default 1,
  add column confirmed_at timestamptz;

-- Le righe esistenti sono gia' state inviate (o date per perse): considerale confermate.
update public.meal_reminders_sent set claimed_at = sent_at, confirmed_at = sent_at;

create or replace function public.claim_due_meal_reminders(p_now timestamptz default now(), p_window_minutes integer default 20)
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
      and not exists (
        select 1 from public.meal_reminders_sent x
        where x.entry_id = e.id
          and (x.confirmed_at is not null or x.attempts >= 3 or x.claimed_at > now() - interval '5 minutes')
      )
  ),
  claimed as (
    insert into public.meal_reminders_sent as m (entry_id, claimed_at, attempts)
    select id, now(), 1 from due
    on conflict (entry_id) do update
      set claimed_at = now(), attempts = m.attempts + 1
      where m.confirmed_at is null and m.attempts < 3 and m.claimed_at <= now() - interval '5 minutes'
    returning m.entry_id
  )
  select d.id, d.owner_id, d.slot, d.title, d.locale from due d join claimed c on c.entry_id = d.id;
$$;
revoke all on function public.claim_due_meal_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_meal_reminders(timestamptz, integer) to service_role;

-- Conferma l'esito (inviato, oppure non recapitabile in modo definitivo): il pasto non verra' piu' riselezionato.
create function public.confirm_meal_reminders(p_entry_ids uuid[])
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.meal_reminders_sent set confirmed_at = now()
  where entry_id = any (p_entry_ids) and confirmed_at is null;
$$;
revoke all on function public.confirm_meal_reminders(uuid[]) from public, anon, authenticated;
grant execute on function public.confirm_meal_reminders(uuid[]) to service_role;
