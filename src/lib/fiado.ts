import { supabase } from "./supabase";

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
  const { data, error } = await supabase
    .from("customer_movements")
    .select("id, type, amount, description")
    .eq("customer_id", customerId)
    .in("type", ["debit", "payment"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
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
