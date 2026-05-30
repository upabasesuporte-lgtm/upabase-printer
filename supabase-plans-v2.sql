-- ============================================================
-- PLANOS v2 — adiciona tipo de plano e integração MP
-- Cole no Supabase SQL Editor e execute
-- ============================================================

ALTER TABLE user_plans
  ADD COLUMN IF NOT EXISTS plan_type        text CHECK (plan_type IN ('loja','delivery','pro')),
  ADD COLUMN IF NOT EXISTS mp_subscription_id text;

-- Índice para busca por subscription_id (webhook)
CREATE INDEX IF NOT EXISTS idx_user_plans_mp_sub ON user_plans(mp_subscription_id)
  WHERE mp_subscription_id IS NOT NULL;
