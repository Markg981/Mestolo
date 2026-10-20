-- Feed personalizzato "Per te".
--
-- feed_recipes() è SECURITY INVOKER: la lettura di public.recipes passa dalla RLS, quindi
-- non restituisce mai ricette private, nascoste, di utenti bloccati o "solo amici" di
-- sconosciuti. Ordinamento: (score desc, id desc) con score calcolato a un istante fisso
-- p_now (lo "snapshot" del feed, riportato nel cursore): così il punteggio non cambia tra
-- una pagina e l'altra e la paginazione keyset non produce duplicati né buchi.
-- (L'unico segnale che può muoversi tra due pagine è il numero di preferiti.)
--
-- Candidati limitati: ricette degli amici ultimi 90 giorni (max 200) + pubbliche ultimi
-- 30 giorni (max 500), entrambe prese da indici su created_at.

create index if not exists favorites_recipe_idx on public.favorites (recipe_id);
create index if not exists favorites_user_created_idx on public.favorites (user_id, created_at desc);
create index if not exists recipes_owner_created_vis_idx
  on public.recipes (owner_id, created_at desc) where not is_hidden and visibility in ('public', 'friends');

-- Solo il conteggio (nessuna identità), e solo per ricette che il chiamante può vedere:
-- la RLS di favorites mostra altrimenti soltanto i preferiti propri.
create or replace function public.favorite_count(rid uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when public.can_view_recipe(rid)
    then (select count(*)::int from public.favorites where recipe_id = rid)
    else 0 end;
$$;
revoke all on function public.favorite_count(uuid) from public;
grant execute on function public.favorite_count(uuid) to authenticated;

create or replace function public.feed_recipes(
  p_limit int default 24,
  p_now timestamptz default now(),
  p_before_score numeric default null,
  p_before_id uuid default null,
  p_exclude_favorited boolean default true
)
returns table (
  id uuid,
  score numeric,
  is_friend boolean,
  matched_tags text[],
  matched_category uuid,
  favorite_count int
)
language sql stable security invoker set search_path = public as $$
  with me as (select auth.uid() as uid),
  -- gusti dell'utente: tag e categorie delle proprie ricette (peso 1) e dei preferiti (peso 2)
  seed as (
    select r.tags, r.category_id, 1 as w
    from (select tags, category_id from public.recipes, me
          where owner_id = me.uid order by created_at desc limit 300) r
    union all
    select r.tags, r.category_id, 2
    from (select recipe_id from public.favorites, me
          where user_id = me.uid order by created_at desc limit 300) f
    join public.recipes r on r.id = f.recipe_id
  ),
  tag_w as (
    select lower(t) as tag, sum(w)::numeric as w
    from seed, unnest(seed.tags) t group by 1
  ),
  cat_w as (
    select category_id, sum(w)::numeric as w from seed where category_id is not null group by 1
  ),
  cand as (
    (select r.id, r.owner_id, r.tags, r.category_id, r.created_at
     from public.recipes r, me
     where r.owner_id <> me.uid and not r.is_hidden and r.visibility in ('friends', 'public')
       and r.created_at <= p_now and r.created_at > p_now - interval '90 days'
       and public.are_friends(r.owner_id, me.uid)
     order by r.created_at desc, r.id desc limit 200)
    union
    (select r.id, r.owner_id, r.tags, r.category_id, r.created_at
     from public.recipes r, me
     where r.owner_id <> me.uid and not r.is_hidden and r.visibility = 'public'
       and r.created_at <= p_now and r.created_at > p_now - interval '30 days'
     order by r.created_at desc, r.id desc limit 500)
  ),
  filtered as (
    select c.* from cand c
    where not (p_exclude_favorited and exists (
      select 1 from public.favorites f, me where f.user_id = me.uid and f.recipe_id = c.id))
  ),
  scored as (
    select c.id, c.owner_id,
      public.are_friends(c.owner_id, (select uid from me)) as is_friend,
      coalesce((select array_agg(m.tag order by m.w desc, m.tag)
                from (select tw.tag, tw.w from tag_w tw
                      where tw.tag = any (select lower(x) from unnest(c.tags) x)
                      order by tw.w desc, tw.tag limit 3) m), '{}') as matched_tags,
      (select cw.category_id from cat_w cw where cw.category_id = c.category_id) as matched_category,
      -- affinità: tag in comune (log-saturati) + categoria
      coalesce((select sum(ln(1 + tw.w)) from tag_w tw
                where tw.tag = any (select lower(x) from unnest(c.tags) x)), 0)
      + coalesce((select 0.8 * ln(1 + cw.w) from cat_w cw where cw.category_id = c.category_id), 0) as affinity,
      -- decadimento temporale: da 2 verso 0, costante di tempo 14 giorni
      2 * exp(-greatest(extract(epoch from (p_now - c.created_at)) / 86400.0, 0) / 14.0) as recency,
      public.favorite_count(c.id) as fav_count
    from filtered c
  ),
  -- PUNTO UNICO per aggiungere segnali futuri (valutazioni, "l'ho cucinata"): sommarli qui.
  base as (
    select s.*,
      s.affinity + s.recency + 0.3 * ln(1 + s.fav_count)
        + 100 * (case when s.is_friend then 1 else 0 end) as base_score
    from scored s
  ),
  -- diversità: ogni ricetta in più dello stesso autore perde 1.5 punti (calcolato su tutto lo snapshot)
  ranked as (
    select b.*, round((b.base_score - 1.5 * (row_number() over (partition by b.owner_id order by b.base_score desc, b.id desc) - 1))::numeric, 6) as final_score
    from base b
  )
  select r.id, r.final_score, r.is_friend, r.matched_tags, r.matched_category, r.fav_count
  from ranked r
  where p_before_score is null
     or (r.final_score, r.id) < (p_before_score, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by r.final_score desc, r.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;
revoke all on function public.feed_recipes(int, timestamptz, numeric, uuid, boolean) from public;
grant execute on function public.feed_recipes(int, timestamptz, numeric, uuid, boolean) to authenticated;
