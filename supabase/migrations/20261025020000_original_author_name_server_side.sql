-- original_author_name non e' piu' accettato dal client: viene derivato lato server
-- dalla ricetta sorgente (stessa logica di copyRecipe). Senza copied_from_recipe_id
-- resta null, cosi' non si puo' falsificare l'autore mostrato ("Copiata da...").
-- Dopo la creazione il campo e' gia' immutabile (recipes_before_write).

create or replace function public.recipes_derive_author_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src_name text;
  src_owner uuid;
  uname text;
begin
  if new.copied_from_recipe_id is null then
    new.original_author_name := null;
    return new;
  end if;
  select r.original_author_name, r.owner_id into src_name, src_owner
    from public.recipes r where r.id = new.copied_from_recipe_id;
  if src_name is null and src_owner is not null then
    select p.username into uname from public.profiles p where p.id = src_owner;
    if uname is not null and uname <> '' then
      src_name := '@' || uname;
    end if;
  end if;
  new.original_author_name := src_name;
  return new;
end;
$$;

drop trigger if exists recipes_derive_author_name on public.recipes;
create trigger recipes_derive_author_name
  before insert on public.recipes
  for each row execute function public.recipes_derive_author_name();
