-- Hardening funzioni SECURITY DEFINER: EXECUTE ad anon solo dove serve davvero.
-- Problema: revocare solo FROM public non basta, perche Supabase concede EXECUTE
-- ad anon/authenticated tramite default privileges. Molte funzioni security definer
-- risultavano quindi chiamabili anche senza login.

-- 1) Revoca EXECUTE da public e anon su TUTTE le funzioni security definer dello
--    schema public, tranne quelle pensate per i visitatori anonimi (pagine pubbliche,
--    anteprima invito, scheda profilo pubblica). Le funzioni trigger non devono essere
--    chiamabili da nessun ruolo client (solo il trigger le esegue): revoca anche da authenticated.
do $$
declare
  f record;
  anon_ok text[] := array[
    'get_public_recipe', 'list_public_recipe_slugs', 'count_public_recipes',
    'public_cover_paths', 'is_public_cover_object', 'invite_preview',
    'get_profile_card', 'get_public_recipe_nutrition'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if not (f.proname = any (anon_ok)) then
      execute format('revoke execute on function %s from public, anon', f.sig);
    end if;
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- 2) collection_owner / shopping_list_owner restano chiamabili da authenticated (le policy
--    RLS le valutano con i privilegi dell'utente), ma non rivelano piu il proprietario di un
--    uuid qualunque: restituiscono owner_id solo se coincide con il chiamante, altrimenti null.
--    Tutte le policy le usano solo nella forma "owner(...) = auth.uid()", quindi il
--    comportamento delle policy resta identico.
create or replace function public.collection_owner(cid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from public.collections where id = cid and owner_id = auth.uid();
$$;

create or replace function public.shopping_list_owner(lid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from public.shopping_lists where id = lid and owner_id = auth.uid();
$$;

revoke execute on function public.collection_owner(uuid) from public, anon;
revoke execute on function public.shopping_list_owner(uuid) from public, anon;
grant execute on function public.collection_owner(uuid) to authenticated;
grant execute on function public.shopping_list_owner(uuid) to authenticated;

-- 3) Funzioni future: niente EXECUTE implicito a public/anon (ogni migrazione concede
--    esplicitamente a chi serve). Vale per le funzioni create dal ruolo che esegue le migrazioni.
alter default privileges in schema public revoke execute on functions from public, anon;
