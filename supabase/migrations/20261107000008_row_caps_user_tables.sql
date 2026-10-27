-- C-08: tetti di righe sulle ultime tabelle utente prive di enforce_row_cap (le ricette hanno gia' il tetto di 10000
-- e il limite giornaliero in 20261106000043). Riusa enforce_row_cap(cap, colonna) generalizzata da 20261106000043;
-- tetti generosi, solo anti-abuso.
create trigger cook_logs_row_cap before insert on public.cook_logs
  for each row execute function public.enforce_row_cap(20000, 'user_id');
create trigger recipe_images_row_cap before insert on public.recipe_images
  for each row execute function public.enforce_row_cap(20000, 'owner_id');
create trigger recipe_ratings_row_cap before insert on public.recipe_ratings
  for each row execute function public.enforce_row_cap(20000, 'user_id');
create trigger recipe_translations_row_cap before insert on public.recipe_translations
  for each row execute function public.enforce_row_cap(20000, 'user_id');
create trigger ai_suggestions_row_cap before insert on public.ai_suggestions
  for each row execute function public.enforce_row_cap(5000, 'user_id');
create trigger push_subscriptions_row_cap before insert on public.push_subscriptions
  for each row execute function public.enforce_row_cap(50, 'user_id');
