-- ============================================================
-- MIGRATION: Adiciona vínculo de produto às opções do cardápio
-- Execute isso no Supabase SQL Editor (uma vez)
-- ============================================================

ALTER TABLE menu_options
  ADD COLUMN IF NOT EXISTS linked_product_id UUID
  REFERENCES products(id)
  ON DELETE SET NULL;
