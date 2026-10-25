-- C-19: public.is_blocked_between e' security definer ed eseguibile da
-- authenticated via RPC: l'utente bloccato poteva chiamarla direttamente e
-- scoprire di essere stato bloccato. Le policy RLS girano col ruolo del
-- chiamante, quindi non si puo' revocare EXECUTE: la logica simmetrica si
-- sposta in uno schema non esposto da PostgREST (private) e policy/funzioni
-- che la usavano vengono riscritte. La versione pubblica resta (compatibilita')
-- ma rivela solo "ho bloccato io l'altro", che il chiamante gia' sa.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and auth.uid() in (a, b)
    and exists (
      select 1 from public.blocks
      where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
    );
$$;
revoke execute on function private.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function private.is_blocked_between(uuid, uuid) to authenticated;

-- Riscrive le policy RLS che chiamano la funzione pubblica.
do $$
declare
  r record;
  q text;
  w text;
  stmt text;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, p.polname,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wchk
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where pg_get_expr(p.polqual, p.polrelid) like '%is_blocked_between%'
       or pg_get_expr(p.polwithcheck, p.polrelid) like '%is_blocked_between%'
  loop
    q := regexp_replace(r.qual, '(public\.)?is_blocked_between\(', 'private.is_blocked_between(', 'g');
    w := regexp_replace(r.wchk, '(public\.)?is_blocked_between\(', 'private.is_blocked_between(', 'g');
    stmt := format('alter policy %I on %I.%I', r.polname, r.sch, r.tbl);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if w is not null then stmt := stmt || format(' with check (%s)', w); end if;
    execute stmt;
  end loop;
end $$;

-- Riscrive le funzioni public che la chiamano.
do $$
declare
  r record;
  def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname <> 'is_blocked_between'
      and p.prokind = 'f'
      and p.prosrc like '%is_blocked_between%'
  loop
    def := regexp_replace(pg_get_functiondef(r.oid), '(public\.)?is_blocked_between\(', 'private.is_blocked_between(', 'g');
    execute def;
  end loop;
end $$;

-- Versione pubblica (RPC): risponde true solo se il chiamante ha bloccato l'altro.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and auth.uid() in (a, b)
    and exists (
      select 1 from public.blocks
      where blocker_id = auth.uid() and blocked_id = case when auth.uid() = a then b else a end
    );
$$;
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
