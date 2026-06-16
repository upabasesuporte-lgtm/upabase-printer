# Política de Segurança - UPABASE

## Resumo das Correções Implementadas

Este documento descreve as medidas de segurança implementadas no projeto UPABASE para proteger dados de usuários e prevenir vazamentos.

### ✅ Correções Críticas Implementadas

#### 1. **Variáveis de Ambiente Seguras**
- Admin email movido para `VITE_ADMIN_EMAIL` (variável de ambiente)
- Arquivo `.env.example` criado com instruções
- `.gitignore` garante que `.env` nunca seja commitado
- **Ação**: Configure `VITE_ADMIN_EMAIL` no seu `.env.local`

#### 2. **Tokens de Convite Protegidos**
- Migrado de `localStorage` (persistente) para `sessionStorage` (expira com sessão)
- Tokens agora são automaticamente deletados ao fechar navegador
- **Impacto**: Reduz risco de roubo de tokens

#### 3. **Validação de Upload de Arquivo**
- Apenas JPEG, PNG e WebP aceitos
- Máximo 5MB por arquivo
- Validação em múltiplos pontos:
  - Avatar do usuário
  - Logo da loja
  - Banner da loja
  - Foto de produtos

#### 4. **Validação de Entrada (Auth)**
- Email validado com regex apropriado
- Senha com mínimo de 8 caracteres
- Previne erros e ataques baseados em input inválido

### ⚠️ Vulnerabilidades Ainda Pendentes

As seguintes vulnerabilidades requerem ações adicionalais e estão documentadas para sua atenção:

#### **CRÍTICAS (Requerem Ação Imediata)**

1. **Políticas de RLS Muito Abertas** (Severidade: CRÍTICA)
   - Problema: Qualquer usuário pode ver dados de OUTROS usuários
   - Tabelas afetadas: `menu_store_settings`, `digital_orders`, `menu_order_messages`
   - Ação necessária: Atualizar políticas RLS no painel Supabase
   - Exemplo de correção:
     ```sql
     -- Substituir USING (true) por:
     ALTER TABLE menu_store_settings
     DROP POLICY IF EXISTS "anon_read_menu_store_settings";
     
     CREATE POLICY "owner_only" ON menu_store_settings
       FOR ALL USING (auth.uid() = user_id);
     ```

2. **Rotacionar Credenciais Supabase e Mercado Pago**
   - Problema: Chaves podem ter sido expostas no histórico git
   - Ação: 
     1. Gerar novas chaves no painel Supabase
     2. Gerar novos tokens no Mercado Pago
     3. Atualizar `.env` local
     4. Remover credenciais antigas de qualquer serviço externo

3. **Verificação de Admin Apenas no Frontend**
   - Problema: Autorização não protegida no backend
   - Ação necessária: Implementar validação de admin no Supabase RLS
   ```sql
   CREATE TABLE IF NOT EXISTS admin_users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     created_at timestamptz DEFAULT now(),
     UNIQUE(user_id)
   );
   
   ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
   
   CREATE POLICY "admin_only" ON admin_users
     FOR ALL USING (auth.uid() = user_id);
   ```

#### **ALTAS (Importante)**

1. **Rate Limiting Ausente**
   - Endpoints críticos sem proteção contra brute force
   - Webhooks sem rate limiting
   - Implementar usando middleware ou Supabase Functions

2. **Headers de Segurança HTTP Ausentes**
   - Configurar em servidor/Vercel:
     - `X-Frame-Options: DENY`
     - `X-Content-Type-Options: nosniff`
     - `Content-Security-Policy`
     - `Strict-Transport-Security`

3. **Falta de Proteção CSRF**
   - Implementar CSRF tokens em formulários
   - Verificar SameSite cookie flag

#### **MÉDIAS**

1. **Dados Sensíveis em localStorage**
   - Preferir `sessionStorage` ou backend storage
   - Criptografar dados se persistir em localStorage

2. **Validação em Múltiplos Campos**
   - Adicionar validação de comprimento máximo em strings
   - Validar tipos de dados em tempo de envio

---

## 🔐 Recomendações de Segurança Contínua

### Antes de Ir para Produção:

- [ ] Implementar RLS corretamente em TODAS as tabelas
- [ ] Rotacionar todas as credenciais/secrets
- [ ] Adicionar rate limiting em endpoints críticos
- [ ] Configurar headers de segurança no servidor
- [ ] Fazer audit de logs de access
- [ ] Testar com ferramentas de segurança (OWASP ZAP, Burp Suite)
- [ ] Configurar HTTPS obrigatório
- [ ] Implementar logging de segurança auditável

### Manutenção Contínua:

- [ ] Atualizar dependências regularmente (`npm audit`)
- [ ] Monitorar alertas de segurança do Supabase
- [ ] Realizar auditorias de segurança trimestrais
- [ ] Manter `.env` files apenas localmente
- [ ] Usar variáveis de ambiente em produção
- [ ] Implementar alertas para atividades suspeitas
- [ ] Fazer backup regular dos dados

---

## 📝 Checklist de Implementação

- [x] Admin email em variável de ambiente
- [x] Tokens de convite em sessionStorage
- [x] Validação de upload de arquivo
- [x] Validação de email e senha
- [x] Arquivo .env.example criado
- [ ] Atualizar RLS no Supabase
- [ ] Rotacionar credenciais
- [ ] Adicionar rate limiting
- [ ] Configurar headers de segurança
- [ ] Implementar CSRF protection

---

## 📞 Contato de Segurança

Se descobrir uma vulnerabilidade, NÃO abra uma issue pública. 
Entre em contato diretamente com: `security@upabase.com`

---

**Última atualização**: 16 de junho de 2026  
**Versão**: 1.0
