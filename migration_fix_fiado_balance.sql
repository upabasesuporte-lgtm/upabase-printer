-- ============================================================
-- MIGRATION: Recalcula fiado_balance de todos os clientes
-- com base nos movimentos reais (customer_movements)
-- Execute isso no Supabase SQL Editor (uma vez)
-- ============================================================

-- Só "debit" (venda fiado) aumenta o fiado e só "payment" (pagamento de fiado)
-- reduz o fiado. "credit" e "saldo" são movimentos do saldo pré-pago (balance),
-- não do fiado, e não devem entrar nessa conta.
UPDATE customers
SET fiado_balance = GREATEST(0, subq.total)
FROM (
  SELECT
    customer_id,
    COALESCE(SUM(CASE
      WHEN type = 'debit' THEN amount
      WHEN type = 'payment' THEN -amount
      ELSE 0
    END), 0) AS total
  FROM customer_movements
  GROUP BY customer_id
) subq
WHERE customers.id = subq.customer_id;
