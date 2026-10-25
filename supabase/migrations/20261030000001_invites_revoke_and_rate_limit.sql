-- Inviti: (1) la revoca e' irreversibile, (2) i tentativi falliti di accept_invite hanno un rate limit per utente.

-- (1) Con il solo grant update (revoked_at) un utente poteva rimettere revoked_at a null,
-- "riattivando" inviti e superando il tetto di 10 attivi (controllato solo all'insert).
-- Una volta impostato, revoked_at non si cambia piu' e non si puo' azzerare.
create or replace function public.invites_before_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'invite_revocation_immutable' using errcode = 'IV002';
  end if;
  return new;
end $$;
revoke execute on function public.invites_before_update() from public, anon, authenticated;
create trigger invites_before_update before update on public.invites
  for each row execute function public.invites_before_update();

-- (2) Un'eccezione annullerebbe la registrazione del tentativo fallito (rollback della transazione):
-- per questo i fallimenti ora restituiscono 'invalid_invite' invece di sollevare IV001, cosi' l'evento
-- in rate_limit_events resta. Oltre 10 fallimenti in 15 minuti per utente: RL001 (rate_limited).
create or replace function public.accept_invite(p_token text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_inv public.invites%rowtype;
  v_bucket text;
begin
  if v_me is null then
    raise exception 'invalid_invite' using errcode = 'IV001';
  end if;
  v_bucket := 'invite_accept_fail:' || v_me::text;
  if (select count(*) from public.rate_limit_events
      where bucket = v_bucket and created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'rate_limited' using errcode = 'RL001';
  end if;

  select * into v_inv from public.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at <= now()
     or v_inv.inviter_id = v_me or public.is_blocked_between(v_inv.inviter_id, v_me) then
    insert into public.rate_limit_events (bucket) values (v_bucket);
    return 'invalid_invite';
  end if;
  -- gia' riscattato da questo utente, o gia' amici: nessun consumo
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and redeemer_id = v_me)
     or public.are_friends(v_inv.inviter_id, v_me) then
    return 'already_friends';
  end if;
  if v_inv.uses >= v_inv.max_uses then
    insert into public.rate_limit_events (bucket) values (v_bucket);
    return 'invalid_invite';
  end if;

  -- una richiesta pendente o rifiutata viene sostituita da un'amicizia accettata
  delete from public.friendships
  where least(requester_id, addressee_id) = least(v_inv.inviter_id, v_me)
    and greatest(requester_id, addressee_id) = greatest(v_inv.inviter_id, v_me);
  insert into public.friendships (requester_id, addressee_id, status, responded_at)
  values (v_me, v_inv.inviter_id, 'accepted', now());

  update public.invites set uses = uses + 1 where id = v_inv.id;
  insert into public.invite_redemptions (invite_id, redeemer_id) values (v_inv.id, v_me);
  return 'accepted';
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
