-- ============================================================
-- CONFIGURAÇÕES DA LOJA - Cole no Supabase SQL Editor e execute
-- ============================================================

CREATE TABLE IF NOT EXISTS store_settings (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text    NOT NULL DEFAULT 'Minha Loja',
  cnpj            text    NOT NULL DEFAULT '',
  address         text    NOT NULL DEFAULT '',
  phone           text    NOT NULL DEFAULT '',
  pix             text    NOT NULL DEFAULT '',
  footer_message  text    NOT NULL DEFAULT 'Obrigado pela preferência! Volte sempre.',
  show_cnpj       boolean NOT NULL DEFAULT true,
  sellers         text[]  NOT NULL DEFAULT '{}',
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_store_settings" ON store_settings;
CREATE POLICY "owner_all_store_settings" ON store_settings
  FOR ALL USING (auth.uid() = user_id);
