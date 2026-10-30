-- Valutazione AI di un ingrediente aggiunto a una ricetta (compatibilita'):
-- il risultato si conserva come le analisi e le sostituzioni.
alter table public.ai_suggestions drop constraint if exists ai_suggestions_kind_check;
alter table public.ai_suggestions
  add constraint ai_suggestions_kind_check check (kind in ('analysis', 'substitution', 'pairing'));
