-- =====================================================================
-- Mestolo - audit C-11: niente piu nascondimento automatico a 3 segnalazioni
--  * prima 3 segnalatori "affidabili" bastavano a nascondere una ricetta, senza
--    avvisare l'autore ne dargli un appello (aggirabile con account fittizi se
--    la conferma email e disattivata in produzione)
--  * ora, superata la soglia (3), la ricetta resta visibile ma entra nella coda
--    dei moderatori (stato 'in_review'); nasconde solo un moderatore (moderate_report)
--  * nascondimento automatico d'emergenza solo a soglia molto piu alta (10)
--  * l'autore riceve un avviso (moderation_notices) quando la ricetta va in revisione,
--    viene nascosta o ripristinata, e puo fare appello (appeal_moderation):
--    la ricetta torna in coda con le segnalazioni riaperte
-- =====================================================================

create table public.moderation_cases (
  recipe_id uuid primary key references public.recipes (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('in_review', 'hidden', 'restored')),
  appealed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.moderation_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  kind text not null check (kind in ('in_review', 'hidden', 'restored')),
  created_at timestamptz not null default now()
);
create index moderation_notices_user_idx on public.moderation_notices (user_id, created_at desc);
create index moderation_notices_recipe_idx on public.moderation_notices (recipe_id, created_at desc);

alter table public.moderation_cases enable row level security;
alter table public.moderation_notices enable row level security;

create policy moderation_cases_select on public.moderation_cases for select to authenticated
  using (owner_id = auth.uid() or public.is_moderator());
create policy moderation_notices_select on public.moderation_notices for select to authenticated
  using (user_id = auth.uid());

revoke all on public.moderation_cases, public.moderation_notices from public, anon, authenticated;
grant select on public.moderation_cases, public.moderation_notices to authenticated;

-- Imposta lo stato del caso e avvisa l'autore (solo uso interno, dalle funzioni security definer)
create or replace function public.moderation_set_case(p_recipe uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  select owner_id into owner from public.recipes where id = p_recipe;
  if owner is null then
    return;
  end if;
  insert into public.moderation_cases (recipe_id, owner_id, status)
    values (p_recipe, owner, p_status)
    on conflict (recipe_id) do update set status = excluded.status, updated_at = now();
  insert into public.moderation_notices (user_id, recipe_id, kind) values (owner, p_recipe, p_status);
end;
$$;
revoke all on function public.moderation_set_case(uuid, text) from public, anon, authenticated;

-- Soglie: 3 segnalatori affidabili => coda di revisione; 10 => nascondimento d'emergenza
create or replace function public.reports_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
  cur text;
begin
  select count(distinct r.reporter_id) into n
    from public.reports r
    join auth.users u on u.id = r.reporter_id
    join public.recipes rc on rc.id = r.recipe_id
   where r.recipe_id = new.recipe_id
     and r.status = 'open'
     and r.reporter_id <> rc.owner_id
     and u.email_confirmed_at is not null
     and u.created_at < now() - interval '7 days';

  select status into cur from public.moderation_cases where recipe_id = new.recipe_id;

  if n >= 10 then
    if exists (select 1 from public.recipes where id = new.recipe_id and not is_hidden) then
      perform set_config('mestolo.moderation', 'on', true);
      update public.recipes set is_hidden = true where id = new.recipe_id and not is_hidden;
      perform set_config('mestolo.moderation', 'off', true);
      perform public.moderation_set_case(new.recipe_id, 'hidden');
    end if;
  elsif n >= 3 and (cur is null or cur = 'restored') then
    perform public.moderation_set_case(new.recipe_id, 'in_review');
  end if;
  return new;
end;
$$;
revoke all on function public.reports_after_insert() from public, anon, authenticated;

-- Azioni del moderatore: ora aggiornano anche il caso e avvisano l'autore
create or replace function public.moderate_report(p_report uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  was_hidden boolean;
  cur text;
begin
  if not public.is_moderator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action not in ('hide', 'restore', 'dismiss') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  select recipe_id into rid from public.reports where id = p_report;
  if rid is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  select status into cur from public.moderation_cases where recipe_id = rid;

  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed' where id = p_report;
    -- nessuna segnalazione aperta rimasta: la revisione si chiude
    if cur = 'in_review'
       and not exists (select 1 from public.reports where recipe_id = rid and status = 'open')
       and not exists (select 1 from public.recipes where id = rid and is_hidden) then
      perform public.moderation_set_case(rid, 'restored');
    end if;
    return;
  end if;

  select is_hidden into was_hidden from public.recipes where id = rid;
  perform set_config('mestolo.moderation', 'on', true);
  update public.recipes set is_hidden = (p_action = 'hide') where id = rid;
  perform set_config('mestolo.moderation', 'off', true);

  update public.reports
     set status = case when p_action = 'hide' then 'reviewed' else 'dismissed' end
   where recipe_id = rid and status = 'open';

  if p_action = 'hide' and (not coalesce(was_hidden, false) or cur = 'in_review') then
    -- nuovo nascondimento, oppure conferma dopo un appello
    perform public.moderation_set_case(rid, 'hidden');
  elsif p_action = 'restore' and (cur is not null or coalesce(was_hidden, false)) then
    perform public.moderation_set_case(rid, 'restored');
  end if;
end;
$$;
revoke execute on function public.moderate_report(uuid, text) from public, anon;
grant execute on function public.moderate_report(uuid, text) to authenticated;

-- Appello dell'autore: una sola volta per caso; riporta la ricetta in coda
create or replace function public.appeal_moderation(p_recipe uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.moderation_cases;
begin
  select * into c from public.moderation_cases where recipe_id = p_recipe;
  if c.recipe_id is null or c.owner_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if c.status <> 'hidden' or c.appealed_at is not null then
    raise exception 'appeal not allowed' using errcode = '22023';
  end if;
  update public.moderation_cases set status = 'in_review', appealed_at = now(), updated_at = now() where recipe_id = p_recipe;
  -- la ricetta resta nascosta; le segnalazioni gia esaminate tornano aperte per il moderatore
  update public.reports set status = 'open' where recipe_id = p_recipe and status = 'reviewed';
end;
$$;
revoke execute on function public.appeal_moderation(uuid) from public, anon;
grant execute on function public.appeal_moderation(uuid) to authenticated;
