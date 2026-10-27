-- L-14: lock per le traduzioni. Due richieste concorrenti per la stessa (ricetta, lingua)
-- chiamavano entrambe il provider AI consumando quota due volte.
-- Claim atomico: insert ... on conflict do nothing; un lock piu vecchio del TTL e considerato
-- abbandonato (crash) e viene rimosso al claim successivo.
create table public.recipe_translation_locks (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  locked_at timestamptz not null default now(),
  primary key (recipe_id, locale)
);
alter table public.recipe_translation_locks enable row level security;
revoke all on table public.recipe_translation_locks from anon, authenticated;

create or replace function public.claim_translation_lock(p_recipe uuid, p_locale text, p_ttl_seconds int default 120)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  delete from public.recipe_translation_locks
   where recipe_id = p_recipe and locale = p_locale
     and locked_at < now() - make_interval(secs => p_ttl_seconds);
  insert into public.recipe_translation_locks (recipe_id, locale) values (p_recipe, p_locale)
    on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

create or replace function public.release_translation_lock(p_recipe uuid, p_locale text)
returns void language sql security definer set search_path = public as $$
  delete from public.recipe_translation_locks where recipe_id = p_recipe and locale = p_locale;
$$;

revoke all on function public.claim_translation_lock(uuid, text, int) from public, anon, authenticated;
revoke all on function public.release_translation_lock(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_translation_lock(uuid, text, int) to service_role;
grant execute on function public.release_translation_lock(uuid, text) to service_role;
