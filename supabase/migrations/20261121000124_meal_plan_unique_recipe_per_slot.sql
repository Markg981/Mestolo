-- G-14: nello stesso slot sono ammesse piu ricette, ma non la stessa ricetta due volte.
-- Bonifica: dei duplicati (owner, data, slot, ricetta) resta la voce piu vecchia.
delete from public.meal_plan_entries a
 using public.meal_plan_entries b
 where a.recipe_id is not null
   and a.owner_id = b.owner_id and a.plan_date = b.plan_date
   and a.slot = b.slot and a.recipe_id = b.recipe_id
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index meal_plan_unique_recipe_slot_idx
  on public.meal_plan_entries (owner_id, plan_date, slot, recipe_id)
  where recipe_id is not null;
