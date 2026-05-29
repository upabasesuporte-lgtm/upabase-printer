-- ============================================================
-- CONTAS A PAGAR - Script SQL completo
-- Cole tudo no Supabase SQL Editor e execute
-- ============================================================

CREATE TABLE IF NOT EXISTS accounts_payable (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description          text        NOT NULL,
  supplier             text,
  category             text        NOT NULL DEFAULT 'outros',
  cost_center          text,
  document_number      text,
  competence_date      date,
  due_date             date        NOT NULL,
  paid_date            date,
  amount               numeric(12,2) NOT NULL,
  discount             numeric(12,2) NOT NULL DEFAULT 0,
  interest             numeric(12,2) NOT NULL DEFAULT 0,
  fine                 numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount          numeric(12,2) NOT NULL DEFAULT 0,
  status               text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid','partial','overdue','cancelled','scheduled')),
  payment_method       text,
  bank_account         text,
  installment_number   int,
  total_installments   int,
  installment_group_id uuid,
  recurrence           text        NOT NULL DEFAULT 'none'
                       CHECK (recurrence IN ('none','weekly','monthly','yearly')),
  notes                text,
  tags                 text[],
  quick_input          text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_accounts_payable" ON accounts_payable;
CREATE POLICY "owner_all_accounts_payable" ON accounts_payable
  FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ap_user   ON accounts_payable(user_id);
CREATE INDEX IF NOT EXISTS idx_ap_due    ON accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_status ON accounts_payable(status);
CREATE INDEX IF NOT EXISTS idx_ap_group  ON accounts_payable(installment_group_id);
