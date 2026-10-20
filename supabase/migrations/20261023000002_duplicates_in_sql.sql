-- Rilevamento duplicati spostato in SQL: porting delle regole di src/lib/recipes/duplicates.ts
-- (normalizzazione, similarita' Dice sui bigrammi dei token del titolo, overlap Jaccard degli ingredienti,
-- URL sorgente normalizzato). Soglie identiche: titolo >= 0.88, oppure titolo >= 0.55 con ingredienti >= 0.6.

create or replace function public.dup_normalize_text(s text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(regexp_replace(
    translate(lower(coalesce(s, '')),
      'àáâãäåāăąçćčďđèéêëēęěìíîïīłñńňòóôõöøōőŕřśšşťùúûüūůűýÿźżž',
      'aaaaaaaaacccddeeeeeeeiiiiilnnnooooooooorrsssstuuuuuuuyyzzz'),
    '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function public.dup_title_tokens(s text)
returns text language sql immutable parallel safe as $$
  select coalesce(string_agg(w, ' ' order by w), '')
  from unnest(string_to_array(public.dup_normalize_text(s), ' ')) as w
  where char_length(w) > 1 and w <> all (array[
    'il','lo','la','i','gli','le','un','una','uno','di','del','della','dei','delle','al','alla','alle','ai','con','e','ed','in','per','da',
    'the','a','an','of','with','and','for','el','los','las','de','y','les','des','du','au','aux','et','avec',
    'der','die','das','mit','und','o','os','as','do','com','ricetta','recipe','receta','recette','rezept','receita','facile','easy']);
$$;

create or replace function public.dup_title_similarity(a text, b text)
returns double precision language plpgsql immutable parallel safe as $$
declare
  ta text := public.dup_title_tokens(a);
  tb text := public.dup_title_tokens(b);
  na int;
  nb int;
  inter int;
begin
  if ta = '' or tb = '' then return 0; end if;
  if ta = tb then return 1; end if;
  ta := replace(ta, ' ', '');
  tb := replace(tb, ' ', '');
  na := char_length(ta) - 1;
  nb := char_length(tb) - 1;
  if na < 1 or nb < 1 then return 0; end if;
  select coalesce(sum(least(x.c, y.c)), 0) into inter
  from (select substr(ta, i, 2) g, count(*) c from generate_series(1, na) i group by 1) x
  join (select substr(tb, i, 2) g, count(*) c from generate_series(1, nb) i group by 1) y using (g);
  return (2.0 * inter) / (na + nb);
end;
$$;

create or replace function public.dup_normalize_url(u text)
returns text language sql immutable parallel safe as $$
  select case when m is null then null else lower(
    regexp_replace(regexp_replace(m[1], '^.*@', ''), ':\d*$', '')
    || regexp_replace(m[2], '/+$', '')
    || coalesce((select '?' || string_agg(p, '&') from unnest(string_to_array(substr(m[3], 2), '&')) p
                 where p <> '' and p !~* '^(utm_|fbclid|gclid|ref(=|$)|mc_)'), '')
  ) end
  from (select regexp_match(u, '^https?://(?:www\.)?([^/?#]*)([^?#]*)(\?[^#]*)?', 'i') as m) t;
$$;

create index if not exists recipes_owner_norm_url_idx
  on public.recipes (owner_id, (public.dup_normalize_url(source_url)))
  where source_url is not null;

-- Security invoker: la RLS si applica e il perimetro e' comunque limitato alle ricette del chiamante.
create or replace function public.find_possible_duplicates(
  p_title text,
  p_source_url text default null,
  p_ingredients text[] default '{}',
  p_exclude_id uuid default null
)
returns table (id uuid, title text, score double precision, reason text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with draft as (
    select public.dup_normalize_url(p_source_url) as url,
           coalesce((select array_agg(distinct n) from (
             select public.dup_normalize_text(x) n from unnest(p_ingredients) x) q where n <> ''), '{}') as ings
  ),
  cand as (
    select r.id, r.title, public.dup_normalize_url(r.source_url) as url,
           public.dup_title_similarity(p_title, r.title) as ts,
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

revoke execute on function public.find_possible_duplicates(text, text, text[], uuid) from public, anon;
grant execute on function public.find_possible_duplicates(text, text, text[], uuid) to authenticated;
