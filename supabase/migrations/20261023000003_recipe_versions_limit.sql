-- Cronologia versioni limitata: si conservano solo le ultime N versioni per ricetta
-- e non si crea una versione se il contenuto (snapshot) non e' cambiato.

-- Unica costante del limite
create or replace function public.recipe_versions_limit()
returns int language sql immutable as $$ select 20 $$;

create or replace function public.recipes_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src record;
  src_source text;
begin
  -- La categoria deve essere di sistema o del proprietario
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and (c.owner_id is null or c.owner_id = new.owner_id)
  ) then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    -- Attribuzione: non falsificabile. Se si dichiara una copia, la fonte deve
    -- essere visibile al nuovo proprietario e l'autore deve coincidere.
    if new.copied_from_recipe_id is not null or new.original_author_id is not null then
      if new.copied_from_recipe_id is null then
        raise exception 'original_author requires copied_from' using errcode = '22023';
      end if;
      select r.owner_id, r.original_author_id into src
        from public.recipes r where r.id = new.copied_from_recipe_id;
      if not found then
        raise exception 'source recipe not found' using errcode = '22023';
      end if;
      if auth.uid() is not null and not public.can_view_recipe_for(new.copied_from_recipe_id, new.owner_id) then
        raise exception 'source recipe not visible' using errcode = '42501';
      end if;
      if new.original_author_id is distinct from coalesce(src.original_author_id, src.owner_id) then
        raise exception 'attribution mismatch' using errcode = '22023';
      end if;
    end if;
    if new.parent_recipe_id is not null and auth.uid() is not null
       and not public.can_view_recipe_for(new.parent_recipe_id, new.owner_id) then
      raise exception 'parent recipe not visible' using errcode = '42501';
    end if;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    -- Campi immutabili dopo la creazione
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.parent_recipe_id := old.parent_recipe_id;
    new.copied_from_recipe_id := old.copied_from_recipe_id;
    new.original_author_id := old.original_author_id;
    new.original_author_name := old.original_author_name;
    new.source_type := old.source_type;
    -- Solo il gestore (service role) può cambiare la moderazione
    if auth.uid() is not null then
      new.is_hidden := old.is_hidden;
    end if;
  end if;

  new.content_hash := md5(jsonb_build_object(
    't', new.title, 'd', new.description, 'l', new.original_language, 's', new.servings,
    'p', new.prep_minutes, 'c', new.cook_minutes, 'tt', new.total_minutes,
    'i', new.ingredients, 'st', new.steps
  )::text);

  new.search_text := lower(concat_ws(' ',
    new.title, new.description, array_to_string(new.tags, ' '),
    (select string_agg(coalesce(e ->> 'name', ''), ' ') from jsonb_array_elements(new.ingredients) e)
  ));

  if tg_op = 'UPDATE' then
    if public.recipe_snapshot(new) is distinct from public.recipe_snapshot(old) then
      new.version := old.version + 1;
      new.updated_at := now();
      src_source := case
        when new.last_change_source is distinct from old.last_change_source and new.last_change_source is not null
          then new.last_change_source
        else 'edit' end;
      insert into public.recipe_versions (recipe_id, version, snapshot, change_source, change_note, created_by)
      values (new.id, new.version, public.recipe_snapshot(new), src_source, new.last_change_note, auth.uid());
      -- La riga ricetta e' bloccata dall'UPDATE in corso: le potature concorrenti sono
      -- serializzate; le versioni sono monotone, quindi l'ordine e' deterministico.
      delete from public.recipe_versions
      where recipe_id = new.id and version <= new.version - public.recipe_versions_limit();
    else
      new.version := old.version;
      if new is distinct from old then
        new.updated_at := now();
      end if;
    end if;
    new.last_change_source := null;
    new.last_change_note := null;
  end if;

  return new;
end;
$$;
