-- ============================================================
-- DIAGNÓSTICO: lançamentos "Venda #XXXXXX" no caixa ABERTO que
-- não têm mais uma venda correspondente na tabela sales (foram
-- deixados órfãos quando a venda foi excluída, por causa do bug
-- corrigido no código em 2026-07-03).
--
-- Isso explica o "Saldo em Dinheiro" ficar maior do que a soma em
-- "Formas de Pagamento" + fundo inicial.
--
-- Passo 1: rode o SELECT abaixo no Supabase SQL Editor e confira
-- os resultados (data/hora, descrição, valor) batem com uma venda
-- que você lembra de ter excluído.
-- ============================================================

WITH open_reg AS (
  SELECT id FROM cash_registers WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1
)
SELECT cm.id, cm.created_at, cm.description, cm.payment_method, cm.amount
FROM cash_movements cm, open_reg
WHERE cm.register_id = open_reg.id
  AND cm.movement_type = 'sale'
  AND cm.description ~ '#[0-9A-Fa-f]{6}'
  AND NOT EXISTS (
    SELECT 1 FROM sales s
    WHERE UPPER(RIGHT(s.id::text, 6)) = UPPER((regexp_match(cm.description, '#([0-9A-Fa-f]{6})'))[1])
  )
ORDER BY cm.created_at DESC;

-- ============================================================
-- Passo 2: depois de CONFIRMAR visualmente que a(s) linha(s) acima
-- são mesmo sobras de vendas excluídas (e não algo legítimo), apague
-- só elas pelo id retornado no Passo 1. Troque o id abaixo pelo que
-- apareceu no resultado (repita para cada linha, se houver mais de uma):
--
-- DELETE FROM cash_movements WHERE id = 'COLE_O_ID_AQUI';
-- ============================================================
