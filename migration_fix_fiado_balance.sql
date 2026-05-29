-- ============================================================
-- MIGRATION: Recalcula fiado_balance de todos os clientes
-- com base nos movimentos reais (customer_movements)
-- Execute isso no Supabase SQL Editor (uma vez)
-- ============================================================

UPDATE customers
SET fiado_balance = subq.total
FROM (
  SELECT
    customer_id,
    COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE -amount END), 0) AS total
  FROM customer_movements
  GROUP BY customer_id
) subq
WHERE customers.id = subq.customer_id;
