-- ============================================================
-- DIAGNOSTICO: quais clientes estao com o "Fiado em aberto"
-- (customers.fiado_balance) diferente do historico real
-- (customer_movements). Rode no Supabase SQL Editor.
-- ============================================================

WITH real AS (
  SELECT
    customer_id,
    GREATEST(0, COALESCE(SUM(CASE
      WHEN type = 'debit'
       AND COALESCE(lower(description),'') NOT LIKE 'saldo usado%' THEN amount
      WHEN type = 'payment' THEN -amount
      ELSE 0
    END), 0)) AS fiado_real,
    MAX(created_at) FILTER (WHERE type = 'debit')   AS ultimo_debito,
    MAX(created_at) FILTER (WHERE type = 'payment') AS ultimo_pagamento
  FROM customer_movements
  GROUP BY customer_id
)
SELECT
  c.name                                   AS cliente,
  c.fiado_balance                          AS mostrado_no_topo,
  COALESCE(r.fiado_real, 0)                AS deveria_ser,
  c.fiado_balance - COALESCE(r.fiado_real, 0) AS diferenca,
  r.ultimo_debito,
  r.ultimo_pagamento
FROM customers c
LEFT JOIN real r ON r.customer_id = c.id
WHERE ROUND((c.fiado_balance - COALESCE(r.fiado_real, 0))::numeric, 2) <> 0
ORDER BY ABS(c.fiado_balance - COALESCE(r.fiado_real, 0)) DESC;
