-- Valutazioni 1-5 stelle delle ricette. Le singole valutazioni sono leggibili solo dall'autore;
-- le altre persone vedono solo gli aggregati denormalizzati su recipes (rating_avg, rating_count).

create table public.recipe_ratings (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);
create index recipe_ratings_user_idx on public.recipe_ratings (user_id);

alter table public.recipes
  add column rating_avg numeric(3, 2) check (rating_avg is null or rating_avg between 1 and 5),
  add column rating_count integer not null default 0 check (rating_count >= 0);
create index recipes_rating_idx on public.recipes (rating_avg desc nulls last, rating_count desc)
  where rating_count > 0;

alter table public.recipe_ratings enable row level security;

-- Si legge solo la propria valutazione; si valuta solo cio' che si puo' vedere e mai la propria ricetta
create policy recipe_ratings_select on public.recipe_ratings for select to authenticated
  using (user_id = auth.uid());
create policy recipe_ratings_insert on public.recipe_ratings for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_view_recipe(recipe_id)
    and not exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );
create policy recipe_ratings_update on public.recipe_ratings for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.can_view_recipe(recipe_id)
    and not exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );
create policy recipe_ratings_delete on public.recipe_ratings for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.recipe_ratings to authenticated;

-- Campi immutabili e timestamp
create or replace function public.recipe_ratings_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.recipe_id := old.recipe_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger recipe_ratings_guard before update on public.recipe_ratings
  for each row execute function public.recipe_ratings_guard();

-- Limite giornaliero sui nuovi inserimenti (le modifiche di una valutazione esistente non contano)
create trigger recipe_ratings_daily_limit before insert on public.recipe_ratings
  for each row execute function public.enforce_daily_limit('rating', '200', 'user_id');

-- Ricalcolo degli aggregati: l'unico percorso autorizzato a scrivere rating_* su recipes
create or replace function public.recipe_ratings_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  perform set_config('mestolo.rating_sync', '1', true);
  for v_id in select distinct x from unnest(case tg_op
      when 'INSERT' then array[new.recipe_id]
      when 'DELETE' then array[old.recipe_id]
      else array[new.recipe_id, old.recipe_id] end) x loop
    update public.recipes r set
      rating_count = s.n,
      rating_avg = s.avg
    from (
      select count(*)::int as n, round(avg(stars)::numeric, 2) as avg
      from public.recipe_ratings where recipe_id = v_id
    ) s
    where r.id = v_id;
  end loop;
  perform set_config('mestolo.rating_sync', '', true);
  return null;
end $$;
revoke execute on function public.recipe_ratings_sync() from public, anon, authenticated;
create trigger recipe_ratings_sync after insert or update of stars or delete on public.recipe_ratings
  for each row execute function public.recipe_ratings_sync();

-- Gli aggregati non si scrivono a mano; le valutazioni non alterano updated_at (ordinamento "recenti").
-- Il nome inizia con "zz" per scattare dopo il trigger di integrita' esistente.
create or replace function public.recipes_rating_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.rating_avg := null;
    new.rating_count := 0;
  elsif coalesce(current_setting('mestolo.rating_sync', true), '') = '1' then
    new.updated_at := old.updated_at;
  else
    new.rating_avg := old.rating_avg;
    new.rating_count := old.rating_count;
  end if;
  return new;
end $$;
create trigger zz_recipes_rating_guard before insert or update on public.recipes
  for each row execute function public.recipes_rating_guard();
