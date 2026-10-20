-- Índices por loja (user_id) — acelera Relatórios e demais telas com muitas lojas.
-- Só adiciona índices: não altera dados nem regras de segurança (RLS).
-- Já aplicado no Supabase em 2026-10-20.
create index if not exists idx_sales_user_created        on public.sales (user_id, created_at desc);
create index if not exists idx_cash_registers_user_opened on public.cash_registers (user_id, opened_at);
create index if not exists idx_cash_movements_user_created on public.cash_movements (user_id, created_at desc);
create index if not exists idx_cash_movements_register   on public.cash_movements (register_id);
create index if not exists idx_customer_movements_user_created on public.customer_movements (user_id, created_at desc);
create index if not exists idx_customer_movements_customer on public.customer_movements (customer_id);
create index if not exists idx_products_user             on public.products (user_id);
create index if not exists idx_stock_items_user          on public.stock_items (user_id);
create index if not exists idx_purchase_orders_user_created on public.purchase_orders (user_id, created_at desc);
create index if not exists idx_purchase_order_items_order on public.purchase_order_items (purchase_order_id);
