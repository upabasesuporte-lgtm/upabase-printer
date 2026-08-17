-- ============================================================
-- Compra Pendente (aguardando entrega) — duas RPCs novas,
-- NAO alteram register_purchase nem cancel_purchase existentes.
--
-- 1) create_pending_purchase: cria a compra com status 'pending'.
--    NAO mexe em estoque nem em contas a pagar (isso so acontece
--    quando a mercadoria realmente chegar).
--
-- 2) receive_purchase_order: confirma o recebimento de uma compra
--    pendente. Reproduz exatamente a mesma logica de estoque e
--    contas a pagar que register_purchase ja faz pra compra
--    recebida na hora, so que agora acontece no momento do
--    recebimento em vez do momento do pedido.
--
-- CORRECAO (v2): a versao anterior de receive_purchase_order tentava
-- gravar em stock_movements com colunas que essa tabela nao tem nesse
-- banco (mesmo problema que ja foi corrigido em register_purchase por
-- migration_register_purchase_fix_stock_movements.sql). Removido aqui
-- tambem. Se voce ja rodou a v1, so rodar esta de novo (create or
-- replace substitui a funcao antiga sem duplicar nada).
--
-- Cole tudo no Supabase SQL Editor e execute.
-- ============================================================

create or replace function create_pending_purchase(
  p_supplier_id uuid,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_po_id uuid;
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_ref_type text;
  v_is_ingredient boolean;
  v_item_id uuid;
  v_qty numeric;
  v_cost numeric;
  v_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A compra precisa ter ao menos um item';
  end if;

  if p_supplier_id is null then
    raise exception 'A compra precisa de um fornecedor selecionado';
  end if;

  if not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Fornecedor nao encontrado';
  end if;

  -- Valida todos os itens antes de gravar qualquer coisa
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_ref_type := v_item->>'ref_type';
    if v_ref_type not in ('ingredient', 'product') then
      raise exception 'Tipo de item invalido: %', v_ref_type;
    end if;

    if v_item->>'item_id' is null then
      raise exception 'Item da compra sem produto/insumo selecionado';
    end if;
    v_item_id := (v_item->>'item_id')::uuid;

    v_qty := (v_item->>'quantity')::numeric;
    if v_qty <= 0 then
      raise exception 'Quantidade invalida para o item %', v_item_id;
    end if;

    v_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_cost < 0 then
      raise exception 'Custo invalido para o item %', v_item_id;
    end if;

    if v_ref_type = 'ingredient' then
      select exists(select 1 from stock_items where id = v_item_id) into v_exists;
      if not v_exists then
        raise exception 'Insumo nao encontrado: %', v_item_id;
      end if;
    else
      select exists(select 1 from products where id = v_item_id) into v_exists;
      if not v_exists then
        raise exception 'Produto nao encontrado: %', v_item_id;
      end if;
    end if;
  end loop;

  -- Grava a compra como pendente — sem mexer em estoque ou financeiro
  insert into purchase_orders (supplier_id, notes, status, received_at, user_id)
  values (p_supplier_id, p_notes, 'pending', null, v_user_id)
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_is_ingredient := (v_item->>'ref_type') = 'ingredient';
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);

    insert into purchase_order_items (purchase_order_id, stock_item_id, product_id, quantity, unit_cost)
    values (
      v_po_id,
      case when v_is_ingredient then v_item_id else null end,
      case when v_is_ingredient then null else v_item_id end,
      v_qty, v_cost
    );
  end loop;

  return v_po_id;
end;
$$;

grant execute on function create_pending_purchase(uuid, text, jsonb) to authenticated;


create or replace function receive_purchase_order(
  p_purchase_order_id uuid,
  p_due_date date
)
returns void
language plpgsql
security invoker
as $$
declare
  v_user_id uuid := auth.uid();
  v_po_status text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_notes text;
  v_total numeric := 0;
  v_item record;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado';
  end if;

  select status, supplier_id, notes into v_po_status, v_supplier_id, v_notes
  from purchase_orders
  where id = p_purchase_order_id and user_id = v_user_id;

  if v_po_status is null then
    raise exception 'Compra nao encontrada';
  end if;

  if v_po_status != 'pending' then
    raise exception 'Esta compra nao esta pendente de recebimento';
  end if;

  for v_item in
    select stock_item_id, product_id, quantity, unit_cost
    from purchase_order_items
    where purchase_order_id = p_purchase_order_id
  loop
    v_total := v_total + (v_item.quantity * v_item.unit_cost);

    if v_item.stock_item_id is not null then
      update stock_items
        set current_qty = current_qty + v_item.quantity,
            cost_price = case when v_item.unit_cost > 0 then v_item.unit_cost else cost_price end
        where id = v_item.stock_item_id;
    elsif v_item.product_id is not null then
      update products
        set stock = stock + v_item.quantity,
            cost_price = case when v_item.unit_cost > 0 then v_item.unit_cost else cost_price end,
            is_active = case when (stock + v_item.quantity) > 0 then true else is_active end
        where id = v_item.product_id;
    end if;
  end loop;

  select name into v_supplier_name from suppliers where id = v_supplier_id;

  insert into accounts_payable (
    user_id, description, supplier, supplier_id, category,
    document_number, due_date, amount, status, purchase_order_id
  ) values (
    v_user_id,
    'Compra' || case when v_supplier_name is not null then ' - ' || v_supplier_name else '' end,
    v_supplier_name, v_supplier_id, 'fornecedores',
    v_notes, p_due_date, v_total, 'pending', p_purchase_order_id
  );

  update purchase_orders
    set status = 'received', received_at = now()
    where id = p_purchase_order_id;
end;
$$;

grant execute on function receive_purchase_order(uuid, date) to authenticated;
