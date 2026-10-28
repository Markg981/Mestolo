-- B-09: i CHECK di dimensione jsonb su public.recipes (20261102000008) sono rimasti NOT VALID.
-- Le righe vecchie oltre soglia verrebbero rifiutate al primo UPDATE, anche se non toccano quei campi.
-- Qui contiamo le righe violanti per ciascun vincolo: se zero, VALIDATE CONSTRAINT (blocco SHARE UPDATE
-- EXCLUSIVE, non blocca le scritture); altrimenti NOTICE col conteggio e il vincolo resta NOT VALID
-- (nessuna perdita di dati, la migrazione non fallisce).
--
-- Bonifica manuale se compare il NOTICE: individuare le righe con
--   select id, octet_length(ingredients::text) from public.recipes where octet_length(ingredients::text) > 400000;
-- (analogo per steps > 2000000 e field_flags > 100000), ridurre/correggere il contenuto, poi rieseguire
--   alter table public.recipes validate constraint <nome>;

do $$
declare
  v record;
  n bigint;
begin
  for v in
    select * from (values
      ('recipes_ingredients_size_chk', 'octet_length(ingredients::text) > 400000'),
      ('recipes_steps_size_chk', 'octet_length(steps::text) > 2000000'),
      ('recipes_field_flags_size_chk', 'octet_length(field_flags::text) > 100000')
    ) as t(name, violation)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.recipes'::regclass and conname = v.name and not convalidated
    ) then
      continue; -- assente o gia' validato
    end if;
    execute format('select count(*) from public.recipes where %s', v.violation) into n;
    if n = 0 then
      execute format('alter table public.recipes validate constraint %I', v.name);
    else
      raise notice 'B-09: % resta NOT VALID: % righe oltre soglia, da bonificare a mano', v.name, n;
    end if;
  end loop;
end
$$;
