-- =====================================================================
-- Mestolo – schema iniziale
-- Tutte le autorizzazioni sono applicate con Row Level Security (RLS).
-- Il ruolo "anon" non ha accesso ad alcuna tabella: l'app richiede login.
-- =====================================================================

-- ---------- Tipi ------------------------------------------------------
create type public.visibility as enum ('private', 'friends', 'public');
create type public.recipe_source as enum ('manual', 'photo', 'url', 'text', 'copy', 'variant');
create type public.verification_status as enum ('verified', 'needs_review');
create type public.image_kind as enum ('upload', 'imported', 'ai_generated');
create type public.friendship_status as enum ('pending', 'accepted', 'declined');
create type public.meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');

-- ---------- Profili ---------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 280),
  locale text not null default 'it' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  discoverable boolean not null default true,
  dietary_preferences text[] not null default '{}',
  avoided_ingredients text[] not null default '{}',
  hidden_categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Blocchi e amicizie (servono alle funzioni di visibilità) --
create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_uidx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(a, b)
      and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
  );
$$;

-- ---------- Categorie -------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  owner_id uuid references auth.users (id) on delete cascade, -- null = categoria di sistema
  name text check (name is null or char_length(name) between 1 and 40),
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  unique nulls not distinct (owner_id, slug),
  check (owner_id is null or name is not null)
);

insert into public.categories (slug, sort_order) values
  ('starters', 10), ('first-courses', 20), ('main-courses', 30), ('sides', 40),
  ('desserts', 50), ('bread-baking', 60), ('drinks', 70), ('breakfast', 80),
  ('snacks', 90), ('sauces', 100), ('uncategorized', 999);

-- ---------- Ricette ---------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  original_language text not null default 'it' check (original_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  servings numeric(7, 2) check (servings is null or (servings > 0 and servings <= 1000)),
  prep_minutes int check (prep_minutes is null or prep_minutes between 0 and 100000),
  cook_minutes int check (cook_minutes is null or cook_minutes between 0 and 100000),
  total_minutes int check (total_minutes is null or total_minutes between 0 and 100000),
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) <= 200),
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 200),
  category_id uuid references public.categories (id) on delete set null,
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  source_type public.recipe_source not null default 'manual',
  source_url text check (source_url is null or (source_url ~ '^https?://' and char_length(source_url) <= 2000)),
  source_name text check (source_name is null or char_length(source_name) <= 200),
  source_attribution text check (source_attribution is null or char_length(source_attribution) <= 500),
  visibility public.visibility not null default 'private',
  verification_status public.verification_status not null default 'verified',
  field_flags jsonb not null default '{}' check (jsonb_typeof(field_flags) = 'object'),
  diet_hints text[] not null default '{}',
  parent_recipe_id uuid references public.recipes (id) on delete set null,
  copied_from_recipe_id uuid references public.recipes (id) on delete set null,
  original_author_id uuid references auth.users (id) on delete set null,
  original_author_name text,
  version int not null default 1,
  content_hash text not null default '',
  search_text text not null default '',
  last_change_source text check (last_change_source is null or last_change_source in ('create', 'edit', 'import', 'ai_suggestions', 'restore', 'copy')),
  last_change_note text check (last_change_note is null or char_length(last_change_note) <= 500),
  is_hidden boolean not null default false, -- moderazione
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_owner_idx on public.recipes (owner_id, updated_at desc);
create index recipes_public_idx on public.recipes (visibility, created_at desc) where not is_hidden;
create index recipes_parent_idx on public.recipes (parent_recipe_id);

-- Visibilità di una ricetta per un dato utente (unica fonte di verità)
create or replace function public.can_view_recipe_for(rid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and exists (
    select 1 from public.recipes r
    where r.id = rid
      and (
        r.owner_id = uid
        or (
          not r.is_hidden
          and not public.is_blocked_between(r.owner_id, uid)
          and (
            r.visibility = 'public'
            or (r.visibility = 'friends' and public.are_friends(r.owner_id, uid))
          )
        )
      )
  );
$$;

create or replace function public.can_view_recipe(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_recipe_for(rid, auth.uid());
$$;

create or replace function public.recipe_snapshot(r public.recipes)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'title', r.title, 'description', r.description, 'original_language', r.original_language,
    'servings', r.servings, 'prep_minutes', r.prep_minutes, 'cook_minutes', r.cook_minutes,
    'total_minutes', r.total_minutes, 'ingredients', r.ingredients, 'steps', r.steps,
    'category_id', r.category_id, 'tags', to_jsonb(r.tags)
  );
$$;

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  change_source text not null,
  change_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (recipe_id, version)
);

