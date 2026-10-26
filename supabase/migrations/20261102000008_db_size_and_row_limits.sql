-- A-08: limiti di dimensione e di numero lato database. I limiti zod esistono solo nelle server action:
-- chi usa PostgREST con la chiave anon li aggira. Qui li replichiamo (leggermente piu' larghi) in SQL.
-- I CHECK sono NOT VALID: non rivalidano i dati esistenti (la migrazione non puo' fallire su dati di produzione),
-- ma valgono per ogni INSERT/UPDATE successivo.

-- Dimensione in byte degli jsonb di ricetta (il numero di voci e' gia' limitato a 200 dal CHECK iniziale;
-- zod: nome ingrediente 300, testo passaggio 4000 caratteri).
alter table public.recipes
  add constraint recipes_ingredients_size_chk check (octet_length(ingredients::text) <= 400000) not valid,
  add constraint recipes_steps_size_chk check (octet_length(steps::text) <= 2000000) not valid,
  add constraint recipes_field_flags_size_chk check (octet_length(field_flags::text) <= 100000) not valid;

-- Tetti di righe (generosi, pensati solo contro l'abuso): per utente, o per lista per le voci della spesa.
create or replace function public.enforce_row_cap()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap int := tg_argv[0]::int;
  col text := tg_argv[1];
  cnt int;
begin
  if tg_table_name = 'categories' and new.owner_id is null then
    return new; -- categorie di sistema
  end if;
  execute format('select count(*) from public.%I where %I = $1', tg_table_name, col)
    into cnt using (case col when 'list_id' then to_jsonb(new) ->> 'list_id' else to_jsonb(new) ->> 'owner_id' end)::uuid;
  if cnt >= cap then
    raise exception 'limit reached for %', tg_table_name using errcode = '54000';
  end if;
  return new;
end $$;
revoke all on function public.enforce_row_cap() from public, anon, authenticated;

create trigger categories_row_cap before insert on public.categories
  for each row execute function public.enforce_row_cap(200, 'owner_id');
create trigger collections_row_cap before insert on public.collections
  for each row execute function public.enforce_row_cap(500, 'owner_id');
create trigger shopping_lists_row_cap before insert on public.shopping_lists
  for each row execute function public.enforce_row_cap(100, 'owner_id');
create trigger shopping_items_row_cap before insert on public.shopping_items
  for each row execute function public.enforce_row_cap(2000, 'list_id');
create trigger pantry_items_row_cap before insert on public.pantry_items
  for each row execute function public.enforce_row_cap(5000, 'owner_id');

-- RPC: limite sugli array in ingresso.
create or replace function public.add_shopping_quantities(p_items jsonb)
returns int
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  n int;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'too many items' using errcode = '54000';
  end if;
  update public.shopping_items s
     set quantity = s.quantity + x.delta
    from jsonb_to_recordset(p_items) as x(id uuid, delta numeric)
   where s.id = x.id and s.quantity is not null and not s.checked;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.replace_plan_entries(p_rows jsonb)
returns int
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'too many rows' using errcode = '54000';
  end if;
  delete from public.meal_plan_entries e
   using jsonb_to_recordset(p_rows) as x(plan_date date, slot public.meal_slot)
   where e.owner_id = auth.uid() and e.plan_date = x.plan_date and e.slot = x.slot;
  insert into public.meal_plan_entries (owner_id, plan_date, slot, recipe_id, title, servings)
  select auth.uid(), x.plan_date, x.slot, x.recipe_id, x.title, x.servings
    from jsonb_to_recordset(p_rows) as x(plan_date date, slot public.meal_slot, recipe_id uuid, title text, servings numeric);
  get diagnostics n = row_count;
  return n;
end $$;

-- find_possible_duplicates: input troncato (titolo 200, max 200 ingredienti da 300 caratteri) per evitare
-- consumo CPU nel calcolo dei bigrammi. Security invoker: la RLS si applica.
create or replace function public.find_possible_duplicates(
  p_title text,
  p_source_url text default null,
  p_ingredients text[] default '{}',
  p_exclude_id uuid default null
)
returns table (id uuid, title text, score double precision, reason text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with draft as (
    select public.dup_normalize_url(left(p_source_url, 2000)) as url,
           coalesce((select array_agg(distinct n) from (
             select public.dup_normalize_text(left(x, 300)) n from unnest(p_ingredients[1:200]) x) q where n <> ''), '{}') as ings
  ),
  cand as (
    select r.id, r.title, public.dup_normalize_url(r.source_url) as url,
           public.dup_title_similarity(left(p_title, 200), r.title) as ts,
           coalesce((select array_agg(distinct n) from (
             select public.dup_normalize_text(i ->> 'name') n from jsonb_array_elements(r.ingredients) i) q where n <> ''), '{}') as ings
    from public.recipes r
    where r.owner_id = auth.uid() and (p_exclude_id is null or r.id <> p_exclude_id)
  ),
  scored as (
    select c.id, c.title,
      case
        when d.url is not null and c.url = d.url then 1.0
        when c.ts >= 0.88 then c.ts
        when c.ts >= 0.55 and io.v >= 0.6 then (c.ts + io.v) / 2
      end as score,
      case
        when d.url is not null and c.url = d.url then 'same_source'
        when c.ts >= 0.88 then 'similar_title'
        when c.ts >= 0.55 and io.v >= 0.6 then 'similar_content'
      end as reason
    from cand c cross join draft d
    cross join lateral (
      select case when cardinality(c.ings) = 0 or cardinality(d.ings) = 0 then 0.0 else
        (select count(*) from unnest(c.ings) z where z = any (d.ings))::double precision
        / (cardinality(c.ings) + cardinality(d.ings) - (select count(*) from unnest(c.ings) z where z = any (d.ings))) end as v
    ) io
  )
  select s.id, s.title, s.score, s.reason from scored s where s.reason is not null
  order by s.score desc limit 5;
$$;
