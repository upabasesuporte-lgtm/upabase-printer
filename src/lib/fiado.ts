import { supabase } from "./supabase";

const isSaldoMov = (m: { type: string; description: string | null }) =>
  m.type === "saldo" || (m.description ?? "").toLowerCase().startsWith("saldo usado");

// Recalcula fiado_balance do zero a partir de customer_movements (a mesma fonte
// que o extrato do cliente usa). Chamar isso depois de QUALQUER inserção/edição/
// exclusão de movimento evita que o contador salvo em customers.fiado_balance
// fique dessincronizado do histórico real — que era a causa da divergência entre
// o valor no topo da tela e o saldo mostrado no extrato/período filtrado.
export async function recalcFiadoBalance(customerId: string): Promise<number> {
  const { data, error } = await supabase
    .from("customer_movements")
    .select("type, amount, description")
    .eq("customer_id", customerId)
    .in("type", ["debit", "payment"]);
  if (error) throw error;

  let total = 0;
  for (const m of (data ?? []) as { type: string; amount: number; description: string | null }[]) {
    if (m.type === "debit" && !isSaldoMov(m)) total += m.amount;
    else if (m.type === "payment") total -= m.amount;
  }
  total = Math.max(0, total);

  const { error: updErr } = await supabase
    .from("customers")
    .update({ fiado_balance: total })
    .eq("id", customerId);
  if (updErr) throw updErr;

  return total;
}
