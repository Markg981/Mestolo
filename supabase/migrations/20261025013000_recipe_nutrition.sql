-- Valori nutrizionali per porzione, con fonte dichiarata (manual | imported | ai_estimate).
-- Tabella 1:1 con recipes: lettura per chi vede la ricetta (stessa funzione di recipes),
-- scrittura solo del proprietario. Il ruolo anon non ha accesso alla tabella: la pagina
-- pubblica passa da una funzione SECURITY DEFINER dedicata (get_public_recipe resta invariata).

create table public.recipe_nutrition (
  recipe_id uuid primary key references public.recipes (id) on delete cascade,
  energy_kcal numeric(7,1) check (energy_kcal is null or (energy_kcal >= 0 and energy_kcal <= 5000)),
  protein_g numeric(7,1) check (protein_g is null or (protein_g >= 0 and protein_g <= 500)),
  carbs_g numeric(7,1) check (carbs_g is null or (carbs_g >= 0 and carbs_g <= 500)),
  sugars_g numeric(7,1) check (sugars_g is null or (sugars_g >= 0 and sugars_g <= 500)),
  fat_g numeric(7,1) check (fat_g is null or (fat_g >= 0 and fat_g <= 500)),
  saturated_fat_g numeric(7,1) check (saturated_fat_g is null or (saturated_fat_g >= 0 and saturated_fat_g <= 500)),
  fiber_g numeric(7,1) check (fiber_g is null or (fiber_g >= 0 and fiber_g <= 500)),
  salt_g numeric(7,2) check (salt_g is null or (salt_g >= 0 and salt_g <= 100)),
  source text not null check (source in ('manual', 'imported', 'ai_estimate')),
  updated_at timestamptz not null default now(),
  check (sugars_g is null or carbs_g is null or sugars_g <= carbs_g),
  check (saturated_fat_g is null or fat_g is null or saturated_fat_g <= fat_g)
);

alter table public.recipe_nutrition enable row level security;

create policy recipe_nutrition_select on public.recipe_nutrition for select to authenticated
  using (public.can_view_recipe(recipe_id));
create policy recipe_nutrition_insert on public.recipe_nutrition for insert to authenticated
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()));
create policy recipe_nutrition_update on public.recipe_nutrition for update to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()));
create policy recipe_nutrition_delete on public.recipe_nutrition for delete to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()));

grant select, insert, update, delete on public.recipe_nutrition to authenticated;

create or replace function public.recipe_nutrition_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger recipe_nutrition_touch before insert or update on public.recipe_nutrition
  for each row execute function public.recipe_nutrition_touch();

-- Lettura anonima: solo per pagine pubbliche attive, solo colonne nutrizionali
create or replace function public.get_public_recipe_nutrition(p_slug text)
returns table (
  energy_kcal numeric, protein_g numeric, carbs_g numeric, sugars_g numeric, fat_g numeric,
  saturated_fat_g numeric, fiber_g numeric, salt_g numeric, source text, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select n.energy_kcal, n.protein_g, n.carbs_g, n.sugars_g, n.fat_g, n.saturated_fat_g, n.fiber_g, n.salt_g, n.source, n.updated_at
  from public.recipes r
  join public.recipe_nutrition n on n.recipe_id = r.id
  where r.public_slug = p_slug
    and r.public_page_enabled and r.visibility = 'public' and not r.is_hidden;
$$;

revoke all on function public.get_public_recipe_nutrition(text) from public;
grant execute on function public.get_public_recipe_nutrition(text) to anon, authenticated, service_role;
