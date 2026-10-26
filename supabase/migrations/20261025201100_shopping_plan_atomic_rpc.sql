-- C-11: operazioni non atomiche su lista della spesa e piano.
-- 1) La fusione di una voce leggeva la quantita', la sommava nell'app e scriveva il totale: due aggiunte
--    concorrenti perdevano un incremento. Ora l'incremento e' un unico UPDATE (quantity = quantity + delta).
-- 2) "Sostituisci" del piano cancellava le voci e poi inseriva le nuove in due chiamate: se l'inserimento
--    falliva il piano era perso. Ora cancellazione e inserimento stanno nella stessa transazione.
-- Entrambe le funzioni sono SECURITY INVOKER: valgono le RLS esistenti (membri della lista / proprietario).

-- p_items: [{ "id": uuid, "delta": numeric }, ...]. Restituisce quante righe sono state incrementate
-- (le voci spuntate nel frattempo, senza quantita' o non visibili non vengono toccate).
create function public.add_shopping_quantities(p_items jsonb)
returns int
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  n int;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
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

-- p_rows: [{ "plan_date": date, "slot": meal_slot, "recipe_id": uuid, "title": text, "servings": numeric|null }, ...]
-- Sostituisce le voci dell'utente nelle celle (data + pasto) indicate. Restituisce il numero di voci inserite.
create function public.replace_plan_entries(p_rows jsonb)
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
  delete from public.meal_plan_entries e
   using jsonb_to_recordset(p_rows) as x(plan_date date, slot public.meal_slot)
   where e.owner_id = auth.uid() and e.plan_date = x.plan_date and e.slot = x.slot;
  insert into public.meal_plan_entries (owner_id, plan_date, slot, recipe_id, title, servings)
  select auth.uid(), x.plan_date, x.slot, x.recipe_id, x.title, x.servings
    from jsonb_to_recordset(p_rows) as x(plan_date date, slot public.meal_slot, recipe_id uuid, title text, servings numeric);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.replace_plan_entries(jsonb) from public, anon;
grant execute on function public.replace_plan_entries(jsonb) to authenticated;
