-- Audit privacy: original_author_name esponeva '@username' dell'autore originale anche se il suo
-- profilo non e' pubblico. Ora il nome viene derivato solo se profile_visibility = 'public';
-- altrimenti resta null (la UI non mostra la riga "Copiata da"). Backfill delle copie esistenti.

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
    select p.username into uname from public.profiles p
      where p.id = src_owner and p.profile_visibility = 'public';
    if uname is not null and uname <> '' then
      src_name := '@' || uname;
    end if;
  end if;
  new.original_author_name := src_name;
  return new;
end;
$$;

-- Backfill: azzera il nome per le copie il cui autore originale ha un profilo non pubblico.
-- Il trigger recipes_before_write rende il campo immutabile per il client: qui si e' owner/migrazione.
alter table public.recipes disable trigger user;
update public.recipes r
   set original_author_name = null
  from public.profiles p
 where p.id = coalesce(r.original_author_id, (select s.owner_id from public.recipes s where s.id = r.copied_from_recipe_id))
   and r.original_author_name is not null
   and p.profile_visibility <> 'public';
alter table public.recipes enable trigger user;
