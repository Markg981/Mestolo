-- M-16: reports_insert non vincolava lo status; un utente poteva inserire
-- segnalazioni gia 'reviewed'/'dismissed' e aggirare il flusso di moderazione
-- (l'appello riporta a 'open' solo quelle 'reviewed'). Unico campo di moderazione
-- della tabella e status: lo si vincola a 'open'.
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and public.can_view_recipe(recipe_id)
    and not exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid())
  );