create or replace function public.recipes_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src record;
  src_source text;
begin
  -- La categoria deve essere di sistema o del proprietario
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and (c.owner_id is null or c.owner_id = new.owner_id)
  ) then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    -- Attribuzione: non falsificabile. Se si dichiara una copia, la fonte deve
    -- essere visibile al nuovo proprietario e l'autore deve coincidere.
    if new.copied_from_recipe_id is not null or new.original_author_id is not null then
      if new.copied_from_recipe_id is null then
        raise exception 'original_author requires copied_from' using errcode = '22023';
      end if;
      select r.owner_id, r.original_author_id into src
        from public.recipes r where r.id = new.copied_from_recipe_id;
      if not found then
        raise exception 'source recipe not found' using errcode = '22023';
      end if;
      if auth.uid() is not null and not public.can_view_recipe_for(new.copied_from_recipe_id, new.owner_id) then
        raise exception 'source recipe not visible' using errcode = '42501';
      end if;
      if new.original_author_id is distinct from coalesce(src.original_author_id, src.owner_id) then
        raise exception 'attribution mismatch' using errcode = '22023';
      end if;
    end if;
    if new.parent_recipe_id is not null and auth.uid() is not null
       and not public.can_view_recipe_for(new.parent_recipe_id, new.owner_id) then
      raise exception 'parent recipe not visible' using errcode = '42501';
    end if;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    -- Campi immutabili dopo la creazione
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.parent_recipe_id := old.parent_recipe_id;
    new.copied_from_recipe_id := old.copied_from_recipe_id;
    new.original_author_id := old.original_author_id;
    new.original_author_name := old.original_author_name;
    new.source_type := old.source_type;
    -- Solo il gestore (service role) può cambiare la moderazione
    if auth.uid() is not null then
      new.is_hidden := old.is_hidden;
    end if;
  end if;

  new.content_hash := md5(jsonb_build_object(
    't', new.title, 'd', new.description, 'l', new.original_language, 's', new.servings,
    'p', new.prep_minutes, 'c', new.cook_minutes, 'tt', new.total_minutes,
    'i', new.ingredients, 'st', new.steps
  )::text);

  new.search_text := lower(concat_ws(' ',
    new.title, new.description, array_to_string(new.tags, ' '),
    (select string_agg(coalesce(e ->> 'name', ''), ' ') from jsonb_array_elements(new.ingredients) e)
  ));

  if tg_op = 'UPDATE' then
    if new.content_hash <> old.content_hash
       or new.category_id is distinct from old.category_id
       or new.tags is distinct from old.tags then
      new.version := old.version + 1;
      new.updated_at := now();
      src_source := case
        when new.last_change_source is distinct from old.last_change_source and new.last_change_source is not null
          then new.last_change_source
        else 'edit' end;
      insert into public.recipe_versions (recipe_id, version, snapshot, change_source, change_note, created_by)
      values (new.id, new.version, public.recipe_snapshot(new), src_source, new.last_change_note, auth.uid());
    else
      new.version := old.version;
      if new is distinct from old then
        new.updated_at := now();
      end if;
    end if;
    new.last_change_source := null;
    new.last_change_note := null;
  end if;

  return new;
end;
$$;

create trigger recipes_before_write
  before insert or update on public.recipes
  for each row execute function public.recipes_before_write();

create or replace function public.recipes_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.recipe_versions (recipe_id, version, snapshot, change_source, change_note, created_by)
  values (new.id, 1, public.recipe_snapshot(new), coalesce(new.last_change_source, 'create'), new.last_change_note, auth.uid());
  return new;
end;
$$;

create trigger recipes_after_insert
  after insert on public.recipes
  for each row execute function public.recipes_after_insert();

