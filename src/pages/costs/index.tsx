import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { fetchAll, fetchAllIn } from "../../lib/fetchAll";
import { PURCHASE_PAY_METHODS } from "../purchases/PurchaseScreen";
import {
  RefreshCw, PiggyBank, ShoppingBasket, Plus, Trash2, Check, ChevronDown, TrendingUp, TrendingDown, UtensilsCrossed, CupSoda,
} from "lucide-react";

// Custo e Lucro (modelo simples): tudo que é lançado em compras de insumos vira
// o custo da cozinha, dividido entre os pratos vendidos na proporção do preço
// de venda (a G leva mais que a P). Bebidas/revenda: venda − preço pago.
// Escolhas de R$ 0,00 dentro da marmita e a taxa de entrega ficam de fora.
// Só lê vendas/compras; grava compras pelo mesmo register_purchase da aba
// Compras e, opcionalmente, o que sobrou no fim do período (cost_counts).

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface StockItem { id: string; name: string; unit: string; cost_price: number | null; is_active: boolean | null }
interface Product { id: string; name: string; sale_price: number | null; cost_price: number | null; category_id: string | null; is_active: boolean | null }
interface Category { id: string; name: string }
interface Count { stock_item_id: string; count_date: string; qty: number }
interface PurchaseLine { day: string; stock_item_id: string | null; product_id: string | null; qty: number; cost: number }
interface SaleLine { day: string; product_id: string; qty: number; revenue: number }

type View = "result" | "buy";
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

// Bebida/revenda: categoria ou nome de bebida, ou produto comprado pronto (compra de produto)
const DRINK_RX = /bebida|refri|refrigerante|coca|guaran|fanta|sprite|soda|suco|água|agua|cerveja|chopp|vinho|energ|lata\b|\b600 ?ml|\b2 ?l\b/i;
// Taxa de entrega lançada como produto: não é comida nem lucro da cozinha
const DELIVERY_RX = /entrega|frete|taxa de servi/i;

// ─── Cálculo ──────────────────────────────────────────────────────────────────

interface ItemResult {
  item: StockItem;
  boughtQty: number; boughtCost: number; avg: number;
  opening: number | null; closing: number | null;
  usedQty: number; usedCost: number;
  perDish: number;      // quantidade estimada por prato vendido
  perDishCost: number;  // R$ por prato vendido
}
interface ProductResult {
  product: Product; kind: "food" | "resale";
  qty: number; revenue: number; cost: number; hasCost: boolean;
  listPrice: number;   // preço do cadastro (ou a média vendida, se o produto não tem preço)
  avgPrice: number;    // média do que entrou no caixa (descontos, preços alterados)
}
interface Result {
  items: ItemResult[]; food: ProductResult[]; resale: ProductResult[];
  foodRevenue: number; foodCost: number; dishes: number;
  resaleRevenue: number; resaleCost: number;
  bought: number; deliveryFees: number;
}

