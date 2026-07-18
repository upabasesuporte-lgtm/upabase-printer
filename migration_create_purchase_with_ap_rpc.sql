-- ============================================================
-- ETAPA 3 — RPC transacional isolada pro fluxo de Compras
-- Não cria nem altera nenhuma tabela, coluna, constraint, índice
-- ou policy de RLS existente. Só cria a function (nova) e concede
-- permissão de execução pro papel "authenticated" (necessário pra
-- o app conseguir chamá-la via supabase.rpc()).
-- Cole tudo no Supabase SQL Editor e execute.
-- ============================================================

create or replace function create_purchase_with_ap(
  p_supplier_id uuid,
  p_notes text,
  p_due_date date,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_po_id uuid;
  v_user_id uuid := auth.uid();
  v_supplier_name text;
  v_total numeric := 0;
  v_item jsonb;
  v_is_ingredient boolean;
  v_item_id uuid;
  v_qty numeric;
  v_cost numeric;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A compra precisa ter ao menos um item';
  end if;

  -- Mesma regra já validada na Etapa 2: cria a compra, um item por linha,
  -- uma movimentação de estoque por linha, e atualiza o saldo/custo do
  -- insumo ou produto conforme o tipo. Tudo dentro desta mesma transação —
  -- qualquer erro em qualquer passo desfaz tudo automaticamente.
  insert into purchase_orders (supplier_id, notes, status, received_at, user_id)
  values (p_supplier_id, p_notes, 'received', now(), v_user_id)
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_is_ingredient := (v_item->>'ref_type') = 'ingredient';
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    v_total := v_total + (v_qty * v_cost);

    insert into purchase_order_items (purchase_order_id, stock_item_id, product_id, quantity, unit_cost)
    values (
      v_po_id,
      case when v_is_ingredient then v_item_id else null end,
      case when v_is_ingredient then null else v_item_id end,
      v_qty, v_cost
    );

    insert into stock_movements (stock_item_id, product_id, user_id, type, quantity, cost_price, reference_type, reference_id, notes)
    values (
      case when v_is_ingredient then v_item_id else null end,
      case when v_is_ingredient then null else v_item_id end,
      v_user_id, 'entry', v_qty, v_cost, 'purchase', v_po_id, 'Entrada via compra'
    );

    if v_is_ingredient then
      update stock_items
        set current_qty = current_qty + v_qty,
            cost_price = case when v_cost > 0 then v_cost else cost_price end
        where id = v_item_id;
    else
      update products
        set stock = stock + v_qty,
            cost_price = case when v_cost > 0 then v_cost else cost_price end,
            is_active = case when (stock + v_qty) > 0 then true else is_active end
        where id = v_item_id;
    end if;
  end loop;

  if p_supplier_id is not null then
    select name into v_supplier_name from suppliers where id = p_supplier_id;
  end if;

  insert into accounts_payable (
    user_id, description, supplier, supplier_id, category,
    document_number, due_date, amount, status, purchase_order_id
  ) values (
    v_user_id,
    'Compra' || case when v_supplier_name is not null then ' - ' || v_supplier_name else '' end,
    v_supplier_name, p_supplier_id, 'fornecedores',
    p_notes, p_due_date, v_total, 'pending', v_po_id
  );

  return v_po_id;
end;
$$;

grant execute on function create_purchase_with_ap(uuid, text, date, jsonb) to authenticated;
