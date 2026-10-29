// Condicional (varejo): a cliente leva peças para provar em casa. As peças saem
// do estoque na hora; no acerto, o que voltou entra de novo e o que ela ficou é
// cobrado no PDV (sem baixar o estoque outra vez).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, Search, Minus, Trash2, RefreshCw, Printer, MessageCircle, ShoppingBag, CheckCircle2, ShoppingCart } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fetchAll } from "../../lib/fetchAll";
import { matchesSearch } from "../../lib/search";
import { printDocument } from "../../lib/printing";
import { RECEIPT_CSS, esc, receiptDate } from "../../lib/receipt";
import { getStoreSettings } from "../settings";
import { useTheme } from "../../contexts/ThemeContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { PageHeader, btnPrimary, WHITE_TEXT } from "../../components/PageHeader";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const isoIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const daysTo = (iso: string | null) => (iso ? Math.round((new Date(iso + "T12:00:00").getTime() - new Date(isoIn(0) + "T12:00:00").getTime()) / 86_400_000) : null);

// O PDV lê isto ao abrir e monta o carrinho da compra da condicional
export const PDV_INJECT_KEY = "pdv_inject_consignment";

interface Cust { id: string; name: string; phone: string | null }
interface Prod { id: string; name: string; barcode: string | null; sale_price: number; stock: number; stock_type: string | null; unlimited_stock: boolean | null; has_variants: boolean | null }
interface CItem { id: string; product_id: string | null; name: string; qty: number; unit_price: number; bought_qty: number; returned_qty: number }
interface Consignment { id: string; customer_id: string; status: string; due_date: string | null; notes: string | null; sale_id: string | null; created_at: string; closed_at: string | null; consignment_items: CItem[] }

