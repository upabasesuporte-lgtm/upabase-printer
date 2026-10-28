import { useState } from "react";
import { Download, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll, fetchAllIn } from "../lib/fetchAll";

// "Seus dados": baixa planilhas (CSV que abre no Excel) com tudo da loja.
// Só leitura — a RLS garante que cada loja baixa apenas o que é dela.

type Row = Record<string, unknown>;

const PAY_LABEL: Record<string, string> = {
  cash: "Dinheiro", pix: "Pix", credit_card: "Crédito", debit_card: "Débito", credit: "Crédito", debit: "Débito",
  fiado: "Fiado", house: "Conta da casa", voucher: "Vale", transfer: "Transferência", boleto: "Boleto", check: "Cheque",
};
const STATUS_LABEL: Record<string, string> = { paid: "Paga", cancelled: "Cancelada", pending: "Pendente", open: "Aberta", overdue: "Vencida" };

const fmtDate = (v: unknown) => v ? new Date(String(v)).toLocaleString("pt-BR") : "";
const fmtMoney = (v: unknown) => v === null || v === undefined || v === "" ? "" : Number(v).toFixed(2).replace(".", ",");
const fmtQty = (v: unknown) => v === null || v === undefined ? "" : String(Number(v)).replace(".", ",");
const fmtPayments = (v: unknown) => Array.isArray(v)
  ? v.map((p: any) => `${PAY_LABEL[p?.method] ?? p?.method ?? "?"} ${fmtMoney(p?.amount)}`).join(" + ")
  : "";

