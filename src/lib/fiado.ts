import { supabase } from "./supabase";
import { fetchAll } from "./fetchAll";

const isSaldoMov = (m: { type: string; description: string | null }) =>
  m.type === "saldo" || (m.description ?? "").toLowerCase().startsWith("saldo usado");

export type FiadoMov = { id: string; type: string; amount: number; description: string | null };

// Regra ÚNICA do fiado (usada pelo extrato E pelo "Deve atualmente"):
// percorre o histórico em ordem; débito soma, pagamento abate, e a dívida nunca
// fica negativa. O que for pago além da dívida NÃO abate compras futuras — fica
// registrado em `overpaid` (e, nos pagamentos novos, vira saldo do cliente via
// um movimento "credit" separado; ver payDebt em Clientes).
// Antes o extrato usava esta regra e o contador usava soma simples (débitos −
// pagamentos), então uma sobra de pagamento sumia do extrato mas abatia a
// dívida no topo da tela — os dois valores divergiam.
export function computeFiadoLedger(movsAsc: FiadoMov[]) {
  let running = 0;
  const after: Record<string, number> = {};
  const overpaid: Record<string, number> = {};
  for (const m of movsAsc) {
    const amount = Number(m.amount) || 0;
    if (m.type === "debit" && !isSaldoMov(m)) running += amount;
    else if (m.type === "payment") {
      if (amount > running) overpaid[m.id] = Math.round((amount - running) * 100) / 100;
      running = Math.max(0, running - amount);
    }
    running = Math.round(running * 100) / 100;
    after[m.id] = running;
  }
  return { total: running, after, overpaid };
}

// ── Pessoas da conta (ex.: a esposa marca na conta do marido) ──
// Mesma regra do computeFiadoLedger, só que separando a dívida por pessoa.
// Quem deve cada débito: a pessoa da venda (sales.member_id) ou do lançamento
// manual (member_id); sem pessoa = titular ("holder").
// Pagamento de uma pessoa abate primeiro as compras mais antigas DELA (sobrando,
// abate as dos outros); pagamento "da conta toda" abate as mais antigas de todos.
// O total por pessoa somado é igual ao total da conta.
export const HOLDER = "holder";
export type MemberMov = FiadoMov & {
  created_at?: string; sale_id?: string | null; member_id?: string | null; member_holder?: boolean | null;
  sales?: { member_id: string | null } | null;
};
export const debitPerson = (m: MemberMov) =>
  (m.sale_id && m.sales ? m.sales.member_id : m.member_id) ?? HOLDER;
export const paymentPerson = (m: MemberMov) =>
  m.member_holder ? HOLDER : m.member_id ?? null; // null = conta toda

export function computeMemberLedger(movsAsc: MemberMov[]) {
  const open: { person: string; left: number }[] = [];
  const bal: Record<string, number> = {};
  // Por pagamento: quanto abateu de cada pessoa e como cada uma ficou
  const pay: Record<string, { alloc: Record<string, number>; before: Record<string, number>; after: Record<string, number> }> = {};
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (const m of movsAsc) {
    const amount = Number(m.amount) || 0;
    if (m.type === "debit" && !isSaldoMov(m)) {
      const p = debitPerson(m);
      open.push({ person: p, left: amount });
      bal[p] = r2((bal[p] ?? 0) + amount);
    } else if (m.type === "payment") {
      const who = paymentPerson(m);
      const before = { ...bal };
      const alloc: Record<string, number> = {};
      let rest = amount;
      const take = (d: { person: string; left: number }) => {
        if (rest <= 0 || d.left <= 0) return;
        const v = Math.min(d.left, rest);
        d.left = r2(d.left - v); rest = r2(rest - v);
        alloc[d.person] = r2((alloc[d.person] ?? 0) + v);
        bal[d.person] = r2((bal[d.person] ?? 0) - v);
      };
      if (who) for (const d of open) if (d.person === who) take(d);
      for (const d of open) take(d);
      for (let i = open.length - 1; i >= 0; i--) if (open[i].left <= 0.0001) open.splice(i, 1);
      pay[m.id] = { alloc, before, after: { ...bal } };
    }
  }
  return { bal, pay };
}

export async function fetchFiadoMovs(customerId: string): Promise<FiadoMov[]> {
  // Paginado: clientes antigos podem passar de 1000 lançamentos
  const { data, error } = await fetchAll(() => supabase
    .from("customer_movements")
    .select("id, type, amount, description")
    .eq("customer_id", customerId)
    .in("type", ["debit", "payment"])
    .order("created_at", { ascending: true }));
  if (error) throw error;
  return (data ?? []) as FiadoMov[];
}

// Recalcula fiado_balance do zero a partir de customer_movements (a mesma fonte
// e a mesma regra do extrato). Chamar isso depois de QUALQUER inserção/edição/
// exclusão de movimento evita que o contador salvo em customers.fiado_balance
// fique dessincronizado do histórico real.
export async function recalcFiadoBalance(customerId: string): Promise<number> {
  const { total } = computeFiadoLedger(await fetchFiadoMovs(customerId));

  const { error: updErr } = await supabase
    .from("customers")
    .update({ fiado_balance: total })
    .eq("id", customerId);
  if (updErr) throw updErr;

  return total;
}

// Compras que formam a dívida atual (desde a última vez que o fiado zerou),
// com a mesma regra do extrato. Usado na cobrança pelo WhatsApp.
export async function fetchOpenFiado(customerId: string) {
  const { data, error } = await fetchAll(() => supabase
    .from("customer_movements")
    .select("id, type, amount, description, created_at")
    .eq("customer_id", customerId)
    .in("type", ["debit", "payment"])
    .order("created_at", { ascending: true }));
  if (error) throw error;
  let running = 0;
  let debits: { date: string; amount: number }[] = [];
  let paid = 0;
  for (const m of (data ?? []) as (FiadoMov & { created_at: string })[]) {
    const amount = Number(m.amount) || 0;
    if (m.type === "debit" && !isSaldoMov(m)) {
      if (running <= 0) { debits = []; paid = 0; }
      running += amount;
      debits.push({ date: m.created_at, amount });
    } else if (m.type === "payment") {
      paid += Math.min(amount, running);
      running = Math.max(0, running - amount);
    }
    running = Math.round(running * 100) / 100;
  }
  if (running <= 0) return { total: 0, debits: [], paid: 0 };
  return { total: running, debits, paid: Math.round(paid * 100) / 100 };
}
