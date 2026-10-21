-- Estoque: histórico de movimentações + ficha técnica (tabelas novas).
-- As tabelas antigas stock_movements / product_recipes têm outro formato
-- (company_id, tipos in/out, ingredient_id) e nunca aceitaram as gravações
-- do app; ficam intocadas.

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete cascade,
  type text not null check (type in ('entry','exit','loss','count','sale','purchase','purchase_cancel','return')),
  quantity numeric not null,           -- variação com sinal (+ entrou, - saiu)
  balance_after numeric,               -- saldo depois do movimento, quando conhecido
  unit_cost numeric,
  reference_type text,
  reference_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  constraint inventory_movements_item_chk check (product_id is not null or stock_item_id is not null)
);
create index if not exists inventory_movements_user_created_idx on public.inventory_movements (user_id, created_at desc);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index if not exists inventory_movements_stock_item_idx on public.inventory_movements (stock_item_id, created_at desc);
alter table public.inventory_movements enable row level security;
create policy inventory_movements_own on public.inventory_movements
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint recipe_items_unique unique (product_id, stock_item_id)
);
create index if not exists recipe_items_user_idx on public.recipe_items (user_id);
create index if not exists recipe_items_stock_item_idx on public.recipe_items (stock_item_id);
alter table public.recipe_items enable row level security;
create policy recipe_items_own on public.recipe_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Ajuste manual atômico: trava o item, calcula o novo saldo, grava o saldo e
-- o histórico na mesma transação. Roda com as permissões do usuário (RLS).
create or replace function public.adjust_inventory(
  p_ref_type text,          -- 'product' | 'ingredient'
  p_item_id uuid,
  p_type text,              -- 'entry' | 'exit' | 'loss' | 'count'
  p_quantity numeric,       -- quantidade movimentada, ou a contada quando 'count'
  p_notes text default null,
  p_unit_cost numeric default null
) returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old numeric;
  v_new numeric;
begin
  if auth.uid() is null then raise exception 'Usuario nao autenticado'; end if;
  if p_quantity is null or p_quantity < 0 or (p_type <> 'count' and p_quantity = 0) then
    raise exception 'Quantidade invalida';
  end if;

  if p_ref_type = 'product' then
    select coalesce(stock, 0) into v_old from products where id = p_item_id for update;
  elsif p_ref_type = 'ingredient' then
    select coalesce(current_qty, 0) into v_old from stock_items where id = p_item_id for update;
  else
    raise exception 'Tipo de item invalido';
  end if;
  if not found then raise exception 'Item nao encontrado'; end if;

  if p_type = 'entry' then v_new := v_old + p_quantity;
  elsif p_type in ('exit', 'loss') then v_new := greatest(v_old - p_quantity, 0);
  elsif p_type = 'count' then v_new := p_quantity;
  else raise exception 'Tipo de movimentacao invalido';
  end if;

  if p_ref_type = 'product' then
    update products
      set stock = v_new,
          is_active = case when v_new > 0 and status = 'active' then true else is_active end
      where id = p_item_id;
  else
    update stock_items set current_qty = v_new where id = p_item_id;
  end if;

  insert into inventory_movements (user_id, product_id, stock_item_id, type, quantity, balance_after, unit_cost, reference_type, notes)
  values (
    auth.uid(),
    case when p_ref_type = 'product' then p_item_id end,
    case when p_ref_type = 'ingredient' then p_item_id end,
    p_type, v_new - v_old, v_new, p_unit_cost, 'manual', nullif(trim(p_notes), '')
  );

  return v_new;
end;
$$;

revoke all on function public.adjust_inventory(text, uuid, text, numeric, text, numeric) from public, anon;
grant execute on function public.adjust_inventory(text, uuid, text, numeric, text, numeric) to authenticated;
