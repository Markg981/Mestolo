-- A-28: pulizia di inviti scaduti e promemoria vecchi; storico degli slug delle pagine pubbliche.

-- 1) Pulizia: inviti scaduti/revocati da oltre p_invite_grace_days giorni (i riscatti vanno in cascata)
--    e promemoria pasto inviati da oltre p_reminder_days giorni. La dedup dei promemoria usa una
--    finestra di minuti, quindi la retention non puo' causare re-invii.
create or replace function public.cleanup_stale_rows(p_invite_grace_days integer default 30, p_reminder_days integer default 30)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_invite_grace_days, 30), 1));
  v_rem_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_reminder_days, 30), 7));
  v_inv bigint;
  v_rem bigint;
begin
  delete from public.invites where expires_at < v_inv_cutoff or revoked_at < v_inv_cutoff;
  get diagnostics v_inv = row_count;
  delete from public.meal_reminders_sent where sent_at < v_rem_cutoff;
  get diagnostics v_rem = row_count;
  return jsonb_build_object('invites', v_inv, 'meal_reminders_sent', v_rem);
end $$;
revoke all on function public.cleanup_stale_rows(integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_stale_rows(integer, integer) to service_role;

-- 2) Storico slug: quando il titolo cambia lo slug viene rigenerato e il vecchio continua a risolvere.
create table public.recipe_slug_history (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index recipe_slug_history_recipe_idx on public.recipe_slug_history (recipe_id);
alter table public.recipe_slug_history enable row level security;
revoke all on public.recipe_slug_history from anon, authenticated;

create or replace function public.recipes_public_page_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_new text;
begin
  if tg_op = 'UPDATE' then
    new.public_slug := old.public_slug;
  else
    new.public_slug := null;
  end if;
  if new.visibility <> 'public' then
    new.public_page_enabled := false;
  end if;
  if new.public_page_enabled and new.public_slug is null then
    new.public_slug := public.make_recipe_slug(new.title, new.id);
  elsif tg_op = 'UPDATE' and new.public_slug is not null and new.title is distinct from old.title then
    v_new := public.make_recipe_slug(new.title, new.id);
    if v_new <> new.public_slug then
      insert into public.recipe_slug_history (slug, recipe_id) values (new.public_slug, new.id) on conflict do nothing;
      delete from public.recipe_slug_history where slug = v_new;
      new.public_slug := v_new;
    end if;
  end if;
  return new;
end;
$$;

-- Slug corrente di una pagina pubblica attiva a partire da un vecchio slug (null se non applicabile)
create or replace function public.resolve_public_recipe_slug(p_slug text)
returns text
language sql stable security definer set search_path = public as $$
  select r.public_slug
  from public.recipe_slug_history h
  join public.recipes r on r.id = h.recipe_id
  where h.slug = p_slug
    and r.public_slug is not null and r.public_slug <> h.slug
    and r.public_page_enabled and r.visibility = 'public' and not r.is_hidden;
$$;
revoke all on function public.resolve_public_recipe_slug(text) from public;
grant execute on function public.resolve_public_recipe_slug(text) to anon, authenticated, service_role;
