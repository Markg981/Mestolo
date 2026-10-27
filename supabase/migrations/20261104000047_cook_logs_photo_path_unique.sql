-- Audit A-12: due cook log non possono condividere la stessa foto, altrimenti
-- cancellarne uno rimuove il file dell'altro. Vincolo a livello DB (robusto
-- anche contro INSERT diretti via API, dove il path e' scelto dal client).

-- Duplicati esistenti: si tiene la foto sul log piu' vecchio, gli altri la perdono
-- (il file resta referenziato dal log conservato, quindi nessun file viene cancellato).
-- Il trigger di immutabilita' va saltato per questo UPDATE di sanatoria.
alter table public.cook_logs disable trigger user;
update public.cook_logs c
   set photo_path = null
 where photo_path is not null
   and exists (
     select 1 from public.cook_logs o
      where o.photo_path = c.photo_path
        and (o.created_at, o.id) < (c.created_at, c.id)
   );
alter table public.cook_logs enable trigger user;

create unique index if not exists cook_logs_photo_path_key
  on public.cook_logs (photo_path) where photo_path is not null;
