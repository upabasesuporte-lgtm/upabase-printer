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
