-- M-02: una copia di una ricetta non puo' essere piu' visibile della sorgente.
-- Ordine: private < friends < public. Una pagina pubblica richiede sorgente public.
-- Sorgente cancellata (copied_from_recipe_id = null per "on delete set null"): la copia
-- diventa autonoma e il vincolo non si applica (e' una scelta del proprietario della sorgente).
-- Il vincolo si verifica solo in INSERT o quando visibilita'/pagina pubblica vengono ampliate:
-- se la sorgente restringe DOPO, la copia esistente non viene toccata (e' uno snapshot gia'
-- condiviso) ma non puo' essere ampliata ulteriormente.
create or replace function public.recipes_public_page_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new text;
  v_src text;
  v_rank_new int;
  v_rank_src int;
begin
  if tg_op = 'UPDATE' then
    new.public_slug := old.public_slug;
  else
    new.public_slug := null;
  end if;

  if new.copied_from_recipe_id is not null
     and (tg_op = 'INSERT'
          or new.visibility is distinct from old.visibility
          or (new.public_page_enabled and not old.public_page_enabled)) then
    select r.visibility::text into v_src from public.recipes r where r.id = new.copied_from_recipe_id;
    if found then
      v_rank_new := case new.visibility::text when 'private' then 0 when 'friends' then 1 else 2 end;
      v_rank_src := case v_src when 'private' then 0 when 'friends' then 1 else 2 end;
      if v_rank_new > v_rank_src or (new.public_page_enabled and v_src <> 'public') then
        raise exception 'copy_visibility_exceeds_source' using errcode = '22023';
      end if;
    end if;
  end if;

  if new.visibility <> 'public' then
    new.public_page_enabled := false;
  end if;
  if new.public_page_enabled and new.public_slug is null then
    new.public_slug := public.make_recipe_slug_random(new.title, null, new.id);
  elsif tg_op = 'UPDATE' and new.public_slug is not null and new.title is distinct from old.title then
    v_new := public.make_recipe_slug_random(new.title, substring(new.public_slug from '([a-f0-9]{8})$'), new.id);
    if v_new <> new.public_slug then
      insert into public.recipe_slug_history (slug, recipe_id) values (new.public_slug, new.id) on conflict do nothing;
      delete from public.recipe_slug_history where slug = v_new and recipe_id = new.id;
      new.public_slug := v_new;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.recipes_public_page_guard() from public, anon, authenticated;
