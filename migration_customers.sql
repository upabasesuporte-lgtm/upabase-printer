-- ============================================================
-- MIGRATION: Garante colunas de fiado e limite na tabela customers
-- Execute isso no Supabase SQL Editor (uma vez)
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS fiado_balance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit  NUMERIC NOT NULL DEFAULT 0;
