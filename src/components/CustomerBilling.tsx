// Cliente empresa: preço combinado por produto (CustomerBilling) e o resumo do
// período do histórico com PDF / impressora térmica (CustomerInvoice).
import { useEffect, useState } from "react";
import { Tag, Trash2, Plus, Printer, RefreshCw, Download, X, MessageCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { getStoreSettings } from "../pages/settings";
import { printDocument } from "../lib/printing";
import { RECEIPT_CSS, fmtPhone, fmtCnpj } from "../lib/receipt";
import { loadJsPdf, savePdf } from "../lib/pdf";
import { computeFiadoLedger, computeMemberLedger, paymentPerson, HOLDER, type MemberMov } from "../lib/fiado";
import { PersonChips, phoneDigits, type CustomerMember } from "./CustomerMembers";

interface Props {
  customer: { id: string; name: string; phone?: string | null; fiado_balance?: number | null };
  card: { bg: string; border: string; shadow: string };
  isLight: boolean;
}
interface ProductOpt { id: string; name: string; sale_price: number }
interface PriceRow { id: string; product_id: string; price: number }
interface PeriodSale { id: string; created_at: string; total: number; fiado: number; person: string; items: { qty: number; name: string; price: number }[] }
// before/after = quanto devia antes e depois deste pagamento (mesma regra do "Deve atualmente")
interface PeriodPayment { id: string; created_at: string; amount: number; methods: string; before: number; after: number; overpaid: number; note?: string }
type Entry = { kind: "sale"; at: string; sale: PeriodSale } | { kind: "pay"; at: string; pay: PeriodPayment };

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseNum = (s: string) => { const t = s.trim(); return parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const qtyTxt = (q: number) => (Number.isInteger(q) ? String(q) : String(q).replace(".", ","));
const PAY_LABEL: Record<string, string> = { cash: "Dinheiro", pix: "PIX", credit: "Crédito", debit: "Débito", fiado: "Fiado" };

export function CustomerBilling({ customer, card, isLight }: Props) {
  const box = { background: card.bg, border: card.border, boxShadow: card.shadow };
  const field = `px-3 py-2 rounded-xl text-sm border ${isLight ? "neu-in border-transparent" : "bg-zinc-950 border-zinc-800"}`;

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

  return (
    <div className="rounded-[26px] p-5 space-y-3" style={box}>
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
  );
}

// ── Resumo do período (fica dentro do Histórico e segue o filtro dele) ──
interface InvoiceProps {
  customer: { id: string; name: string; phone?: string | null; fiado_balance?: number | null };
  members?: CustomerMember[]; // pessoas da conta: fatura separada por pessoa
  range: { from: string; to: string };
  label: string;          // ex.: "outubro de 2026", "01/10/2026 a 15/10/2026"
  reloadKey: unknown;     // muda quando o histórico recarrega
  isLight: boolean;
}

export function CustomerInvoice({ customer, members = [], range, label, reloadKey, isLight }: InvoiceProps) {
  const [allSales, setAllSales] = useState<PeriodSale[]>([]);
  const [movs, setMovs] = useState<(MemberMov & { created_at: string; payment_methods?: any[] })[]>([]);
  const [loading, setLoading] = useState(false);
  // Pessoa da conta escolhida (null = conta toda)
  const [person, setPerson] = useState<string | null>(null);
  useEffect(() => { setPerson(null); }, [customer.id]);
  const personName = (pk: string) => pk === HOLDER ? customer.name : members.find(m => m.id === pk)?.name ?? "";
  const personPhone = (pk: string | null) => (!pk || pk === HOLDER ? customer.phone : members.find(m => m.id === pk)?.phone) ?? null;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetchAll(() => supabase.from("sales")
        .select("id, created_at, total_amount, payments, origin, member_id, sale_items(quantity, unit_price, products(name))")
        .eq("customer_id", customer.id).eq("status", "paid").neq("origin", "fiado_payment")
        .gte("created_at", range.from).lte("created_at", range.to)),
      // Histórico inteiro do fiado: precisa do que devia antes de cada pagamento
      fetchAll(() => supabase.from("customer_movements").select("id, type, amount, description, created_at, payment_methods, sale_id, member_id, member_holder, sales(member_id)")
        .eq("customer_id", customer.id).in("type", ["debit", "payment"])
        .order("created_at", { ascending: true })),
    ]).then(([s, p]) => {
      if (!alive) return;
      setAllSales(((s.data ?? []) as any[]).map(r => ({
        id: r.id, created_at: r.created_at, total: Number(r.total_amount ?? 0), person: r.member_id ?? HOLDER,
        fiado: ((r.payments ?? []) as any[]).filter(x => x.method === "fiado").reduce((a, x) => a + Number(x.amount ?? 0), 0),
        items: ((r.sale_items ?? []) as any[]).map(i => ({ qty: Number(i.quantity), name: i.products?.name ?? "Produto", price: Number(i.unit_price) })),
      })).sort((a, b) => a.created_at.localeCompare(b.created_at)));
      setMovs((p.data ?? []) as any[]);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [customer.id, range.from, range.to, reloadKey]);

  const fromT = new Date(range.from).getTime(), toT = new Date(range.to).getTime();
  const methodsTxt = (m: { payment_methods?: any[] }) => ((m.payment_methods ?? []) as any[]).map(x => PAY_LABEL[x.method] ?? x.method).join(" + ");
  const memberLedger = members.length > 0 ? computeMemberLedger(movs) : null;
  let opening = 0;
  const payments: PeriodPayment[] = [];
  if (!person) {
    // Conta toda (como sempre foi)
    const ledger = computeFiadoLedger(movs);
    let prev = 0;
    for (const m of movs) {
      const t = new Date(m.created_at).getTime();
      if (t < fromT) opening = ledger.after[m.id] ?? opening;
      else if (m.type === "payment" && t <= toT) {
        const who = members.length ? paymentPerson(m) : null;
        payments.push({
          id: m.id, created_at: m.created_at, amount: Number(m.amount ?? 0), methods: methodsTxt(m),
          before: prev, after: ledger.after[m.id] ?? 0, overpaid: ledger.overpaid[m.id] ?? 0,
          note: who ? `pago por ${personName(who)}` : undefined,
        });
      }
      prev = ledger.after[m.id] ?? prev;
    }
  } else {
    // Só a pessoa escolhida: os pedidos dela e a parte dos pagamentos que abateu dela
    opening = computeMemberLedger(movs.filter(m => new Date(m.created_at).getTime() < fromT)).bal[person] ?? 0;
    for (const m of movs) {
      const t = new Date(m.created_at).getTime();
      const pr = memberLedger?.pay[m.id];
      if (m.type !== "payment" || t < fromT || t > toT || !pr || !(pr.alloc[person] > 0)) continue;
      const who = paymentPerson(m);
      const full = Number(m.amount ?? 0);
      payments.push({
        id: m.id, created_at: m.created_at, amount: pr.alloc[person], methods: methodsTxt(m),
        before: pr.before[person] ?? 0, after: pr.after[person] ?? 0, overpaid: 0,
        note: who === person && Math.abs(full - pr.alloc[person]) < 0.01 ? undefined
          : `parte de um pagamento de ${fmt(full)}${who ? ` feito por ${personName(who)}` : " da conta toda"}`,
      });
    }
  }
  const sales = person ? allSales.filter(sl => sl.person === person) : allSales;
  const total = sales.reduce((x, s) => x + s.total, 0);
  const owes = person ? memberLedger?.bal[person] ?? 0 : Number(customer.fiado_balance ?? 0);
  const whoTitle = person ? `${personName(person)}${person !== HOLDER ? ` (conta de ${customer.name})` : ""}` : customer.name;
  // Pedidos e pagamentos na ordem em que aconteceram (extrato)
  const entries: Entry[] = [
    ...sales.map(sl => ({ kind: "sale" as const, at: sl.created_at, sale: sl })),
    ...payments.map(py => ({ kind: "pay" as const, at: py.created_at, pay: py })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const lastPay = payments[payments.length - 1];
  // Situação do pagamento em palavras: o cliente confere sozinho
  const payResult = (py: PeriodPayment) =>
    py.after <= 0.009
      ? py.overpaid > 0.009 ? `Quitou tudo (sobrou ${fmt(py.overpaid)} de crédito)` : `Quitou todo o débito${py.before > 0.009 ? ` de ${fmt(py.before)}` : ""}`
      : `Devia ${fmt(py.before)} e ficou devendo ${fmt(py.after)}`;
  const payCleared = (py: PeriodPayment) => py.after <= 0.009;
  const dayTxt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const itemsTxt = (s: PeriodSale) => {
    const m = new Map<string, number>();
    for (const i of s.items) if (i.price > 0) m.set(i.name, (m.get(i.name) ?? 0) + i.qty);
    return [...m].map(([n, q]) => `${qtyTxt(q)}x ${n}`).join(", ") || "—";
  };
  const orderNo = (id: string) => "#" + id.slice(-6).toUpperCase();
  const situation = (s: PeriodSale) => (s.fiado > 0.009 ? "fiado" : "pago");

  const [printMenu, setPrintMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const fileBase = `Fatura ${person ? personName(person) : customer.name} - ${label}`.replace(/[\\/:*?"<>|]/g, "");

  // PDF em folha A4: baixa o arquivo (no celular abre para compartilhar)
  async function downloadPdf() {
    setBusy("pdf"); setPrintMsg(null);
    try {
      const JsPDF = await loadJsPdf();
      const store = getStoreSettings();
      const doc = new JsPDF({ unit: "mm", format: "a4" });
      const L = 14, R = 196, BOTTOM = 282;
      let y = 18;
      doc.setFont("helvetica", "bold"); doc.setFontSize(17);
      doc.text(store.name || "Fatura", L, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(100);
      const contact = [store.address, store.phone ? fmtPhone(store.phone) : "", store.show_cnpj && store.cnpj ? "CNPJ " + fmtCnpj(store.cnpj) : ""].filter(Boolean).join("  ·  ");
      if (contact) { const cl: string[] = doc.splitTextToSize(contact, R - L); doc.text(cl, L, y); y += cl.length * 4.5; }
      doc.setTextColor(0); y += 5;
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(`Fatura - ${label}`, L, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.text(`Cliente: ${whoTitle}`, L, y);
      doc.setFontSize(9); doc.setTextColor(110);
      doc.text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, R, y, { align: "right" });
      doc.setTextColor(0); y += 9;

      const col = { data: L, ped: L + 16, itens: L + 38, valor: R - 22, sit: R };
      const header = () => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(110);
        doc.text("DATA", col.data, y); doc.text("PEDIDO", col.ped, y); doc.text("ITENS", col.itens, y);
        doc.text("VALOR", col.valor, y, { align: "right" }); doc.text("SITUAÇÃO", col.sit, y, { align: "right" });
        doc.setTextColor(0); y += 2; doc.setDrawColor(200); doc.line(L, y, R, y); y += 5;
      };
      const textRow = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); };
      header();
      if (opening > 0.009) {
        textRow(); doc.setFont("helvetica", "bold");
        doc.text(`Já devia antes de ${dayTxt(range.from)}`, col.itens, y);
        doc.text(fmt(opening), col.valor, y, { align: "right" });
        y += 1.6; doc.setDrawColor(230); doc.line(L, y, R, y); y += 4.6;
      }
      if (!entries.length) { textRow(); doc.text("Nenhum pedido no período.", L, y); y += 7; }
      for (const e of entries) {
        textRow();
        if (e.kind === "sale") {
          const sl = e.sale;
          const lines: string[] = doc.splitTextToSize(itemsTxt(sl), col.valor - 26 - col.itens);
          const h = lines.length * 4.2 + 2.6;
          if (y + h > BOTTOM) { doc.addPage(); y = 18; header(); textRow(); }
          doc.text(dayTxt(sl.created_at), col.data, y);
          doc.text(orderNo(sl.id), col.ped, y);
          doc.text(lines, col.itens, y);
          doc.text(fmt(sl.total), col.valor, y, { align: "right" });
          const due = sl.fiado > 0.009;
          doc.setTextColor(due ? 180 : 20, due ? 110 : 140, due ? 0 : 60);
          doc.text(situation(sl), col.sit, y, { align: "right" });
          doc.setTextColor(0);
          y += h - 3.4; doc.setDrawColor(230); doc.line(L, y, R, y); y += 4.6;
        } else {
          // Pagamento: faixa verde com o resultado (quitou ou quanto ficou)
          const py = e.pay;
          if (y + 16 > BOTTOM) { doc.addPage(); y = 18; header(); textRow(); }
          doc.setFillColor(232, 246, 236); doc.rect(L, y - 4.2, R - L, 11.5, "F");
          doc.setFont("helvetica", "bold"); doc.setTextColor(20, 120, 50);
          doc.text(dayTxt(py.created_at), col.data, y);
          doc.text(`PAGAMENTO${py.methods ? " (" + py.methods + ")" : ""}`, col.ped, y);
          doc.text("- " + fmt(py.amount), col.valor, y, { align: "right" });
          doc.setFont("helvetica", "normal"); doc.setFontSize(9);
          doc.text(payResult(py) + (py.note ? ` · ${py.note}` : ""), col.ped, y + 4.6);
          doc.setTextColor(0);
          y += 11.5;
          if (payCleared(py) && entries.indexOf(e) < entries.length - 1) {
            doc.setFontSize(8); doc.setTextColor(120);
            doc.text("Pedidos depois deste pagamento:", L, y); doc.setTextColor(0);
            y += 4.5;
          }
          doc.setDrawColor(230); doc.line(L, y - 2, R, y - 2); y += 2.6;
        }
      }

      if (y + 40 > BOTTOM) { doc.addPage(); y = 18; }
      y += 6;
      const tl = R - 90;
      const row = (a: string, b: string, big = false) => {
        doc.setFont("helvetica", big ? "bold" : "normal"); doc.setFontSize(big ? 13 : 10.5);
        doc.text(a, tl, y); doc.text(b, R, y, { align: "right" }); y += big ? 8 : 6;
      };
      row("Pedidos no período", String(sales.length));
      row("Total dos pedidos", fmt(total));
      if (lastPay) {
        doc.setFontSize(9); doc.setTextColor(20, 120, 50);
        doc.text(`Último pagamento: ${dayTxt(lastPay.created_at)}, ${fmt(lastPay.amount)} - ${payCleared(lastPay) ? "quitou" : "ficou " + fmt(lastPay.after)}`, tl, y);
        doc.setTextColor(0); y += 5.5;
      }
      doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(tl, y - 3, R, y - 3); doc.setLineWidth(0.2); y += 3;
      row("A pagar (hoje)", fmt(owes), true);
      if (store.pix) { doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.text(`Pix: ${store.pix}`, tl, y); }

      await savePdf(doc, fileBase + ".pdf");
      setPrintMenu(false);
    } catch (e) {
      setPrintMsg(e instanceof Error ? e.message : "Não foi possível gerar o PDF");
    }
    setBusy(null);
  }

  // Extrato em texto no WhatsApp de quem vai pagar (abre o wa.me, sem custo)
  function sendWhatsApp() {
    const store = getStoreSettings();
    const first = (person ? personName(person) : customer.name).split(" ")[0];
    const lines: string[] = [`Olá ${first}! Segue ${person && person !== HOLDER ? `o seu extrato na conta de ${customer.name}` : "o seu extrato"} (${label}):`, ""];
    if (opening > 0.009) lines.push(`Já devia antes de ${dayTxt(range.from)}: ${fmt(opening)}`, "");
    for (const e of entries) {
      if (e.kind === "sale") lines.push(`${dayTxt(e.sale.created_at)} · ${itemsTxt(e.sale)} · ${fmt(e.sale.total)}${situation(e.sale) === "pago" ? " (pago)" : ""}`);
      else lines.push(`${dayTxt(e.pay.created_at)} · PAGAMENTO -${fmt(e.pay.amount)} · ${payResult(e.pay)}${e.pay.note ? ` (${e.pay.note})` : ""}`);
    }
    if (!entries.length) lines.push("Nenhum pedido no período.");
    lines.push("", `*Total a pagar: ${fmt(owes)}*`);
    if (store.pix) lines.push(`Pix: ${store.pix}`);
    const ph = phoneDigits(personPhone(person));
    const url = `https://wa.me/${ph.length >= 10 ? "55" + ph : ""}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank", "noopener");
    setPrintMenu(false);
  }

  // Resumo na impressora térmica (mesma impressora dos cupons)
  async function printThermal() {
    setBusy("thermal"); setPrintMsg(null);
    const store = getStoreSettings();
    const contact = [store.address, store.phone ? fmtPhone(store.phone) : ""].filter(Boolean);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(fileBase)}</title><style>${RECEIPT_CSS}
      .ln{display:flex;gap:6px;margin-top:6px;font-size:13px}.ln .dt{font-weight:700;white-space:nowrap}.ln .tx{flex:1}.ln .vl{white-space:nowrap}
      .st{font-size:12px;padding-left:46px}.pay{border-top:1px dashed #000;border-bottom:1px dashed #000;margin:6px 0;padding-bottom:4px}</style></head><body>
      <button class="pbtn" onclick="window.print()">Imprimir</button>
      <div class="c"><div class="store">${esc(store.name || "Minha Loja")}</div>
      ${contact.map(c => `<div class="sub">${esc(c)}</div>`).join("")}
      ${store.show_cnpj && store.cnpj ? `<div class="sub">CNPJ ${esc(fmtCnpj(store.cnpj))}</div>` : ""}</div>
      <div class="sep"></div>
      <div class="big">FATURA</div>
      <div class="c sub">${esc(label)}</div>
      <div class="info"><b>Cliente:</b> ${esc(whoTitle)}</div>
      <div class="sep"></div>
      ${opening > 0.009 ? `<div class="row"><b>Já devia antes de ${dayTxt(range.from)}</b><b>${fmt(opening)}</b></div>` : ""}
      ${entries.map((e, i) => e.kind === "sale"
        ? `<div class="ln"><span class="dt">${dayTxt(e.sale.created_at)}</span><span class="tx">${esc(itemsTxt(e.sale))}</span><span class="vl">${fmt(e.sale.total)}</span></div><div class="st">${orderNo(e.sale.id)} · ${situation(e.sale)}</div>`
        : `<div class="pay"><div class="ln"><span class="dt">${dayTxt(e.pay.created_at)}</span><span class="tx"><b>PAGAMENTO</b>${e.pay.methods ? " " + esc(e.pay.methods) : ""}</span><span class="vl"><b>-${fmt(e.pay.amount)}</b></span></div><div class="st"><b>${esc(payResult(e.pay))}</b>${e.pay.note ? "<br>" + esc(e.pay.note) : ""}</div></div>${payCleared(e.pay) && i < entries.length - 1 ? `<div class="note">pedidos depois deste pagamento:</div>` : ""}`).join("") || `<div class="note">Nenhum pedido no período</div>`}
      <div class="sep"></div>
      <div class="row"><span>Pedidos no período</span><span>${sales.length}</span></div>
      <div class="row"><span>Total dos pedidos</span><span>${fmt(total)}</span></div>
      ${lastPay ? `<div class="note">Último pagamento ${dayTxt(lastPay.created_at)}: ${fmt(lastPay.amount)} - ${payCleared(lastPay) ? "quitou" : "ficou " + fmt(lastPay.after)}</div>` : ""}
      <div class="row t"><span>A PAGAR</span><span>${fmt(owes)}</span></div>
      ${store.pix ? `<div class="note">Pix: ${esc(store.pix)}</div>` : ""}
      </body></html>`;
    try { await printDocument(html, { kind: "receipt", title: fileBase }); setPrintMenu(false); }
    catch { setPrintMsg("Não foi possível imprimir"); }
    setBusy(null);
  }

  return (
    <div className="px-5 py-3 space-y-3 border-b border-zinc-800">
      {members.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Fatura de quem?</p>
          <PersonChips holderName={customer.name} members={members} value={person} onChange={setPerson}
            allLabel="Conta toda" isLight={isLight} bal={memberLedger?.bal} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { l: "Pedidos", v: loading ? "…" : String(sales.length), c: "" },
          { l: "Total no período", v: loading ? "…" : fmt(total), c: "" },
          { l: person ? `${personName(person).split(" ")[0]} deve` : "Deve atualmente", v: fmt(owes), c: "text-amber-500" },
        ].map(k => (
          <div key={k.l} className={`rounded-xl px-2 py-2 ${isLight ? "neu-in" : "bg-zinc-950"}`}>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k.l}</p>
            <p className={`text-sm font-bold ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>
      {!loading && lastPay && (
        <p className="text-xs text-emerald-600 font-semibold">
          Último pagamento no período: {dayTxt(lastPay.created_at)}, {fmt(lastPay.amount)} · {payResult(lastPay)}
        </p>
      )}
      <button onClick={() => { setPrintMenu(v => !v); setPrintMsg(null); }} disabled={loading}
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border disabled:opacity-50 ${isLight ? "border-gray-300 hover:bg-gray-100" : "border-zinc-700 hover:bg-zinc-800/30"}`}>
        <Printer className="w-4 h-4" /> Imprimir / PDF
      </button>
      {printMenu && (
        <div className={`rounded-xl p-3 space-y-2 border ${isLight ? "neu-in border-transparent" : "bg-zinc-950 border-zinc-800"}`}>
          <div className="flex items-center">
            <p className="text-xs font-semibold flex-1">Fatura{person ? ` de ${personName(person)}` : ""} ({label}): como você quer?</p>
            <button onClick={() => setPrintMenu(false)} className="p-1 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <button onClick={sendWhatsApp} disabled={!!busy}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 text-left" style={{ background: "#25D366", color: "#fff" }}>
              <MessageCircle className="w-4 h-4" />
              <span>WhatsApp<span className="block text-[11px] font-normal opacity-90">{phoneDigits(personPhone(person)).length >= 10 ? `Para ${person ? personName(person).split(" ")[0] : customer.name.split(" ")[0]}` : "Você escolhe o contato"}</span></span>
            </button>
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
    </div>
  );
}
