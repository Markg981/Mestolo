-- Audit: l'update di shopping_items non validava recipe_id, quindi un membro
-- poteva puntare un articolo a una ricetta altrui non visibile.
-- Il controllo sta in un trigger (non nella WITH CHECK) per scattare solo quando
-- recipe_id cambia: spuntare un articolo la cui ricetta non e piu visibile
-- deve continuare a funzionare. La policy di update resta invariata.
-- SECURITY INVOKER: can_view_recipe valuta auth.uid() del chiamante.
create or replace function public.shopping_items_recipe_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.recipe_id is not null
     and new.recipe_id is distinct from old.recipe_id
     and not public.can_view_recipe(new.recipe_id) then
    raise exception 'recipe not visible' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger shopping_items_recipe_guard before update on public.shopping_items
  for each row execute function public.shopping_items_recipe_guard();
