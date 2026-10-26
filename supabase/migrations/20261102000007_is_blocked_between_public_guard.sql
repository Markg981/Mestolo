-- A-07: public.is_blocked_between controlla un solo verso (solo "ho bloccato io
-- l'altro") di proposito: renderla simmetrica la farebbe tornare a rivelare al
-- bloccato di esserlo (vedi 20261102000001, C-19). Il rischio residuo e' che una
-- policy futura la usi credendola simmetrica e ridia accesso a un utente
-- bloccato. Nessuna riscrittura regex: la funzione resta invariata e viene
-- marcata con un commento; le policy usano private.is_blocked_between (simmetrica)
-- e tests/db/social-graph.test.ts fallisce se una policy o funzione public
-- richiama di nuovo la versione pubblica. Idempotente.

comment on function public.is_blocked_between(uuid, uuid) is
  'SOLO RPC, UNIDIREZIONALE: true se il chiamante ha bloccato l''altro. NON usarla in policy RLS o funzioni: per il controllo simmetrico usare private.is_blocked_between.';

comment on function private.is_blocked_between(uuid, uuid) is
  'Controllo simmetrico del blocco (in entrambi i versi), solo per policy RLS e funzioni server. Non esposta via PostgREST.';
