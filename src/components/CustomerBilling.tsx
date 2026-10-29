// Cliente empresa: preço combinado por produto e fatura do mês (imprimir / WhatsApp).
import { useEffect, useMemo, useState } from "react";
import { Tag, Trash2, Plus, FileText, Printer, MessageCircle, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { getStoreSettings } from "../pages/settings";

interface Props {
  customer: { id: string; name: string; phone?: string | null; fiado_balance?: number | null };
  card: { bg: string; border: string; shadow: string };
  isLight: boolean;
}
interface ProductOpt { id: string; name: string; sale_price: number }
interface PriceRow { id: string; product_id: string; price: number }
interface MonthSale { id: string; created_at: string; total: number; fiado: number; items: { qty: number; name: string; price: number }[] }

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseNum = (s: string) => { const t = s.trim(); return parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); };
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const qtyTxt = (q: number) => (Number.isInteger(q) ? String(q) : String(q).replace(".", ","));

export function CustomerBilling({ customer, card, isLight }: Props) {
  const box = { background: card.bg, border: card.border, boxShadow: card.shadow };
  const field = `px-3 py-2 rounded-xl text-sm border ${isLight ? "bg-white border-gray-200" : "bg-zinc-950 border-zinc-800"}`;

  // ── Preços especiais ──
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [newProduct, setNewProduct] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);

  async function loadPrices() {
    const { data } = await supabase.from("customer_prices").select("id, product_id, price").eq("customer_id", customer.id);
    setPrices(((data ?? []) as any[]).map(r => ({ id: r.id, product_id: r.product_id, price: Number(r.price) })));
  }
  useEffect(() => {
    loadPrices();
    fetchAll(() => supabase.from("products").select("id, name, sale_price").neq("is_active", false))
      .then(r => setProducts(((r.data ?? []) as any[]).filter(p => Number(p.sale_price) > 0)
        .map(p => ({ id: p.id, name: p.name, sale_price: Number(p.sale_price) })).sort((a, b) => a.name.localeCompare(b.name))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id]);

  const productName = (id: string) => products.find(p => p.id === id)?.name ?? "Produto";
  const normalPrice = (id: string) => products.find(p => p.id === id)?.sale_price ?? 0;

  async function savePrice(productId: string, value: string) {
    const price = parseNum(value);
    if (!productId || !(price >= 0)) { setPriceMsg("Escolha o produto e digite o preço."); return; }
    setSavingPrice(true); setPriceMsg(null);
    const { error } = await supabase.from("customer_prices")
      .upsert({ customer_id: customer.id, product_id: productId, price, updated_at: new Date().toISOString() }, { onConflict: "customer_id,product_id" });
    setSavingPrice(false);
    if (error) { setPriceMsg("Erro: " + error.message); return; }
    setNewProduct(""); setNewPrice("");
    loadPrices();
  }
  async function removePrice(id: string) {
    await supabase.from("customer_prices").delete().eq("id", id);
    loadPrices();
  }

  // ── Fatura do mês ──
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const months = useMemo(() => {
    const out: string[] = []; const d = new Date(); d.setDate(1);
    for (let i = 0; i < 12; i++) { out.push(monthKey(d)); d.setMonth(d.getMonth() - 1); }
    return out;
  }, []);
  const [sales, setSales] = useState<MonthSale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);

  async function loadMonth() {
    setLoadingSales(true);
    const [y, m] = month.split("-").map(Number);
    const from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
    const { data } = await fetchAll(() => supabase.from("sales")
      .select("id, created_at, total_amount, payments, origin, sale_items(quantity, unit_price, products(name))")
      .eq("customer_id", customer.id).eq("status", "paid").neq("origin", "fiado_payment")
      .gte("created_at", from.toISOString()).lt("created_at", to.toISOString()));
    setSales(((data ?? []) as any[]).map(s => ({
      id: s.id, created_at: s.created_at, total: Number(s.total_amount ?? 0),
      fiado: ((s.payments ?? []) as any[]).filter(p => p.method === "fiado").reduce((x, p) => x + Number(p.amount ?? 0), 0),
      items: ((s.sale_items ?? []) as any[]).map(i => ({ qty: Number(i.quantity), name: i.products?.name ?? "Produto", price: Number(i.unit_price) })),
    })).sort((a, b) => a.created_at.localeCompare(b.created_at)));
    setLoadingSales(false);
  }
  useEffect(() => { loadMonth(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month, customer.id]);

  const total = sales.reduce((x, s) => x + s.total, 0);
  const onFiado = sales.reduce((x, s) => x + s.fiado, 0);
  const paidNow = Math.max(0, total - onFiado);
  // "Marmitas": itens com preço (escolhas de R$ 0,00 dentro da marmita não contam)
  const units = sales.reduce((x, s) => x + s.items.filter(i => i.price > 0).reduce((y, i) => y + i.qty, 0), 0);
  const dayTxt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const itemsTxt = (s: MonthSale) => s.items.filter(i => i.price > 0).map(i => `${qtyTxt(i.qty)}x ${i.name}`).join(", ") || "—";

  function printInvoice() {
    const store = getStoreSettings();
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fatura ${esc(customer.name)} - ${esc(monthLabel(month))}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111;padding:32px;font-size:13px}
    h1{font-size:20px}h2{font-size:15px;margin-top:4px;color:#374151}table{width:100%;border-collapse:collapse;margin-top:18px}
    th,td{text-align:left;padding:7px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#6b7280}
    td.v,th.v{text-align:right;white-space:nowrap}.tot{margin-top:18px;margin-left:auto;width:300px}.tot div{display:flex;justify-content:space-between;padding:4px 0}
    .big{font-size:17px;font-weight:800;border-top:2px solid #111;margin-top:4px;padding-top:8px!important}
    .pbtn{position:fixed;top:16px;right:16px;background:#315DFB;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-weight:700;cursor:pointer}
    @media print{.pbtn{display:none}body{padding:0}}</style></head><body>
    <button class="pbtn" onclick="window.print()">Imprimir</button>
    <h1>${esc(store.name || "Fatura")}</h1>
    <div style="color:#6b7280">${[store.address, store.phone, store.show_cnpj && store.cnpj ? "CNPJ " + store.cnpj : ""].filter(Boolean).map(esc).join(" · ")}</div>
    <h2 style="margin-top:22px">Fatura de ${esc(monthLabel(month))} — ${esc(customer.name)}</h2>
    <table><thead><tr><th>Data</th><th>Pedido</th><th>Itens</th><th class="v">Valor</th><th class="v">Situação</th></tr></thead><tbody>
    ${sales.map(s => `<tr><td>${dayTxt(s.created_at)}</td><td>#${s.id.slice(-6).toUpperCase()}</td><td>${esc(itemsTxt(s))}</td><td class="v">${fmt(s.total)}</td><td class="v">${s.fiado > 0.009 ? "a pagar" : "pago"}</td></tr>`).join("")}
    </tbody></table>
    <div class="tot">
      <div><span>Pedidos</span><span>${sales.length}</span></div>
      <div><span>Itens (marmitas e outros)</span><span>${qtyTxt(units)}</span></div>
      <div><span>Total do mês</span><span>${fmt(total)}</span></div>
      <div><span>Já pago</span><span>${fmt(paidNow)}</span></div>
      <div class="big"><span>A pagar</span><span>${fmt(onFiado)}</span></div>
      ${store.pix ? `<div style="margin-top:8px"><span>Pix: ${esc(store.pix)}</span></div>` : ""}
    </div></body></html>`);
    win.document.close();
  }

  function sendWhatsApp() {
    const store = getStoreSettings();
    const header = [
      `*Fechamento de ${monthLabel(month)}* — ${customer.name}`,
      `Pedidos: ${sales.length} · Itens: ${qtyTxt(units)}`,
      `Total do mês: ${fmt(total)}`,
      ...(paidNow > 0.009 ? [`Já pago: ${fmt(paidNow)}`] : []),
      `*A pagar: ${fmt(onFiado)}*`,
      ...(store.pix ? [`Pix: ${store.pix}`] : []),
      "",
      "Detalhes:",
    ];
    const lines: string[] = [];
    let size = header.join("\n").length;
    for (let i = 0; i < sales.length; i++) {
      const l = `${dayTxt(sales[i].created_at)} · ${itemsTxt(sales[i])} · ${fmt(sales[i].total)}`;
      if (size + l.length > 1500) { lines.push(`…e mais ${sales.length - i} pedido(s). Peça o PDF da fatura.`); break; }
      lines.push(l); size += l.length + 1;
    }
    const text = [...header, ...lines, "", `Obrigado! ${store.name ?? ""}`.trim()].join("\n");
    let phone = (customer.phone ?? "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) phone = "55" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <>
      {/* Preços especiais */}
      <div className="rounded-2xl p-5 space-y-3" style={box}>
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-brand-600" />
          <h2 className="text-sm font-semibold flex-1">Preços especiais deste cliente</h2>
        </div>
        <p className="text-xs text-zinc-500">Ex.: empresa paga a M a R$ 28,00. Ao escolher este cliente no PDV, o preço já entra sozinho (dá para mudar na hora, se precisar).</p>
        {prices.length > 0 && (
          <div className="divide-y divide-zinc-800/40">
            {prices.map(r => (
              <div key={r.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1 truncate">{productName(r.product_id)}</span>
                <span className="text-xs text-zinc-500 line-through">{fmt(normalPrice(r.product_id))}</span>
                <span className="font-bold w-24 text-right">{fmt(r.price)}</span>
                <button onClick={() => removePrice(r.id)} title="Voltar ao preço normal" className="p-1.5 text-zinc-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select value={newProduct} onChange={e => setNewProduct(e.target.value)} className={field + " flex-1 min-w-[180px]"}>
            <option value="">Escolha o produto…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} ({fmt(p.sale_price)})</option>)}
          </select>
          <input inputMode="decimal" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Preço combinado" className={field + " w-36"} />
          <button onClick={() => savePrice(newProduct, newPrice)} disabled={savingPrice}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-50" style={{ color: "#fff" }}>
            <Plus className="w-4 h-4" /> Salvar preço
          </button>
        </div>
        {priceMsg && <p className="text-xs text-red-500">{priceMsg}</p>}
      </div>

      {/* Fatura do mês */}
      <div className="rounded-2xl p-5 space-y-3" style={box}>
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="w-4 h-4 text-brand-600" />
          <h2 className="text-sm font-semibold flex-1">Fatura do mês</h2>
          <select value={month} onChange={e => setMonth(e.target.value)} className={field}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        {loadingSales ? (
          <div className="flex justify-center py-4"><RefreshCw className="w-4 h-4 animate-spin text-brand-500" /></div>
        ) : sales.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum pedido deste cliente em {monthLabel(month)}.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                { l: "Pedidos", v: String(sales.length) },
                { l: "Itens", v: qtyTxt(units) },
                { l: "Total do mês", v: fmt(total) },
                { l: "A pagar (fiado)", v: fmt(onFiado) },
              ].map(k => (
                <div key={k.l} className={`rounded-xl px-2 py-2 ${isLight ? "bg-gray-50" : "bg-zinc-950"}`}>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k.l}</p>
                  <p className="text-sm font-bold">{k.v}</p>
                </div>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/40 text-xs">
              {sales.map(s => (
                <div key={s.id} className="flex items-start gap-2 py-1.5">
                  <span className="text-zinc-500 w-11 shrink-0">{dayTxt(s.created_at)}</span>
                  <span className="flex-1">{itemsTxt(s)}</span>
                  <span className="font-semibold whitespace-nowrap">{fmt(s.total)}</span>
                  <span className={`w-14 text-right shrink-0 ${s.fiado > 0.009 ? "text-amber-500" : "text-emerald-500"}`}>{s.fiado > 0.009 ? "a pagar" : "pago"}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={printInvoice} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border border-zinc-700 hover:bg-zinc-800/30">
                <Printer className="w-4 h-4" /> Imprimir / PDF
              </button>
              <button onClick={sendWhatsApp} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#25D366", color: "#fff" }}>
                <MessageCircle className="w-4 h-4" /> Enviar no WhatsApp
              </button>
            </div>
            {onFiado > 0.009 && (
              <p className="text-[11px] text-zinc-500">"A pagar" são os pedidos lançados no fiado. Quando a empresa pagar, use "Pagar Fiado" aqui em cima.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
