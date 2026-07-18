-- ============================================================
-- INTEGRAÇÃO COMPRAS <-> ESTOQUE <-> CONTAS A PAGAR — Etapa 1
-- Só estrutura (colunas/constraints novas, todas opcionais).
-- Nenhuma compra ou conta existente é alterada por este script.
-- Cole tudo no Supabase SQL Editor e execute.
-- ============================================================

-- 1) purchase_order_items passa a aceitar item de estoque (insumo)
--    OU produto de revenda, nunca os dois nem nenhum dos dois.
alter table purchase_order_items
  add column if not exists product_id uuid references products(id);

alter table purchase_order_items
  alter column stock_item_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchase_order_items_one_ref_check'
  ) then
    alter table purchase_order_items
      add constraint purchase_order_items_one_ref_check
      check (
        (stock_item_id is not null and product_id is null)
        or
        (stock_item_id is null and product_id is not null)
      );
  end if;
end $$;

create index if not exists idx_poi_product on purchase_order_items(product_id);

-- 2) accounts_payable ganha relacionamento real com fornecedor e com a
--    compra que a originou (hoje "supplier" é só texto livre).
alter table accounts_payable
  add column if not exists supplier_id uuid references suppliers(id);

alter table accounts_payable
  add column if not exists purchase_order_id uuid references purchase_orders(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_payable_purchase_order_id_key'
  ) then
    alter table accounts_payable
      add constraint accounts_payable_purchase_order_id_key unique (purchase_order_id);
  end if;
end $$;

create index if not exists idx_ap_supplier_id on accounts_payable(supplier_id);
create index if not exists idx_ap_purchase_order_id on accounts_payable(purchase_order_id);
