-- Feedback in-app di tester e utenti (bug, idee, altro).
-- Inserimento: solo utenti autenticati, solo come se stessi, max 10 al giorno (trigger sul DB).
-- Lettura: l'autore vede i propri; i moderatori vedono tutti e possono cambiare solo lo stato.
-- Nessun accesso per il ruolo anon.

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 5 and 4000),
  page_path text check (page_path is null or char_length(page_path) <= 300),
  platform text not null default 'web' check (platform in ('web', 'android', 'ios')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);

create index app_feedback_status_created_idx on public.app_feedback (status, created_at desc);
create index app_feedback_user_idx on public.app_feedback (user_id, created_at desc);

alter table public.app_feedback enable row level security;
revoke all on table public.app_feedback from anon, authenticated;

-- Privilegi a livello di colonna: id, user_id (default auth.uid()), status e created_at non sono scrivibili all'inserimento
grant select on public.app_feedback to authenticated;
grant insert (kind, message, page_path, platform, app_version, user_agent) on public.app_feedback to authenticated;
grant update (status) on public.app_feedback to authenticated;

create policy app_feedback_insert on public.app_feedback for insert to authenticated
  with check (user_id = auth.uid());
create policy app_feedback_select_own on public.app_feedback for select to authenticated
  using (user_id = auth.uid());
create policy app_feedback_select_moderator on public.app_feedback for select to authenticated
  using (public.is_moderator());
create policy app_feedback_update_moderator on public.app_feedback for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- Limite giornaliero (stesso meccanismo di friendships e reports)
create trigger app_feedback_daily_limit before insert on public.app_feedback
  for each row execute function public.enforce_daily_limit('feedback', '10', 'user_id');
