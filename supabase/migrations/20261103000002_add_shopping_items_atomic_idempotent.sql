-- C-08: aggiunte alla lista della spesa non atomiche ne' idempotenti.
-- Prima: lettura illimitata delle voci + merge nell'app + update + insert in chiamate separate.
-- Un aggiornamento parziale restituiva not_found dopo aver gia' scritto, e un doppio clic raddoppiava le quantita'.
-- Ora: un'unica RPC transazionale (merge + insert) con chiave di idempotenza generata dal client,
-- salvata in shopping_add_requests con unique (user_id, key): una richiesta ripetuta restituisce
-- l'esito gia' registrato senza riapplicare nulla. Se la RPC fallisce la transazione annulla anche la chiave.
-- La RPC riceve un list id esplicito (p_list_id).

create table public.shopping_add_requests (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  idempotency_key uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
alter table public.shopping_add_requests enable row level security;
create policy shopping_add_requests_own on public.shopping_add_requests
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Stessa normalizzazione di normalizeText() in src/lib/recipes/duplicates.ts.
create or replace function public.shopping_norm_name(t text)
returns text language sql immutable parallel safe strict set search_path = public, pg_temp as $$
  select btrim(regexp_replace(regexp_replace(lower(public.f_unaccent(t)), '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- p_items: [{ name, quantity, unit, note, recipe_id, recipe_title }, ...]
-- Regole di merge come planShoppingMerge: stesso nome normalizzato + stessa unita' + voce non spuntata,
-- somma solo se entrambe hanno quantita'; altrimenti nuova riga. Restituisce { added, merged, duplicate }.
create or replace function public.add_shopping_items(p_list_id uuid, p_items jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_saved jsonb;
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
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  -- la lista deve essere visibile (RLS: proprietario o membro)
  perform 1 from public.shopping_lists where id = p_list_id;
  if not found then
    raise exception 'list not found' using errcode = '42501';
  end if;

  delete from public.shopping_add_requests where user_id = v_uid and created_at < now() - interval '7 days';
  insert into public.shopping_add_requests (user_id, idempotency_key) values (v_uid, p_idempotency_key)
    on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    -- richiesta gia' applicata (o in corso: il conflitto attende il commit dell'altra transazione)
    select result into v_saved from public.shopping_add_requests where user_id = v_uid and idempotency_key = p_idempotency_key;
    return coalesce(v_saved, jsonb_build_object('added', 0, 'merged', 0)) || jsonb_build_object('duplicate', true);
  end if;

  -- serializza le aggiunte sulla stessa lista
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
        update public.shopping_items set quantity = quantity + r.quantity where id = v_target;
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
