// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PlanType = 'loja' | 'delivery' | 'pro';

export interface UserPlanRecord {
  plan: 'trial' | 'active' | 'lifetime' | 'suspended';
  plan_expires_at: string | null;
  is_lifetime: boolean;
  plan_type: PlanType | null;
  mp_subscription_id?: string | null;
}

// ─── Rotas liberadas por plano ────────────────────────────────────────────────

export const PLAN_ROUTES: Record<PlanType, string[]> = {
  loja: [
    '/', '/cash', '/pdv', '/digital-menu', '/tables', '/products', '/stock',
    '/purchases', '/suppliers',
    '/customers', '/accounts-payable', '/reports', '/settings',
  ],
  delivery: [
    '/', '/cash', '/pdv', '/digital-menu', '/products', '/stock',
    '/purchases', '/suppliers',
    '/customers', '/accounts-payable', '/reports', '/settings',
  ],
  pro: [
    '/', '/cash', '/pdv', '/digital-menu', '/tables', '/products', '/stock',
    '/purchases', '/suppliers',
    '/customers', '/accounts-payable', '/reports', '/settings',
  ],
};

// ─── Detalhes de cada plano ───────────────────────────────────────────────────

export const PLAN_INFO: Record<PlanType, {
  label: string;
  description: string;
  price_monthly: number;
  price_annual_monthly: number;
  price_annual_total: number;
  color: string;
  highlight: boolean;
  features: string[];
  // IDs dos planos no Mercado Pago — preencha após criar os planos no painel MP
  mp_id_monthly: string;
  mp_id_annual: string;
}> = {
  loja: {
    label: 'Plano Loja',
    description: 'Acesso completo a todas as funcionalidades',
    price_monthly: 59.90,
    price_annual_monthly: 49.90,
    price_annual_total: 598.80,
    color: '#10b981',
    highlight: true,
    features: [
      'Dashboard completo',
      'Caixa com relatórios',
      'PDV (ponto de venda)',
      'Gestão de produtos',
      'Controle de estoque',
      'Cadastro de clientes',
      'Contas a pagar',
      'Relatórios',
      'Cardápio digital com QR Code',
      'Gestão de mesas',
      'Configurações',
    ],
    mp_id_monthly: '972256de953c4c65b3ee06365d1f0808',
    mp_id_annual:  'a3716e086f1b425e832657a2576e54ca',
  },
  delivery: {
    label: 'Plano Delivery',
    description: 'Para delivery e restaurantes',
    price_monthly: 79.90,
    price_annual_monthly: 65.90,
    price_annual_total: 790.80,
    color: '#7B2FBE',
    highlight: true,
    features: [
      'Tudo do Plano Loja',
      'Cardápio digital com QR Code',
      'Chat com cliente',
      'Pedidos online em tempo real',
      'Notificações de novos pedidos',
      'Impressão de comanda',
    ],
    mp_id_monthly: 'c54f782a2ca144f3b277b00e8fad57a6',
    mp_id_annual:  '76f5b3dd887c4a34916da685289c2eaa',
  },
  pro: {
    label: 'Plano Pro',
    description: 'Tudo incluso + controle de mesas',
    price_monthly: 97.00,
    price_annual_monthly: 79.90,
    price_annual_total: 958.80,
    color: '#f59e0b',
    highlight: false,
    features: [
      'Tudo do Plano Delivery',
      'Gestão de mesas',
      'Atendimento no salão',
      'Comandas por mesa',
      'Histórico por mesa',
    ],
    mp_id_monthly: 'a9f190a3ee544a33b9d0287446d2ba77',
    mp_id_annual:  'd729eedfaa7b4bbaac2f07029d21b8d4',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isPlanValid(plan: UserPlanRecord | null): boolean {
  if (!plan) return false;
  if (plan.is_lifetime) return true;
  if (plan.plan === 'suspended') return false;
  if (!plan.plan_expires_at) return false;
  return new Date(plan.plan_expires_at) > new Date();
}

export function isRouteAllowed(path: string, plan: UserPlanRecord | null): boolean {
  if (!isPlanValid(plan)) return false;
  if (!plan) return false;
  // Trial e lifetime têm acesso a tudo
  if (plan.is_lifetime || plan.plan === 'trial') return true;
  // Sem plan_type = acesso total (legado)
  if (!plan.plan_type) return true;
  return PLAN_ROUTES[plan.plan_type]?.includes(path) ?? false;
}

export function getMpCheckoutUrl(planId: string, email?: string): string {
  const base = `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${planId}`;
  return email ? `${base}&payer_email=${encodeURIComponent(email)}` : base;
}
