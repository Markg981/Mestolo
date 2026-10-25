-- =====================================================================
-- Mestolo – auto-hide: contano solo le segnalazioni di account affidabili
--  * prima bastavano 3 account usa-e-getta per nascondere qualsiasi ricetta
--  * ora ai fini del nascondimento automatico contano solo i segnalatori che
--    - non sono l'autore della ricetta,
--    - hanno l'email confermata,
--    - hanno un account più vecchio di 7 giorni
--  * la segnalazione resta sempre registrata (status 'open') per la revisione
--    manuale dei moderatori, anche se non conta per il filtro automatico
-- =====================================================================

create or replace function public.reports_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  select count(distinct r.reporter_id) into n
    from public.reports r
    join auth.users u on u.id = r.reporter_id
    join public.recipes rc on rc.id = r.recipe_id
   where r.recipe_id = new.recipe_id
     and r.status = 'open'
     and r.reporter_id <> rc.owner_id
     and u.email_confirmed_at is not null
     and u.created_at < now() - interval '7 days';
  if n >= 3 then
    perform set_config('mestolo.moderation', 'on', true);
    update public.recipes set is_hidden = true where id = new.recipe_id and not is_hidden;
    perform set_config('mestolo.moderation', 'off', true);
  end if;
  return new;
end;
$$;

revoke all on function public.reports_after_insert() from public, anon, authenticated;
