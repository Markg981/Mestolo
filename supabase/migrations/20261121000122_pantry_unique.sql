-- B-10: la dispensa accettava righe duplicate (stesso utente, stesso nome
-- normalizzato). Prima si uniscono i duplicati esistenti, poi si crea l'indice
-- unico e si espone una RPC di upsert/merge usata dalle action.

-- Chiave di confronto: senza accenti, minuscolo, spazi collassati.
create or replace function public.pantry_norm(t text)
returns text language sql immutable parallel safe strict set search_path = public as $$
  select lower(btrim(regexp_replace(public.f_unaccent(t), '\s+', ' ', 'g')))
$$;

-- 1) Unisce i duplicati: stessa chiave nome + stessa unita => una sola riga
--    (la piu vecchia) con quantita sommata e scadenza piu vicina. Le righe con
--    unita diversa restano separate (nessuna perdita di informazione).
with grp as (
  select owner_id, public.pantry_norm(name) as k, coalesce(public.pantry_norm(unit), '') as u,
         (array_agg(id order by created_at, id))[1] as keep_id,
         sum(quantity) as qty, min(expires_on) as exp
  from public.pantry_items
  group by 1, 2, 3
  having count(*) > 1
), upd as (
  update public.pantry_items p
     set quantity = g.qty,
         expires_on = g.exp
    from grp g
   where p.id = g.keep_id
  returning p.id
)
delete from public.pantry_items p
using grp g
where p.owner_id = g.owner_id
  and public.pantry_norm(p.name) = g.k
  and coalesce(public.pantry_norm(p.unit), '') = g.u
  and p.id <> g.keep_id;

-- 2) Indice unico per utente su nome normalizzato + unita.
create unique index pantry_items_owner_name_unit_uidx
  on public.pantry_items (owner_id, public.pantry_norm(name), (coalesce(public.pantry_norm(unit), '')));

-- 3) Upsert/merge atomico (SECURITY INVOKER: la RLS resta in vigore).
create or replace function public.add_pantry_item(
  p_name text, p_quantity numeric, p_unit text, p_expires_on date,
  p_location public.pantry_location, p_note text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into public.pantry_items (owner_id, name, quantity, unit, expires_on, location, note)
  values (auth.uid(), p_name, p_quantity, p_unit, p_expires_on, p_location, p_note)
  on conflict (owner_id, public.pantry_norm(name), (coalesce(public.pantry_norm(unit), '')))
  do update set
    quantity = case when pantry_items.quantity is null and excluded.quantity is null then null
                    else coalesce(pantry_items.quantity, 0) + coalesce(excluded.quantity, 0) end,
    expires_on = case when pantry_items.expires_on is null then excluded.expires_on
                      when excluded.expires_on is null then pantry_items.expires_on
                      else least(pantry_items.expires_on, excluded.expires_on) end,
    note = coalesce(pantry_items.note, excluded.note)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_pantry_item(text, numeric, text, date, public.pantry_location, text) from public, anon;
grant execute on function public.add_pantry_item(text, numeric, text, date, public.pantry_location, text) to authenticated;