export default function ConsignmentsPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const card = isLight
    ? { bg: "#ffffff", border: "1px solid #e5e7eb", shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)" }
    : { bg: "#18181b", border: "1px solid rgba(39,39,42,0.8)", shadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
  const navigate = useNavigate();
  const [view, setView] = useState<"open" | "closed">("open");
  const [list, setList] = useState<Consignment[] | null>(null);
  const [customers, setCustomers] = useState<Cust[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [settling, setSettling] = useState<Consignment | null>(null);

  async function load() {
    setList(null);
    let q = supabase.from("consignments").select("*, consignment_items(*)").eq("status", view);
    if (view === "closed") { const since = new Date(); since.setDate(since.getDate() - 90); q = q.gte("created_at", since.toISOString()); }
    const { data } = await q.order("created_at", { ascending: false }).limit(200);
    setList(((data ?? []) as any[]).map(c => ({ ...c, consignment_items: (c.consignment_items ?? []).map((i: any) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), bought_qty: Number(i.bought_qty), returned_qty: Number(i.returned_qty) })) })));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view]);
  useEffect(() => {
    fetchAll(() => supabase.from("customers").select("id, name, phone").order("name")).then(r => setCustomers((r.data ?? []) as Cust[]));
  }, []);

  const custOf = (id: string) => customers.find(c => c.id === id);
  const total = (c: Consignment) => c.consignment_items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const pieces = (c: Consignment) => c.consignment_items.reduce((s, i) => s + i.qty, 0);

  function printSlip(c: Consignment) {
    const store = getStoreSettings();
    const cust = custOf(c.customer_id);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Condicional</title><style>${RECEIPT_CSS}</style></head><body>
      <button class="pbtn" onclick="window.print()">Imprimir</button>
      <div class="c"><div class="store">${esc(store.name || "Minha Loja")}</div>${store.phone ? `<div class="sub">${esc(store.phone)}</div>` : ""}</div>
      <div class="sep"></div>
      <div class="big">CONDICIONAL</div>
      <div class="head"><span>Nº ${esc(c.id.slice(-6).toUpperCase())}</span><span>${esc(receiptDate(c.created_at))}</span></div>
      <div class="info"><b>Cliente:</b> ${esc(cust?.name ?? "")}</div>
      ${cust?.phone ? `<div class="info"><b>Telefone:</b> ${esc(cust.phone)}</div>` : ""}
      <div class="info"><b>Devolver até:</b> ${esc(dateBr(c.due_date))}</div>
      <div class="sep"></div>
      ${c.consignment_items.map(i => `<div class="it"><span class="q">${esc(i.qty)}x</span><span class="n">${esc(i.name)}</span><span class="v">${(i.qty * i.unit_price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>`).join("")}
      <div class="sep"></div>
      <div class="row t"><span>TOTAL</span><span>${esc(fmt(total(c)))}</span></div>
      ${c.notes ? `<div class="note">Obs: ${esc(c.notes)}</div>` : ""}
      <div class="note" style="margin-top:28px">_______________________________</div>
      <div class="foot">Assinatura do cliente</div>
      </body></html>`;
    printDocument(html, { kind: "receipt", title: "Condicional" });
  }

  function whatsapp(c: Consignment) {
    const store = getStoreSettings();
    const cust = custOf(c.customer_id);
    const first = (cust?.name ?? "").trim().split(/\s+/)[0] ?? "";
    const d = daysTo(c.due_date);
    const text = [
      `Olá${first ? `, ${first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()}` : ""}! Tudo bem?`,
      `Passando para lembrar das peças da condicional${store.name ? ` da ${store.name}` : ""}${c.due_date ? ` (${d != null && d < 0 ? "venceu" : "devolução até"} ${dateBr(c.due_date)})` : ""}:`,
      "",
      ...c.consignment_items.map(i => `• ${i.qty}x ${i.name} — ${fmt(i.unit_price)}`),
      "",
      "Me avisa quais vai ficar e quando posso buscar/receber as outras. Obrigado!",
    ].join("\n");
    let phone = (cust?.phone ?? "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) phone = "55" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  }

  function sendToPdv(c: { id: string; customer_id: string }, bought: { product_id: string | null; qty: number; unit_price: number }[]) {
    try {
      localStorage.setItem(PDV_INJECT_KEY, JSON.stringify({
        consignmentId: c.id, customerId: c.customer_id,
        items: bought.filter(b => b.product_id && b.qty > 0).map(b => ({ product_id: b.product_id, qty: b.qty, unit_price: b.unit_price })),
      }));
    } catch { /* sem armazenamento */ }
    navigate("/pdv");
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Condicional" subtitle="Peças que a cliente levou para provar em casa" actions={
        <button onClick={() => setShowNew(true)} className={btnPrimary} style={WHITE_TEXT}><Plus className="w-4 h-4" /> Nova condicional</button>
      } />

      <div className="flex p-1 rounded-xl w-fit" style={{ background: isLight ? "rgba(229,231,235,0.6)" : "#18181b" }}>
        {(["open", "closed"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${view === v ? "bg-white text-brand-700 shadow-sm" : "text-gray-500"}`}>
            {v === "open" ? "Em aberto" : "Acertadas"}
          </button>
        ))}
      </div>

      {!list ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-brand-600" /></div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-zinc-500">
          <ShoppingBag className="w-10 h-10" />
          <p className="text-sm">{view === "open" ? "Nenhuma condicional em aberto." : "Nenhuma condicional acertada nos últimos 90 dias."}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map(c => {
            const d = daysTo(c.due_date);
            const late = c.status === "open" && d != null && d < 0;
            const bought = c.consignment_items.filter(i => i.bought_qty > 0);
            return (
              <div key={c.id} className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: late ? "1px solid rgba(239,68,68,0.5)" : card.border, boxShadow: card.shadow }}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{custOf(c.customer_id)?.name ?? "Cliente"}</p>
                    <p className="text-xs text-zinc-500">Nº {c.id.slice(-6).toUpperCase()} · saiu {dateBr(c.created_at)}</p>
                  </div>
                  {c.status === "open" ? (
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg ${late ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-600"}`}>
                      {d == null ? "sem prazo" : late ? `${-d} dia${d === -1 ? "" : "s"} atrasada` : d === 0 ? "devolve hoje" : `devolve em ${d} dia${d === 1 ? "" : "s"}`}
                    </span>
                  ) : (
                    <span className="text-xs font-bold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600">acertada {dateBr(c.closed_at)}</span>
                  )}
                </div>
                <div className="text-sm space-y-0.5">
                  {c.consignment_items.map(i => (
                    <div key={i.id} className="flex gap-2">
                      <span className="font-bold w-8">{i.qty}x</span>
                      <span className="flex-1 truncate">{i.name}</span>
                      {c.status === "closed"
                        ? <span className="text-xs text-zinc-500">{i.bought_qty > 0 ? `ficou ${i.bought_qty}` : ""}{i.bought_qty > 0 && i.returned_qty > 0 ? " · " : ""}{i.returned_qty > 0 ? `voltou ${i.returned_qty}` : ""}</span>
                        : <span className="text-xs text-zinc-500">{fmt(i.unit_price)}</span>}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm border-t border-zinc-800/40 pt-2">
                  <span className="text-zinc-500">{pieces(c)} peça{pieces(c) === 1 ? "" : "s"}</span>
                  <span className="font-bold">{fmt(total(c))}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.status === "open" ? (
                    <>
                      <button onClick={() => setSettling(c)} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700" style={{ color: "#fff" }}>
                        <CheckCircle2 className="w-4 h-4" /> Acerto
                      </button>
                      <button onClick={() => whatsapp(c)} title="Lembrar no WhatsApp" className="p-2 rounded-xl" style={{ background: "#25D366", color: "#fff" }}><MessageCircle className="w-4 h-4" /></button>
                      <button onClick={() => printSlip(c)} title="Imprimir comprovante" className="p-2 rounded-xl border border-zinc-700"><Printer className="w-4 h-4" /></button>
                    </>
                  ) : bought.length > 0 && !c.sale_id ? (
                    <button onClick={() => sendToPdv(c, bought.map(i => ({ product_id: i.product_id, qty: i.bought_qty, unit_price: i.unit_price })))}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold" style={{ background: "rgba(245,158,11,0.15)", color: "#d97706" }}>
                      <ShoppingCart className="w-4 h-4" /> Cobrar no PDV (ainda não cobrada)
                    </button>
                  ) : bought.length > 0 ? (
                    <span className="text-xs text-emerald-600 font-semibold">Compra cobrada · venda #{c.sale_id!.slice(-6).toUpperCase()}</span>
                  ) : (
                    <span className="text-xs text-zinc-500">Tudo voltou para o estoque.</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewConsignment customers={customers} isLight={isLight}
          onClose={() => setShowNew(false)}
          onCreated={async id => {
            setShowNew(false);
            setView("open");
            await load();
            const { data } = await supabase.from("consignments").select("*, consignment_items(*)").eq("id", id).maybeSingle();
            if (data) printSlip({ ...(data as any), consignment_items: ((data as any).consignment_items ?? []).map((i: any) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price) })) });
          }} />
      )}
      {settling && (
        <SettleModal c={settling} customerName={custOf(settling.customer_id)?.name ?? ""} isLight={isLight}
          onClose={() => setSettling(null)}
          onDone={(bought) => {
            const c = settling;
            setSettling(null);
            if (bought.length) sendToPdv(c, bought); else load();
          }} />
      )}
    </div>
  );
}

