-- ============================================================
-- MIGRATION: permite origin = 'fiado_payment' na tabela sales
--
-- A constraint sales_origin_check só aceitava:
--   'pdv', 'cardapio_digital', 'digital_menu', 'ifood', 'mesa', 'tables'
-- Isso bloqueava o lançamento do pagamento de fiado no histórico de
-- vendas (o insert falhava com "violates check constraint sales_origin_check").
--
-- Este script recria a mesma constraint incluindo 'fiado_payment',
-- sem remover nenhum valor que já era aceito.
--
-- Execute isso no Supabase SQL Editor (uma vez).
-- ============================================================

ALTER TABLE sales DROP CONSTRAINT sales_origin_check;

ALTER TABLE sales ADD CONSTRAINT sales_origin_check
  CHECK (origin = ANY (ARRAY[
    'pdv'::text,
    'cardapio_digital'::text,
    'digital_menu'::text,
    'ifood'::text,
    'mesa'::text,
    'tables'::text,
    'fiado_payment'::text
  ]));