-- ---------- Immagini --------------------------------------------------
create table public.recipe_images (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  storage_path text not null unique,
  thumb_path text unique,
  kind public.image_kind not null default 'upload',
  source_url text check (source_url is null or source_url ~ '^https?://'),
  attribution text check (attribution is null or char_length(attribution) <= 500),
  alt_text text not null default '' check (char_length(alt_text) <= 300),
  width int,
  height int,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index recipe_images_recipe_idx on public.recipe_images (recipe_id, position);

-- ---------- Note personali, preferiti, raccolte ----------------------
create table public.recipe_notes (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  body text not null default '' check (char_length(body) <= 10000),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, owner_id)
);

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collection_recipes (
  collection_id uuid not null references public.collections (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, recipe_id)
);

-- ---------- Segnalazioni ---------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  reason text not null check (reason in ('spam', 'offensive', 'copyright', 'unsafe', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, recipe_id)
);

-- ---------- Lista della spesa e piano pasti --------------------------
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 200),
  quantity numeric(12, 3) check (quantity is null or quantity >= 0),
  unit text check (unit is null or char_length(unit) <= 40),
  note text check (note is null or char_length(note) <= 300),
  checked boolean not null default false,
  recipe_id uuid references public.recipes (id) on delete set null,
  recipe_title text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index shopping_items_list_idx on public.shopping_items (list_id, checked, position);

create table public.meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  plan_date date not null,
  slot public.meal_slot not null,
  recipe_id uuid references public.recipes (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  servings numeric(7, 2) check (servings is null or servings > 0),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index meal_plan_owner_date_idx on public.meal_plan_entries (owner_id, plan_date);

-- ---------- Traduzioni (cache) ---------------------------------------
create table public.recipe_translations (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  content jsonb not null,
  source_hash text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  primary key (recipe_id, locale)
);

-- ---------- AI: suggerimenti, chiavi, uso ----------------------------
create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('analysis', 'substitution')),
  payload jsonb not null,
  recipe_hash text not null,
  provider text not null,
  key_source text not null check (key_source in ('app', 'user', 'builtin')),
  created_at timestamptz not null default now()
);
create index ai_suggestions_user_idx on public.ai_suggestions (user_id, recipe_id, created_at desc);

create table public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version int not null default 1,
  key_hint text not null check (char_length(key_hint) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  provider text not null,
  key_source text not null check (key_source in ('app', 'user')),
  created_at timestamptz not null default now()
);
create index ai_usage_user_idx on public.ai_usage (user_id, key_source, created_at desc);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_bucket_idx on public.rate_limit_events (bucket, created_at desc);

-- =====================================================================
-- Trigger di supporto
-- =====================================================================

-- Profilo creato automaticamente alla registrazione
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  loc text := coalesce(new.raw_user_meta_data ->> 'locale', 'it');
  uname text;
begin
  if wanted ~ '^[a-z0-9_]{3,24}$' and not exists (select 1 from public.profiles where username = wanted) then
    uname := wanted;
  else
    uname := 'cuoco_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  if loc !~ '^[a-z]{2}(-[A-Z]{2})?$' then loc := 'it'; end if;
  insert into public.profiles (id, username, display_name, locale)
  values (new.id, uname, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60), loc);
  insert into public.shopping_lists (owner_id, name) values (new.id, 'default');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Amicizie: solo il destinatario può rispondere, e solo cambiando lo stato
create or replace function public.friendships_before_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is distinct from old.addressee_id then
    raise exception 'only the addressee can respond' using errcode = '42501';
  end if;
  if old.status <> 'pending' or new.status not in ('accepted', 'declined') then
    raise exception 'invalid transition' using errcode = '22023';
  end if;
  new.requester_id := old.requester_id;
  new.addressee_id := old.addressee_id;
  new.created_at := old.created_at;
  new.responded_at := now();
  return new;
end;
$$;

create trigger friendships_before_update
  before update on public.friendships
  for each row execute function public.friendships_before_update();

-- Bloccare un utente elimina l'eventuale amicizia/richiesta
create or replace function public.blocks_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.friendships
  where least(requester_id, addressee_id) = least(new.blocker_id, new.blocked_id)
    and greatest(requester_id, addressee_id) = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;

