-- ============================================================
-- DIGITAL MENU - Script SQL completo
-- Cole tudo no Supabase SQL Editor e execute
-- ============================================================

-- 1. Adicionar colunas na tabela digital_orders (se não existirem)
ALTER TABLE digital_orders
  ADD COLUMN IF NOT EXISTS user_id       uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS change_for    numeric(10,2);

-- 2. Tabela de configurações da loja (cardápio digital)
CREATE TABLE IF NOT EXISTS menu_store_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- 3. Tabela de grupos de opções (ex: "Misturas", "Acompanhamentos")
CREATE TABLE IF NOT EXISTS menu_option_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  min_choices int  NOT NULL DEFAULT 0,
  max_choices int  NOT NULL DEFAULT 1,
  required    boolean NOT NULL DEFAULT false,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- 4. Tabela de opções individuais (ex: "Bife", "Frango", "Toscana")
CREATE TABLE IF NOT EXISTS menu_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES menu_option_groups(id) ON DELETE CASCADE,
  name             text NOT NULL,
  additional_price numeric(10,2) NOT NULL DEFAULT 0,
  is_available     boolean NOT NULL DEFAULT true,
  position         int NOT NULL DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

-- 5. Tabela de mensagens do pedido (chat loja <-> cliente)
CREATE TABLE IF NOT EXISTS menu_order_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES digital_orders(id) ON DELETE CASCADE,
  sender     text NOT NULL CHECK (sender IN ('store', 'customer')),
  message    text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 6. Adicionar coluna is_configurable em products (se não existir)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_configurable boolean NOT NULL DEFAULT false;

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

-- menu_store_settings
ALTER TABLE menu_store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_menu_store_settings"   ON menu_store_settings;
DROP POLICY IF EXISTS "anon_read_menu_store_settings"   ON menu_store_settings;

CREATE POLICY "owner_all_menu_store_settings" ON menu_store_settings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "anon_read_menu_store_settings" ON menu_store_settings
  FOR SELECT USING (true);

-- menu_option_groups
ALTER TABLE menu_option_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_menu_option_groups" ON menu_option_groups;
DROP POLICY IF EXISTS "anon_read_menu_option_groups" ON menu_option_groups;

CREATE POLICY "owner_all_menu_option_groups" ON menu_option_groups
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "anon_read_menu_option_groups" ON menu_option_groups
  FOR SELECT USING (true);

-- menu_options
ALTER TABLE menu_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_menu_options" ON menu_options;
DROP POLICY IF EXISTS "anon_read_menu_options"  ON menu_options;

CREATE POLICY "owner_all_menu_options" ON menu_options
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM menu_option_groups g
      WHERE g.id = menu_options.group_id
        AND g.user_id = auth.uid()
    )
  );

CREATE POLICY "anon_read_menu_options" ON menu_options
  FOR SELECT USING (true);

-- menu_order_messages
ALTER TABLE menu_order_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_all_menu_order_messages" ON menu_order_messages;
DROP POLICY IF EXISTS "anon_read_insert_messages"     ON menu_order_messages;

CREATE POLICY "store_all_menu_order_messages" ON menu_order_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM digital_orders o
      WHERE o.id = menu_order_messages.order_id
        AND o.user_id = auth.uid()
    )
  );

CREATE POLICY "anon_read_insert_messages" ON menu_order_messages
  FOR SELECT USING (true);

CREATE POLICY "anon_insert_messages" ON menu_order_messages
  FOR INSERT WITH CHECK (sender = 'customer');

-- digital_orders: permitir anon inserir e ler pelo order_id
DROP POLICY IF EXISTS "anon_insert_digital_orders" ON digital_orders;
DROP POLICY IF EXISTS "anon_select_digital_orders" ON digital_orders;

CREATE POLICY "anon_insert_digital_orders" ON digital_orders
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_select_digital_orders" ON digital_orders
  FOR SELECT USING (true);

-- ============================================================
-- Realtime: habilitar publicação das tabelas
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE digital_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE menu_order_messages;

-- ============================================================
-- Índices para performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_menu_store_settings_user    ON menu_store_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_menu_option_groups_product  ON menu_option_groups(product_id);
CREATE INDEX IF NOT EXISTS idx_menu_option_groups_user     ON menu_option_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_menu_options_group          ON menu_options(group_id);
CREATE INDEX IF NOT EXISTS idx_menu_order_messages_order   ON menu_order_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_digital_orders_user         ON digital_orders(user_id);
