// Funcionários com PIN no mesmo login da loja.
// Regra de ouro: se a conta não tem nenhum operador ativo, nada muda no app
// (sem tela de PIN, sem bloqueio de abas, sem pedido de autorização).
//
// Observação: é um controle operacional (quem pode fazer o quê no balcão),
// não uma barreira contra quem tem acesso técnico ao computador logado.
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// "staff" = funcionário com abas escolhidas uma a uma (allowed_routes).
// manager/cashier/waiter/stock ficam como atalhos (modelos) e compatibilidade.
export type OperatorRole = "owner" | "staff" | "manager" | "cashier" | "waiter" | "stock";

export interface Operator {
  id: string;
  name: string;
  role: OperatorRole;
  active: boolean;
  allowed_routes?: string[] | null;
  can_approve?: boolean;
}

export const ROLE_LABEL: Record<OperatorRole, string> = {
  owner: "Dono",
  staff: "Funcionário",
  manager: "Gerente",
  cashier: "Caixa",
  waiter: "Garçom",
  stock: "Estoquista",
};

// Abas que podem ser liberadas (mesmos caminhos do menu)
export const TAB_OPTIONS: { path: string; label: string }[] = [
  { path: "/",                 label: "Dashboard" },
  { path: "/cash",             label: "Caixa" },
  { path: "/pdv",              label: "Vendas (PDV)" },
  { path: "/customers",        label: "Clientes" },
  { path: "/digital-menu",     label: "Catálogo Digital" },
  { path: "/tables",           label: "Mesas" },
  { path: "/kitchen",          label: "Cozinha" },
  { path: "/products",         label: "Produtos" },
  { path: "/stock",            label: "Estoque" },
  { path: "/purchases",        label: "Compras" },
  { path: "/suppliers",        label: "Fornecedores" },
  { path: "/accounts-payable", label: "Contas a Pagar" },
  { path: "/reports",          label: "Relatórios" },
  { path: "/settings",         label: "Configurações" },
];

// Atalhos que já marcam as abas mais comuns de cada função
export const PRESETS: { label: string; routes: string[]; canApprove: boolean }[] = [
  { label: "Caixa",      routes: ["/pdv", "/tables", "/customers", "/cash"], canApprove: false },
  { label: "Garçom",     routes: ["/tables", "/digital-menu"], canApprove: false },
  { label: "Estoquista", routes: ["/products", "/stock", "/purchases", "/suppliers"], canApprove: false },
  { label: "Gerente",    routes: ["/", "/cash", "/pdv", "/customers", "/digital-menu", "/tables", "/kitchen", "/products", "/stock", "/purchases", "/suppliers", "/reports"], canApprove: true },
];

// Abas das funções antigas/fixas (null = todas)
const ROLE_ROUTES: Record<OperatorRole, string[] | null> = {
  owner: null,
  staff: [],
  manager: PRESETS[3].routes,
  cashier: PRESETS[0].routes,
  waiter: PRESETS[1].routes,
  stock: PRESETS[2].routes,
};

export function operatorRoutes(op: Operator): string[] | null {
  if (op.role === "owner") return null;
  return op.allowed_routes ?? ROLE_ROUTES[op.role];
}

export function operatorCanApprove(op: Operator | null): boolean {
  return !!op && (op.role === "owner" || op.role === "manager" || !!op.can_approve);
}

export function describeOperator(op: Operator): string {
  const routes = operatorRoutes(op);
  if (routes === null) return "Acesso total";
  const labels = TAB_OPTIONS.filter(t => routes.includes(t.path)).map(t => t.label);
  return (labels.length ? labels.join(", ") : "Nenhuma aba") + (operatorCanApprove(op) ? " · pode autorizar" : "");
}

interface State {
  ownerId: string | null;       // usuário logado (dono da conta)
  operators: Operator[];        // operadores ativos
  current: Operator | null;     // quem está operando neste aparelho
  approval: { reason: string; resolve: (ok: boolean) => void } | null;
  lockMinutes: number;          // trava automática por inatividade (0 = nunca)
}

