-- ============================================================
-- CORRECAO NA FONTE: trigger que mantem customers.fiado_balance
-- SEMPRE igual a soma real de customer_movements.
--
-- Ate agora o valor do topo ("Fiado em aberto") era um contador
-- gravado pela aplicacao em ~8 lugares (PDV, Mesas, Clientes).
-- Se qualquer passo falhasse (rede, RLS, venda excluida por outro
-- aparelho, exclusao em cascata, dois caixas ao mesmo tempo), o
-- contador ficava diferente do extrato e so dava pra consertar
-- cliente por cliente.
--
-- Com este trigger, QUALQUER insercao / edicao / exclusao de
-- movimento recalcula o saldo do cliente na mesma transacao, no
-- banco. Fica impossivel o topo divergir do historico, nao
-- importa o que a aplicacao faca.
--
-- Rode UMA VEZ no Supabase SQL Editor.
-- ============================================================

-- 1) Funcao que recalcula o fiado de um cliente a partir do extrato real.
--    Mesma regra do extrato: "debit" soma, "payment" abate, movimentos de
--    saldo pre-pago ("saldo" ou descricao "saldo usado...") nao entram,
--    e o saldo nunca fica negativo.
CREATE OR REPLACE FUNCTION public.fiado_balance_from_movements(p_customer_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(0, COALESCE(SUM(CASE
    WHEN m.type = 'debit'
     AND COALESCE(lower(m.description), '') NOT LIKE 'saldo usado%' THEN m.amount
    WHEN m.type = 'payment' THEN -m.amount
    ELSE 0
  END), 0))
  FROM public.customer_movements m
  WHERE m.customer_id = p_customer_id;
$$;

-- 2) Trigger que aplica esse recalculo sempre que um movimento muda.
CREATE OR REPLACE FUNCTION public.trg_recalc_fiado_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new uuid := NEW.customer_id;
  v_old uuid := OLD.customer_id;
BEGIN
  IF v_new IS NOT NULL THEN
    UPDATE public.customers
       SET fiado_balance = public.fiado_balance_from_movements(v_new)
     WHERE id = v_new;
  END IF;

  -- UPDATE que troca o movimento de cliente (raro, mas cobre o caso)
  IF v_old IS NOT NULL AND v_old IS DISTINCT FROM v_new THEN
    UPDATE public.customers
       SET fiado_balance = public.fiado_balance_from_movements(v_old)
     WHERE id = v_old;
  END IF;

  RETURN NULL; -- AFTER trigger: valor de retorno ignorado
END;
$$;

DROP TRIGGER IF EXISTS customer_movements_recalc_fiado ON public.customer_movements;

CREATE TRIGGER customer_movements_recalc_fiado
AFTER INSERT OR UPDATE OR DELETE ON public.customer_movements
FOR EACH ROW
EXECUTE FUNCTION public.trg_recalc_fiado_balance();

-- 3) Correcao unica de TODOS os clientes que ja estao divergentes agora
--    (inclusive o que motivou esse ajuste).
UPDATE public.customers c
SET fiado_balance = public.fiado_balance_from_movements(c.id)
WHERE ROUND(c.fiado_balance::numeric, 2)
   <> ROUND(public.fiado_balance_from_movements(c.id)::numeric, 2);

-- 4) Conferencia: deve voltar 0 linhas.
SELECT c.name,
       c.fiado_balance                              AS topo,
       public.fiado_balance_from_movements(c.id)     AS extrato
FROM public.customers c
WHERE ROUND(c.fiado_balance::numeric, 2)
   <> ROUND(public.fiado_balance_from_movements(c.id)::numeric, 2);
