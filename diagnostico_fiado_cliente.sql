-- ============================================================
-- DIAGNOSTICO POR CLIENTE: mostra TODOS os movimentos de fiado
-- do cliente na ordem cronologica, com o saldo acumulado passo a
-- passo. Serve pra ver exatamente de onde vem o valor do topo.
--
-- Troque o nome abaixo pelo nome do cliente (ou parte dele).
-- ============================================================

WITH mov AS (
  SELECT
    m.created_at,
    m.type,
    m.amount,
    m.description,
    m.sale_id,
    CASE
      WHEN m.type = 'debit'
       AND COALESCE(lower(m.description), '') NOT LIKE 'saldo usado%' THEN m.amount
      WHEN m.type = 'payment' THEN -m.amount
      ELSE 0
    END AS efeito_no_fiado
  FROM customer_movements m
  JOIN customers c ON c.id = m.customer_id
  WHERE c.name ILIKE '%NOME DO CLIENTE AQUI%'
)
SELECT
  created_at,
  type,
  amount,
  description,
  efeito_no_fiado,
  SUM(efeito_no_fiado) OVER (ORDER BY created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_acumulado
FROM mov
ORDER BY created_at;

-- Comparativo final: topo x extrato
SELECT
  c.name,
  c.fiado_balance AS mostrado_no_topo,
  GREATEST(0, COALESCE(SUM(CASE
    WHEN m.type = 'debit'
     AND COALESCE(lower(m.description), '') NOT LIKE 'saldo usado%' THEN m.amount
    WHEN m.type = 'payment' THEN -m.amount
    ELSE 0
  END), 0)) AS soma_do_extrato
FROM customers c
LEFT JOIN customer_movements m ON m.customer_id = c.id
WHERE c.name ILIKE '%NOME DO CLIENTE AQUI%'
GROUP BY c.name, c.fiado_balance;
