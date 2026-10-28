import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { fetchAll, fetchAllIn } from "../../lib/fetchAll";
import { matchesSearch } from "../../lib/search";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { PURCHASE_PAY_METHODS } from "../purchases/PurchaseScreen";
import {
  RefreshCw, PiggyBank, ShoppingBasket, SlidersHorizontal, Plus, Trash2, Check, X, ChevronDown, AlertCircle, Search, TrendingUp, TrendingDown,
} from "lucide-react";

// Custo e Lucro: soma as compras de insumos do período, divide pelo que foi
// vendido no caixa (sem ninguém pesar nada) e mostra custo, venda e lucro de
// cada produto. Só lê vendas/compras; grava apenas as regras próprias
// (cost_item_rules, cost_product_rules, cost_counts) e compras pelo mesmo
// register_purchase da aba Compras.

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface StockItem { id: string; name: string; unit: string; cost_price: number | null; is_active: boolean | null }
interface Product { id: string; name: string; sale_price: number | null; cost_price: number | null; category_id: string | null; is_active: boolean | null }
interface Category { id: string; name: string }
interface ItemRule { stock_item_id: string; mode: "all" | "some" | "none"; product_ids: string[] }
interface ProductRule { product_id: string; in_general: boolean; weight: number }
interface Count { stock_item_id: string; count_date: string; qty: number }
interface PurchaseLine { day: string; stock_item_id: string; qty: number; cost: number }
interface SaleLine { day: string; product_id: string; qty: number; revenue: number }

type View = "result" | "buy" | "setup";
type Preset = "week" | "lastweek" | "month" | "lastmonth" | "custom";

// ─── Estilos (mesmo padrão da aba Estoque) ────────────────────────────────────

