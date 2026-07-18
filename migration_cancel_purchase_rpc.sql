-- ============================================================
-- Cancelar Compra — RPC transacional isolada, so usada pelo
-- fluxo de Compras. Segue o padrao profissional: NAO apaga o
-- registro (mantem para auditoria), so marca como cancelada,
-- reverte o estoque, e cancela a conta a pagar vinculada.
--
-- Bloqueia o cancelamento se a conta a pagar ja tiver qualquer
-- pagamento registrado (status 'paid' ou 'partial') - nesse caso
-- e preciso estornar o pagamento em Contas a Pagar primeiro.
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
    elsif v_item.product_id is not null then
      update products
        set stock = greatest(0, stock - v_item.quantity)
        where id = v_item.product_id;
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