function compute(
  from: string, to: string,
  purchases: PurchaseLine[], sales: SaleLine[], counts: Count[],
  stockItems: StockItem[], products: Product[], catName: (id: string | null) => string,
): Result {
  const inRange = (d: string) => d >= from && d <= to;
  const itemById = new Map(stockItems.map(i => [i.id, i]));
  const productById = new Map(products.map(p => [p.id, p]));

  // Produtos comprados prontos (revenda) e o preço médio pago por eles
  const resaleBought = new Map<string, { qty: number; cost: number }>();
  for (const p of purchases) {
    if (!p.product_id) continue;
    const cur = resaleBought.get(p.product_id) ?? { qty: 0, cost: 0 };
    cur.qty += p.qty; cur.cost += p.qty * p.cost;
    resaleBought.set(p.product_id, cur);
  }

  // Vendas por produto (só o que teve preço; escolhas de R$ 0,00 ficam de fora)
  const sold = new Map<string, { qty: number; revenue: number }>();
  let deliveryFees = 0;
  for (const s of sales) {
    if (!inRange(s.day)) continue;
    const prod = productById.get(s.product_id);
    if (!prod) continue;
    if (DELIVERY_RX.test(prod.name)) { deliveryFees += s.revenue; continue; }
    if (s.revenue <= 0.0001) continue;
    const cur = sold.get(s.product_id) ?? { qty: 0, revenue: 0 };
    cur.qty += s.qty; cur.revenue += s.revenue;
    sold.set(s.product_id, cur);
  }

  const isResale = (p: Product) =>
    DRINK_RX.test(catName(p.category_id)) || DRINK_RX.test(p.name) || resaleBought.has(p.id);

  const food: ProductResult[] = [], resale: ProductResult[] = [];
  for (const [pid, s] of sold) {
    const product = productById.get(pid)!;
    if (isResale(product)) {
      const b = resaleBought.get(pid);
      const unitCost = b && b.qty > 0 ? b.cost / b.qty : Number(product.cost_price ?? 0);
      const avgPrice = s.qty > 0 ? s.revenue / s.qty : 0;
      resale.push({ product, kind: "resale", qty: s.qty, revenue: s.revenue, cost: unitCost * s.qty, hasCost: unitCost > 0,
        listPrice: Number(product.sale_price ?? 0) > 0 ? Number(product.sale_price) : avgPrice, avgPrice });
    } else {
      const avgPrice = s.qty > 0 ? s.revenue / s.qty : 0;
      food.push({ product, kind: "food", qty: s.qty, revenue: s.revenue, cost: 0, hasCost: true,
        listPrice: Number(product.sale_price ?? 0) > 0 ? Number(product.sale_price) : avgPrice, avgPrice });
    }
  }
  const foodRevenue = food.reduce((x, p) => x + p.revenue, 0);
  // Pratos = itens de comida com preço de prato (adicional de R$ 5 não conta como marmita)
  const maxPrice = Math.max(0, ...food.map(p => p.listPrice));
  const dishes = food.filter(p => p.qty > 0 && p.listPrice >= maxPrice * 0.4).reduce((x, p) => x + p.qty, 0);

  // Compras de insumos (± o que sobrou) = custo da cozinha
  const bought = new Map<string, { qty: number; cost: number }>();
  let totalBought = 0;
  for (const p of purchases) {
    if (!p.stock_item_id || !inRange(p.day)) continue;
    const cur = bought.get(p.stock_item_id) ?? { qty: 0, cost: 0 };
    cur.qty += p.qty; cur.cost += p.qty * p.cost;
    bought.set(p.stock_item_id, cur);
    totalBought += p.qty * p.cost;
  }
  for (const p of purchases) if (p.product_id && inRange(p.day)) totalBought += p.qty * p.cost;
  const openDay = addDays(from, -1);
  const countOf = (id: string, day: string) => counts.find(c => c.stock_item_id === id && c.count_date === day)?.qty ?? null;
  const ids = new Set<string>([...bought.keys(), ...counts.filter(c => c.count_date === openDay || c.count_date === to).map(c => c.stock_item_id)]);

  const items: ItemResult[] = [];
  for (const id of ids) {
    const item = itemById.get(id);
    if (!item) continue;
    const b = bought.get(id) ?? { qty: 0, cost: 0 };
    const avg = b.qty > 0 ? b.cost / b.qty : Number(item.cost_price ?? 0);
    const opening = countOf(id, openDay), closing = countOf(id, to);
    const usedQty = Math.max(0, (opening ?? 0) + b.qty - (closing ?? 0));
    const usedCost = Math.max(0, b.cost + ((opening ?? 0) - (closing ?? 0)) * avg);
    items.push({
      item, boughtQty: b.qty, boughtCost: b.cost, avg, opening, closing, usedQty, usedCost,
      perDish: dishes > 0 ? usedQty / dishes : 0, perDishCost: dishes > 0 ? usedCost / dishes : 0,
    });
  }
  items.sort((a, b) => b.usedCost - a.usedCost);
  const foodCost = items.reduce((x, i) => x + i.usedCost, 0);

  // Divide o custo da cozinha entre os pratos pelo preço do cadastro × quantidade
  // (a G leva mais que a P; preço alterado numa venda não distorce o custo)
  const weightTotal = food.reduce((x, p) => x + p.qty * p.listPrice, 0);
  for (const p of food) p.cost = weightTotal > 0 ? foodCost * (p.qty * p.listPrice) / weightTotal : 0;
  food.sort((a, b) => b.revenue - a.revenue);
  resale.sort((a, b) => b.revenue - a.revenue);

  return {
    items, food, resale, foodRevenue, foodCost, dishes,
    resaleRevenue: resale.reduce((x, p) => x + p.revenue, 0),
    resaleCost: resale.reduce((x, p) => x + p.cost, 0),
    bought: totalBought, deliveryFees,
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

  async function loadBase() {
    const [{ data: u }, si, pr, ca, su] = await Promise.all([
      supabase.auth.getUser(),
      fetchAll(() => supabase.from("stock_items").select("id, name, unit, cost_price, is_active")),
      fetchAll(() => supabase.from("products").select("id, name, sale_price, cost_price, category_id, is_active")),
      fetchAll(() => supabase.from("categories").select("id, name")),
      fetchAll(() => supabase.from("suppliers").select("id, name")),
    ]);
    setUid(u.user?.id ?? null);
    setStockItems((si.data as StockItem[]).sort((a, b) => a.name.localeCompare(b.name)));
    setProducts((pr.data as Product[]).sort((a, b) => a.name.localeCompare(b.name)));
    setCategories(ca.data as Category[]);
    setSuppliers((su.data as any[]).sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  }
  useEffect(() => { loadBase(); }, []);

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
          <p className="text-xs text-gray-500 mt-0.5">Lance as compras do dia; o sistema cruza com as vendas e mostra o custo e o lucro de cada marmita.</p>
        </div>
        <div className="flex p-1 bg-gray-200/60 rounded-xl">
          {([
            { key: "result", label: "Resultado", icon: <PiggyBank className="w-4 h-4" /> },
            { key: "buy", label: "Lançar compras", icon: <ShoppingBasket className="w-4 h-4" /> },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`flex flex-1 md:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${view === t.key ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {view === "result" && <ResultView stockItems={stockItems} products={products} categories={categories} uid={uid} goBuy={() => setView("buy")} />}
      {view === "buy" && <BuyView stockItems={stockItems} suppliers={suppliers} uid={uid} onItemsChanged={loadBase} />}
    </div>
  );
}

// ─── Resultado ────────────────────────────────────────────────────────────────

function ResultView({ stockItems, products, categories, uid, goBuy }: {
  stockItems: StockItem[]; products: Product[]; categories: Category[]; uid: string | null; goBuy: () => void;
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
  const [leftoverOpen, setLeftoverOpen] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    const fromISO = startISO(range.prevFrom), toISO = endISO(range.to);
    const [po, sa, co] = await Promise.all([
      // Compra conta no dia em que a mercadoria chegou (received_at)
      fetchAll(() => supabase.from("purchase_orders")
        .select("id, status, created_at, received_at, purchase_order_items(stock_item_id, product_id, quantity, unit_cost)")
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
        if (!it.stock_item_id && !it.product_id) continue;
        lines.push({ day, stock_item_id: it.stock_item_id ?? null, product_id: it.product_id ?? null, qty: Number(it.quantity) || 0, cost: Number(it.unit_cost) || 0 });
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

  const catName = useMemo(() => {
    const m = new Map(categories.map(c => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? "" : "");
  }, [categories]);
  const cur = useMemo(() => compute(range.from, range.to, purchases, sales, counts, stockItems, products, catName),
    [range, purchases, sales, counts, stockItems, products, catName]);
  const prev = useMemo(() => compute(range.prevFrom, range.prevTo, purchases, sales, counts, stockItems, products, catName),
    [range, purchases, sales, counts, stockItems, products, catName]);
  const prevPerDish = new Map(prev.items.map(i => [i.item.id, i.perDish]));

  const foodProfit = cur.foodRevenue - cur.foodCost;
  const resaleProfit = cur.resaleRevenue - cur.resaleCost;
  const revenue = cur.foodRevenue + cur.resaleRevenue;
  const profit = foodProfit + resaleProfit;
  const pct = (a: number, b: number) => (b > 0 ? `${fmtNum((a / b) * 100, 0)}%` : "—");

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
            <Kpi label="Vendeu" value={fmt(revenue)} sub={`${fmtNum(cur.dishes, 0)} pratos · sem taxa de entrega`} />
            <Kpi label="Custo" value={fmt(cur.foodCost + cur.resaleCost)} sub={`compras no período: ${fmt(cur.bought)}`} />
            <Kpi label="Lucro" value={fmt(profit)} tone={profit >= 0 ? "green" : "red"} sub={`margem de ${pct(profit, revenue)}`} />
            <Kpi label="Custo por prato" value={cur.dishes > 0 ? fmt(cur.foodCost / cur.dishes) : "—"}
              sub={cur.dishes > 0 ? `vende em média por ${fmt(cur.foodRevenue / cur.dishes)}` : "sem pratos vendidos"} />
          </div>

          {cur.foodCost === 0 && cur.foodRevenue > 0 && (
            <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-900">
              <p className="flex-1">Nenhuma compra de mercado/fornecedor lançada neste período, então o custo da comida está zerado.</p>
              <button onClick={goBuy} className={btnPrimary + " !py-2"} style={WHITE}>Lançar compras</button>
            </div>
          )}

          {/* Comida x Bebidas */}
          <div className={card}>
            <div className="px-4 pt-4 pb-2">
              <p className="text-sm font-bold text-gray-900">Resumo</p>
            </div>
            <div className="divide-y divide-gray-100">
              <div className="hidden md:grid grid-cols-[1fr_120px_120px_120px_70px] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <span /><span className="text-right">Vendeu</span><span className="text-right">Custo</span><span className="text-right">Lucro</span><span className="text-right">Margem</span>
              </div>
              {[
                { icon: <UtensilsCrossed className="w-4 h-4 text-brand-600" />, label: "Comida", r: cur.foodRevenue, c: cur.foodCost },
                { icon: <CupSoda className="w-4 h-4 text-brand-600" />, label: "Bebidas e revenda", r: cur.resaleRevenue, c: cur.resaleCost },
              ].map(row => (
                <div key={row.label} className="px-4 py-3 grid grid-cols-2 md:grid-cols-[1fr_120px_120px_120px_70px] gap-x-2 gap-y-1 items-center">
                  <span className="col-span-2 md:col-span-1 flex items-center gap-2 font-semibold text-sm text-gray-900">{row.icon}{row.label}</span>
                  <Cell label="Vendeu" value={fmt(row.r)} />
                  <Cell label="Custo" value={fmt(row.c)} />
                  <Cell label="Lucro" value={fmt(row.r - row.c)} tone={row.r - row.c >= 0 ? "green" : "red"} bold />
                  <Cell label="Margem" value={pct(row.r - row.c, row.r)} />
                </div>
              ))}
              <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-[1fr_120px_120px_120px_70px] gap-x-2 gap-y-1 items-center bg-gray-50 rounded-b-2xl">
                <span className="col-span-2 md:col-span-1 font-bold text-sm text-gray-900">Total</span>
                <Cell label="Vendeu" value={fmt(revenue)} bold />
                <Cell label="Custo" value={fmt(cur.foodCost + cur.resaleCost)} bold />
                <Cell label="Lucro" value={fmt(profit)} tone={profit >= 0 ? "green" : "red"} bold />
                <Cell label="Margem" value={pct(profit, revenue)} bold />
              </div>
            </div>
            {cur.deliveryFees > 0 && (
              <p className="px-4 py-2 text-[11px] text-gray-400">Taxas de entrega recebidas ({fmt(cur.deliveryFees)}) não entram no lucro: costumam ir para o motoboy.</p>
            )}
          </div>

          {/* Por unidade */}
          <div className={card}>
            <div className="px-4 pt-4 pb-2">
              <p className="text-sm font-bold text-gray-900">Custo e lucro de cada um</p>
              <p className="text-[11px] text-gray-400">"Vende por" é o preço do cadastro; "média" aparece quando o caixa recebeu diferente (desconto ou preço alterado). O lucro total usa o que realmente entrou. Pratos: o custo das compras é dividido pelo preço de cada um (a G leva mais que a P). Bebidas: preço pago na compra.</p>
            </div>
            {cur.food.length + cur.resale.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-gray-500">Nenhuma venda no período.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                <div className="hidden md:grid grid-cols-[1fr_70px_110px_110px_110px_110px] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  <span>Produto</span><span className="text-right">Vendidos</span><span className="text-right">Vende por</span><span className="text-right">Custo cada</span>
                  <span className="text-right">Lucro cada</span><span className="text-right">Lucro total</span>
                </div>
                {[...cur.food, ...cur.resale].map((p, idx, all) => {
                  const price = p.listPrice, each = p.qty > 0 ? p.cost / p.qty : 0;
                  const avgDiffers = p.avgPrice > 0 && Math.abs(p.avgPrice - price) / Math.max(price, 0.01) > 0.01;
                  const firstResale = p.kind === "resale" && (idx === 0 || all[idx - 1].kind === "food");
                  return (
                    <div key={p.product.id}>
                      {firstResale && <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Bebidas e revenda</p>}
                      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-[1fr_70px_110px_110px_110px_110px] gap-x-2 gap-y-1 items-center">
                        <span className="col-span-2 md:col-span-1 font-semibold text-sm text-gray-900 truncate">
                          {p.product.name}
                          {!p.hasCost && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">sem preço de compra</span>}
                        </span>
                        <Cell label="Vendidos" value={fmtNum(p.qty, 2)} />
                        <span className="flex md:block items-center justify-between md:text-right text-xs tabular-nums">
                          <span className="md:hidden text-gray-400">Vende por</span>
                          <span className="font-semibold text-gray-800">{fmt(price)}
                            {avgDiffers && <span className="block text-[10px] font-normal text-gray-400" title="Média do que entrou no caixa (descontos ou preço alterado na venda)">média {fmt(p.avgPrice)}</span>}
                          </span>
                        </span>
                        <Cell label="Custo cada" value={p.hasCost ? fmt(each) : "—"} />
                        <Cell label="Lucro cada" value={p.hasCost ? fmt(price - each) : "—"} tone={p.hasCost ? (price - each >= 0 ? "green" : "red") : undefined} bold />
                        <Cell label="Lucro total" value={p.hasCost ? fmt(p.revenue - p.cost) : "—"} tone={p.hasCost ? (p.revenue - p.cost >= 0 ? "green" : "red") : undefined} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Por compra */}
          <div className={card}>
            <div className="px-4 pt-4 pb-2">
              <p className="text-sm font-bold text-gray-900">Para onde foi o dinheiro das compras</p>
              <p className="text-[11px] text-gray-400">"Por prato" é a média: total comprado ÷ pratos vendidos. Se subir muito sem você mudar nada, tem porção maior, desperdício ou sumiço.</p>
            </div>
            {cur.items.length === 0 ? (
              <div className="px-4 pb-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-gray-500 flex-1">Nenhuma compra lançada no período.</p>
                <button onClick={goBuy} className={btnGhost + " !py-2"}><Plus className="w-4 h-4" /> Lançar compras</button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {cur.items.map(r => {
                  const before = prevPerDish.get(r.item.id) ?? 0;
                  const change = before > 0 && r.perDish > 0 ? ((r.perDish - before) / before) * 100 : null;
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
                      </div>
                      <div className="flex items-center gap-3 md:gap-5 text-xs">
                        {cur.dishes > 0 && (
                          <span className="text-gray-700"><span className="text-gray-400">por prato </span><b className="tabular-nums">{portionText(r.perDish, r.item.unit)}</b> · {fmt(r.perDishCost)}</span>
                        )}
                        {change !== null && Math.abs(change) >= 5 && (
                          <span className={`inline-flex items-center gap-0.5 font-bold ${change > 0 ? "text-red-600" : "text-emerald-600"}`}
                            title={`Antes: ${portionText(before, r.item.unit)} por prato`}>
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

function BuyView({ stockItems, suppliers, uid, onItemsChanged }: {
  stockItems: StockItem[]; suppliers: { id: string; name: string }[]; uid: string | null;
  onItemsChanged: () => Promise<void>;
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
            ✓ {done}. Já entrou no estoque, em Contas a Pagar e no Resultado.
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
