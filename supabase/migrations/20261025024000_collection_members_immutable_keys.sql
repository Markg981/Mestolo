-- M5: il proprietario poteva cambiare user_id/invited_by/collection_id di un membro con un UPDATE,
-- aggirando il vincolo di amicizia/blocco verificato solo in INSERT. Le chiavi del membro diventano
-- immutabili: resta modificabile solo il ruolo (per cambiare utente si elimina e si reinserisce).
create or replace function public.collection_members_keys_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.collection_id is distinct from old.collection_id
     or new.user_id is distinct from old.user_id
     or new.invited_by is distinct from old.invited_by then
    raise exception 'collection_members: collection_id, user_id e invited_by non sono modificabili'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger collection_members_keys_immutable before update on public.collection_members
  for each row execute function public.collection_members_keys_immutable();
