// Funcionários com PIN no mesmo login da loja.
// Regra de ouro: se a conta não tem nenhum operador ativo, nada muda no app
// (sem tela de PIN, sem bloqueio de abas, sem pedido de autorização).
//
// Observação: é um controle operacional (quem pode fazer o quê no balcão),
// não uma barreira contra quem tem acesso técnico ao computador logado.
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

export type OperatorRole = "owner" | "manager" | "cashier" | "waiter" | "stock";

export interface Operator {
  id: string;
  name: string;
  role: OperatorRole;
  active: boolean;
}

export const ROLE_LABEL: Record<OperatorRole, string> = {
  owner: "Dono",
  manager: "Gerente",
  cashier: "Caixa",
  waiter: "Garçom",
  stock: "Estoquista",
};

export const ROLE_DESC: Record<OperatorRole, string> = {
  owner: "Acesso total",
  manager: "Tudo, menos Configurações e Contas a Pagar",
  cashier: "Vendas, Mesas, Clientes e Caixa",
  waiter: "Mesas e Catálogo Digital",
  stock: "Produtos, Estoque, Compras e Fornecedores",
};

// Abas liberadas por função (null = todas)
const ROLE_ROUTES: Record<OperatorRole, string[] | null> = {
  owner: null,
  manager: ["/", "/cash", "/pdv", "/customers", "/digital-menu", "/tables", "/products", "/stock", "/purchases", "/suppliers", "/reports"],
  cashier: ["/pdv", "/tables", "/customers", "/cash"],
  waiter: ["/tables", "/digital-menu"],
  stock: ["/products", "/stock", "/purchases", "/suppliers"],
};

interface State {
  ownerId: string | null;       // usuário logado (dono da conta)
  operators: Operator[];        // operadores ativos
  current: Operator | null;     // quem está operando neste aparelho
  approval: { reason: string; resolve: (ok: boolean) => void } | null;
}

let state: State = { ownerId: null, operators: [], current: null, approval: null };
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
  const { data, error } = await supabase.from("operators")
    .select("id,name,role,active").eq("active", true).order("name");
  if (error) { console.warn("operators:", error.message); return; }
  const ops = (data ?? []) as Operator[];
  writeJSON(enabledKey(ownerId), ops);
  // Se o operador atual foi removido/alterado, atualiza ou desloga
  const cur = state.current ? ops.find(o => o.id === state.current!.id) ?? null : null;
  writeJSON(curKey(ownerId), cur);
  setState({ operators: ops, current: cur });
}

export function setCurrentOperator(op: Operator | null) {
  if (state.ownerId) writeJSON(curKey(state.ownerId), op);
  setState({ current: op });
}

export function canAccessRoute(path: string, s: State = state): boolean {
  if (!operatorsEnabled(s)) return true;
  if (!s.current) return false;
  const allowed = ROLE_ROUTES[s.current.role];
  return allowed === null || allowed.includes(path);
}

// Pede PIN de dono/gerente antes de uma ação sensível.
// Libera direto se a conta não usa PIN ou se quem opera já é dono/gerente.
export function requireApproval(reason: string): Promise<boolean> {
  if (!operatorsEnabled()) return Promise.resolve(true);
  const role = state.current?.role;
  if (role === "owner" || role === "manager") return Promise.resolve(true);
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

export async function verifyManagerPin(pin: string) {
  const { data, error } = await supabase.rpc("verify_manager_pin", { p_pin: pin });
  if (error) throw error;
  return data as { ok: boolean; name?: string };
}
