-- ============================================================
-- Atualiza cancel_purchase: alem de reverter o estoque, agora
-- tambem desativa o produto/insumo automaticamente QUANDO essa
-- compra cancelada era a UNICA origem dele (nenhuma outra compra
-- e nenhuma venda no PDV vinculada) - exatamente o cenario de
-- "criei um produto de teste via Compras e quero que cancelar a
-- nota faça tudo sumir junto".
--
-- Se o produto/insumo já tem OUTRAS compras ou vendas vinculadas,
-- ele NÃO é desativado - só o estoque dessa compra é revertido,
-- porque nesse caso é um item real e estabelecido, não um teste
-- isolado, e desativar sozinho poderia esconder algo que a loja
-- ainda usa.
--
-- Desativar (não excluir) segue a mesma regra já usada no resto
-- do sistema: nunca apaga registro com histórico vinculado.
-- ============================================================

create or replace function cancel_purchase(p_purchase_order_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_po_status text;
  v_ap_status text;
  v_item record;
  v_other_refs int;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado';
  end if;

  select status into v_po_status
  from purchase_orders
  where id = p_purchase_order_id and user_id = v_user_id;

  if v_po_status is null then
    raise exception 'Compra nao encontrada';
  end if;

  if v_po_status = 'cancelled' then
    raise exception 'Esta compra ja foi cancelada';
  end if;

  select status into v_ap_status
  from accounts_payable
  where purchase_order_id = p_purchase_order_id;

  if v_ap_status in ('paid', 'partial') then
    raise exception 'Esta compra tem pagamento registrado em Contas a Pagar. Estorne o pagamento primeiro antes de cancelar a compra.';
  end if;

  -- Reverte o estoque que essa compra tinha somado (nunca deixa ficar negativo)
  for v_item in
    select stock_item_id, product_id, quantity
    from purchase_order_items
    where purchase_order_id = p_purchase_order_id
  loop
    if v_item.stock_item_id is not null then
      update stock_items
        set current_qty = greatest(0, current_qty - v_item.quantity)
        where id = v_item.stock_item_id;

      -- So desativa se nao existir NENHUMA outra compra pra esse insumo
      select count(*) into v_other_refs
      from purchase_order_items
      where stock_item_id = v_item.stock_item_id
        and purchase_order_id <> p_purchase_order_id;

      if v_other_refs = 0 then
        update stock_items set is_active = false where id = v_item.stock_item_id;
      end if;

    elsif v_item.product_id is not null then
      update products
        set stock = greatest(0, stock - v_item.quantity)
        where id = v_item.product_id;

      -- So desativa se nao existir NENHUMA outra compra nem venda pra esse produto
      select count(*) into v_other_refs
      from purchase_order_items
      where product_id = v_item.product_id
        and purchase_order_id <> p_purchase_order_id;

      if v_other_refs = 0 then
        select count(*) into v_other_refs
        from sale_items
        where product_id = v_item.product_id;
      end if;

      if v_other_refs = 0 then
        update products set is_active = false, status = 'inactive' where id = v_item.product_id;
      end if;
    end if;
  end loop;

  update accounts_payable
    set status = 'cancelled', updated_at = now()
    where purchase_order_id = p_purchase_order_id;

  update purchase_orders
    set status = 'cancelled'
    where id = p_purchase_order_id;
end;
$$;

grant execute on function cancel_purchase(uuid) to authenticated;
