-- Fase 4: preferenze di pianificazione (tabella dedicata, accesso solo al proprietario) e spostamento/scambio
-- atomico delle voci del piano settimanale.

create table public.plan_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  meals public.meal_slot[] not null default '{lunch,dinner}' check (cardinality(meals) between 1 and 4),
  -- giorni della settimana da coprire: 0 = lunedi' ... 6 = domenica
  days smallint[] not null default '{0,1,2,3,4,5,6}' check (cardinality(days) between 1 and 7 and days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  weekday_max_minutes integer check (weekday_max_minutes is null or weekday_max_minutes between 5 and 1440),
  preferred_tags text[] not null default '{}' check (cardinality(preferred_tags) <= 30),
  excluded_tags text[] not null default '{}' check (cardinality(excluded_tags) <= 30),
  preferred_category_ids uuid[] not null default '{}' check (cardinality(preferred_category_ids) <= 30),
  excluded_category_ids uuid[] not null default '{}' check (cardinality(excluded_category_ids) <= 30),
  avoid_ingredients text[] not null default '{}' check (cardinality(avoid_ingredients) <= 50),
  repeat_level text not null default 'medium' check (repeat_level in ('low', 'medium', 'high')),
  servings numeric(7, 2) check (servings is null or (servings > 0 and servings <= 1000)),
  updated_at timestamptz not null default now()
);

create function public.plan_preferences_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger plan_preferences_touch before insert or update on public.plan_preferences
  for each row execute function public.plan_preferences_touch();

alter table public.plan_preferences enable row level security;
create policy plan_preferences_select on public.plan_preferences for select to authenticated using (user_id = auth.uid());
create policy plan_preferences_insert on public.plan_preferences for insert to authenticated with check (user_id = auth.uid());
create policy plan_preferences_update on public.plan_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy plan_preferences_delete on public.plan_preferences for delete to authenticated using (user_id = auth.uid());

-- Sposta una voce in un'altra cella (giorno + pasto). Se p_swap_with e' indicato, le due voci si scambiano
-- di posto. Security definer perche' deve azzerare il registro dei promemoria (meal_reminders_sent, senza
-- policy): una voce spostata deve poter ricevere il promemoria del nuovo orario. Il proprietario viene
-- verificato esplicitamente con auth.uid().
create function public.move_plan_entry(p_entry uuid, p_date date, p_slot public.meal_slot, p_swap_with uuid default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.meal_plan_entries;
  b public.meal_plan_entries;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into a from public.meal_plan_entries where id = p_entry and owner_id = auth.uid() for update;
  if not found then
    raise exception 'entry not found' using errcode = '42501';
  end if;
  if p_swap_with is not null then
    if p_swap_with = p_entry then
      raise exception 'cannot swap an entry with itself' using errcode = '22023';
    end if;
    select * into b from public.meal_plan_entries where id = p_swap_with and owner_id = auth.uid() for update;
    if not found then
      raise exception 'entry not found' using errcode = '42501';
    end if;
    update public.meal_plan_entries set plan_date = b.plan_date, slot = b.slot where id = a.id;
    update public.meal_plan_entries set plan_date = a.plan_date, slot = a.slot where id = b.id;
    delete from public.meal_reminders_sent where entry_id in (a.id, b.id);
  else
    if p_date is null or p_slot is null then
      raise exception 'destination required' using errcode = '22023';
    end if;
    update public.meal_plan_entries set plan_date = p_date, slot = p_slot where id = a.id;
    delete from public.meal_reminders_sent where entry_id = a.id;
  end if;
end $$;
revoke all on function public.move_plan_entry(uuid, date, public.meal_slot, uuid) from public, anon;
grant execute on function public.move_plan_entry(uuid, date, public.meal_slot, uuid) to authenticated;
