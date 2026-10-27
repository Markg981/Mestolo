-- pgTAP: add_shopping_quantities rifiuta delta negativi, nulli, zero o enormi.
begin;
select plan(5);
select throws_ok($$select public.add_shopping_quantities('[{"id":"00000000-0000-0000-0000-000000000001","delta":-5}]'::jsonb)$$, '22023');
select throws_ok($$select public.add_shopping_quantities('[{"id":"00000000-0000-0000-0000-000000000001","delta":0}]'::jsonb)$$, '22023');
select throws_ok($$select public.add_shopping_quantities('[{"id":"00000000-0000-0000-0000-000000000001","delta":1e12}]'::jsonb)$$, '22023');
select throws_ok($$select public.add_shopping_quantities('[{"id":"00000000-0000-0000-0000-000000000001"}]'::jsonb)$$, '22023');
select is(public.add_shopping_quantities('[{"id":"00000000-0000-0000-0000-000000000001","delta":2}]'::jsonb), 0, 'delta valido su id inesistente: 0 righe');
select * from finish();
rollback;