// ── Nova condicional ──
function NewConsignment({ customers, isLight, onClose, onCreated }: {
  customers: Cust[]; isLight: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  useEscapeKey(onClose);
  const [products, setProducts] = useState<Prod[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<{ p: Prod; qty: number }[]>([]);
  const [due, setDue] = useState(isoIn(3));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll(() => supabase.from("products").select("id, name, barcode, sale_price, stock, stock_type, unlimited_stock, has_variants")
      .eq("is_active", true).order("name"))
      .then(r => setProducts(((r.data ?? []) as any[]).filter(p => !p.has_variants).map(p => ({ ...p, sale_price: Number(p.sale_price), stock: Number(p.stock) }))));
  }, []);

  const results = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    return products.filter(p => matchesSearch(p.name, q) || (p.barcode ?? "").includes(q)).slice(0, 30);
  }, [products, search]);
  const unlimited = (p: Prod) => p.stock_type === "unlimited" || !!p.unlimited_stock;
  const add = (p: Prod) => {
    setItems(prev => {
      const i = prev.findIndex(x => x.p.id === p.id);
      if (i >= 0) return prev.map((x, j) => j === i ? { ...x, qty: unlimited(p) ? x.qty + 1 : Math.min(p.stock, x.qty + 1) } : x);
      return [...prev, { p, qty: 1 }];
    });
    setSearch("");
  };
  const custOptions = custSearch.trim() ? customers.filter(c => matchesSearch(c.name, custSearch.trim())).slice(0, 8) : [];
  const total = items.reduce((s, x) => s + x.qty * x.p.sale_price, 0);
  const box = isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800";

  async function save() {
    if (!customerId) { setError("Escolha a cliente."); return; }
    if (!items.length) { setError("Adicione as peças."); return; }
    setSaving(true); setError(null);
    const { data, error: err } = await supabase.rpc("open_consignment", { p: {
      customer_id: customerId, due_date: due || null, notes: notes.trim() || null,
      items: items.map(x => ({ product_id: x.p.id, qty: x.qty, unit_price: x.p.sale_price })),
    } });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onCreated(data as string);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}
        style={{ background: isLight ? "#fff" : "#18181b" }}>
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold flex-1">Nova condicional</h3>
          <button onClick={onClose} className="p-1 text-zinc-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Cliente</p>
          {customerId ? (
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${box}`}>
              <span className="flex-1 text-sm font-semibold">{customers.find(c => c.id === customerId)?.name}</span>
              <button onClick={() => setCustomerId("")} className="text-xs font-semibold text-brand-600">Trocar</button>
            </div>
          ) : (
            <>
              <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Buscar cliente pelo nome..." className={`w-full px-3 py-2.5 rounded-xl border text-sm ${box}`} />
              {custOptions.map(c => (
                <button key={c.id} onClick={() => { setCustomerId(c.id); setCustSearch(""); }} className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-zinc-800/30">{c.name}</button>
              ))}
              <p className="text-[11px] text-zinc-500">Cliente nova? Cadastre em Clientes (com telefone, para lembrar pelo WhatsApp).</p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Peças</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar peça ou bipar o código de barras..."
              onKeyDown={e => { if (e.key === "Enter") { const exact = products.find(p => p.barcode && p.barcode === search.trim()); const pick = exact ?? results[0]; if (pick) add(pick); } }}
              className={`w-full pl-9 pr-3 py-2.5 rounded-xl border text-sm ${box}`} />
          </div>
          {results.length > 0 && (
            <div className={`rounded-xl border divide-y divide-zinc-800/40 max-h-48 overflow-y-auto ${box}`}>
              {results.map(p => {
                const out = !unlimited(p) && p.stock <= 0;
                return (
                  <button key={p.id} disabled={out} onClick={() => add(p)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-40">
                    <Plus className="w-4 h-4 text-brand-600" />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-zinc-500">{unlimited(p) ? "" : `${p.stock} un · `}{fmt(p.sale_price)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {items.map(x => (
            <div key={x.p.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${box}`}>
              <span className="flex-1 text-sm truncate">{x.p.name}</span>
              <button onClick={() => setItems(prev => prev.map(y => y.p.id === x.p.id ? { ...y, qty: Math.max(1, y.qty - 1) } : y))} className="p-1 rounded-lg border border-zinc-700"><Minus className="w-3.5 h-3.5" /></button>
              <span className="w-6 text-center font-bold">{x.qty}</span>
              <button onClick={() => add(x.p)} className="p-1 rounded-lg border border-zinc-700"><Plus className="w-3.5 h-3.5" /></button>
              <button onClick={() => setItems(prev => prev.filter(y => y.p.id !== x.p.id))} className="p-1 text-zinc-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Devolver até</p>
            <input type="date" value={due} onChange={e => setDue(e.target.value)} className={`w-full px-3 py-2 rounded-xl border text-sm ${box}`} />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Observação</p>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" className={`w-full px-3 py-2 rounded-xl border text-sm ${box}`} />
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <button onClick={save} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 disabled:opacity-50" style={{ color: "#fff" }}>
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
          Registrar saída{items.length ? ` · ${items.reduce((s, x) => s + x.qty, 0)} peças · ${fmt(total)}` : ""}
        </button>
        <p className="text-[11px] text-zinc-500 text-center">As peças saem do estoque agora e o comprovante é impresso para a cliente assinar.</p>
      </div>
    </div>
  );
}

