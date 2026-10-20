-- "L'ho cucinata": diario delle volte in cui un utente ha cucinato una ricetta, con nota e foto facoltative.
-- Privacy:
--  * l'autore vede, crea, modifica ed elimina i propri log;
--  * gli altri leggono un log solo se visibility = 'recipe' E possono leggere la ricetta
--    (can_view_recipe: stessa fonte di verita' della ricetta, quindi niente ampliamenti) E non c'e' un blocco;
--  * con visibility = 'private' il log resta visibile solo all'autore, anche su ricette pubbliche;
--  * il proprietario della ricetta puo' eliminare (non leggere i privati) i log altrui sulla sua ricetta.
-- Le foto stanno nel bucket privato recipe-images con percorso <user_id>/cook/<file>.webp e si scrivono
-- solo dal server (service role), come le immagini delle ricette.

create table public.cook_logs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  cooked_at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 1000),
  photo_path text check (photo_path is null or (char_length(photo_path) <= 300 and photo_path like user_id::text || '/cook/%')),
  visibility text not null default 'recipe' check (visibility in ('private', 'recipe')),
  created_at timestamptz not null default now()
);
create index cook_logs_recipe_idx on public.cook_logs (recipe_id, cooked_at desc);
create index cook_logs_user_idx on public.cook_logs (user_id, cooked_at desc);

alter table public.cook_logs enable row level security;

create policy cook_logs_select on public.cook_logs for select to authenticated
  using (
    user_id = auth.uid()
    or (
      visibility = 'recipe'
      and public.can_view_recipe(recipe_id)
      and not public.is_blocked_between(user_id, auth.uid())
    )
  );
-- si puo' registrare solo una ricetta che si e' autorizzati a vedere
create policy cook_logs_insert on public.cook_logs for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_recipe(recipe_id));
create policy cook_logs_update on public.cook_logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cook_logs_delete on public.cook_logs for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );

-- ricetta, autore e foto non si cambiano dopo la creazione
create or replace function public.cook_logs_lock_refs()
returns trigger language plpgsql as $$
begin
  if new.recipe_id is distinct from old.recipe_id then
    raise exception 'cook_logs.recipe_id is immutable' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'cook_logs.user_id is immutable' using errcode = '42501';
  end if;
  if new.photo_path is distinct from old.photo_path then
    raise exception 'cook_logs.photo_path is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger cook_logs_lock_refs before update on public.cook_logs
  for each row execute function public.cook_logs_lock_refs();

-- limite giornaliero: 30 log per utente al giorno, anche con inserimenti diretti
create trigger cook_logs_daily_limit before insert on public.cook_logs
  for each row execute function public.enforce_daily_limit('cook_log', '30', 'user_id');

-- Foto: leggibili da chi puo' leggere il log (la sotto-query rispetta la RLS di cook_logs)
create policy cook_logs_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'recipe-images'
    and exists (select 1 from public.cook_logs cl where cl.photo_path = objects.name)
  );

-- Le foto dei log non sono orfane
create or replace function public.list_orphan_images(p_limit integer default 200)
returns table (name text)
language sql stable security definer set search_path = public, storage, pg_temp as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'recipe-images'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.recipe_images i
      where i.storage_path = o.name or i.thumb_path = o.name
    )
    and not exists (
      select 1 from public.cook_logs c where c.photo_path = o.name
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
revoke all on function public.list_orphan_images(integer) from public, anon, authenticated;
grant execute on function public.list_orphan_images(integer) to service_role;
