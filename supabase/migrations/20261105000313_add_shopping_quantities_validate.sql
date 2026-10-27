-- A-13: add_shopping_quantities accettava delta negativi o enormi. Ora ogni delta deve essere
-- > 0 e <= 1000000 (stesso massimo usato negli schema zod di planning.ts/pantry.ts).
-- Stessa firma e stessi grant. Nessun CHECK aggiuntivo: la colonna ha gia' quantity >= 0
-- e numeric(12,3), quindi un tetto sulla colonna sarebbe ridondante.
create or replace function public.add_shopping_quantities(p_items jsonb)
returns int
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  n int;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(id uuid, delta numeric)
     where x.delta is null or x.delta <= 0 or x.delta > 1000000
  ) then
    raise exception 'delta must be > 0 and <= 1000000' using errcode = '22023';
  end if;
  update public.shopping_items s
     set quantity = s.quantity + x.delta
    from jsonb_to_recordset(p_items) as x(id uuid, delta numeric)
   where s.id = x.id and s.quantity is not null and not s.checked;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.add_shopping_quantities(jsonb) from public, anon;
grant execute on function public.add_shopping_quantities(jsonb) to authenticated;
