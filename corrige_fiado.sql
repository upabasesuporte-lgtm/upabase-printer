-- ============================================================
-- CORRECAO: recalcula o fiado de TODOS os clientes a partir
-- do historico real (customer_movements).
-- Rode DEPOIS de conferir o diagnostico_fiado.sql
-- ============================================================

UPDATE customers c
SET fiado_balance = sub.fiado_real
FROM (
  SELECT
    cu.id AS customer_id,
    GREATEST(0, COALESCE(SUM(CASE
      WHEN m.type = 'debit'
       AND COALESCE(lower(m.description),'') NOT LIKE 'saldo usado%' THEN m.amount
      WHEN m.type = 'payment' THEN -m.amount
      ELSE 0
    END), 0)) AS fiado_real
  FROM customers cu
  LEFT JOIN customer_movements m ON m.customer_id = cu.id
  GROUP BY cu.id
) sub
WHERE c.id = sub.customer_id
  AND ROUND(c.fiado_balance::numeric, 2) <> ROUND(sub.fiado_real::numeric, 2);
