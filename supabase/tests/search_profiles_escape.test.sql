-- pgTAP: search_profiles tratta _ % \ come caratteri letterali.
begin;
select plan(3);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');
update public.profiles set discoverable = true, username = 'zz_viewer', display_name = 'Viewer'
  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set discoverable = true, username = 'zz_u2', display_name = 'a_b'
  where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set discoverable = true, username = 'zz_u3', display_name = 'axb'
  where id = '00000000-0000-0000-0000-0000000000a3';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select results_eq($$select display_name from public.search_profiles('a_b')$$,
  $$values ('a_b')$$, 'a_b non trova axb');
select is_empty($$select 1 from public.search_profiles('a%b')$$, 'il % e'' letterale');
select is_empty($$select 1 from public.search_profiles('a\b')$$, 'il backslash e'' letterale');

select * from finish();
rollback;
