-- ============================================================
-- BACKFILL: cria em "sales" os pagamentos de fiado ANTIGOS
-- (feitos antes da correção do bug), para que também apareçam
-- no Histórico do PDV / Vendas Recentes / Caixa (histórico).
--
-- Sem isso, só os pagamentos de fiado feitos DEPOIS da correção
-- vão aparecer lá (pagamentos antigos continuam só no extrato do
-- cliente, em "Movimentações").
--
-- Execute isso no Supabase SQL Editor (uma vez).
-- ============================================================

-- 1) Cria uma venda (origin = 'fiado_payment') para cada pagamento de fiado
--    que ainda não tem venda vinculada (sale_id IS NULL)
INSERT INTO sales (user_id, status, total_amount, discount, customer_id, origin, seller_name, notes, payments, created_at)
SELECT
  cm.user_id,
  'paid',
  cm.amount,
  0,
  cm.customer_id,
  'fiado_payment',
  NULL,
  'Pagamento de fiado - ' || c.name,
  cm.payment_methods,
  cm.created_at
FROM customer_movements cm
JOIN customers c ON c.id = cm.customer_id
WHERE cm.type = 'payment'
  AND cm.sale_id IS NULL;

-- 2) Vincula de volta o sale_id criado ao movimento de origem
--    (evita rodar esse script duas vezes e duplicar vendas)
UPDATE customer_movements cm
SET sale_id = s.id
FROM sales s
WHERE cm.type = 'payment'
  AND cm.sale_id IS NULL
  AND s.origin = 'fiado_payment'
  AND s.customer_id = cm.customer_id
  AND s.total_amount = cm.amount
  AND s.created_at = cm.created_at;
