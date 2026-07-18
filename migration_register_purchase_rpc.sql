-- ============================================================
-- ETAPA 3 — ajustes preventivos aprovados:
-- 1) Renomeia create_purchase_with_ap -> register_purchase
-- 2) Adiciona validacao server-side (nao depende so da interface)
-- Nao altera nenhuma regra de negocio, so protege contra dado invalido.
-- Cole tudo no Supabase SQL Editor e execute.
-- ============================================================

create or replace function register_purchase(
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

  -- Todas as validacoes passaram - agora grava tudo
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

  select name into v_supplier_name from suppliers where id = p_supplier_id;

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

grant execute on function register_purchase(uuid, text, date, jsonb) to authenticated;

drop function if exists create_purchase_with_ap(uuid, text, date, jsonb);
