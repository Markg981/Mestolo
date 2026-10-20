-- Inviti: link monouso a scadenza con cui un utente invita altre persone e diventa loro amico.
-- Il token in chiaro esiste solo nel link: nel database c'e' soltanto l'hash sha256 (hex).

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses int not null default 5 check (max_uses between 1 and 50),
  uses int not null default 0 check (uses >= 0),
  revoked_at timestamptz
);
create index invites_inviter_idx on public.invites (inviter_id, created_at desc);

create table public.invite_redemptions (
  invite_id uuid not null references public.invites (id) on delete cascade,
  redeemer_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invite_id, redeemer_id)
);
create index invite_redemptions_redeemer_idx on public.invite_redemptions (redeemer_id);

-- Al massimo 10 inviti attivi per utente
create or replace function public.invites_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.invites
      where inviter_id = new.inviter_id and revoked_at is null
        and expires_at > now() and uses < max_uses) >= 10 then
    raise exception 'too_many_active_invites' using errcode = 'RL002';
  end if;
  return new;
end $$;
revoke execute on function public.invites_before_insert() from public, anon, authenticated;
create trigger invites_before_insert before insert on public.invites
  for each row execute function public.invites_before_insert();

alter table public.invites enable row level security;
alter table public.invite_redemptions enable row level security;

-- Solo il proprietario vede e gestisce i propri inviti; il client puo' fornire solo l'hash
-- e, in aggiornamento, revocare (le altre colonne restano fisse per i privilegi di colonna).
revoke all on public.invites from anon, authenticated;
revoke all on public.invite_redemptions from anon, authenticated;
grant select on public.invites to authenticated;
grant insert (token_hash) on public.invites to authenticated;
grant update (revoked_at) on public.invites to authenticated;
grant select on public.invite_redemptions to authenticated;

create policy invites_select on public.invites for select to authenticated
  using (inviter_id = (select auth.uid()));
create policy invites_insert on public.invites for insert to authenticated
  with check (inviter_id = (select auth.uid()));
create policy invites_update on public.invites for update to authenticated
  using (inviter_id = (select auth.uid())) with check (inviter_id = (select auth.uid()));
create policy invite_redemptions_select on public.invite_redemptions for select to authenticated
  using (exists (select 1 from public.invites i where i.id = invite_id and i.inviter_id = (select auth.uid())));

-- Anteprima pubblica: solo username e nome visualizzato dell'invitante, e solo se l'invito e' valido.
-- Nessuna distinzione tra token inesistente, scaduto, revocato o esaurito.
create or replace function public.invite_preview(p_token text)
returns table (username text, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.username, p.display_name
  from public.invites i
  join public.profiles p on p.id = i.inviter_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
    and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses;
$$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- Accetta un invito: crea (o promuove) l'amicizia con l'invitante. Un solo errore generico ('invalid_invite').
-- Richiedente = chi accetta, cosi' il limite giornaliero di richieste conta su di lui e non sull'invitante.
create or replace function public.accept_invite(p_token text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_inv public.invites%rowtype;
begin
  if v_me is null then
    raise exception 'invalid_invite' using errcode = 'IV001';
  end if;
  select * into v_inv from public.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at <= now()
     or v_inv.inviter_id = v_me or public.is_blocked_between(v_inv.inviter_id, v_me) then
    raise exception 'invalid_invite' using errcode = 'IV001';
  end if;
  -- gia' riscattato da questo utente, o gia' amici: nessun consumo
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and redeemer_id = v_me)
     or public.are_friends(v_inv.inviter_id, v_me) then
    return 'already_friends';
  end if;
  if v_inv.uses >= v_inv.max_uses then
    raise exception 'invalid_invite' using errcode = 'IV001';
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