let state: State = { ownerId: null, operators: [], current: null, approval: null, lockMinutes: 10 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const setState = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

const curKey = (uid: string) => `operator_current_${uid}`;
const enabledKey = (uid: string) => `operators_enabled_${uid}`;

function readJSON<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; }
}
function writeJSON(key: string, v: unknown) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem storage */ }
}

export function useOperators() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export function operatorsEnabled(s: State = state) {
  return s.operators.length > 0;
}

// Carrega os operadores da conta (chamado pelo layout após o login)
export async function loadOperators(ownerId: string) {
  // Enquanto carrega, usa a última situação conhecida neste aparelho (evita
  // abrir as abas por um instante quando a conta usa PIN)
  if (state.ownerId !== ownerId) {
    const cachedOps = readJSON<Operator[]>(enabledKey(ownerId)) ?? [];
    setState({ ownerId, operators: cachedOps, current: readJSON<Operator>(curKey(ownerId)) });
  }
  const [{ data, error }, { data: us }] = await Promise.all([
    supabase.from("operators")
      .select("id,name,role,active,allowed_routes,can_approve").eq("active", true).order("name"),
    supabase.from("user_settings").select("operator_lock_minutes").eq("user_id", ownerId).maybeSingle(),
  ]);
  if (error) { console.warn("operators:", error.message); return; }
  const lock = (us as any)?.operator_lock_minutes;
  if (typeof lock === "number") setState({ lockMinutes: lock });
  const ops = (data ?? []) as Operator[];
  writeJSON(enabledKey(ownerId), ops);
  // Se o operador atual foi removido/alterado, atualiza ou desloga
  const cur = state.current ? ops.find(o => o.id === state.current!.id) ?? null : null;
  writeJSON(curKey(ownerId), cur);
  setState({ operators: ops, current: cur });
}

export async function saveLockMinutes(ownerId: string, minutes: number) {
  const { error } = await supabase.from("user_settings").upsert(
    { user_id: ownerId, operator_lock_minutes: minutes, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw error;
  setState({ lockMinutes: minutes });
}

export function setCurrentOperator(op: Operator | null) {
  if (state.ownerId) writeJSON(curKey(state.ownerId), op);
  setState({ current: op });
}

export function canAccessRoute(path: string, s: State = state): boolean {
  if (!operatorsEnabled(s)) return true;
  if (!s.current) return false;
  const allowed = operatorRoutes(s.current);
  return allowed === null || allowed.includes(path);
}

// Pede PIN de dono/gerente antes de uma ação sensível.
// Libera direto se a conta não usa PIN ou se quem opera já é dono/gerente.
export function requireApproval(reason: string): Promise<boolean> {
  if (!operatorsEnabled()) return Promise.resolve(true);
  if (operatorCanApprove(state.current)) return Promise.resolve(true);
  return new Promise(resolve => {
    state.approval?.resolve(false);
    setState({ approval: { reason, resolve } });
  });
}

export function finishApproval(ok: boolean) {
  const a = state.approval;
  setState({ approval: null });
  a?.resolve(ok);
}

export async function verifyOperatorPin(id: string, pin: string) {
  const { data, error } = await supabase.rpc("verify_operator_pin", { p_id: id, p_pin: pin });
  if (error) throw error;
  return data as { ok: boolean; id?: string; name?: string; role?: OperatorRole };
}

// Entrar só com o PIN: o banco descobre de quem é (PIN não repete na conta)
export async function verifyPinLogin(pin: string) {
  const { data, error } = await supabase.rpc("verify_pin_login", { p_pin: pin });
  if (error) throw error;
  return data as { ok: boolean; operator?: Operator };
}

export async function verifyManagerPin(pin: string) {
  const { data, error } = await supabase.rpc("verify_manager_pin", { p_pin: pin });
  if (error) throw error;
  return data as { ok: boolean; name?: string };
}