create trigger blocks_after_insert
  after insert on public.blocks
  for each row execute function public.blocks_after_insert();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger collections_touch before update on public.collections
  for each row execute function public.touch_updated_at();
create trigger recipe_notes_touch before update on public.recipe_notes
  for each row execute function public.touch_updated_at();

-- Il proprietario dei record dipendenti non è modificabile
create or replace function public.keep_owner()
returns trigger language plpgsql as $$
begin
  new.owner_id := old.owner_id;
  return new;
end;
$$;
create trigger shopping_items_keep_owner before update on public.shopping_items
  for each row execute function public.keep_owner();
create trigger meal_plan_keep_owner before update on public.meal_plan_entries
  for each row execute function public.keep_owner();
create trigger recipe_images_keep_owner before update on public.recipe_images
  for each row execute function public.keep_owner();

-- =====================================================================
-- Funzioni RPC
-- =====================================================================

-- Ricerca utenti rispettando privacy e blocchi
create or replace function public.search_profiles(q text)
returns table (id uuid, username text, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where auth.uid() is not null
    and char_length(trim(q)) >= 2
    and p.discoverable
    and p.id <> auth.uid()
    and not public.is_blocked_between(p.id, auth.uid())
    and (p.username ilike replace(replace(lower(trim(q)), '%', ''), '_', '\_') || '%'
         or p.display_name ilike '%' || replace(trim(q), '%', '') || '%')
  order by p.username
  limit 20;
$$;

-- Metadati delle chiavi personali (mai il contenuto cifrato)
create or replace function public.my_api_keys()
returns table (provider text, key_hint text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select k.provider, k.key_hint, k.updated_at
  from public.user_api_keys k
  where k.user_id = auth.uid()
  order by k.provider;
$$;

-- Rate limiting a finestra scorrevole (solo service role)
create or replace function public.rate_limit_hit(p_bucket text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  select count(*) into n from public.rate_limit_events
  where bucket = p_bucket and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_limit_events (bucket) values (p_bucket);
  if random() < 0.01 then
    delete from public.rate_limit_events where created_at < now() - interval '2 days';
  end if;
  return true;
end;
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.friendships enable row level security;
alter table public.categories enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_images enable row level security;
alter table public.recipe_notes enable row level security;
alter table public.favorites enable row level security;
alter table public.collections enable row level security;
alter table public.collection_recipes enable row level security;
alter table public.reports enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.meal_plan_entries enable row level security;
alter table public.recipe_translations enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.user_api_keys enable row level security;
alter table public.ai_usage enable row level security;
alter table public.rate_limit_events enable row level security;

-- Profili
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or not public.is_blocked_between(id, auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Blocchi
create policy blocks_select on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- Amicizie
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy friendships_insert on public.friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending'
              and not public.is_blocked_between(requester_id, addressee_id));
create policy friendships_update on public.friendships for update to authenticated
  using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Categorie
create policy categories_select on public.categories for select to authenticated
  using (
    owner_id is null or owner_id = auth.uid()
    or exists (select 1 from public.recipes r where r.category_id = categories.id)
  );
create policy categories_insert on public.categories for insert to authenticated with check (owner_id = auth.uid());
create policy categories_update on public.categories for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy categories_delete on public.categories for delete to authenticated using (owner_id = auth.uid());

-- Ricette
create policy recipes_select on public.recipes for select to authenticated
  using (
    owner_id = auth.uid()
    or (
      not is_hidden
      and not public.is_blocked_between(owner_id, auth.uid())
      and (visibility = 'public' or (visibility = 'friends' and public.are_friends(owner_id, auth.uid())))
    )
  );
create policy recipes_insert on public.recipes for insert to authenticated with check (owner_id = auth.uid());
create policy recipes_update on public.recipes for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy recipes_delete on public.recipes for delete to authenticated using (owner_id = auth.uid());

-- Versioni: solo il proprietario della ricetta; scritte solo dai trigger
create policy recipe_versions_select on public.recipe_versions for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()));

-- Immagini: le immagini importate da terzi restano visibili solo al proprietario
create policy recipe_images_select on public.recipe_images for select to authenticated
  using (owner_id = auth.uid() or (kind <> 'imported' and public.can_view_recipe(recipe_id)));
create policy recipe_images_insert on public.recipe_images for insert to authenticated
  with check (
    owner_id = auth.uid()
    and storage_path like auth.uid()::text || '/%'
    and (thumb_path is null or thumb_path like auth.uid()::text || '/%')
    and exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );
create policy recipe_images_update on public.recipe_images for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy recipe_images_delete on public.recipe_images for delete to authenticated using (owner_id = auth.uid());

-- Note personali: sempre e solo del loro autore
create policy recipe_notes_all on public.recipe_notes for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.can_view_recipe(recipe_id));

