-- G-06: nel merge di add_shopping_items il recipe_id (e recipe_title) della seconda aggiunta andava perso.
-- Fonte di verita' unica del merge della spesa: questa funzione SQL (src/lib/shopping/merge.ts era codice morto, rimosso).
-- Regole: stesso nome normalizzato + stessa unita' (null = null) + stato non spuntato -> somma delle quantita';
-- unita' diversa -> riga separata. Su merge recipe_id/recipe_title restano quelli gia' presenti sulla riga;
-- se la riga non ne aveva, si adottano quelli del primo inserimento non nullo.
-- Il resto della funzione e' identico a 20261121000110.

create or replace function public.add_shopping_items(p_list_id uuid, p_items jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_saved jsonb;
  v_saved_hash text;
  v_hash text;
  v_n int;
  v_added int := 0;
  v_merged int := 0;
  v_touched uuid[] := '{}';
  v_idx int := 0;
  v_target uuid;
  v_result jsonb;
  r record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items (max 200)' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  perform 1 from public.shopping_lists where id = p_list_id;
  if not found then
    raise exception 'list not found' using errcode = '42501';
  end if;

  v_hash := encode(sha256(convert_to(p_list_id::text || ':' || p_items::text, 'UTF8')), 'hex');

  delete from public.shopping_add_requests where user_id = v_uid and created_at < now() - interval '7 days';
  insert into public.shopping_add_requests (user_id, idempotency_key, payload_hash) values (v_uid, p_idempotency_key, v_hash)
    on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    select result, payload_hash into v_saved, v_saved_hash
      from public.shopping_add_requests where user_id = v_uid and idempotency_key = p_idempotency_key;
    -- righe precedenti alla migrazione hanno hash null: restano trattate come replay
    if v_saved_hash is not null and v_saved_hash <> v_hash then
      raise exception 'idempotency key reused with a different payload' using errcode = 'IK409';
    end if;
    return coalesce(v_saved, jsonb_build_object('added', 0, 'merged', 0)) || jsonb_build_object('duplicate', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shopping_add:' || p_list_id::text, 0));

  for r in
    select nullif(btrim(x.name), '') as name, x.quantity, nullif(btrim(x.unit), '') as unit, x.note, x.recipe_id, x.recipe_title
      from jsonb_to_recordset(p_items) as x(name text, quantity numeric, unit text, note text, recipe_id uuid, recipe_title text)
  loop
    continue when r.name is null;
    select s.id into v_target
      from public.shopping_items s
     where s.list_id = p_list_id and not s.checked
       and public.shopping_norm_name(s.name) = public.shopping_norm_name(r.name)
       and s.unit is not distinct from r.unit
       and (s.quantity is null) = (r.quantity is null)
     order by s.created_at, s.id
     limit 1;
    if v_target is not null then
      if r.quantity is not null then
        update public.shopping_items
           set quantity = quantity + r.quantity,
               recipe_id = coalesce(recipe_id, r.recipe_id),
               recipe_title = case when recipe_id is null and r.recipe_id is not null then r.recipe_title else recipe_title end
         where id = v_target;
        if not v_target = any (v_touched) then
          v_merged := v_merged + 1;
          v_touched := v_touched || v_target;
        end if;
      end if;
    else
      insert into public.shopping_items (list_id, owner_id, name, quantity, unit, note, recipe_id, recipe_title, position)
      values (p_list_id, v_uid, r.name, r.quantity, r.unit, r.note, r.recipe_id, r.recipe_title, v_idx);
      v_added := v_added + 1;
    end if;
    v_idx := v_idx + 1;
  end loop;

  v_result := jsonb_build_object('added', v_added, 'merged', v_merged);
  update public.shopping_add_requests set result = v_result where user_id = v_uid and idempotency_key = p_idempotency_key;
  return v_result || jsonb_build_object('duplicate', false);
end $$;
revoke all on function public.add_shopping_items(uuid, jsonb, uuid) from public, anon;
grant execute on function public.add_shopping_items(uuid, jsonb, uuid) to authenticated;