const card = "bg-white border border-gray-200 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]";
const fieldCls = "w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition-all";
const btnPrimary = "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const btnGhost = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors";
const WHITE = { color: "#fff" };
const UNITS = ["kg", "g", "litro", "ml", "unidade", "pacote", "caixa", "dúzia", "lata", "fardo"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number, d = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: d });
// Aceita "1,5", "1.5" e "1.234,50"
const parseNum = (s: string) => {
  const t = s.trim();
  if (!t) return NaN;
  return parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
};
const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOf = (iso: string) => dayStr(new Date(iso));
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
const startISO = (s: string) => parseDay(s).toISOString();
const endISO = (s: string) => { const d = parseDay(s); d.setHours(23, 59, 59, 999); return d.toISOString(); };
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
const fmtDay = (s: string) => parseDay(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Quantidade por porção em gramas/ml quando der (é o que se entende na cozinha)
function portionText(qty: number, unit: string) {
  const u = norm(unit);
  if (u === "kg") return `${fmtNum(qty * 1000, 0)} g`;
  if (u === "g") return `${fmtNum(qty, 0)} g`;
  if (u === "litro" || u === "l" || u === "lt") return `${fmtNum(qty * 1000, 0)} ml`;
  if (u === "ml") return `${fmtNum(qty, 0)} ml`;
  return `${fmtNum(qty, 2)} ${unit}`;
}

function presetRange(p: Preset, today: string): { from: string; to: string; prevFrom: string; prevTo: string } {
  const d = parseDay(today);
  if (p === "week" || p === "lastweek") {
    const dow = (d.getDay() + 6) % 7; // segunda = 0
    let from = addDays(today, -dow);
    if (p === "lastweek") from = addDays(from, -7);
    const to = p === "week" ? today : addDays(from, 6);
    return { from, to, prevFrom: addDays(from, -7), prevTo: addDays(to, -7) };
  }
  const monthStart = (y: number, m: number) => dayStr(new Date(y, m, 1));
  const monthEnd = (y: number, m: number) => dayStr(new Date(y, m + 1, 0));
  const y = d.getFullYear(), m = d.getMonth() - (p === "lastmonth" ? 1 : 0);
  const from = monthStart(y, m);
  const to = p === "month" ? today : monthEnd(y, m);
  const prevFrom = monthStart(y, m - 1);
  // Mês anterior até o mesmo dia (comparação justa com o mês em andamento)
  const prevTo = p === "month" ? dayStr(new Date(y, m - 1, Math.min(d.getDate(), new Date(y, m, 0).getDate()))) : monthEnd(y, m - 1);
  return { from, to, prevFrom, prevTo };
}

// Sugestão inicial do que é "prato" (só usada enquanto nada foi configurado)
const DISH_RX = /marmit|prato|refei|almo[cç]|quentinha|executiv|self|jantar|\bpf\b|feijoada|parmegian|strogonof|frango|bife|carne|peixe/i;

// ─── Cálculo ──────────────────────────────────────────────────────────────────

interface ItemResult {
  item: StockItem; mode: ItemRule["mode"]; targets: string[];
  boughtQty: number; boughtCost: number; avg: number;
  opening: number | null; closing: number | null;
  usedQty: number; usedCost: number;
  basis: number;          // porções vendidas (já com o peso de cada tamanho)
  perPortion: number;     // quantidade estimada por porção normal
  allocated: boolean;
}
interface ProductResult {
  product: Product; qty: number; revenue: number; cost: number; source: "calc" | "cadastro" | "none";
  parts: { item: StockItem; cost: number; qtyEach: number }[];
}
interface Result {
  items: ItemResult[]; products: ProductResult[];
  revenue: number; cost: number; notDivided: number; unallocated: number; bought: number;
}

function compute(
  from: string, to: string,
  purchases: PurchaseLine[], sales: SaleLine[], counts: Count[],
  stockItems: StockItem[], products: Product[], itemRules: Map<string, ItemRule>, productRules: Map<string, ProductRule>,
): Result {
  const inRange = (d: string) => d >= from && d <= to;
  const itemById = new Map(stockItems.map(i => [i.id, i]));
  const productById = new Map(products.map(p => [p.id, p]));

  // Vendas por produto
  const sold = new Map<string, { qty: number; revenue: number }>();
  for (const s of sales) {
    if (!inRange(s.day)) continue;
    const cur = sold.get(s.product_id) ?? { qty: 0, revenue: 0 };
    cur.qty += s.qty; cur.revenue += s.revenue;
    sold.set(s.product_id, cur);
  }
  const weight = (pid: string) => productRules.get(pid)?.weight ?? 1;
  const general = products.filter(p => productRules.get(p.id)?.in_general).map(p => p.id);

  // Compras por insumo
  const bought = new Map<string, { qty: number; cost: number }>();
  for (const p of purchases) {
    if (!inRange(p.day)) continue;
    const cur = bought.get(p.stock_item_id) ?? { qty: 0, cost: 0 };
    cur.qty += p.qty; cur.cost += p.qty * p.cost;
    bought.set(p.stock_item_id, cur);
  }
  const openDay = addDays(from, -1);
  const countOf = (id: string, day: string) => counts.find(c => c.stock_item_id === id && c.count_date === day)?.qty ?? null;

  const ids = new Set<string>([...bought.keys(), ...counts.filter(c => c.count_date === openDay || c.count_date === to).map(c => c.stock_item_id)]);
  const items: ItemResult[] = [];
  const productParts = new Map<string, ProductResult["parts"]>();
  let notDivided = 0, unallocated = 0, totalBought = 0;

  for (const id of ids) {
    const item = itemById.get(id);
    if (!item) continue;
    const b = bought.get(id) ?? { qty: 0, cost: 0 };
    totalBought += b.cost;
    const avg = b.qty > 0 ? b.cost / b.qty : Number(item.cost_price ?? 0);
    const opening = countOf(id, openDay), closing = countOf(id, to);
    const usedQty = Math.max(0, (opening ?? 0) + b.qty - (closing ?? 0));
    const usedCost = Math.max(0, b.cost + ((opening ?? 0) - (closing ?? 0)) * avg);
    const rule = itemRules.get(id);
    const mode = rule?.mode ?? "all";
    const targets = mode === "some" ? rule!.product_ids.filter(pid => productById.has(pid)) : mode === "all" ? general : [];
    const basis = targets.reduce((s, pid) => s + (sold.get(pid)?.qty ?? 0) * weight(pid), 0);
    const allocated = mode !== "none" && basis > 0;
    if (mode === "none") notDivided += usedCost;
    else if (!allocated) unallocated += usedCost;
    else {
      for (const pid of targets) {
        const q = sold.get(pid)?.qty ?? 0;
        if (q <= 0) continue;
        const share = (q * weight(pid)) / basis;
        const list = productParts.get(pid) ?? [];
        list.push({ item, cost: usedCost * share, qtyEach: (usedQty * weight(pid)) / basis });
        productParts.set(pid, list);
      }
    }
    items.push({ item, mode, targets, boughtQty: b.qty, boughtCost: b.cost, avg, opening, closing, usedQty, usedCost, basis, perPortion: basis > 0 ? usedQty / basis : 0, allocated });
  }

  const productsOut: ProductResult[] = [];
  for (const [pid, s] of sold) {
    const product = productById.get(pid);
    if (!product) continue;
    const parts = (productParts.get(pid) ?? []).sort((a, b) => b.cost - a.cost);
    let cost = parts.reduce((x, p) => x + p.cost, 0);
    let source: ProductResult["source"] = parts.length ? "calc" : "none";
    // Produto de revenda (refrigerante etc.): usa o custo do cadastro
    if (!parts.length && Number(product.cost_price ?? 0) > 0) { cost = Number(product.cost_price) * s.qty; source = "cadastro"; }
    productsOut.push({ product, qty: s.qty, revenue: s.revenue, cost, source, parts });
  }
  productsOut.sort((a, b) => b.revenue - a.revenue);
  items.sort((a, b) => b.usedCost - a.usedCost);
  return {
    items, products: productsOut,
    revenue: productsOut.reduce((s, p) => s + p.revenue, 0),
    cost: productsOut.reduce((s, p) => s + p.cost, 0),
    notDivided, unallocated, bought: totalBought,
  };
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CostsPage() {
  const [view, setView] = useState<View>("result");
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [itemRules, setItemRules] = useState<Map<string, ItemRule>>(new Map());
  const [productRules, setProductRules] = useState<Map<string, ProductRule>>(new Map());

  async function loadBase() {
    const [{ data: u }, si, pr, ca, su, ir, prr] = await Promise.all([
      supabase.auth.getUser(),
      fetchAll(() => supabase.from("stock_items").select("id, name, unit, cost_price, is_active")),
      fetchAll(() => supabase.from("products").select("id, name, sale_price, cost_price, category_id, is_active")),
      fetchAll(() => supabase.from("categories").select("id, name")),
      fetchAll(() => supabase.from("suppliers").select("id, name")),
      fetchAll(() => supabase.from("cost_item_rules").select("stock_item_id, mode, product_ids")),
      fetchAll(() => supabase.from("cost_product_rules").select("product_id, in_general, weight")),
    ]);
    setUid(u.user?.id ?? null);
    setStockItems((si.data as StockItem[]).sort((a, b) => a.name.localeCompare(b.name)));
    setProducts((pr.data as Product[]).sort((a, b) => a.name.localeCompare(b.name)));
    setCategories(ca.data as Category[]);
    setSuppliers((su.data as any[]).sort((a, b) => a.name.localeCompare(b.name)));
    setItemRules(new Map((ir.data as ItemRule[]).map(r => [r.stock_item_id, { ...r, product_ids: r.product_ids ?? [] }])));
    setProductRules(new Map((prr.data as any[]).map(r => [r.product_id, { product_id: r.product_id, in_general: r.in_general, weight: Number(r.weight) || 1 }])));
    setLoading(false);
  }
  useEffect(() => { loadBase(); }, []);

  const configured = productRules.size > 0 && [...productRules.values()].some(r => r.in_general);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">Custo e Lucro</h1>
          <p className="text-xs text-gray-500 mt-0.5">Quanto custa cada marmita, por quanto vende e quanto sobra, sem precisar pesar nada.</p>
        </div>
        <div className="flex p-1 bg-gray-200/60 rounded-xl">
          {([
            { key: "result", label: "Resultado", icon: <PiggyBank className="w-4 h-4" /> },
            { key: "buy", label: "Lançar compras", icon: <ShoppingBasket className="w-4 h-4" /> },
            { key: "setup", label: "Vai em quê", icon: <SlidersHorizontal className="w-4 h-4" /> },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`flex flex-1 md:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${view === t.key ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {!configured && view !== "setup" && (
        <div className="flex items-start gap-3 p-3.5 rounded-2xl border border-amber-200 bg-amber-50">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-900">
            <p className="font-semibold">Primeiro passo (uma vez só): diga quais produtos são marmitas/pratos.</p>
            <p className="text-xs mt-0.5">É neles que arroz, feijão, tempero, embalagem etc. são divididos.</p>
          </div>
          <button onClick={() => setView("setup")} className={btnPrimary + " !py-2 shrink-0"} style={WHITE}>Configurar</button>
        </div>
      )}

      {view === "result" && (
        <ResultView stockItems={stockItems} products={products} itemRules={itemRules} productRules={productRules} uid={uid} />
      )}
      {view === "buy" && (
        <BuyView stockItems={stockItems} suppliers={suppliers} uid={uid}
          onItemsChanged={loadBase} goSetup={() => setView("setup")} />
      )}
      {view === "setup" && (
        <SetupView stockItems={stockItems} products={products} categories={categories} uid={uid}
          itemRules={itemRules} setItemRules={setItemRules} productRules={productRules} setProductRules={setProductRules} />
      )}
    </div>
  );
}

// ─── Resultado ────────────────────────────────────────────────────────────────

function ResultView({ stockItems, products, itemRules, productRules, uid }: {
  stockItems: StockItem[]; products: Product[]; itemRules: Map<string, ItemRule>; productRules: Map<string, ProductRule>; uid: string | null;
}) {
  const today = dayStr(new Date());
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(() => addDays(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset, today);
    const from = customFrom <= customTo ? customFrom : customTo, to = customFrom <= customTo ? customTo : customFrom;
    const len = daysBetween(from, to) + 1;
    return { from, to, prevFrom: addDays(from, -len), prevTo: addDays(from, -1) };
  }, [preset, customFrom, customTo, today]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<PurchaseLine[]>([]);
  const [sales, setSales] = useState<SaleLine[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [leftoverOpen, setLeftoverOpen] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    const fromISO = startISO(range.prevFrom), toISO = endISO(range.to);
    const [po, sa, co] = await Promise.all([
      // Compra conta no dia em que a mercadoria chegou (received_at)
      fetchAll(() => supabase.from("purchase_orders")
        .select("id, status, created_at, received_at, purchase_order_items(stock_item_id, quantity, unit_cost)")
        .eq("status", "received")
        .lte("created_at", toISO)
        .or(`received_at.gte."${fromISO}",created_at.gte."${fromISO}"`)),
      fetchAll(() => supabase.from("sales")
        .select("id, created_at, discount")
        .eq("status", "paid")
        .neq("origin", "fiado_payment")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)),
      fetchAll(() => supabase.from("cost_counts").select("stock_item_id, count_date, qty")
        .gte("count_date", addDays(range.prevFrom, -1)).lte("count_date", range.to)),
    ]);
    const err = po.error || sa.error || co.error;
    const lines: PurchaseLine[] = [];
    for (const o of po.data as any[]) {
      const day = dayOf(o.received_at ?? o.created_at);
      for (const it of o.purchase_order_items ?? []) {
        if (!it.stock_item_id) continue;
        lines.push({ day, stock_item_id: it.stock_item_id, qty: Number(it.quantity) || 0, cost: Number(it.unit_cost) || 0 });
      }
    }
    const saleRows = sa.data as any[];
    const items = await fetchAllIn(saleRows.map(s => s.id), ids => supabase.from("sale_items")
      .select("id, sale_id, product_id, quantity, unit_price").in("sale_id", ids));
    // Desconto da venda é dividido entre os itens dela
    const bySale = new Map<string, any[]>();
    for (const it of items.data as any[]) {
      const l = bySale.get(it.sale_id) ?? []; l.push(it); bySale.set(it.sale_id, l);
    }
    const saleLines: SaleLine[] = [];
    for (const s of saleRows) {
      const its = bySale.get(s.id) ?? [];
      const subtotal = its.reduce((x, i) => x + Number(i.quantity) * Number(i.unit_price), 0);
      const factor = subtotal > 0 ? Math.max(0, Math.min(1, (subtotal - Number(s.discount ?? 0)) / subtotal)) : 1;
      const day = dayOf(s.created_at);
      for (const i of its) {
        if (!i.product_id) continue;
        saleLines.push({ day, product_id: i.product_id, qty: Number(i.quantity) || 0, revenue: Number(i.quantity) * Number(i.unit_price) * factor });
      }
    }
    setPurchases(lines); setSales(saleLines);
    setCounts((co.data as any[]).map(c => ({ stock_item_id: c.stock_item_id, count_date: c.count_date, qty: Number(c.qty) })));
    setError(err || items.error ? (err || items.error).message : null);
    setLoading(false);
  }
  useEffect(() => { load(); }, [range.from, range.to, range.prevFrom]);

  const cur = useMemo(() => compute(range.from, range.to, purchases, sales, counts, stockItems, products, itemRules, productRules),
    [range, purchases, sales, counts, stockItems, products, itemRules, productRules]);
  const prev = useMemo(() => compute(range.prevFrom, range.prevTo, purchases, sales, counts, stockItems, products, itemRules, productRules),
    [range, purchases, sales, counts, stockItems, products, itemRules, productRules]);
  const prevPortion = new Map(prev.items.map(i => [i.item.id, i.perPortion]));

  const profit = cur.revenue - cur.cost;
  const finalResult = profit - cur.notDivided - cur.unallocated;
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      {/* Período */}
      <div className={`${card} p-3 flex flex-col lg:flex-row gap-3 lg:items-center`}>
        <div className="flex p-1 bg-gray-100 rounded-xl max-w-full overflow-x-auto">
          {([
            { v: "week", l: "Esta semana" }, { v: "lastweek", l: "Semana passada" },
            { v: "month", l: "Este mês" }, { v: "lastmonth", l: "Mês passado" }, { v: "custom", l: "Escolher" },
          ] as const).map(o => (
            <button key={o.v} onClick={() => setPreset(o.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${preset === o.v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
              {o.l}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className={fieldCls + " !py-2"} />
            <span className="text-xs text-gray-400">até</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className={fieldCls + " !py-2"} />
          </div>
        )}
        <p className="text-xs text-gray-500 lg:ml-auto">{fmtDay(range.from)} a {fmtDay(range.to)} · comparando com {fmtDay(range.prevFrom)} a {fmtDay(range.prevTo)}</p>
        <button onClick={load} className={btnGhost + " !py-2"} title="Atualizar"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div>

      {error && <p className="text-sm text-red-600">Erro ao carregar: {error}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-40"><RefreshCw className="w-5 h-5 animate-spin text-brand-500" /></div>
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Vendeu" value={fmt(cur.revenue)} sub={`${fmtNum(cur.products.reduce((s, p) => s + p.qty, 0), 0)} itens vendidos`} />
            <Kpi label="Custo do que vendeu" value={fmt(cur.cost)} sub={`compras no período: ${fmt(cur.bought)}`} />
            <Kpi label="Lucro bruto" value={fmt(profit)} tone={profit >= 0 ? "green" : "red"} sub={cur.revenue > 0 ? `margem de ${fmtNum((profit / cur.revenue) * 100, 0)}%` : "sem vendas"} />
            <Kpi label="Sobrou no fim" value={fmt(finalResult)} tone={finalResult >= 0 ? "green" : "red"}
              sub={cur.notDivided + cur.unallocated > 0 ? `já tirando ${fmt(cur.notDivided + cur.unallocated)} de compras fora dos pratos` : "lucro bruto − outras compras"} />
          </div>
          {cur.unallocated > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {fmt(cur.unallocated)} em compras não foram divididos porque os produtos onde eles entram não tiveram venda no período (ou nenhum produto foi marcado como prato em "Vai em quê").
            </p>
          )}

          {/* Por produto */}
          <div className={card}>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">Lucro por produto</p>
              <p className="text-[11px] text-gray-400">toque para ver de onde vem o custo</p>
            </div>
            {cur.products.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-gray-500">Nenhuma venda no período.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                <div className="hidden md:grid grid-cols-[1fr_70px_110px_110px_110px_110px_70px] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  <span>Produto</span><span className="text-right">Vendidas</span><span className="text-right">Custo cada</span><span className="text-right">Vende por</span>
                  <span className="text-right">Lucro cada</span><span className="text-right">Lucro total</span><span className="text-right">Margem</span>
                </div>
                {cur.products.map(p => {
                  const each = p.qty > 0 ? p.cost / p.qty : 0, price = p.qty > 0 ? p.revenue / p.qty : 0;
                  const lp = p.revenue - p.cost, margin = p.revenue > 0 ? (lp / p.revenue) * 100 : 0;
                  const open = openProduct === p.product.id;
                  const noCost = p.source === "none";
                  return (
                    <div key={p.product.id}>
                      <button onClick={() => setOpenProduct(open ? null : p.product.id)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors grid grid-cols-2 md:grid-cols-[1fr_70px_110px_110px_110px_110px_70px] gap-x-2 gap-y-1 items-center">
                        <span className="col-span-2 md:col-span-1 flex items-center gap-1.5 min-w-0">
                          <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                          <span className="font-semibold text-sm text-gray-900 truncate">{p.product.name}</span>
                          {p.source === "cadastro" && <span className="text-[10px] font-semibold text-gray-400 shrink-0">custo do cadastro</span>}
                          {noCost && <span className="text-[10px] font-semibold text-amber-600 shrink-0">sem custo</span>}
                        </span>
                        <Cell label="Vendidas" value={fmtNum(p.qty, 2)} />
                        <Cell label="Custo cada" value={noCost ? "—" : fmt(each)} />
                        <Cell label="Vende por" value={fmt(price)} />
                        <Cell label="Lucro cada" value={noCost ? "—" : fmt(price - each)} tone={noCost ? undefined : price - each >= 0 ? "green" : "red"} />
                        <Cell label="Lucro total" value={noCost ? "—" : fmt(lp)} tone={noCost ? undefined : lp >= 0 ? "green" : "red"} bold />
                        <Cell label="Margem" value={noCost ? "—" : `${fmtNum(margin, 0)}%`} />
                      </button>
                      {open && (
                        <div className="px-4 pb-3 md:pl-10">
                          {p.parts.length > 0 ? (
                            <div className="rounded-xl bg-gray-50 border border-gray-100 divide-y divide-gray-100">
                              {p.parts.map(part => (
                                <div key={part.item.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                                  <span className="flex-1 truncate text-gray-700">{part.item.name}</span>
                                  <span className="text-gray-500 tabular-nums">≈ {portionText(part.qtyEach, part.item.unit)} cada</span>
                                  <span className="w-20 text-right font-semibold tabular-nums">{fmt(p.qty > 0 ? part.cost / p.qty : 0)}</span>
                                </div>
                              ))}
                              <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold">
                                <span className="flex-1">Custo de cada um</span>
                                <span className="w-20 text-right tabular-nums">{fmt(each)}</span>
                              </div>
                            </div>
                          ) : p.source === "cadastro" ? (
                            <p className="text-xs text-gray-500">Produto de revenda: usa o custo do cadastro ({fmt(Number(p.product.cost_price ?? 0))}).</p>
                          ) : (
                            <p className="text-xs text-amber-700">Nenhuma compra foi dividida neste produto. Marque-o como prato em "Vai em quê" ou coloque um custo no cadastro do produto.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Por insumo */}
          <div className={card}>
            <div className="px-4 pt-4 pb-2">
              <p className="text-sm font-bold text-gray-900">O que foi gasto de cada compra</p>
              <p className="text-[11px] text-gray-400">"Por porção" é a média estimada pelo total comprado ÷ vendido. Se subir muito sem você mudar nada, tem porção maior, desperdício ou sumiço.</p>
            </div>
            {cur.items.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-gray-500">Nenhuma compra de insumo lançada no período. Use "Lançar compras".</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {cur.items.map(r => {
                  const before = prevPortion.get(r.item.id) ?? 0;
                  const change = before > 0 && r.perPortion > 0 ? ((r.perPortion - before) / before) * 100 : null;
                  return (
                    <div key={r.item.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-900 truncate">{r.item.name}</p>
                        <p className="text-[11px] text-gray-500">
                          comprou {fmtNum(r.boughtQty, 3)} {r.item.unit} · {fmt(r.boughtCost)}
                          {r.boughtQty > 0 && ` (${fmt(r.avg)}/${r.item.unit})`}
                          {(r.opening !== null || r.closing !== null) && ` · usou ${fmtNum(r.usedQty, 3)} ${r.item.unit}`}
                          {r.opening !== null && ` · tinha ${fmtNum(r.opening, 3)}`}
                          {r.closing !== null && ` · sobrou ${fmtNum(r.closing, 3)}`}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {r.mode === "none" ? "não dividido (despesa à parte)"
                            : r.mode === "some" ? `vai em: ${r.targets.map(productName).join(", ") || "nenhum produto escolhido"}`
                            : "vai em todos os pratos"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 md:gap-5 text-xs">
                        {r.allocated ? (
                          <span className="text-gray-700"><span className="text-gray-400">por porção </span><b className="tabular-nums">{portionText(r.perPortion, r.item.unit)}</b></span>
                        ) : r.mode !== "none" ? (
                          <span className="text-amber-600 font-semibold">sem venda para dividir</span>
                        ) : null}
                        {change !== null && Math.abs(change) >= 5 && (
                          <span className={`inline-flex items-center gap-0.5 font-bold ${change > 0 ? "text-red-600" : "text-emerald-600"}`}
                            title={`Antes: ${portionText(before, r.item.unit)} por porção`}>
                            {change > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                            {change > 0 ? "+" : ""}{fmtNum(change, 0)}%
                          </span>
                        )}
                        <span className="w-24 text-right font-bold tabular-nums">{fmt(r.usedCost)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sobra no fim do período (opcional) */}
          <div className={card}>
            <button onClick={() => setLeftoverOpen(o => !o)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${leftoverOpen ? "rotate-180" : ""}`} />
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900">Informar o que sobrou em {fmtDay(range.to)} <span className="font-normal text-gray-400">(opcional)</span></p>
                <p className="text-[11px] text-gray-500">Comprou muito no fim do período? Diga quanto ainda tem e o sistema desconta, e passa para o próximo período.</p>
              </div>
            </button>
            {leftoverOpen && (
              <LeftoverForm day={range.to} uid={uid} counts={counts} onSaved={load}
                items={stockItems.filter(i => cur.items.some(r => r.item.id === i.id) || i.is_active !== false)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div className={`${card} p-3 sm:p-4 min-w-0`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-xl sm:text-2xl font-black tabular-nums tracking-tight mt-1 whitespace-nowrap ${color}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

function Cell({ label, value, tone, bold }: { label: string; value: string; tone?: "green" | "red"; bold?: boolean }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-gray-800";
  return (
    <span className="flex md:block items-center justify-between md:text-right text-xs tabular-nums">
      <span className="md:hidden text-gray-400">{label}</span>
      <span className={`${color} ${bold ? "font-bold" : "font-semibold"}`}>{value}</span>
    </span>
  );
}

function LeftoverForm({ day, uid, counts, items, onSaved }: {
  day: string; uid: string | null; counts: Count[]; items: StockItem[]; onSaved: () => void;
}) {
  const initial = () => Object.fromEntries(counts.filter(c => c.count_date === day).map(c => [c.stock_item_id, String(c.qty).replace(".", ",")]));
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setVals(initial()); }, [day, counts]);

  async function save() {
    setSaving(true); setMsg(null);
    const existing = new Set(counts.filter(c => c.count_date === day).map(c => c.stock_item_id));
    const upserts: any[] = [], removes: string[] = [];
    for (const it of items) {
      const v = vals[it.id];
      const n = v === undefined ? NaN : parseNum(v);
      if (!isNaN(n) && n >= 0) upserts.push({ user_id: uid, stock_item_id: it.id, count_date: day, qty: n });
      else if (existing.has(it.id)) removes.push(it.id);
    }
    let err: any = null;
    if (upserts.length) err = (await supabase.from("cost_counts").upsert(upserts, { onConflict: "user_id,stock_item_id,count_date" })).error;
    if (!err && removes.length) err = (await supabase.from("cost_counts").delete().eq("count_date", day).in("stock_item_id", removes)).error;
    setSaving(false);
    if (err) { setMsg("Erro: " + err.message); return; }
    setMsg("Salvo!");
    onSaved();
  }

  return (
    <div className="px-4 pb-4 space-y-2">
      <p className="text-[11px] text-gray-500">Deixe em branco o que acabou ou que você não quer contar.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {items.map(it => (
          <label key={it.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate text-gray-700">{it.name}</span>
            <input inputMode="decimal" value={vals[it.id] ?? ""} onChange={e => setVals(v => ({ ...v, [it.id]: e.target.value }))}
              placeholder="0" className={fieldCls + " !w-24 !py-1.5 text-right"} />
            <span className="w-12 text-xs text-gray-400">{it.unit}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className={btnPrimary} style={WHITE}>
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar sobras
        </button>
        {msg && <span className={`text-xs font-semibold ${msg.startsWith("Erro") ? "text-red-600" : "text-emerald-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ─── Lançar compras do dia ────────────────────────────────────────────────────

interface BuyRow { name: string; unit: string; qty: string; total: string }
const emptyRow = (): BuyRow => ({ name: "", unit: "kg", qty: "", total: "" });

function BuyView({ stockItems, suppliers, uid, onItemsChanged, goSetup }: {
  stockItems: StockItem[]; suppliers: { id: string; name: string }[]; uid: string | null;
  onItemsChanged: () => Promise<void>; goSetup: () => void;
}) {
  const today = dayStr(new Date());
  const [day, setDay] = useState(today);
  const [supplierId, setSupplierId] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [paid, setPaid] = useState(true);
  const [rows, setRows] = useState<BuyRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ id: string; day: string; items: { name: string; unit: string; qty: number; cost: number }[] }[]>([]);

  const activeItems = stockItems.filter(i => i.is_active !== false);
  const findItem = (name: string) => activeItems.find(i => norm(i.name) === norm(name));

  async function loadRecent() {
    const { data } = await supabase.from("purchase_orders")
      .select("id, created_at, received_at, purchase_order_items(quantity, unit_cost, stock_items(name, unit))")
      .eq("status", "received").gte("created_at", startISO(addDays(today, -6)))
      .order("created_at", { ascending: false }).limit(30);
    setRecent(((data ?? []) as any[]).map(o => ({
      id: o.id, day: dayOf(o.received_at ?? o.created_at),
      items: (o.purchase_order_items ?? []).filter((i: any) => i.stock_items).map((i: any) => ({
        name: i.stock_items.name, unit: i.stock_items.unit, qty: Number(i.quantity), cost: Number(i.unit_cost),
      })),
    })).filter(o => o.items.length));
  }
  useEffect(() => { loadRecent(); }, []);

  const setRow = (idx: number, patch: Partial<BuyRow>) => setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const filled = rows.filter(r => r.name.trim() || r.qty || r.total);
  const total = filled.reduce((s, r) => s + (parseNum(r.total) || 0), 0);

  async function supplierForDay(): Promise<string> {
    if (supplierId) return supplierId;
    // Compra de mercado/feira sem fornecedor: usa (ou cria) "Diversos"
    const found = suppliers.find(s => norm(s.name) === "diversos");
    if (found) return found.id;
    const { data, error } = await supabase.from("suppliers").insert({ name: "Diversos" }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "Não foi possível criar o fornecedor Diversos");
    return data.id;
  }

  async function save() {
    setError(null); setDone(null);
    if (filled.length === 0) { setError("Preencha pelo menos um item."); return; }
    for (const r of filled) {
      if (!r.name.trim()) { setError("Tem item sem nome."); return; }
      if (!(parseNum(r.qty) > 0)) { setError(`Quantidade inválida em "${r.name}".`); return; }
      if (!(parseNum(r.total) >= 0)) { setError(`Valor inválido em "${r.name}".`); return; }
    }
    if (day > today) { setError("A data não pode ser no futuro."); return; }
    setSaving(true);
    try {
      const sup = await supplierForDay();
      // Insumos novos são criados na hora (mesmo cadastro da aba Estoque)
      const ids: string[] = [];
      for (const r of filled) {
        const ex = findItem(r.name);
        if (ex) { ids.push(ex.id); continue; }
        const { data, error } = await supabase.from("stock_items").insert({
          name: r.name.trim(), unit: r.unit, current_qty: 0, min_qty: 0, cost_price: 0, supplier_id: supplierId || null,
        }).select("id").single();
        if (error || !data) throw new Error(error?.message ?? "Erro ao criar insumo");
        ids.push(data.id);
      }
      const items = filled.map((r, i) => {
        const q = parseNum(r.qty), t = parseNum(r.total) || 0;
        return { ref_type: "ingredient", item_id: ids[i], quantity: q, unit_cost: Math.round((t / q) * 10000) / 10000 };
      });
      const { data: poId, error } = await supabase.rpc("register_purchase", {
        p_supplier_id: sup, p_notes: "Compras do dia", p_due_date: day, p_installments: 1, p_items: items,
      });
      if (error || !poId) throw new Error(error?.message ?? "Erro ao salvar a compra");
      // Data escolhida (compra de ontem lançada hoje, por exemplo)
      if (day !== today) {
        const when = new Date(parseDay(day).setHours(12)).toISOString();
        await supabase.from("purchase_orders").update({ created_at: when, received_at: when }).eq("id", poId as string);
      }
      // Forma de pagamento em Contas a Pagar (mesmo que a aba Compras faz)
      const { data: bills } = await supabase.from("accounts_payable").select("id, amount").eq("purchase_order_id", poId as string);
      for (const b of bills ?? []) {
        await supabase.from("accounts_payable").update(paid
          ? { payment_method: payMethod, status: "paid", paid_date: day, paid_amount: b.amount, updated_at: new Date().toISOString() }
          : { payment_method: payMethod, updated_at: new Date().toISOString() }).eq("id", b.id);
      }
      // Histórico do estoque (aparece na aba Estoque); falhar aqui não desfaz a compra
      const { data: bal } = await supabase.from("stock_items").select("id, current_qty").in("id", ids);
      const balance = new Map(((bal ?? []) as any[]).map(b => [b.id, Number(b.current_qty)]));
      const supName = supplierId ? suppliers.find(s => s.id === supplierId)?.name : "Diversos";
      await supabase.from("inventory_movements").insert(items.map(i => ({
        product_id: null, stock_item_id: i.item_id, type: "purchase", quantity: i.quantity,
        balance_after: balance.get(i.item_id) ?? null, unit_cost: i.unit_cost || null,
        reference_type: "purchase", reference_id: poId, notes: `Compra${supName ? " - " + supName : ""}`,
      })));
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      setDone(`${filled.length} ite${filled.length === 1 ? "m lançado" : "ns lançados"} · ${fmt(total)}`);
      await Promise.all([onItemsChanged(), loadRecent()]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    setSaving(false);
  }

  void uid;
  return (
    <div className="space-y-4">
      <div className={`${card} p-4 space-y-3`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-xs text-gray-500">Data da compra
            <input type="date" value={day} max={today} onChange={e => setDay(e.target.value)} className={fieldCls + " mt-1"} />
          </label>
          <label className="text-xs text-gray-500">Onde comprou
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={fieldCls + " mt-1"}>
              <option value="">Diversos (mercado, feira…)</option>
              {suppliers.filter(s => norm(s.name) !== "diversos").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Pagou com
            <select value={payMethod} onChange={e => { setPayMethod(e.target.value); setPaid(PURCHASE_PAY_METHODS.find(m => m.key === e.target.value)?.paidByDefault ?? true); }} className={fieldCls + " mt-1"}>
              {PURCHASE_PAY_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
            <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} className="w-4 h-4 accent-brand-600" />
            Já está pago
          </label>
        </div>

        <datalist id="cost-items">
          {activeItems.map(i => <option key={i.id} value={i.name} />)}
        </datalist>
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1fr_120px_110px_130px_110px_36px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1">
            <span>Item</span><span>Unidade</span><span>Quantidade</span><span>Valor pago (total)</span><span className="text-right">Preço por un.</span><span />
          </div>
          {rows.map((r, idx) => {
            const ex = r.name.trim() ? findItem(r.name) : undefined;
            const q = parseNum(r.qty), t = parseNum(r.total);
            const unit = ex?.unit ?? r.unit;
            return (
              <div key={idx} className="grid grid-cols-2 md:grid-cols-[1fr_120px_110px_130px_110px_36px] gap-2 items-center p-2 md:p-0 rounded-xl border border-gray-100 md:border-0">
                <input list="cost-items" value={r.name} onChange={e => setRow(idx, { name: e.target.value })}
                  placeholder="Ex.: Bife, Alho, Arroz…" className={fieldCls + " col-span-2 md:col-span-1"} />
                {ex ? (
                  <span className="text-sm text-gray-600 px-1">{ex.unit}</span>
                ) : (
                  <select value={r.unit} onChange={e => setRow(idx, { unit: e.target.value })} className={fieldCls} title="Unidade do item novo">
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                )}
                <input inputMode="decimal" value={r.qty} onChange={e => setRow(idx, { qty: e.target.value })} placeholder={`Qtd (${unit})`} className={fieldCls} />
                <input inputMode="decimal" value={r.total} onChange={e => setRow(idx, { total: e.target.value })} placeholder="R$ 0,00" className={fieldCls} />
                <span className="text-xs text-gray-500 md:text-right tabular-nums">
                  {q > 0 && t >= 0 ? `${fmt(t / q)}/${unit}` : ""}
                  {r.name.trim() && !ex && <span className="block text-[10px] font-semibold text-brand-600">item novo</span>}
                </span>
                <button onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, i) => i !== idx) : [emptyRow()])}
                  className="justify-self-end p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Remover linha">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setRows(rs => [...rs, emptyRow()])} className={btnGhost}><Plus className="w-4 h-4" /> Mais um item</button>
          <div className="flex-1" />
          <span className="text-sm text-gray-600">Total: <b className="text-gray-900">{fmt(total)}</b></span>
          <button onClick={save} disabled={saving || filled.length === 0} className={btnPrimary} style={WHITE}>
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar compras
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && (
          <p className="text-sm text-emerald-700 font-semibold">
            ✓ {done}. Já entrou no estoque e em Contas a Pagar.{" "}
            <button onClick={goSetup} className="underline font-normal">Item novo? Diga em "Vai em quê" onde ele entra.</button>
          </p>
        )}
      </div>

      <div className={card}>
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-bold text-gray-900">Compras dos últimos 7 dias</p>
          <p className="text-[11px] text-gray-400">Para corrigir ou cancelar uma compra, use a aba Compras.</p>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-500">Nada lançado ainda.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map(o => (
              <div key={o.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700">{fmtDay(o.day)}</span>
                  <span className="font-bold tabular-nums">{fmt(o.items.reduce((s, i) => s + i.qty * i.cost, 0))}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {o.items.map(i => `${i.name} ${fmtNum(i.qty, 3)} ${i.unit} (${fmt(i.qty * i.cost)})`).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Vai em quê (configuração, uma vez só) ────────────────────────────────────

function SetupView({ stockItems, products, categories, uid, itemRules, setItemRules, productRules, setProductRules }: {
  stockItems: StockItem[]; products: Product[]; categories: Category[]; uid: string | null;
  itemRules: Map<string, ItemRule>; setItemRules: (m: Map<string, ItemRule>) => void;
  productRules: Map<string, ProductRule>; setProductRules: (m: Map<string, ProductRule>) => void;
}) {
  const activeProducts = products.filter(p => p.is_active !== false);
  const catName = (id: string | null) => categories.find(c => c.id === id)?.name ?? "Sem categoria";
  const nothingYet = productRules.size === 0;

  // Rascunho dos pratos (com sugestão automática na primeira vez)
  const [dish, setDish] = useState<Record<string, { on: boolean; weight: string }>>(() => Object.fromEntries(activeProducts.map(p => {
    const r = productRules.get(p.id);
    const on = r ? r.in_general : nothingYet && (DISH_RX.test(p.name) || DISH_RX.test(catName(p.category_id)));
    return [p.id, { on, weight: String(r?.weight ?? 1).replace(".", ",") }];
  })));
  const [savingDish, setSavingDish] = useState(false);
  const [dishMsg, setDishMsg] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<StockItem | null>(null);
  const [itemSearch, setItemSearch] = useState("");

  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of activeProducts) { const k = catName(p.category_id); m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products, categories]);

  const dirty = activeProducts.some(p => {
    const r = productRules.get(p.id), d = dish[p.id];
    if (!d) return false;
    return (r?.in_general ?? false) !== d.on || (d.on && (r?.weight ?? 1) !== (parseNum(d.weight) || 1));
  });

  async function saveDishes() {
    setSavingDish(true); setDishMsg(null);
    const rows = activeProducts
      .filter(p => dish[p.id] && (dish[p.id].on || productRules.has(p.id)))
      .map(p => ({ user_id: uid, product_id: p.id, in_general: dish[p.id].on, weight: Math.max(0.1, parseNum(dish[p.id].weight) || 1), updated_at: new Date().toISOString() }));
    const { error } = rows.length
      ? await supabase.from("cost_product_rules").upsert(rows, { onConflict: "user_id,product_id" })
      : { error: null };
    setSavingDish(false);
    if (error) { setDishMsg("Erro: " + error.message); return; }
    const next = new Map(productRules);
    for (const r of rows) next.set(r.product_id, { product_id: r.product_id, in_general: r.in_general, weight: r.weight });
    setProductRules(next);
    setDishMsg("Salvo!");
  }

  async function saveItemRule(item: StockItem, mode: ItemRule["mode"], product_ids: string[]) {
    const prevRules = itemRules;
    const next = new Map(itemRules);
    next.set(item.id, { stock_item_id: item.id, mode, product_ids });
    setItemRules(next);
    const { error } = await supabase.from("cost_item_rules").upsert(
      { user_id: uid, stock_item_id: item.id, mode, product_ids, updated_at: new Date().toISOString() },
      { onConflict: "user_id,stock_item_id" });
    if (error) { setItemRules(prevRules); alert("Não foi possível salvar: " + error.message); }
  }

  const items = stockItems.filter(i => i.is_active !== false && (!itemSearch || matchesSearch(i.name, itemSearch)));
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      {/* 1. Pratos */}
      <div className={`${card} p-4 space-y-3`}>
        <div>
          <p className="text-sm font-bold text-gray-900">1. Quais produtos são marmitas/pratos?</p>
          <p className="text-xs text-gray-500">Os itens marcados como "todos os pratos" (arroz, feijão, tempero, embalagem…) são divididos entre esses produtos. Refrigerante e outros de revenda ficam de fora.</p>
          <p className="text-xs text-gray-500 mt-1"><b>Tamanho:</b> 1 = porção normal. Marmita grande que leva 50% a mais, coloque 1,5; pequena, 0,7.</p>
          {nothingYet && <p className="text-xs text-brand-700 font-semibold mt-1">Já deixamos marcados os que parecem pratos. Confira e salve.</p>}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {groups.map(([cat, list]) => {
            const allOn = list.every(p => dish[p.id]?.on);
            return (
              <div key={cat} className="rounded-xl border border-gray-100">
                <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-t-xl text-xs font-bold text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={allOn} className="w-4 h-4 accent-brand-600"
                    onChange={e => setDish(d => ({ ...d, ...Object.fromEntries(list.map(p => [p.id, { ...d[p.id], on: e.target.checked }])) }))} />
                  {cat}
                </label>
                <div className="divide-y divide-gray-50">
                  {list.map(p => (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                      <label className="flex-1 flex items-center gap-2 text-sm text-gray-800 cursor-pointer min-w-0">
                        <input type="checkbox" checked={dish[p.id]?.on ?? false} className="w-4 h-4 accent-brand-600"
                          onChange={e => setDish(d => ({ ...d, [p.id]: { ...d[p.id], on: e.target.checked } }))} />
                        <span className="truncate">{p.name}</span>
                      </label>
                      {dish[p.id]?.on && (
                        <label className="flex items-center gap-1 text-[11px] text-gray-400">
                          tamanho
                          <input inputMode="decimal" value={dish[p.id].weight}
                            onChange={e => setDish(d => ({ ...d, [p.id]: { ...d[p.id], weight: e.target.value } }))}
                            className={fieldCls + " !w-14 !py-1 !px-2 text-center"} />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={saveDishes} disabled={savingDish || (!dirty && !nothingYet)} className={btnPrimary} style={WHITE}>
            {savingDish ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar pratos
          </button>
          {dishMsg && <span className={`text-xs font-semibold ${dishMsg.startsWith("Erro") ? "text-red-600" : "text-emerald-600"}`}>{dishMsg}</span>}
        </div>
      </div>

      {/* 2. Insumos */}
      <div className={`${card} p-4 space-y-3`}>
        <div>
          <p className="text-sm font-bold text-gray-900">2. Cada compra vai em quê?</p>
          <p className="text-xs text-gray-500">Bife só nas marmitas de bife? Escolha "Só em alguns". Arroz, alho, tempero, embalagem: "Todos os pratos". Produto de limpeza, gás que você não quer dividir: "Não dividir". Salva sozinho.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="Buscar insumo..." className={fieldCls + " pl-10 bg-gray-50"} />
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum insumo ainda. Eles aparecem aqui quando você lança as compras.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map(it => {
              const r = itemRules.get(it.id);
              const mode = r?.mode ?? "all";
              return (
                <div key={it.id} className="py-2.5 flex flex-col md:flex-row md:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{it.name} <span className="font-normal text-xs text-gray-400">{it.unit}</span></p>
                    {mode === "some" && (
                      <p className="text-[11px] text-gray-500 truncate">
                        {r!.product_ids.length ? r!.product_ids.map(productName).join(", ") : <span className="text-amber-600 font-semibold">escolha os produtos</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex p-1 bg-gray-100 rounded-xl">
                      {([
                        { v: "all", l: "Todos os pratos" }, { v: "some", l: "Só em alguns" }, { v: "none", l: "Não dividir" },
                      ] as const).map(o => (
                        <button key={o.v}
                          onClick={() => {
                            if (o.v === "some") { setPickFor(it); return; }
                            saveItemRule(it, o.v, r?.product_ids ?? []);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${mode === o.v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pickFor && (
        <PickProducts item={pickFor} products={activeProducts} catName={catName}
          initial={itemRules.get(pickFor.id)?.product_ids ?? []}
          onClose={() => setPickFor(null)}
          onSave={ids => { saveItemRule(pickFor, "some", ids); setPickFor(null); }} />
      )}
    </div>
  );
}

function PickProducts({ item, products, catName, initial, onClose, onSave }: {
  item: StockItem; products: Product[]; catName: (id: string | null) => string; initial: string[];
  onClose: () => void; onSave: (ids: string[]) => void;
}) {
  useEscapeKey(onClose, true);
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [q, setQ] = useState("");
  const list = products.filter(p => !q || matchesSearch(p.name, q) || matchesSearch(catName(p.category_id), q));
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100 flex items-start gap-2">
          <div className="flex-1">
            <p className="font-bold text-gray-900">{item.name} vai em quais produtos?</p>
            <p className="text-xs text-gray-500">O custo é dividido só entre os marcados, pelo que cada um vendeu.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3 border-b border-gray-100">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar produto..." className={fieldCls} autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {list.map(p => (
            <label key={p.id} className="flex items-center gap-2 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4 accent-brand-600" />
              <span className="flex-1 truncate text-gray-800">{p.name}</span>
              <span className="text-[11px] text-gray-400 truncate max-w-[40%]">{catName(p.category_id)}</span>
            </label>
          ))}
        </div>
        <div className="p-3 border-t border-gray-100 flex items-center gap-2">
          <span className="text-xs text-gray-500 flex-1">{sel.size} selecionado{sel.size === 1 ? "" : "s"}</span>
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button onClick={() => onSave([...sel])} disabled={sel.size === 0} className={btnPrimary} style={WHITE}><Check className="w-4 h-4" /> Salvar</button>
        </div>
      </div>
    </div>
  );
}