-- Preferiti
create policy favorites_select on public.favorites for select to authenticated using (user_id = auth.uid());
create policy favorites_insert on public.favorites for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_recipe(recipe_id));
create policy favorites_delete on public.favorites for delete to authenticated using (user_id = auth.uid());

-- Raccolte
create policy collections_all on public.collections for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy collection_recipes_select on public.collection_recipes for select to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));
create policy collection_recipes_insert on public.collection_recipes for insert to authenticated
  with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    and public.can_view_recipe(recipe_id)
  );
create policy collection_recipes_delete on public.collection_recipes for delete to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));

-- Segnalazioni: si segnalano solo contenuti altrui visibili
create policy reports_select on public.reports for select to authenticated using (reporter_id = auth.uid());
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and public.can_view_recipe(recipe_id)
    and not exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );

-- Lista della spesa
create policy shopping_lists_all on public.shopping_lists for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy shopping_items_select on public.shopping_items for select to authenticated using (owner_id = auth.uid());
create policy shopping_items_insert on public.shopping_items for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.shopping_lists l where l.id = list_id and l.owner_id = auth.uid())
    and (recipe_id is null or public.can_view_recipe(recipe_id))
  );
create policy shopping_items_update on public.shopping_items for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.shopping_lists l where l.id = list_id and l.owner_id = auth.uid())
  );
create policy shopping_items_delete on public.shopping_items for delete to authenticated using (owner_id = auth.uid());

-- Piano pasti
create policy meal_plan_select on public.meal_plan_entries for select to authenticated using (owner_id = auth.uid());
create policy meal_plan_insert on public.meal_plan_entries for insert to authenticated
  with check (owner_id = auth.uid() and (recipe_id is null or public.can_view_recipe(recipe_id)));
create policy meal_plan_update on public.meal_plan_entries for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (recipe_id is null or public.can_view_recipe(recipe_id)));
create policy meal_plan_delete on public.meal_plan_entries for delete to authenticated using (owner_id = auth.uid());

-- Traduzioni: leggibili da chi vede la ricetta, scritte solo dal server
create policy recipe_translations_select on public.recipe_translations for select to authenticated
  using (public.can_view_recipe(recipe_id));

-- Suggerimenti AI: solo per chi li ha richiesti
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated using (user_id = auth.uid());
create policy ai_suggestions_delete on public.ai_suggestions for delete to authenticated using (user_id = auth.uid());

-- Uso AI: l'utente vede solo il proprio
create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = auth.uid());

-- user_api_keys e rate_limit_events: nessuna policy => nessun accesso dai client.

-- =====================================================================
-- Privilegi
-- =====================================================================
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on table public.user_api_keys from authenticated;
revoke all on table public.rate_limit_events from authenticated;
revoke all on table public.recipe_versions from authenticated;
grant select on table public.recipe_versions to authenticated;
revoke insert, update, delete on table public.recipe_translations from authenticated;
revoke insert, update on table public.ai_suggestions from authenticated;
revoke insert, update, delete on table public.ai_usage from authenticated;
revoke execute on function public.rate_limit_hit(text, int, int) from public, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
revoke execute on function public.can_view_recipe_for(uuid, uuid) from public, authenticated;
grant execute on function public.can_view_recipe_for(uuid, uuid) to service_role;

-- =====================================================================
-- Storage: bucket privato per le immagini delle ricette
-- Percorso: <owner_id>/<recipe_id>/<file>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy recipe_images_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'recipe-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.recipe_images ri
        where ri.storage_path = objects.name or ri.thumb_path = objects.name
      )
    )
  );
create policy recipe_images_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy recipe_images_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = auth.uid()::text);
