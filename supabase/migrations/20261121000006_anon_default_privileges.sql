-- M-17: difesa in profondita. init.sql revocava i grant ad anon solo sulle tabelle esistenti allora;
-- le tabelle create dalle migrazioni successive ereditavano i default privileges di Supabase.
-- Le pagine pubbliche (/r/<slug>, sitemap, profili) leggono via RPC security definer o client admin,
-- quindi anon non ha bisogno di alcun privilegio diretto sulle tabelle.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
