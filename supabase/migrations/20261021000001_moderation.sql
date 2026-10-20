-- =====================================================================
-- Mestolo – moderazione dei contenuti generati dagli utenti
-- (requisito degli store per le app con contenuti pubblici)
--  * ruolo moderatore assegnabile solo dal gestore (SQL / service role)
--  * i moderatori vedono le segnalazioni e le ricette segnalate
--  * azioni: nascondi, ripristina, archivia la segnalazione (solo via RPC)
--  * filtro automatico: una ricetta segnalata da 3 utenti diversi viene
--    nascosta finché un moderatore non la esamina
-- =====================================================================

alter table public.profiles add column is_moderator boolean not null default false;

-- Nessun utente può attribuirsi il ruolo di moderatore
create or replace function public.profiles_protect()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.is_moderator := old.is_moderator;
  end if;
  return new;
end;
$$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.profiles_protect();

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_moderator from public.profiles p where p.id = auth.uid()), false);
$$;

-- La moderazione può cambiare is_hidden solo passando dalle funzioni qui sotto,
-- che impostano un flag valido per la sola transazione corrente.
create or replace function public.recipes_before_write_moderation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('mestolo.moderation', true) = 'on' then
    -- consentito: la funzione principale userebbe old.is_hidden, lo ripristiniamo dopo
    perform set_config('mestolo.moderation_hidden', new.is_hidden::text, true);
  end if;
  return new;
end;
$$;

create or replace function public.recipes_apply_moderation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('mestolo.moderation', true) = 'on' then
    new.is_hidden := coalesce(nullif(current_setting('mestolo.moderation_hidden', true), '')::boolean, new.is_hidden);
  end if;
  return new;
end;
$$;

-- I trigger BEFORE scattano in ordine alfabetico: "a_" prima di recipes_before_write, "z_" dopo
create trigger a_recipes_moderation_capture
  before update on public.recipes
  for each row execute function public.recipes_before_write_moderation();
create trigger z_recipes_moderation_apply
  before update on public.recipes
  for each row execute function public.recipes_apply_moderation();

-- Lettura per i moderatori
create policy reports_select_moderator on public.reports for select to authenticated
  using (public.is_moderator());

create policy recipes_select_moderator on public.recipes for select to authenticated
  using (public.is_moderator() and exists (select 1 from public.reports r where r.recipe_id = recipes.id));

-- Azioni di moderazione
create or replace function public.moderate_report(p_report uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
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

  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed' where id = p_report;
    return;
  end if;

  perform set_config('mestolo.moderation', 'on', true);
  update public.recipes set is_hidden = (p_action = 'hide') where id = rid;
  perform set_config('mestolo.moderation', 'off', true);

  update public.reports
     set status = case when p_action = 'hide' then 'reviewed' else 'dismissed' end
   where recipe_id = rid and status = 'open';
end;
$$;

revoke execute on function public.moderate_report(uuid, text) from public, anon;
grant execute on function public.moderate_report(uuid, text) to authenticated;

-- Filtro automatico: 3 segnalazioni aperte da utenti diversi => ricetta nascosta
create or replace function public.reports_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  select count(distinct reporter_id) into n
    from public.reports
   where recipe_id = new.recipe_id and status = 'open';
  if n >= 3 then
    perform set_config('mestolo.moderation', 'on', true);
    update public.recipes set is_hidden = true where id = new.recipe_id and not is_hidden;
    perform set_config('mestolo.moderation', 'off', true);
  end if;
  return new;
end;
$$;

create trigger reports_after_insert
  after insert on public.reports
  for each row execute function public.reports_after_insert();

revoke all on function public.reports_after_insert() from public, anon, authenticated;
