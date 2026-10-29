// Cliente empresa: preço combinado por produto e fatura do mês (imprimir / WhatsApp).
import { useEffect, useMemo, useState } from "react";
import { Tag, Trash2, Plus, FileText, Printer, MessageCircle, RefreshCw, Download, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { getStoreSettings } from "../pages/settings";
import { printDocument } from "../lib/printing";
import { RECEIPT_CSS, fmtPhone, fmtCnpj } from "../lib/receipt";

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

// Gerador de PDF carregado só quando precisa (não pesa no sistema)
let jsPdfLoad: Promise<any> | null = null;
function loadJsPdf(): Promise<any> {
  const w = window as any;
  if (w.jspdf?.jsPDF) return Promise.resolve(w.jspdf.jsPDF);
  jsPdfLoad ??= new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    sc.onload = () => (w.jspdf?.jsPDF ? resolve(w.jspdf.jsPDF) : reject(new Error("PDF indisponível")));
    sc.onerror = () => { jsPdfLoad = null; sc.remove(); reject(new Error("Sem internet para gerar o PDF")); };
    document.head.appendChild(sc);
  });
  return jsPdfLoad;
}

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

  const [printMenu, setPrintMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const fileBase = `Fatura ${customer.name} - ${monthLabel(month)}`.replace(/[\\/:*?"<>|]/g, "");

  // PDF em folha A4: baixa o arquivo (no celular abre para compartilhar)
  async function downloadPdf() {
    setBusy("pdf"); setPrintMsg(null);
    try {
      const JsPDF = await loadJsPdf();
      const store = getStoreSettings();
      const doc = new JsPDF({ unit: "mm", format: "a4" });
      const W = 210, L = 14, R = W - 14;
      let y = 18;
      doc.setFont("helvetica", "bold"); doc.setFontSize(17);
      doc.text(store.name || "Fatura", L, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(100);
      const contact = [store.address, store.phone ? fmtPhone(store.phone) : "", store.show_cnpj && store.cnpj ? "CNPJ " + fmtCnpj(store.cnpj) : ""].filter(Boolean).join("  ·  ");
      if (contact) { const cl: string[] = doc.splitTextToSize(contact, R - L); doc.text(cl, L, y); y += cl.length * 4.5; }
      doc.setTextColor(0); y += 5;
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(`Fatura de ${monthLabel(month)}`, L, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.text(`Cliente: ${customer.name}`, L, y); y += 9;

      const col = { data: L, ped: L + 16, itens: L + 38, valor: R - 22, sit: R };
      const header = () => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(110);
        doc.text("DATA", col.data, y); doc.text("PEDIDO", col.ped, y); doc.text("ITENS", col.itens, y);
        doc.text("VALOR", col.valor, y, { align: "right" }); doc.text("SITUAÇÃO", col.sit, y, { align: "right" });
        doc.setTextColor(0); y += 2; doc.setDrawColor(200); doc.line(L, y, R, y); y += 5;
      };
      header();
      for (const sl of sales) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
        const lines: string[] = doc.splitTextToSize(itemsTxt(sl), col.valor - 26 - col.itens);
        const h = lines.length * 4.2 + 2.6;
        if (y + h > 282) { doc.addPage(); y = 18; header(); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); }
        doc.text(dayTxt(sl.created_at), col.data, y);
        doc.text("#" + sl.id.slice(-6).toUpperCase(), col.ped, y);
        doc.text(lines, col.itens, y);
        doc.text(fmt(sl.total), col.valor, y, { align: "right" });
        const due = sl.fiado > 0.009;
        doc.setTextColor(due ? 180 : 20, due ? 110 : 140, due ? 0 : 60);
        doc.text(due ? "a pagar" : "pago", col.sit, y, { align: "right" });
        doc.setTextColor(0);
        y += h - 3.4; doc.setDrawColor(230); doc.line(L, y, R, y); y += 4.6;
      }

      if (y + 48 > 282) { doc.addPage(); y = 18; }
      y += 4;
      const tl = R - 80;
      const row = (a: string, b: string, big = false) => {
        doc.setFont("helvetica", big ? "bold" : "normal"); doc.setFontSize(big ? 13 : 10.5);
        doc.text(a, tl, y); doc.text(b, R, y, { align: "right" }); y += big ? 8 : 6;
      };
      row("Pedidos", String(sales.length));
      row("Itens (marmitas e outros)", qtyTxt(units));
      row("Total do mês", fmt(total));
      row("Já pago", fmt(paidNow));
      doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(tl, y - 3, R, y - 3); doc.setLineWidth(0.2); y += 3;
      row("A pagar", fmt(onFiado), true);
      if (store.pix) { doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.text(`Pix: ${store.pix}`, tl, y); }

      const fileName = fileBase + ".pdf";
      const file = new File([doc.output("blob")], fileName, { type: "application/pdf" });
      const nav = navigator as any;
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: fileName }).catch(() => {});
      } else {
        doc.save(fileName);
      }
      setPrintMenu(false);
    } catch (e) {
      setPrintMsg(e instanceof Error ? e.message : "Não foi possível gerar o PDF");
    }
    setBusy(null);
  }

  // Resumo do mês na impressora térmica (mesma impressora dos cupons)
  async function printThermal() {
    setBusy("thermal"); setPrintMsg(null);
    const store = getStoreSettings();
    const contact = [store.address, store.phone ? fmtPhone(store.phone) : ""].filter(Boolean);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(fileBase)}</title><style>${RECEIPT_CSS}
      .ln{display:flex;gap:6px;margin-top:6px;font-size:13px}.ln .dt{font-weight:700;white-space:nowrap}.ln .tx{flex:1}.ln .vl{white-space:nowrap}
      .st{font-size:12px;padding-left:46px}</style></head><body>
      <button class="pbtn" onclick="window.print()">Imprimir</button>
      <div class="c"><div class="store">${esc(store.name || "Minha Loja")}</div>
      ${contact.map(c => `<div class="sub">${esc(c)}</div>`).join("")}
      ${store.show_cnpj && store.cnpj ? `<div class="sub">CNPJ ${esc(fmtCnpj(store.cnpj))}</div>` : ""}</div>
      <div class="sep"></div>
      <div class="big">FATURA ${esc(monthLabel(month).toUpperCase())}</div>
      <div class="info"><b>Cliente:</b> ${esc(customer.name)}</div>
      <div class="sep"></div>
      ${sales.map(sl => `<div class="ln"><span class="dt">${dayTxt(sl.created_at)}</span><span class="tx">${esc(itemsTxt(sl))}</span><span class="vl">${fmt(sl.total)}</span></div>${sl.fiado > 0.009 ? "" : `<div class="st">pago</div>`}`).join("")}
      <div class="sep"></div>
      <div class="row"><span>Pedidos</span><span>${sales.length}</span></div>
      <div class="row"><span>Itens</span><span>${qtyTxt(units)}</span></div>
      <div class="row"><span>Total do mês</span><span>${fmt(total)}</span></div>
      <div class="row"><span>Já pago</span><span>${fmt(paidNow)}</span></div>
      <div class="row t"><span>A PAGAR</span><span>${fmt(onFiado)}</span></div>
      ${store.pix ? `<div class="note">Pix: ${esc(store.pix)}</div>` : ""}
      </body></html>`;
    try { await printDocument(html, { kind: "receipt", title: fileBase }); setPrintMenu(false); }
    catch { setPrintMsg("Não foi possível imprimir"); }
    setBusy(null);
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
              <button onClick={() => { setPrintMenu(v => !v); setPrintMsg(null); }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border border-zinc-700 hover:bg-zinc-800/30">
                <Printer className="w-4 h-4" /> Imprimir / PDF
              </button>
              <button onClick={sendWhatsApp} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#25D366", color: "#fff" }}>
                <MessageCircle className="w-4 h-4" /> Enviar no WhatsApp
              </button>
            </div>
            {printMenu && (
              <div className={`rounded-xl p-3 space-y-2 border ${isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800"}`}>
                <div className="flex items-center">
                  <p className="text-xs font-semibold flex-1">Como você quer a fatura?</p>
                  <button onClick={() => setPrintMenu(false)} className="p-1 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <button onClick={downloadPdf} disabled={!!busy}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-left" style={{ color: "#fff" }}>
                    {busy === "pdf" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    <span>Baixar PDF<span className="block text-[11px] font-normal opacity-80">Folha A4 para mandar ao cliente</span></span>
                  </button>
                  <button onClick={printThermal} disabled={!!busy}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border disabled:opacity-50 text-left ${isLight ? "border-gray-300 hover:bg-gray-100" : "border-zinc-700 hover:bg-zinc-800/40"}`}>
                    {busy === "thermal" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                    <span>Impressora térmica<span className="block text-[11px] font-normal text-zinc-500">Resumo no papel do cupom</span></span>
                  </button>
                </div>
                {printMsg && <p className="text-xs text-red-500">{printMsg}</p>}
              </div>
            )}
            {onFiado > 0.009 && (
              <p className="text-[11px] text-zinc-500">"A pagar" são os pedidos lançados no fiado. Quando a empresa pagar, use "Pagar Fiado" aqui em cima.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
