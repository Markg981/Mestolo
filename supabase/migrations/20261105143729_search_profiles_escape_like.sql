-- A-15: search_profiles non faceva l'escape dei metacaratteri LIKE.
-- Il display_name non escapava '_' e '\'; lo username non escapava '\'.
-- Si fa l'escape di '\', '%' e '_' su tutte e due le colonne (firma, grant,
-- security definer e search_path invariati).
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
    and (p.username ilike regexp_replace(lower(trim(q)), '([\\%_])', '\\\1', 'g') || '%'
         or p.display_name ilike '%' || regexp_replace(trim(q), '([\\%_])', '\\\1', 'g') || '%')
  order by p.username
  limit 20;
$$;
