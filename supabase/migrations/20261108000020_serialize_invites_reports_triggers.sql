-- M-20: serializza per chiave i trigger con conteggio + azione (tetto inviti, soglia segnalazioni).
-- pg_advisory_xact_lock prima del conteggio: due insert concorrenti non leggono piu' lo stesso conteggio.

-- Al massimo 10 inviti attivi per utente (lock per utente)
create or replace function public.invites_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('invites:' || new.inviter_id::text));
  if (select count(*) from public.invites
      where inviter_id = new.inviter_id and revoked_at is null
        and expires_at > now() and uses < max_uses) >= 10 then
    raise exception 'too_many_active_invites' using errcode = 'RL002';
  end if;
  return new;
end $$;
revoke execute on function public.invites_before_insert() from public, anon, authenticated;

-- Soglie segnalazioni (lock per ricetta)
create or replace function public.reports_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
  cur text;
begin
  perform pg_advisory_xact_lock(hashtext('reports:' || new.recipe_id::text));
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
