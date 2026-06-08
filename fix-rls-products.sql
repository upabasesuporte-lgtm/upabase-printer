-- ============================================================
-- DESABILITAR RLS NA TABELA PRODUCTS
-- Cole isso no Supabase SQL Editor e execute
-- ============================================================

-- Verificar se RLS está ativada
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'products';

-- Desabilitar RLS
ALTER TABLE products DISABLE ROW LEVEL SECURITY;

-- Verificar resultado
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'products';