// ── Acerto ──
function SettleModal({ c, customerName, isLight, onClose, onDone }: {
  c: Consignment; customerName: string; isLight: boolean; onClose: () => void;
  onDone: (bought: { product_id: string | null; qty: number; unit_price: number }[]) => void;
}) {
  useEscapeKey(onClose);
  const [bought, setBought] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = c.consignment_items.reduce((s, i) => s + (bought[i.id] ?? 0) * i.unit_price, 0);
  const setAll = (all: boolean) => setBought(Object.fromEntries(c.consignment_items.map(i => [i.id, all ? i.qty : 0])));
  const box = isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800";

  async function confirm() {
    setSaving(true); setError(null);
    const { data, error: err } = await supabase.rpc("close_consignment", { p: {
      id: c.id, items: c.consignment_items.map(i => ({ item_id: i.id, bought_qty: bought[i.id] ?? 0 })),
    } });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDone(((data as any)?.bought ?? []).map((b: any) => ({ product_id: b.product_id, qty: Number(b.qty), unit_price: Number(b.unit_price) })));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}
        style={{ background: isLight ? "#fff" : "#18181b" }}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold flex-1">Acerto · {customerName}</h3>
          <button onClick={onClose} className="p-1 text-zinc-500"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-zinc-500">Marque quantas peças de cada a cliente <b>ficou</b>. O resto volta para o estoque.</p>
        <div className="flex gap-2">
          <button onClick={() => setAll(false)} className="flex-1 py-2 rounded-xl text-xs font-semibold border border-zinc-700">Voltou tudo</button>
          <button onClick={() => setAll(true)} className="flex-1 py-2 rounded-xl text-xs font-semibold border border-zinc-700">Ficou com tudo</button>
        </div>
        <div className="space-y-1.5">
          {c.consignment_items.map(i => {
            const b = bought[i.id] ?? 0;
            return (
              <div key={i.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${box}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{i.name}</p>
                  <p className="text-[11px] text-zinc-500">levou {i.qty} · {fmt(i.unit_price)} cada{b < i.qty ? ` · volta ${i.qty - b}` : ""}</p>
                </div>
                <span className="text-[11px] text-zinc-500">ficou</span>
                <button disabled={b <= 0} onClick={() => setBought(x => ({ ...x, [i.id]: b - 1 }))} className="p-1 rounded-lg border border-zinc-700 disabled:opacity-30"><Minus className="w-3.5 h-3.5" /></button>
                <span className="w-6 text-center font-bold">{b}</span>
                <button disabled={b >= i.qty} onClick={() => setBought(x => ({ ...x, [i.id]: b + 1 }))} className="p-1 rounded-lg border border-zinc-700 disabled:opacity-30"><Plus className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button onClick={confirm} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 disabled:opacity-50" style={{ color: "#fff" }}>
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : total > 0 ? <ShoppingCart className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {total > 0 ? `Confirmar e cobrar ${fmt(total)} no PDV` : "Confirmar: tudo voltou"}
        </button>
      </div>
    </div>
  );
}
