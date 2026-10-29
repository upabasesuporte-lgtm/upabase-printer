// Crediário (varejo): a venda vai para o fiado do cliente e é dividida em
// parcelas com vencimento (tabela installments). O dinheiro devido continua sendo
// o fiado — "Pagar Fiado" quita as parcelas. Qual parcela está paga é calculado
// pela ordem: os pagamentos abatem as dívidas mais antigas primeiro (mesma regra
// do extrato), e dentro de uma venda, a parcela 1, depois a 2...
import { supabase } from "./supabase";
import { fetchAll } from "./fetchAll";

export interface Installment {
  id: string; customer_id: string; sale_id: string;
  number: number; total: number; due_date: string; amount: number;
}
export interface InstallmentStatus extends Installment {
  open: number;          // quanto falta pagar desta parcela
  paid: boolean;
  daysLate: number;      // 0 = em dia
}
export interface CrediarioRules { multaPct: number; jurosMesPct: number }
export const DEFAULT_RULES: CrediarioRules = { multaPct: 2, jurosMesPct: 1 };

const round2 = (v: number) => Math.round(v * 100) / 100;
const isSaldoMov = (m: { type: string; description: string | null }) =>
  m.type === "saldo" || (m.description ?? "").toLowerCase().startsWith("saldo usado");

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayDiff = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso + "T12:00:00").getTime() - new Date(fromIso + "T12:00:00").getTime()) / 86_400_000);

// Divide o valor em N parcelas (centavos que sobram vão na última); vencimento mensal
export function buildPlan(amount: number, n: number, firstDue: string) {
  const base = Math.floor((amount / n) * 100) / 100;
  const [y, m, d] = firstDue.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const due = new Date(y, m - 1 + i, 1);
    const last = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
    due.setDate(Math.min(d, last)); // dia 31 → último dia de meses curtos
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
    return { number: i + 1, total: n, due_date: iso, amount: i === n - 1 ? round2(amount - base * (n - 1)) : base };
  });
}

// Multa (uma vez) + juros ao dia sobre o que está em aberto
export function lateCharge(s: InstallmentStatus, rules: CrediarioRules): number {
  if (s.paid || s.daysLate <= 0) return 0;
  return round2(s.open * (rules.multaPct / 100) + s.open * (rules.jurosMesPct / 100 / 30) * s.daysLate);
}

export async function fetchRules(): Promise<CrediarioRules> {
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) return DEFAULT_RULES;
  const { data } = await supabase.from("store_settings").select("crediario_multa_pct, crediario_juros_mes_pct").eq("user_id", uid).maybeSingle();
  return {
    multaPct: data?.crediario_multa_pct != null ? Number(data.crediario_multa_pct) : DEFAULT_RULES.multaPct,
    jurosMesPct: data?.crediario_juros_mes_pct != null ? Number(data.crediario_juros_mes_pct) : DEFAULT_RULES.jurosMesPct,
  };
}

interface Mov { type: string; amount: number; description: string | null; sale_id: string | null }

// Situação de cada parcela de um cliente
export function computeStatus(insts: Installment[], movsAsc: Mov[], today = todayIso()): InstallmentStatus[] {
  // Pagamentos abatem as dívidas mais antigas primeiro
  const debits: { sale_id: string | null; amount: number; covered: number }[] = [];
  let head = 0;
  for (const m of movsAsc) {
    const amt = Number(m.amount) || 0;
    if (m.type === "debit" && !isSaldoMov(m)) debits.push({ sale_id: m.sale_id, amount: amt, covered: 0 });
    else if (m.type === "payment") {
      let left = amt;
      while (left > 0.0001 && head < debits.length) {
        const d = debits[head];
        const take = Math.min(left, d.amount - d.covered);
        d.covered += take; left -= take;
        if (d.amount - d.covered <= 0.0001) head++;
      }
    }
  }
  const debitBySale: Record<string, { amount: number; covered: number }> = {};
  for (const d of debits) if (d.sale_id) {
    const x = (debitBySale[d.sale_id] ??= { amount: 0, covered: 0 });
    x.amount += d.amount; x.covered += d.covered;
  }

  const bySale: Record<string, Installment[]> = {};
  for (const i of insts) (bySale[i.sale_id] ??= []).push(i);
  const out: InstallmentStatus[] = [];
  for (const [saleId, list] of Object.entries(bySale)) {
    list.sort((a, b) => a.number - b.number);
    const planned = list.reduce((s, i) => s + Number(i.amount), 0);
    const debt = debitBySale[saleId];
    // Venda editada depois: as parcelas acompanham o valor atual do fiado dela
    const scale = debt && planned > 0 ? debt.amount / planned : 0;
    let covered = debt?.covered ?? 0;
    for (const i of list) {
      const amount = round2(Number(i.amount) * scale);
      const pay = Math.min(covered, amount);
      covered -= pay;
      const open = round2(amount - pay);
      const paid = open <= 0.009;
      out.push({ ...i, amount, open: paid ? 0 : open, paid, daysLate: paid ? 0 : Math.max(0, dayDiff(i.due_date, today)) });
    }
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number);
}

async function movsOf(customerIds: string[]): Promise<Record<string, Mov[]>> {
  const { data, error } = await fetchAll(() => supabase.from("customer_movements")
    .select("customer_id, type, amount, description, sale_id, created_at")
    .in("customer_id", customerIds).in("type", ["debit", "payment"])
    .order("created_at", { ascending: true }));
  if (error) throw error;
  const map: Record<string, Mov[]> = {};
  for (const m of (data ?? []) as any[]) (map[m.customer_id] ??= []).push(m);
  return map;
}

export async function fetchCustomerInstallments(customerId: string): Promise<InstallmentStatus[]> {
  const { data, error } = await supabase.from("installments").select("*").eq("customer_id", customerId);
  if (error) throw error;
  if (!data?.length) return [];
  const movs = await movsOf([customerId]);
  return computeStatus(data as Installment[], movs[customerId] ?? []);
}

// Parcelas vencidas (ou vencendo até `untilIso`) de todos os clientes
export async function fetchDueInstallments(untilIso = todayIso()): Promise<InstallmentStatus[]> {
  const { data: due, error } = await fetchAll(() => supabase.from("installments").select("customer_id").lte("due_date", untilIso));
  if (error) throw error;
  const ids = [...new Set(((due ?? []) as any[]).map(r => r.customer_id))];
  if (!ids.length) return [];
  const [{ data: all }, movs] = await Promise.all([
    fetchAll(() => supabase.from("installments").select("*").in("customer_id", ids)),
    movsOf(ids),
  ]);
  const byCustomer: Record<string, Installment[]> = {};
  for (const i of (all ?? []) as Installment[]) (byCustomer[i.customer_id] ??= []).push(i);
  return Object.entries(byCustomer)
    .flatMap(([cid, list]) => computeStatus(list, movs[cid] ?? []))
    .filter(s => !s.paid && s.due_date <= untilIso);
}