// Excel em português: separador ";" e BOM para os acentos
function toCsv(headers: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map(r => r.map(cell).join(";")).join("\r\n");
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface ExportDef { key: string; label: string; hint: string; build: () => Promise<{ headers: string[]; rows: unknown[][] }> }

const must = <T,>(r: { data: T[]; error: any }) => { if (r.error) throw new Error(r.error.message); return r.data; };

const EXPORTS: ExportDef[] = [
  {
    key: "vendas", label: "Vendas", hint: "Todas as vendas com forma de pagamento",
    build: async () => {
      const rows = must(await fetchAll<Row>(() => supabase.from("sales")
        .select("id, created_at, status, origin, customer_name, customer_phone, seller_name, total_amount, discount, delivery_fee, service_tax, payments, delivery_address")));
      rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return {
        headers: ["Data", "Código", "Situação", "Origem", "Cliente", "Telefone", "Vendedor", "Total", "Desconto", "Taxa de entrega", "Taxa de serviço", "Pagamento", "Endereço de entrega"],
        rows: rows.map(r => [fmtDate(r.created_at), String(r.id).slice(-6).toUpperCase(), STATUS_LABEL[String(r.status)] ?? r.status, r.origin,
          r.customer_name, r.customer_phone, r.seller_name, fmtMoney(r.total_amount), fmtMoney(r.discount), fmtMoney(r.delivery_fee),
          fmtMoney(r.service_tax), fmtPayments(r.payments), r.delivery_address]),
      };
    },
  },
  {
    key: "itens-vendidos", label: "Itens vendidos", hint: "Cada produto de cada venda",
    build: async () => {
      const sales = must(await fetchAll<Row>(() => supabase.from("sales").select("id, created_at, status")));
      const byId = new Map(sales.map(s => [String(s.id), s]));
      const items = must(await fetchAllIn<Row>([...byId.keys()], ids => supabase.from("sale_items")
        .select("id, sale_id, quantity, unit_price, notes, products(name)").in("sale_id", ids)));
      items.sort((a, b) => String(byId.get(String(a.sale_id))?.created_at).localeCompare(String(byId.get(String(b.sale_id))?.created_at)));
      return {
        headers: ["Data", "Venda", "Situação da venda", "Produto", "Quantidade", "Preço unitário", "Total", "Observação"],
        rows: items.map(i => {
          const s = byId.get(String(i.sale_id));
          return [fmtDate(s?.created_at), String(i.sale_id).slice(-6).toUpperCase(), STATUS_LABEL[String(s?.status)] ?? s?.status,
            (i.products as any)?.name ?? "", fmtQty(i.quantity), fmtMoney(i.unit_price), fmtMoney(Number(i.quantity) * Number(i.unit_price)), i.notes];
        }),
      };
    },
  },
  {
    key: "clientes", label: "Clientes", hint: "Contatos, endereço e saldo de fiado",
    build: async () => {
      const rows = must(await fetchAll<Row>(() => supabase.from("customers")
        .select("id, name, phone, email, cpf, address, fiado_balance, credit_limit, notes, created_at")));
      rows.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
      return {
        headers: ["Nome", "Telefone", "E-mail", "CPF", "Endereço", "Fiado em aberto", "Limite de fiado", "Observações", "Cadastrado em"],
        rows: rows.map(r => [r.name, r.phone, r.email, r.cpf, r.address, fmtMoney(r.fiado_balance), fmtMoney(r.credit_limit), r.notes, fmtDate(r.created_at)]),
      };
    },
  },
  {
    key: "fiado", label: "Fiado (movimentos)", hint: "Compras e pagamentos de fiado",
    build: async () => {
      const rows = must(await fetchAll<Row>(() => supabase.from("customer_movements")
        .select("id, created_at, type, amount, description, customers(name)")));
      rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return {
        headers: ["Data", "Cliente", "Tipo", "Valor", "Descrição"],
        rows: rows.map(r => [fmtDate(r.created_at), (r.customers as any)?.name ?? "", r.type, fmtMoney(r.amount), r.description]),
      };
    },
  },
  {
    key: "produtos", label: "Produtos", hint: "Preços, custo e estoque",
    build: async () => {
      const rows = must(await fetchAll<Row>(() => supabase.from("products")
        .select("id, name, barcode, unit, sale_price, cost_price, stock, is_active, categories(name)")));
      rows.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
      return {
        headers: ["Nome", "Categoria", "Código de barras", "Unidade", "Preço de venda", "Custo", "Estoque", "Ativo"],
        rows: rows.map(r => [r.name, (r.categories as any)?.name ?? "", r.barcode, r.unit, fmtMoney(r.sale_price), fmtMoney(r.cost_price), fmtQty(r.stock), r.is_active === false ? "Não" : "Sim"]),
      };
    },
  },
  {
    key: "contas-a-pagar", label: "Contas a pagar", hint: "Despesas, vencimentos e pagamentos",
    build: async () => {
      const rows = must(await fetchAll<Row>(() => supabase.from("accounts_payable")
        .select("id, description, supplier, category, due_date, amount, status, paid_date, paid_amount, payment_method, notes")));
      rows.sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")));
      return {
        headers: ["Descrição", "Fornecedor", "Categoria", "Vencimento", "Valor", "Situação", "Pago em", "Valor pago", "Forma de pagamento", "Observações"],
        rows: rows.map(r => [r.description, r.supplier, r.category, r.due_date ? new Date(String(r.due_date) + "T12:00:00").toLocaleDateString("pt-BR") : "",
          fmtMoney(r.amount), STATUS_LABEL[String(r.status)] ?? r.status, r.paid_date ? new Date(String(r.paid_date) + "T12:00:00").toLocaleDateString("pt-BR") : "",
          fmtMoney(r.paid_amount), PAY_LABEL[String(r.payment_method)] ?? r.payment_method ?? "", r.notes]),
      };
    },
  },
];

export function DataExport({ isLight }: { isLight: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function run(defs: ExportDef[]) {
    setError(null);
    for (const d of defs) {
      setBusy(d.key);
      try {
        const { headers, rows } = await d.build();
        download(`${d.key}-${today}.csv`, toCsv(headers, rows));
        setDone(x => x.includes(d.key) ? x : [...x, d.key]);
      } catch (e: any) {
        setError(`${d.label}: ${e?.message ?? e}`);
        break;
      }
    }
    setBusy(null);
  }

  const box = { background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" };
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Os dados são seus. Baixe quando quiser, em planilhas que abrem no Excel ou no Google Planilhas.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {EXPORTS.map(d => (
          <button key={d.key} type="button" onClick={() => run([d])} disabled={!!busy}
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all disabled:opacity-60" style={box}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{d.label}</p>
              <p className="text-xs text-zinc-500">{d.hint}</p>
            </div>
            {busy === d.key ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
              : done.includes(d.key) ? <CheckCircle2 className="w-4 h-4" style={{ color: "#10b981" }} />
              : <Download className="w-4 h-4 text-zinc-500" />}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => run(EXPORTS)} disabled={!!busy}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: "#315DFB", color: "#fff" }}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {busy ? "Preparando..." : "Baixar tudo"}
      </button>
      {error && <p className="text-xs text-red-500">Não foi possível baixar {error}</p>}
    </div>
  );
}
