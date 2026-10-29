// Troca / devolução de uma venda (varejo): escolhe as peças que voltaram, o
// motivo e como devolver o valor — vale-troca (saldo do cliente), abater do
// fiado ou dinheiro do caixa. Tudo é gravado de uma vez no banco (register_return).
import { useEffect, useMemo, useState } from "react";
import { X, Minus, Plus, RefreshCw, Undo2, Printer, ShoppingCart, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { printDocument } from "../lib/printing";
import { RECEIPT_CSS, esc, receiptDate } from "../lib/receipt";
import { getStoreSettings } from "../pages/settings";
import { useEscapeKey } from "../hooks/useEscapeKey";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const REASONS = ["Tamanho", "Cor", "Defeito", "Não gostou", "Outro"];

interface RSale { id: string; created_at: string; customer_id: string | null; total?: number; total_amount?: number; delivery_fee?: number | null; payments?: { method: string; amount: number }[]; customers?: { name: string } | null }
interface RItem { product_id: string | null; quantity: number; unit_price: number; total_price: number; products?: { name: string } | null }
interface RCustomer { id: string; name: string }
type Refund = "credit" | "fiado" | "cash";

export function ReturnModal({ sale, items, customers, cashRegisterId, isLight, onClose, onDone, onUseNow }: {
  sale: RSale; items: RItem[]; customers: RCustomer[]; cashRegisterId: string | null; isLight: boolean;
  onClose: () => void;
  onDone: () => void;                         // recarrega o histórico
  onUseNow: (customerId: string) => void;     // vale-troca: já começa a nova venda com este cliente
}) {
  useEscapeKey(onClose);
  const [returned, setReturned] = useState<Record<string, number> | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("Tamanho");
  const [refund, setRefund] = useState<Refund>("credit");
  const [customerId, setCustomerId] = useState<string>(sale.customer_id ?? "");
  const [custSearch, setCustSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ total: number; customer_id: string | null; items: { name: string; qty: number; unit_price: number }[] } | null>(null);

  useEffect(() => {
    supabase.from("sale_returns").select("items").eq("sale_id", sale.id).then(({ data }) => {
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) for (const x of r.items ?? []) map[x.product_id] = (map[x.product_id] ?? 0) + Number(x.qty);
      setReturned(map);
    });
  }, [sale.id]);

  // Uma linha por produto (somando repetidos); itens de R$ 0,00 não entram
  const lines = useMemo(() => {
    const m = new Map<string, { product_id: string; name: string; sold: number; unit: number }>();
    for (const i of items) {
      if (!i.product_id || Number(i.unit_price) <= 0) continue;
      const x = m.get(i.product_id) ?? { product_id: i.product_id, name: i.products?.name ?? "Produto", sold: 0, unit: Number(i.unit_price) };
      x.sold += Number(i.quantity); m.set(i.product_id, x);
    }
    return [...m.values()].map(l => ({ ...l, max: Math.max(0, l.sold - (returned?.[l.product_id] ?? 0)) }));
  }, [items, returned]);

  const itemsTotal = items.reduce((s, i) => s + Number(i.total_price), 0);
  const saleTotal = Number(sale.total_amount ?? sale.total ?? 0) - Number(sale.delivery_fee ?? 0);
  const factor = itemsTotal > 0 ? Math.max(0, Math.min(1, saleTotal / itemsTotal)) : 1;
  const estimate = lines.reduce((s, l) => s + Math.round((qty[l.product_id] ?? 0) * l.unit * factor * 100) / 100, 0);
  const anyQty = Object.values(qty).some(v => v > 0);
  const hadFiado = (sale.payments ?? []).some(p => p.method === "fiado") && !!sale.customer_id;
  const days = Math.floor((Date.now() - new Date(sale.created_at).getTime()) / 86_400_000);
  const custName = (id: string | null) => customers.find(c => c.id === id)?.name ?? sale.customers?.name ?? "";
  const custOptions = custSearch.trim()
    ? customers.filter(c => c.name.toLowerCase().includes(custSearch.trim().toLowerCase())).slice(0, 8) : [];

  async function confirm() {
    if (!anyQty) { setError("Escolha pelo menos uma peça."); return; }
    if ((refund === "credit" || refund === "fiado") && !customerId) { setError("Escolha o cliente que vai ficar com o vale-troca."); return; }
    if (refund === "cash" && !cashRegisterId) { setError("Abra o caixa para devolver em dinheiro."); return; }
    setSaving(true); setError(null);
    const { data, error: err } = await supabase.rpc("register_return", { p: {
      sale_id: sale.id, refund_type: refund, reason, customer_id: customerId || null, register_id: cashRegisterId,
      items: lines.filter(l => (qty[l.product_id] ?? 0) > 0).map(l => ({ product_id: l.product_id, qty: qty[l.product_id] })),
    } });
    setSaving(false);
    if (err) { setError(err.message); return; }
    const r = data as any;
    setDone({ total: Number(r.total), customer_id: r.customer_id ?? null, items: (r.items ?? []).map((x: any) => ({ name: x.name, qty: Number(x.qty), unit_price: Number(x.unit_price) })) });
    onDone();
  }

  function printProof() {
    if (!done) return;
    const store = getStoreSettings();
    const title = refund === "credit" ? "VALE-TROCA" : refund === "fiado" ? "DEVOLUÇÃO (FIADO)" : "DEVOLUÇÃO";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${RECEIPT_CSS}</style></head><body>
      <button class="pbtn" onclick="window.print()">Imprimir</button>
      <div class="c"><div class="store">${esc(store.name || "Minha Loja")}</div></div>
      <div class="sep"></div>
      <div class="big">${title}</div>
      <div class="head"><span>VENDA #${esc(sale.id.slice(-6).toUpperCase())}</span><span>${esc(receiptDate())}</span></div>
      ${done.customer_id ? `<div class="info"><b>Cliente:</b> ${esc(custName(done.customer_id))}</div>` : ""}
      <div class="info"><b>Motivo:</b> ${esc(reason)}</div>
      <div class="sep"></div>
      ${done.items.map(i => `<div class="it"><span class="q">${esc(i.qty)}x</span><span class="n">${esc(i.name)}</span><span class="v">${(i.qty * i.unit_price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>`).join("")}
      <div class="sep"></div>
      <div class="row t"><span>${refund === "credit" ? "CRÉDITO" : "DEVOLVIDO"}</span><span>${esc(fmt(done.total))}</span></div>
      ${refund === "credit" ? `<div class="note">Crédito guardado no cadastro do cliente — use como "Saldo" na próxima compra.</div>` : ""}
      </body></html>`;
    printDocument(html, { kind: "receipt", title });
  }

  const box = isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800";

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}
        style={{ background: isLight ? "#fff" : "#18181b" }}>
        <div className="flex items-center gap-2">
          <Undo2 className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold flex-1">Troca / devolução · Venda #{sale.id.slice(-6).toUpperCase()}</h3>
          <button onClick={onClose} className="p-1 text-zinc-500"><X className="w-5 h-5" /></button>
        </div>

        {done ? (
          <div className="space-y-3 text-center py-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="font-bold">
              {refund === "credit" ? `Vale-troca de ${fmt(done.total)} para ${custName(done.customer_id)}`
                : refund === "fiado" ? `${fmt(done.total)} abatido do fiado de ${custName(done.customer_id)}`
                : `Devolva ${fmt(done.total)} em dinheiro ao cliente`}
            </p>
            <p className="text-xs text-zinc-500">As peças voltaram para o estoque.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={printProof} className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border ${isLight ? "border-gray-300" : "border-zinc-700"}`}>
                <Printer className="w-4 h-4" /> Comprovante
              </button>
              {refund === "credit" && done.customer_id ? (
                <button onClick={() => onUseNow(done.customer_id!)} className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-brand-600" style={{ color: "#fff" }}>
                  <ShoppingCart className="w-4 h-4" /> Usar o vale agora
                </button>
              ) : (
                <button onClick={onClose} className="py-2.5 rounded-xl text-sm font-bold bg-brand-600" style={{ color: "#fff" }}>Pronto</button>
              )}
            </div>
          </div>
        ) : returned === null ? (
          <div className="flex justify-center py-6"><RefreshCw className="w-5 h-5 animate-spin text-brand-600" /></div>
        ) : (
          <>
            {days > 30 && (
              <div className="flex items-center gap-2 text-xs p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Venda de {days} dias atrás (o prazo comum de troca é 30 dias).
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Peças que voltaram</p>
              {lines.map(l => (
                <div key={l.product_id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${box}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{l.name}</p>
                    <p className="text-[11px] text-zinc-500">{l.max === 0 ? "já devolvido" : `vendido ${l.sold} · ${fmt(l.unit * factor)} cada`}</p>
                  </div>
                  <button disabled={!(qty[l.product_id] > 0)} onClick={() => setQty(q => ({ ...q, [l.product_id]: Math.max(0, (q[l.product_id] ?? 0) - 1) }))}
                    className="p-1.5 rounded-lg border border-zinc-700 disabled:opacity-30"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center font-bold">{qty[l.product_id] ?? 0}</span>
                  <button disabled={(qty[l.product_id] ?? 0) >= l.max} onClick={() => setQty(q => ({ ...q, [l.product_id]: Math.min(l.max, (q[l.product_id] ?? 0) + 1) }))}
                    className="p-1.5 rounded-lg border border-zinc-700 disabled:opacity-30"><Plus className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Motivo</p>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map(r => (
                  <button key={r} onClick={() => setReason(r)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
                    style={reason === r ? { background: "#315DFB", borderColor: "#315DFB", color: "#fff" } : { borderColor: isLight ? "#d1d5db" : "#3f3f46" }}>{r}</button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Como devolver o valor</p>
              {([
                { k: "credit" as Refund, t: "Vale-troca", d: "Fica de crédito no cadastro do cliente (use como Saldo na compra)", show: true },
                { k: "fiado" as Refund, t: "Abater do fiado", d: "A venda foi no fiado: diminui o que ele deve", show: hadFiado },
                { k: "cash" as Refund, t: "Dinheiro", d: cashRegisterId ? "Sai do caixa como devolução" : "Abra o caixa para usar esta opção", show: true },
              ]).filter(o => o.show).map(o => (
                <button key={o.k} onClick={() => setRefund(o.k)} disabled={o.k === "cash" && !cashRegisterId}
                  className="w-full text-left rounded-xl border-2 px-3 py-2 disabled:opacity-40"
                  style={{ borderColor: refund === o.k ? "#315DFB" : (isLight ? "#e5e7eb" : "#3f3f46") }}>
                  <p className="text-sm font-bold">{o.t}</p>
                  <p className="text-[11px] text-zinc-500">{o.d}</p>
                </button>
              ))}
            </div>

            {(refund === "credit" || refund === "fiado") && !sale.customer_id && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Cliente do vale-troca</p>
                {customerId ? (
                  <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${box}`}>
                    <span className="flex-1 text-sm font-semibold">{custName(customerId)}</span>
                    <button onClick={() => setCustomerId("")} className="text-xs text-brand-600 font-semibold">Trocar</button>
                  </div>
                ) : (
                  <>
                    <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Buscar cliente pelo nome..."
                      className={`w-full px-3 py-2 rounded-xl border text-sm ${box}`} />
                    {custOptions.map(c => (
                      <button key={c.id} onClick={() => { setCustomerId(c.id); setCustSearch(""); }} className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-zinc-800/30">{c.name}</button>
                    ))}
                    <p className="text-[11px] text-zinc-500">Cliente sem cadastro? Cadastre em Clientes ou no PDV e volte aqui.</p>
                  </>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
            <button onClick={confirm} disabled={saving || !anyQty}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 disabled:opacity-40" style={{ color: "#fff" }}>
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              Confirmar devolução{anyQty ? ` · ${fmt(estimate)}` : ""}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Acha a venda para a troca: pelo número do cupom (#ABC123) ou pelo cliente (qualquer data)
export function ReturnFinder({ customers, isLight, onClose, onPick }: {
  customers: RCustomer[]; isLight: boolean; onClose: () => void;
  onPick: (sale: any, items: any[]) => void;
}) {
  useEscapeKey(onClose);
  const [code, setCode] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [found, setFound] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const SELECT = "*, customers(name), sale_items(*, products(name, item_type, category_id))";

  async function byCode() {
    if (!code.trim()) return;
    setLoading(true);
    const { data: ids } = await supabase.rpc("find_sales_by_code", { p_code: code.trim() });
    const list = ((ids ?? []) as any[]).map(x => (typeof x === "string" ? x : x.find_sales_by_code ?? x.id)).filter(Boolean);
    const { data } = list.length ? await supabase.from("sales").select(SELECT).in("id", list) : { data: [] };
    setFound((data ?? []) as any[]); setLoading(false);
  }
  async function byCustomer(id: string) {
    setLoading(true); setCustSearch("");
    const since = new Date(); since.setDate(since.getDate() - 180);
    const { data } = await supabase.from("sales").select(SELECT).eq("customer_id", id).eq("status", "paid")
      .neq("origin", "fiado_payment").gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(30);
    setFound((data ?? []) as any[]); setLoading(false);
  }
  const custOptions = custSearch.trim()
    ? customers.filter(c => c.name.toLowerCase().includes(custSearch.trim().toLowerCase())).slice(0, 8) : [];
  const box = isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800";

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}
        style={{ background: isLight ? "#fff" : "#18181b" }}>
        <div className="flex items-center gap-2">
          <Undo2 className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold flex-1">Troca / devolução</h3>
          <button onClick={onClose} className="p-1 text-zinc-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Número do pedido (no cupom)</p>
          <div className="flex gap-2">
            <input autoFocus value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") byCode(); }}
              placeholder="Ex.: #A1B2C3" className={`flex-1 px-3 py-2.5 rounded-xl border text-sm uppercase ${box}`} />
            <button onClick={byCode} className="px-4 rounded-xl text-sm font-bold bg-brand-600" style={{ color: "#fff" }}>Buscar</button>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Ou pelo cliente</p>
          <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Nome do cliente..." className={`w-full px-3 py-2.5 rounded-xl border text-sm ${box}`} />
          {custOptions.map(c => (
            <button key={c.id} onClick={() => byCustomer(c.id)} className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-zinc-800/30">{c.name}</button>
          ))}
        </div>
        {loading && <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin text-brand-600" /></div>}
        {!loading && found && (found.length === 0
          ? <p className="text-sm text-zinc-500 text-center py-2">Nenhuma venda encontrada.</p>
          : (
            <div className="space-y-1.5">
              {found.map(s => (
                <button key={s.id} onClick={() => onPick(s, s.sale_items ?? [])} className={`w-full text-left rounded-xl border px-3 py-2 ${box}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold flex-1">#{String(s.id).slice(-6).toUpperCase()} · {new Date(s.created_at).toLocaleDateString("pt-BR")}</span>
                    <span className="text-sm font-bold">{fmt(Number(s.total_amount ?? s.total ?? 0))}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 truncate">
                    {s.customers?.name ? `${s.customers.name} · ` : ""}
                    {(s.sale_items ?? []).filter((i: any) => Number(i.unit_price) > 0).map((i: any) => `${Number(i.quantity)}x ${i.products?.name ?? "Produto"}`).join(", ")}
                  </p>
                </button>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
