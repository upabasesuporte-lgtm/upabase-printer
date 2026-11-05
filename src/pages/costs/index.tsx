import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { fetchAll, fetchAllIn } from "../../lib/fetchAll";
import { PURCHASE_PAY_METHODS } from "../purchases/PurchaseScreen";
import {
  RefreshCw, PiggyBank, ShoppingBasket, Plus, Trash2, Check, ChevronDown, TrendingUp, TrendingDown, UtensilsCrossed, CupSoda, Pencil, X, ScanLine, ClipboardPaste, Camera, ExternalLink, Wallet, Receipt,
} from "lucide-react";
import { parseNfceText, nfceUnit } from "../../lib/nfceText";

// Custo e Lucro (modelo simples): tudo que é lançado em compras de insumos vira
// o custo da cozinha, dividido entre os pratos vendidos na proporção do preço
// de venda (a G leva mais que a P). Bebidas/revenda: venda − preço pago.
// Escolhas de R$ 0,00 dentro da marmita e a taxa de entrega ficam de fora.
// Só lê vendas/compras; grava compras pelo mesmo register_purchase da aba
// Compras e, opcionalmente, o que sobrou no fim do período (cost_counts).

// ─── Tipos ────────────────────────────────────────────────────────────────────

// category: "bebida" = fica fora do custo do prato; "cozinha" = entra; vazio = o sistema decide pelo nome
interface StockItem { id: string; name: string; unit: string; cost_price: number | null; is_active: boolean | null; category?: string | null }
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
// Insumo que é bebida (comprado no mercado junto com a comida): não entra no custo
// do prato, vira o custo da bebida vendida. Mais estrito que DRINK_RX para não
// pegar "milho lata", "leite", "água sanitária"…
const STOCK_DRINK_RX = /refri|refrigerante|coca[\s-]?cola|\bcoca\b|guaran[aá]|fanta|sprite|pepsi|kuat|schweppes|tubaina|itubaina|dolly|vencetex|cerveja|chopp|energ[eé]tico|red ?bull|monster|[aá]gua (mineral|com g[aá]s|sem g[aá]s)|\bh2oh?\b|del valle|suco .*(lata|caixa|cx|garrafa|\d+ ?ml)/i;
const autoDrinkName = (name: string) => STOCK_DRINK_RX.test(name);
const isDrinkItem = (i: { name: string; category?: string | null }) =>
  i.category === "bebida" ? true : i.category === "cozinha" ? false : autoDrinkName(i.name);
// Liga o produto vendido ("ZERO LATA") ao insumo comprado ("COCA COLA LATA ZERO")
const GENERIC_TOKENS = new Set(["de", "da", "do", "com", "sem", "lata", "pet", "garrafa", "refri", "refrigerante", "ml", "l", "un", "und"]);
const tokens = (t: string) => norm(t).split(/[^a-z0-9]+/).filter(w => w.length >= 2 || /\d/.test(w));
function matchDrinkItem(productName: string, items: StockItem[]): StockItem | null {
  const pt = tokens(productName);
  if (pt.length === 0) return null;
  let best: StockItem | null = null, bestScore = -Infinity;
  for (const it of items) {
    const it_t = new Set(tokens(it.name));
    const all = pt.every(w => it_t.has(w));
    // Tamanho (2l, 350ml) sozinho não liga: "VENCETEX 2L" não é "COCA COLA 2L"
    const shared = pt.filter(w => !GENERIC_TOKENS.has(w) && !/^\d+([.,]\d+)?(ml|l)$/.test(w) && it_t.has(w)).length;
    if (!all && shared === 0) continue;
    // Todos os termos batendo vale mais; depois, menos sobra no nome do insumo
    const score = (all ? 1000 : 0) + shared * 10 - (it_t.size - pt.filter(w => it_t.has(w)).length);
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
}

// Taxa de entrega lançada como produto: não é comida nem lucro da cozinha
const DELIVERY_RX = /entrega|frete|taxa de servi/i;

// Contas a Pagar pagas no período: comida comprada por lá (mercado, verdura…) e
// despesas do negócio (combustível, aluguel…). Contas geradas por compra lançada
// (purchase_order_id) já estão no custo e não entram de novo; conta pessoal fica de fora.
interface PaidBill { category: string; value: number }
const FOOD_BILL_RX = /aliment|mercado|verdura|legume|hortifruti|feira|embalag|g[aá]s|carne|a[cç]ougue|fornecedor|bebida|padaria|frango|peixe/i;
const PERSONAL_BILL_RX = /pessoal/i;
const BILL_LABEL: Record<string, string> = {
  alimentacao: "Alimentação", transporte: "Transporte / combustível", aluguel: "Aluguel", utilities: "Contas (luz, água, internet)",
  saude: "Saúde", salarios: "Salários", impostos: "Impostos", marketing: "Marketing", fornecedores: "Fornecedores",
  manutencao: "Manutenção", escritorio: "Escritório", outros: "Outros",
};
const BUY_CAT_KEY = "costs_buy_category";
const billLabel = (k: string) => BILL_LABEL[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ") : "Sem categoria");

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

  // Bebidas compradas como insumo (no mercado): preço médio pago por unidade
  const drinkItems = stockItems.filter(i => isDrinkItem(i) && !/fardo|caixa|pacote|d[uú]zia/i.test(i.unit));
  const drinkBought = new Map<string, { qty: number; cost: number }>();
  for (const p of purchases) {
    if (!p.stock_item_id || !drinkItems.some(i => i.id === p.stock_item_id)) continue;
    const cur = drinkBought.get(p.stock_item_id) ?? { qty: 0, cost: 0 };
    cur.qty += p.qty; cur.cost += p.qty * p.cost;
    drinkBought.set(p.stock_item_id, cur);
  }
  const drinkUnitCost = (prod: Product): number => {
    const it = matchDrinkItem(prod.name, drinkItems.filter(i => drinkBought.has(i.id)));
    const b = it ? drinkBought.get(it.id) : undefined;
    return b && b.qty > 0 ? b.cost / b.qty : 0;
  };

  const food: ProductResult[] = [], resale: ProductResult[] = [];
  for (const [pid, s] of sold) {
    const product = productById.get(pid)!;
    if (isResale(product)) {
      const b = resaleBought.get(pid);
      const unitCost = b && b.qty > 0 ? b.cost / b.qty : drinkUnitCost(product) || Number(product.cost_price ?? 0);
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
    if (!item || isDrinkItem(item)) continue;
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
      fetchAll(() => supabase.from("stock_items").select("id, name, unit, cost_price, is_active, category")),
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
  const [bills, setBills] = useState<PaidBill[]>([]);

  async function load() {
    setLoading(true); setError(null);
    const fromISO = startISO(range.prevFrom), toISO = endISO(range.to);
    const [po, sa, co, ap] = await Promise.all([
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
      fetchAll(() => supabase.from("accounts_payable").select("id, category, paid_amount, amount, purchase_order_id")
        .eq("status", "paid").is("purchase_order_id", null)
        .gte("paid_date", range.from).lte("paid_date", range.to)),
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
    setBills(ap.error ? [] : (ap.data as any[]).map(b => ({ category: String(b.category ?? ""), value: Number(b.paid_amount ?? b.amount ?? 0) })));
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

  // Lucro líquido: lucro da comida e bebidas − compras de comida feitas por Contas a Pagar − despesas
  const billGroups = useMemo(() => {
    const food = new Map<string, number>(), expense = new Map<string, number>();
    let personal = 0;
    for (const b of bills) {
      if (PERSONAL_BILL_RX.test(b.category)) { personal += b.value; continue; }
      const m = FOOD_BILL_RX.test(b.category) ? food : expense;
      m.set(b.category, (m.get(b.category) ?? 0) + b.value);
    }
    const sum = (m: Map<string, number>) => [...m.values()].reduce((x, v) => x + v, 0);
    const list = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { food: list(food), foodTotal: sum(food), expense: list(expense), expenseTotal: sum(expense), personal };
  }, [bills]);
  const netProfit = profit - billGroups.foodTotal - billGroups.expenseTotal;
  // Para explicar o lucro: de cada R$ 100 vendidos, quanto foi para cada lado
  const goodsCost = cur.foodCost + cur.resaleCost + billGroups.foodTotal;
  const per100 = (v: number) => (revenue > 0 ? (v / revenue) * 100 : 0);
  const prevProfit = prev.foodRevenue + prev.resaleRevenue - prev.foodCost - prev.resaleCost;
  const prevRevenue = prev.foodRevenue + prev.resaleRevenue;
  const dishCost = cur.dishes > 0 ? cur.foodCost / cur.dishes : 0;
  const dishPrice = cur.dishes > 0 ? cur.foodRevenue / cur.dishes : 0;
  const prevDishCost = prev.dishes > 0 ? prev.foodCost / prev.dishes : 0;
  const change = (now: number, before: number) =>
    before > 0 ? `${now >= before ? "+" : ""}${fmtNum(((now - before) / before) * 100, 0)}%` : "—";
  const profitChange = prevProfit > 0 ? ((profit - prevProfit) / prevProfit) * 100 : null;
  const topExpense = billGroups.expense[0];
  const maxItemCost = Math.max(0.01, ...cur.items.map(i => i.usedCost));
  const itemsTotal = cur.items.reduce((x, i) => x + i.usedCost, 0);

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
          {/* Resumo: cartões */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-1">
            <StatCard tone="sky" icon={Wallet} label="Vendeu" value={fmt(revenue)}
              rating={fmtNum(cur.dishes, 0)} ratingLabel="pratos"
              stats={[
                { l: "Ticket", v: cur.dishes > 0 ? fmt(cur.foodRevenue / cur.dishes) : "—" },
                { l: "Bebidas", v: fmt(cur.resaleRevenue) },
                { l: "vs ant.", v: change(revenue, prevRevenue) },
              ]} />
            <StatCard tone="amber" icon={ShoppingBasket} label="Custo" value={fmt(cur.foodCost + cur.resaleCost)}
              rating={pct(cur.foodCost + cur.resaleCost, revenue)} ratingLabel="da venda"
              stats={[
                { l: "Comida", v: fmt(cur.foodCost) },
                { l: "Bebidas", v: fmt(cur.resaleCost) },
                { l: "Compras", v: fmt(cur.bought) },
              ]} />
            <StatCard tone={profit >= 0 ? "emerald" : "red"} icon={TrendingUp} label="Lucro" value={fmt(profit)}
              rating={pct(profit, revenue)} ratingLabel="margem"
              stats={[
                { l: "Por prato", v: cur.dishes > 0 ? fmt(foodProfit / cur.dishes) : "—" },
                { l: "Comida", v: fmt(foodProfit) },
                { l: "vs ant.", v: change(profit, prevProfit) },
              ]} />
            <StatCard tone="violet" icon={UtensilsCrossed} label="Custo por prato" value={dishCost > 0 ? fmt(dishCost) : "—"}
              rating={dishPrice > 0 && dishCost > 0 ? pct(dishCost, dishPrice) : "—"} ratingLabel="do preço"
              tier={dishPrice > 0 && dishCost > 0 ? (dishCost / dishPrice <= 0.35 ? "ouro" : dishCost / dishPrice <= 0.45 ? "prata" : "bronze") : undefined}
              tierTitle="Custo do prato ÷ preço de venda. Até 35% = ouro, até 45% = prata, acima = bronze (restaurantes costumam mirar 30–35%)."
              stats={[
                { l: "Vende por", v: dishPrice > 0 ? fmt(dishPrice) : "—" },
                { l: "Sobra", v: dishPrice > 0 ? fmt(dishPrice - dishCost) : "—" },
                { l: "vs ant.", v: change(dishCost, prevDishCost) },
              ]} />
          </div>

          {cur.foodCost === 0 && cur.foodRevenue > 0 && (
            <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-900">
              <p className="flex-1">Nenhuma compra de mercado/fornecedor lançada neste período, então o custo da comida está zerado.</p>
              <button onClick={goBuy} className={btnPrimary + " !py-2"} style={WHITE}>Lançar compras</button>
            </div>
          )}

          {/* Comida x Bebidas */}
          <div className={`${card} p-4 space-y-3`}>
            <SectionTitle title="Resumo" sub="Quanto entrou, quanto custou e quanto ficou de cada lado." />
            <div className="grid md:grid-cols-2 gap-3">
              {[
                { icon: <UtensilsCrossed className="w-4 h-4" />, label: "Comida", r: cur.foodRevenue, c: cur.foodCost },
                { icon: <CupSoda className="w-4 h-4" />, label: "Bebidas e revenda", r: cur.resaleRevenue, c: cur.resaleCost },
              ].map(row => {
                const pr = row.r - row.c;
                return (
                  <div key={row.label} className="rounded-2xl border border-gray-100 bg-gradient-to-br from-white to-gray-50 p-3.5 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">{row.icon}</span>
                      <p className="flex-1 font-bold text-sm text-gray-900">{row.label}</p>
                      <MarginBadge value={row.r > 0 ? (pr / row.r) * 100 : null} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Vendeu" value={fmt(row.r)} tone="sky" />
                      <Stat label="Custo" value={fmt(row.c)} tone="amber" />
                      <Stat label="Lucro" value={fmt(pr)} tone={pr >= 0 ? "emerald" : "red"} />
                    </div>
                    <SplitBar parts={[{ v: row.c, cls: "bg-amber-400", label: "custo" }, { v: Math.max(0, pr), cls: "bg-emerald-500", label: "lucro" }]} />
                  </div>
                );
              })}
            </div>
            <div className="rounded-2xl bg-gradient-to-r from-sky-50 via-white to-emerald-50 border border-gray-100 p-3.5 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total vendido" value={fmt(revenue)} tone="sky" big />
              <Stat label="Custo total" value={fmt(cur.foodCost + cur.resaleCost)} tone="amber" big />
              <Stat label="Lucro total" value={fmt(profit)} tone={profit >= 0 ? "emerald" : "red"} big />
              <Stat label="Margem" value={pct(profit, revenue)} tone="violet" big />
            </div>
            {cur.deliveryFees > 0 && (
              <p className="text-[11px] text-gray-400">Taxas de entrega recebidas ({fmt(cur.deliveryFees)}) não entram no lucro: costumam ir para o motoboy.</p>
            )}
          </div>

          {/* Por unidade */}
          <div className={`${card} p-4 space-y-3`}>
            <SectionTitle title="Custo e lucro de cada um"
              sub={'"Vende por" é o preço do cadastro; "média" aparece quando o caixa recebeu diferente (desconto ou preço alterado). O lucro total usa o que realmente entrou. Pratos: o custo das compras é dividido pelo preço de cada um (a G leva mais que a P). Bebidas: preço pago na compra.'} />
            {cur.food.length + cur.resale.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhuma venda no período.</p>
            ) : (
              <div className="space-y-4">
                {([["Pratos", <UtensilsCrossed key="i" className="w-3.5 h-3.5" />, cur.food], ["Bebidas e revenda", <CupSoda key="i" className="w-3.5 h-3.5" />, cur.resale]] as const)
                  .filter(([, , list]) => list.length > 0).map(([title, icon, list]) => (
                  <div key={title} className="space-y-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{icon}{title}</p>
                    <div className="hidden md:grid grid-cols-[1fr_80px_110px_100px_100px_120px] gap-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      <span>Produto</span><span className="text-right">Vendidos</span><span className="text-right">Vende por</span><span className="text-right">Custo cada</span>
                      <span className="text-right">Lucro cada</span><span className="text-right">Lucro total</span>
                    </div>
                    {list.map(pr => {
                      const price = pr.listPrice, each = pr.qty > 0 ? pr.cost / pr.qty : 0;
                      const avgDiffers = pr.avgPrice > 0 && Math.abs(pr.avgPrice - price) / Math.max(price, 0.01) > 0.01;
                      const totalProfit = pr.revenue - pr.cost;
                      return (
                        <div key={pr.product.id} className="rounded-xl border border-gray-100 hover:border-gray-200 bg-white px-3 py-2.5 grid grid-cols-2 md:grid-cols-[1fr_80px_110px_100px_100px_120px] gap-x-2 gap-y-1.5 items-center transition-colors">
                          <div className="col-span-2 md:col-span-1 min-w-0 space-y-1">
                            <p className="font-semibold text-sm text-gray-900 truncate">
                              {pr.product.name}
                              {!pr.hasCost && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">sem preço de compra</span>}
                            </p>
                            {pr.hasCost && price > 0 && (
                              <div className="flex items-center gap-2 max-w-[260px]">
                                <SplitBar thin parts={[{ v: Math.min(each, price), cls: "bg-amber-400" }, { v: Math.max(0, price - each), cls: "bg-emerald-500" }]} />
                                <span className={`text-[10px] font-bold tabular-nums ${price - each >= 0 ? "text-emerald-600" : "text-red-600"}`}>{pct(price - each, price)}</span>
                              </div>
                            )}
                          </div>
                          <span className="flex md:block items-center justify-between md:text-right text-xs">
                            <span className="md:hidden text-gray-400">Vendidos</span>
                            <span className="inline-block px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 font-bold tabular-nums">{fmtNum(pr.qty, 2)}×</span>
                          </span>
                          <span className="flex md:block items-center justify-between md:text-right text-xs tabular-nums">
                            <span className="md:hidden text-gray-400">Vende por</span>
                            <span className="font-semibold text-sky-700">{fmt(price)}
                              {avgDiffers && <span className="block text-[10px] font-normal text-gray-400" title="Média do que entrou no caixa (descontos ou preço alterado na venda)">média {fmt(pr.avgPrice)}</span>}
                            </span>
                          </span>
                          <Cell label="Custo cada" value={pr.hasCost ? fmt(each) : "—"} tone={pr.hasCost ? "amber" : undefined} />
                          <Cell label="Lucro cada" value={pr.hasCost ? fmt(price - each) : "—"} tone={pr.hasCost ? (price - each >= 0 ? "green" : "red") : undefined} bold />
                          <span className="flex md:block items-center justify-between md:text-right text-xs tabular-nums">
                            <span className="md:hidden text-gray-400">Lucro total</span>
                            {pr.hasCost ? (
                              <span className={`inline-block px-2 py-1 rounded-lg font-black ${totalProfit >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{fmt(totalProfit)}</span>
                            ) : <span className="text-gray-400">—</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lucro líquido (com Contas a Pagar) */}
          <div className={`${card} p-4 space-y-4`}>
            <SectionTitle title="Quanto sobrou de verdade" sub="Puxa sozinho as contas pagas em Contas a Pagar no período (pela data do pagamento)." />

            {/* Destaque do lucro líquido */}
            <div className={`rounded-2xl p-4 border ${netProfit >= 0 ? "bg-gradient-to-br from-emerald-50 to-white border-emerald-100" : "bg-gradient-to-br from-red-50 to-white border-red-100"}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Lucro líquido do período</p>
              <p className={`text-3xl font-black tabular-nums tracking-tight ${netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(netProfit)}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Pill tone="violet">margem líquida {pct(netProfit, revenue)}</Pill>
                {cur.dishes > 0 && <Pill tone="sky">{fmt(netProfit / cur.dishes)} por prato vendido</Pill>}
                {profitChange !== null && (
                  <Pill tone={profitChange >= 0 ? "emerald" : "red"}>
                    lucro das vendas {profitChange >= 0 ? "+" : ""}{fmtNum(profitChange, 0)}% vs período anterior
                  </Pill>
                )}
              </div>
            </div>

            {/* De cada R$ 100 */}
            {revenue > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-800">De cada R$ 100,00 que você vendeu:</p>
                <SplitBar tall parts={[
                  { v: goodsCost, cls: "bg-amber-400", label: "compras" },
                  { v: billGroups.expenseTotal, cls: "bg-rose-400", label: "despesas" },
                  { v: Math.max(0, netProfit), cls: "bg-emerald-500", label: "sobrou" },
                ]} />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-amber-50 p-2"><p className="text-lg font-black text-amber-600 tabular-nums">{fmt(per100(goodsCost))}</p><p className="text-[10px] text-gray-500">foram para compras de comida e bebida</p></div>
                  <div className="rounded-xl bg-rose-50 p-2"><p className="text-lg font-black text-rose-600 tabular-nums">{fmt(per100(billGroups.expenseTotal))}</p><p className="text-[10px] text-gray-500">foram para despesas do negócio</p></div>
                  <div className={`rounded-xl p-2 ${netProfit >= 0 ? "bg-emerald-50" : "bg-red-50"}`}><p className={`text-lg font-black tabular-nums ${netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(per100(netProfit))}</p><p className="text-[10px] text-gray-500">{netProfit >= 0 ? "sobraram para você" : "faltaram"}</p></div>
                </div>
              </div>
            )}

            {/* Conta passo a passo */}
            <div className="rounded-2xl border border-gray-100 divide-y divide-gray-100 text-sm">
              <Line label="Vendeu (comida e bebidas)" value={fmt(revenue)} tone="sky" />
              <Line label="− Custo da comida (compras lançadas aqui)" value={fmt(cur.foodCost)} tone="amber" />
              {cur.resaleCost > 0 && <Line label="− Custo das bebidas vendidas" value={fmt(cur.resaleCost)} tone="amber" />}
              <Line label="= Lucro das vendas" value={fmt(profit)} tone={profit >= 0 ? "emerald" : "red"} strong
                note={`margem de ${pct(profit, revenue)}`} />
              {billGroups.foodTotal > 0 && (
                <div>
                  <Line label="− Compras de comida pagas em Contas a Pagar" value={fmt(billGroups.foodTotal)} tone="amber" />
                  <BillBreakdown rows={billGroups.food} total={billGroups.foodTotal} cls="bg-amber-400" />
                </div>
              )}
              <div>
                <Line label="− Despesas do negócio" value={fmt(billGroups.expenseTotal)} tone="rose"
                  note={billGroups.expense.length ? undefined : "nenhuma conta paga no período"} />
                <BillBreakdown rows={billGroups.expense} total={billGroups.expenseTotal} cls="bg-rose-400" />
              </div>
              <Line label="= Lucro líquido" value={fmt(netProfit)} tone={netProfit >= 0 ? "emerald" : "red"} strong />
            </div>

            {/* Por que deu esse lucro */}
            <div className="rounded-2xl bg-gray-50 p-3.5 space-y-1.5 text-xs text-gray-600">
              <p className="font-bold text-gray-800 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" /> Por que deu esse resultado</p>
              {revenue > 0 && (
                <p>• As vendas deram <b className="text-emerald-700">{fmt(profit)}</b> de lucro ({pct(profit, revenue)} do que entrou), depois de pagar o que foi comprado.</p>
              )}
              {cur.dishes > 0 && (
                <p>• Cada prato custou em média <b className="text-violet-700">{fmt(cur.foodCost / cur.dishes)}</b> e foi vendido por <b className="text-sky-700">{fmt(cur.foodRevenue / cur.dishes)}</b>.</p>
              )}
              {topExpense && (
                <p>• A maior despesa foi <b className="text-rose-700">{billLabel(topExpense[0])}</b>: {fmt(topExpense[1])} ({pct(topExpense[1], billGroups.expenseTotal)} das despesas).</p>
              )}
              {cur.items[0] && (
                <p>• A compra que mais pesou foi <b className="text-amber-700">{cur.items[0].item.name}</b>: {fmt(cur.items[0].usedCost)} ({pct(cur.items[0].usedCost, itemsTotal)} das compras de comida).</p>
              )}
              {netProfit < 0 && revenue > 0 && (
                <p className="text-red-700 font-semibold">• As despesas passaram o lucro das vendas em {fmt(-netProfit)}. Para fechar no azul, falta vender mais ou cortar despesas.</p>
              )}
              {billGroups.foodTotal > 0 && (
                <p className="text-gray-400">Dica: compras de comida lançadas aqui em "Lançar compras" entram no custo de cada marmita; as lançadas direto em Contas a Pagar só aparecem neste total.</p>
              )}
              {billGroups.personal > 0 && (
                <p className="text-gray-400">Contas pessoais pagas ({fmt(billGroups.personal)}) não entram no lucro da empresa.</p>
              )}
            </div>
          </div>

          {/* Por compra */}
          <div className={`${card} p-4 space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <SectionTitle title="Para onde foi o dinheiro das compras"
                sub={'"Por prato" é a média: total comprado ÷ pratos vendidos. Se subir muito sem você mudar nada, tem porção maior, desperdício ou sumiço.'} />
              {cur.items.length > 0 && (
                <div className="text-right">
                  <p className="text-xl font-black text-amber-600 tabular-nums">{fmt(itemsTotal)}</p>
                  <p className="text-[11px] text-gray-400">{cur.items.length} ite{cur.items.length === 1 ? "m" : "ns"}</p>
                </div>
              )}
            </div>
            {cur.items.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-gray-500 flex-1">Nenhuma compra lançada no período.</p>
                <button onClick={goBuy} className={btnGhost + " !py-2"}><Plus className="w-4 h-4" /> Lançar compras</button>
              </div>
            ) : (
              <div className="space-y-2">
                {cur.items.map((r, idx) => {
                  const before = prevPerDish.get(r.item.id) ?? 0;
                  const change = before > 0 && r.perDish > 0 ? ((r.perDish - before) / before) * 100 : null;
                  return (
                    <div key={r.item.id} className="rounded-xl border border-gray-100 hover:border-gray-200 bg-white px-3 py-2.5 space-y-1.5 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-[11px] font-black ${idx < 3 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-gray-900 truncate">{r.item.name}</p>
                          <p className="text-[11px] text-gray-500">
                            comprou {fmtNum(r.boughtQty, 3)} {r.item.unit}
                            {r.boughtQty > 0 && <> · <span className="text-amber-700 font-semibold">{fmt(r.avg)}/{r.item.unit}</span></>}
                            {(r.opening !== null || r.closing !== null) && ` · usou ${fmtNum(r.usedQty, 3)} ${r.item.unit}`}
                            {r.opening !== null && ` · tinha ${fmtNum(r.opening, 3)}`}
                            {r.closing !== null && ` · sobrou ${fmtNum(r.closing, 3)}`}
                          </p>
                        </div>
                        <span className="text-right">
                          <span className="block font-black text-sm text-amber-600 tabular-nums">{fmt(r.usedCost)}</span>
                          <span className="block text-[10px] text-gray-400 tabular-nums">{pct(r.usedCost, itemsTotal)}</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-9">
                        <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500" style={{ width: `${Math.max(2, (r.usedCost / maxItemCost) * 100)}%` }} />
                        </div>
                        {cur.dishes > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-semibold tabular-nums">por prato {portionText(r.perDish, r.item.unit)} · {fmt(r.perDishCost)}</span>
                        )}
                        {change !== null && Math.abs(change) >= 5 && (
                          <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${change > 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}
                            title={`Antes: ${portionText(before, r.item.unit)} por prato`}>
                            {change > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                            {change > 0 ? "+" : ""}{fmtNum(change, 0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type Tone = "sky" | "amber" | "emerald" | "red" | "violet" | "rose";
const TONES: Record<Tone, { text: string; chip: string; bar: string }> = {
  sky: { text: "text-sky-600", chip: "bg-sky-50 text-sky-700", bar: "from-sky-400 to-sky-600" },
  amber: { text: "text-amber-600", chip: "bg-amber-50 text-amber-700", bar: "from-amber-300 to-amber-500" },
  emerald: { text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700", bar: "from-emerald-400 to-emerald-600" },
  red: { text: "text-red-600", chip: "bg-red-50 text-red-700", bar: "from-red-400 to-red-600" },
  violet: { text: "text-violet-600", chip: "bg-violet-50 text-violet-700", bar: "from-violet-400 to-violet-600" },
  rose: { text: "text-rose-600", chip: "bg-rose-50 text-rose-700", bar: "from-rose-300 to-rose-500" },
};

// Cartão de indicador: claro, com sombra suave (efeito 3D), ícone num quadradinho
// colorido e uma pílula com o número-chave (margem, % da venda…)
const CARD_SKINS: Record<"sky" | "amber" | "emerald" | "red" | "violet", { tile: string; icon: string; pill: string; glow: string; value: string }> = {
  sky: { tile: "linear-gradient(145deg,#e0f2fe,#bae6fd)", icon: "#0284c7", pill: "linear-gradient(135deg,#38bdf8,#0284c7)", glow: "rgba(2,132,199,.45)", value: "#0369a1" },
  amber: { tile: "linear-gradient(145deg,#ffedd5,#fed7aa)", icon: "#ea580c", pill: "linear-gradient(135deg,#fb923c,#ea580c)", glow: "rgba(234,88,12,.4)", value: "#c2410c" },
  emerald: { tile: "linear-gradient(145deg,#d1fae5,#a7f3d0)", icon: "#059669", pill: "linear-gradient(135deg,#34d399,#059669)", glow: "rgba(5,150,105,.4)", value: "#047857" },
  red: { tile: "linear-gradient(145deg,#ffe4e6,#fecdd3)", icon: "#e11d48", pill: "linear-gradient(135deg,#fb7185,#e11d48)", glow: "rgba(225,29,72,.4)", value: "#be123c" },
  violet: { tile: "linear-gradient(145deg,#ede9fe,#ddd6fe)", icon: "#7c3aed", pill: "linear-gradient(135deg,#a78bfa,#7c3aed)", glow: "rgba(124,58,237,.4)", value: "#6d28d9" },
};
const TIER_STYLE: Record<"ouro" | "prata" | "bronze", { bg: string; fg: string }> = {
  ouro: { bg: "#fef3c7", fg: "#92400e" },
  prata: { bg: "#f1f5f9", fg: "#334155" },
  bronze: { bg: "#ffedd5", fg: "#9a3412" },
};

function StatCard({ tone, icon: Icon, label, value, rating, ratingLabel, stats, tier, tierTitle }: {
  tone: keyof typeof CARD_SKINS; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; rating: string; ratingLabel: string;
  stats: { l: string; v: string }[]; tier?: "ouro" | "prata" | "bronze"; tierTitle?: string;
}) {
  const skin = CARD_SKINS[tone];
  return (
    <div className="ncard rounded-[26px] p-4 min-w-0 flex flex-col gap-3"
      style={{
        background: "linear-gradient(145deg,#ffffff,#eef1f5)",
        border: "1px solid rgba(255,255,255,.8)",
        boxShadow: "9px 9px 20px rgba(163,177,198,.45), -9px -9px 20px rgba(255,255,255,.95)",
      }}>
      <div className="flex items-start justify-between gap-2">
        <span className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: skin.tile, boxShadow: "inset 2px 2px 5px rgba(255,255,255,.85), inset -2px -2px 5px rgba(0,0,0,.06), 3px 3px 8px rgba(163,177,198,.35)" }}>
          <Icon className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: skin.icon }} />
        </span>
        <span className="text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 rounded-full whitespace-nowrap tabular-nums"
          style={{ background: skin.pill, color: "#fff", boxShadow: `0 6px 14px -5px ${skin.glow}` }}>
          {rating} <span className="font-medium opacity-90">{ratingLabel}</span>
        </span>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
          {tier && (
            <span title={tierTitle} className="text-[9px] font-black px-1.5 py-0.5 rounded-md cursor-help normal-case tracking-normal"
              style={{ background: TIER_STYLE[tier].bg, color: TIER_STYLE[tier].fg }}>{tier}</span>
          )}
        </p>
        <p className="text-xl sm:text-2xl font-black tabular-nums tracking-tight whitespace-nowrap" style={{ color: skin.value }}>{value}</p>
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-gray-500">
        {stats.map(st => (
          <span key={st.l} className="whitespace-nowrap">{st.l} <b className="font-semibold text-gray-700 tabular-nums">{st.v}</b></span>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-base font-black text-gray-900 tracking-tight">{title}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Stat({ label, value, tone, big }: { label: string; value: string; tone: Tone; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`${big ? "text-lg" : "text-sm"} font-black tabular-nums tracking-tight truncate ${TONES[tone].text}`}>{value}</p>
    </div>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONES[tone].chip}`}>{children}</span>;
}

function MarginBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-gray-400">sem vendas</span>;
  return <Pill tone={value >= 0 ? "emerald" : "red"}>{fmtNum(value, 0)}% de margem</Pill>;
}

// Barra dividida (custo × lucro, compras × despesas × sobra)
function SplitBar({ parts, thin, tall }: { parts: { v: number; cls: string; label?: string }[]; thin?: boolean; tall?: boolean }) {
  const total = parts.reduce((x, p) => x + Math.max(0, p.v), 0);
  const h = thin ? "h-1.5" : tall ? "h-4" : "h-2.5";
  return (
    <div className="w-full space-y-1">
      <div className={`flex w-full ${h} rounded-full bg-gray-100 overflow-hidden`}>
        {total > 0 && parts.map((p, i) => p.v > 0 && (
          <div key={i} className={p.cls} style={{ width: `${(p.v / total) * 100}%` }} title={p.label} />
        ))}
      </div>
      {!thin && parts.some(p => p.label) && total > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
          {parts.filter(p => p.label).map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${p.cls}`} />{p.label} {fmtNum((Math.max(0, p.v) / total) * 100, 0)}%</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Line({ label, value, tone, strong, note }: { label: string; value: string; tone: Tone; strong?: boolean; note?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${strong ? "bg-gray-50" : ""}`}>
      <span className={strong ? "font-bold text-gray-900" : "text-gray-600"}>
        {label}
        {note && <span className="block text-[10px] font-normal text-gray-400">{note}</span>}
      </span>
      <span className={`tabular-nums ${strong ? "font-black text-base" : "font-bold"} ${TONES[tone].text}`}>{value}</span>
    </div>
  );
}

function BillBreakdown({ rows, total, cls }: { rows: [string, number][]; total: number; cls: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="px-3.5 pb-2.5 space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[1fr_auto] gap-x-3 items-center text-xs">
          <span className="text-gray-600 truncate">{billLabel(k)}</span>
          <span className="tabular-nums font-semibold text-gray-700">{fmt(v)} <span className="text-[10px] font-normal text-gray-400">{total > 0 ? fmtNum((v / total) * 100, 0) : 0}%</span></span>
          <div className="col-span-2 h-1 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${cls}`} style={{ width: `${total > 0 ? Math.max(2, (v / total) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Cell({ label, value, tone, bold }: { label: string; value: string; tone?: "green" | "red" | "amber"; bold?: boolean }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-gray-800";
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

// nota: nome do item como veio na notinha (para o sistema aprender a ligação)
// kind: escolha manual de bebida/cozinha na linha (sem escolha, o sistema decide pelo nome)
interface BuyRow { name: string; unit: string; qty: string; total: string; nota?: string; kind?: "bebida" | "cozinha" }
interface RecentLine { id: string; stockItemId: string; name: string; unit: string; qty: number; cost: number }
interface RecentBuy {
  id: string; day: string; editable: boolean; items: RecentLine[];
  supplierId: string | null; supplierName: string | null;
  category: string | null; title: string | null; billStatus: string | null;
}
// Linha da correção: id nulo = item acrescentado agora
interface EditLine { key: string; id: string | null; name: string; unit: string; qty: string; total: string; removed: boolean }
interface EditState { id: string; day: string; supplierId: string; category: string; newCat: string | null; lines: EditLine[] }
const emptyRow = (): BuyRow => ({ name: "", unit: "kg", qty: "", total: "" });

// Leitor de QR Code pela câmera: usa o leitor do próprio navegador (Android/Chrome);
// onde não existe (iPhone, Firefox), carrega o jsQR na hora, só quando precisar.
type JsQR = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: string }) => { data: string } | null;
let jsQRLoad: Promise<JsQR> | null = null;
function loadJsQR(): Promise<JsQR> {
  jsQRLoad ??= new Promise<JsQR>((resolve, reject) => {
    const w = window as any;
    if (w.jsQR) { resolve(w.jsQR); return; }
    const el = document.createElement("script");
    el.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
    el.onload = () => w.jsQR ? resolve(w.jsQR) : reject(new Error("jsQR"));
    el.onerror = () => { jsQRLoad = null; reject(new Error("jsQR")); };
    document.head.appendChild(el);
  });
  return jsQRLoad;
}

function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const Det = (window as any).BarcodeDetector;
        let det: any = null;
        if (Det) { try { det = new Det({ formats: ["qr_code"] }); } catch { det = null; } }
        const jsQR = det ? null : await loadJsQR();
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = async () => {
          if (stop) return;
          if (v.readyState >= 2 && v.videoWidth) {
            let found: string | null = null;
            if (det) {
              try { found = (await det.detect(v))[0]?.rawValue ?? null; } catch { /* tenta de novo */ }
            } else if (jsQR) {
              const k = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
              canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
            if (found && !stop) { stop = true; resultRef.current(found); return; }
          }
          timer = window.setTimeout(tick, 200);
        };
        tick();
      } catch (e: any) {
        setErr(e?.name === "NotAllowedError"
          ? "Permita o uso da câmera para ler o QR Code (no cadeado ao lado do endereço do site)."
          : "Não consegui abrir a câmera neste aparelho. Use a câmera do celular e cole o link aqui.");
      }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 gap-3">
      <p className="text-sm font-semibold" style={WHITE}>Aponte para o QR Code da notinha</p>
      <div className="relative w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-[18%] border-4 border-white/80 rounded-2xl pointer-events-none" />
      </div>
      {err && <p className="text-sm text-amber-300 text-center max-w-sm">{err}</p>}
      <button onClick={onClose} className={btnGhost}><X className="w-4 h-4" /> Fechar</button>
    </div>
  );
}

function BuyView({ stockItems, suppliers, uid, onItemsChanged }: {
  stockItems: StockItem[]; suppliers: { id: string; name: string }[]; uid: string | null;
  onItemsChanged: () => Promise<void>;
}) {
  const today = dayStr(new Date());
  const [day, setDay] = useState(today);
  const [supplierId, setSupplierId] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [paid, setPaid] = useState(true);
  // Categoria da conta em Contas a Pagar (lembra a última escolhida neste aparelho)
  const [category, setCategory] = useState(() => { try { return localStorage.getItem(BUY_CAT_KEY) || "fornecedores"; } catch { return "fornecedores"; } });
  const [newCat, setNewCat] = useState<string | null>(null);
  const [usedCats, setUsedCats] = useState<string[]>([]);
  const [rows, setRows] = useState<BuyRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentBuy[]>([]);
  // Corrigir uma compra já lançada
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editDone, setEditDone] = useState<string | null>(null);
  // Colar a notinha (texto da página do QR Code)
  const [notaOpen, setNotaOpen] = useState(false);
  const [notaText, setNotaText] = useState("");
  const [notaBusy, setNotaBusy] = useState(false);
  const [notaMsg, setNotaMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [notaKey, setNotaKey] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [notaLink, setNotaLink] = useState<string | null>(null);
  const [notaWaiting, setNotaWaiting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const activeItems = stockItems.filter(i => i.is_active !== false);
  const findItem = (name: string) => activeItems.find(i => norm(i.name) === norm(name));

  async function loadRecent() {
    const { data } = await supabase.from("purchase_orders")
      .select("id, created_at, received_at, supplier_id, suppliers(name), accounts_payable(category, description, status), purchase_order_items(id, stock_item_id, quantity, unit_cost, stock_items(name, unit))")
      .eq("status", "received").gte("created_at", startISO(addDays(today, -6)))
      .order("created_at", { ascending: false }).limit(30);
    setRecent(((data ?? []) as any[]).map(o => {
      const all = (o.purchase_order_items ?? []) as any[];
      // purchase_order_id é único na conta: o Supabase devolve objeto, não lista
      const apRaw = o.accounts_payable;
      const bills = (Array.isArray(apRaw) ? apRaw : apRaw ? [apRaw] : []).filter((b: any) => b.status !== "cancelled");
      return {
        id: o.id, day: dayOf(o.received_at ?? o.created_at),
        // Só corrige aqui compra só de insumos e à vista (as outras ficam na aba Compras)
        editable: all.length > 0 && all.every(i => i.stock_items) && bills.length <= 1,
        items: all.filter(i => i.stock_items).map(i => ({
          id: i.id, stockItemId: i.stock_item_id, name: i.stock_items.name, unit: i.stock_items.unit, qty: Number(i.quantity), cost: Number(i.unit_cost),
        })),
        supplierId: o.supplier_id ?? null, supplierName: o.suppliers?.name ?? null,
        category: bills[0]?.category ?? null, title: bills[0]?.description ?? null, billStatus: bills[0]?.status ?? null,
      };
    }).filter(o => o.items.length));
  }
  useEffect(() => { loadRecent(); }, []);

  // Categorias que já existem em Contas a Pagar (inclusive as criadas lá)
  async function loadCats() {
    const { data } = await fetchAll(() => supabase.from("accounts_payable").select("category"));
    setUsedCats([...new Set(((data ?? []) as any[]).map(b => String(b.category ?? "")).filter(Boolean))]);
  }
  useEffect(() => { loadCats(); }, []);
  const catOptions = useMemo(() => {
    const keys = [...Object.keys(BILL_LABEL), ...usedCats.filter(k => !(k in BILL_LABEL)).sort()];
    if (category && !keys.includes(category)) keys.push(category);
    return keys;
  }, [usedCats, category]);
  const catSlug = (t: string) => t.toLowerCase().trim().replace(/\s+/g, "_");

  const setRow = (idx: number, patch: Partial<BuyRow>) => setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const filled = rows.filter(r => r.name.trim() || r.qty || r.total);
  const total = filled.reduce((s, r) => s + (parseNum(r.total) || 0), 0);

  async function supplierForDay(chosen: string = supplierId): Promise<string> {
    if (chosen) return chosen;
    // Compra de mercado/feira sem fornecedor: usa (ou cria) "Diversos"
    const found = suppliers.find(s => norm(s.name) === "diversos");
    if (found) return found.id;
    const { data, error } = await supabase.from("suppliers").insert({ name: "Diversos" }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "Não foi possível criar o fornecedor Diversos");
    return data.id;
  }

  // Lê o texto copiado da página da nota e pré-preenche as linhas (nada é salvo aqui)
  async function readNota(text: string) {
    setNotaMsg(null);
    const t = text.trim();
    if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) { gotLink(t); return; }
    const n = parseNfceText(t);
    if (n.items.length === 0) {
      setNotaMsg({ ok: false, lines: ["Não achei os itens nesse texto. Copie a página inteira da nota (Selecionar tudo → Copiar) e cole de novo.", "Se continuar, me avise de qual estado é a nota."] });
      return;
    }
    setNotaBusy(true);
    try {
      // Mesmo item em linhas separadas na nota vira uma linha só
      const merged: typeof n.items = [];
      for (const it of n.items) {
        const same = merged.find(m => norm(m.name) === norm(it.name) && m.unit === it.unit);
        if (same) { same.qty += it.qty; same.total += it.total; } else merged.push({ ...it });
      }
      // Desconto da nota: reparte nos itens para a conta bater com o que foi pago
      const paidTotal = n.toPay ?? (n.discount > 0 ? n.itemsTotal - n.discount : null);
      const sum = merged.reduce((a, i) => a + i.total, 0);
      let totals = merged.map(i => Math.round(i.total * 100) / 100);
      const discounted = paidTotal != null && paidTotal > 0 && paidTotal < sum - 0.009;
      if (discounted) {
        totals = merged.map(i => Math.round(i.total * (paidTotal! / sum) * 100) / 100);
        const diff = Math.round((paidTotal! - totals.reduce((a, v) => a + v, 0)) * 100) / 100;
        const big = totals.indexOf(Math.max(...totals));
        totals[big] = Math.round((totals[big] + diff) * 100) / 100;
      }
      // Nomes que o sistema já aprendeu (nome da nota → item do estoque)
      const keys = merged.map(i => i.name.toUpperCase());
      const { data: al } = await supabase.from("nfce_item_alias").select("nota_name, stock_item_id").in("nota_name", keys);
      const alias = new Map(((al ?? []) as any[]).map(a => [a.nota_name as string, a.stock_item_id as string]));
      const newRows: BuyRow[] = merged.map((it, k) => {
        const known = activeItems.find(x => x.id === alias.get(it.name.toUpperCase())) ?? findItem(it.name);
        return {
          name: known?.name ?? it.name, unit: known?.unit ?? nfceUnit(it.unit), nota: it.name,
          qty: String(Math.round(it.qty * 1000) / 1000).replace(".", ","),
          total: totals[k].toFixed(2).replace(".", ","),
        };
      });
      setRows(rs => [...rs.filter(r => r.name.trim() || r.qty || r.total), ...newRows]);
      if (n.date && n.date <= today) setDay(n.date);
      // Onde comprou: fornecedor já cadastrado com o mesmo CNPJ ou nome
      let supFound: { id: string; name: string } | undefined;
      if (n.cnpj) {
        const { data: sc } = await supabase.from("suppliers").select("id, cnpj");
        const hit = ((sc ?? []) as any[]).find(x => String(x.cnpj ?? "").replace(/\D/g, "") === n.cnpj);
        if (hit) supFound = suppliers.find(x => x.id === hit.id);
      }
      if (!supFound && n.store) supFound = suppliers.find(x => norm(x.name) === norm(n.store!));
      if (supFound) setSupplierId(supFound.id);
      // Mesma nota lançada antes?
      let dup: string | null = null;
      if (n.key) {
        const { data: d } = await supabase.from("purchase_orders").select("created_at").ilike("notes", `%${n.key}%`).neq("status", "cancelled").limit(1);
        if (d && d.length) dup = new Date((d[0] as any).created_at).toLocaleDateString("pt-BR");
      }
      setNotaKey(n.key);
      const known = newRows.filter(r => findItem(r.name)).length;
      const lines = [
        `Nota lida: ${newRows.length} ite${newRows.length === 1 ? "m" : "ns"} · ${fmt(paidTotal ?? sum)}${n.store ? " · " + n.store : ""}${n.date ? " · " + n.date.split("-").reverse().join("/") : ""}`,
        "Confira os itens abaixo, corrija o que precisar e toque em Salvar compras.",
      ];
      if (discounted) lines.push(`A nota teve desconto de ${fmt(sum - paidTotal!)}: já reparti nos itens, o total bate com o que você pagou.`);
      if (known < newRows.length) lines.push(`${newRows.length - known} ite${newRows.length - known === 1 ? "m está" : "ns estão"} como "item novo". Se já existe no seu estoque com outro nome, escolha o nome certo na lista: o sistema aprende para a próxima nota.`);
      if (dup) lines.push(`⚠ Essa nota já foi lançada em ${dup}. Confira para não lançar duas vezes.`);
      setNotaMsg({ ok: !dup, lines });
      setNotaText(""); setNotaOpen(false); setNotaLink(null); setNotaWaiting(false);
    } catch (e: any) {
      setNotaMsg({ ok: false, lines: [e?.message ?? String(e)] });
    }
    setNotaBusy(false);
  }

  // QR Code lido (ou link colado): a página da nota precisa ser aberta pelo dono,
  // a SEFAZ não deixa o sistema buscar sozinho
  function gotLink(text: string) {
    setScanOpen(false); setNotaText("");
    const t = text.trim();
    if (!/^https?:\/\//i.test(t) || !/\.gov\.br(?:[/?:]|$)/i.test(t)) {
      setNotaMsg({ ok: false, lines: ["Esse QR Code não é de nota fiscal. Procure o QR Code que fica no fim da notinha."] });
      return;
    }
    setNotaMsg(null); setNotaLink(t); setNotaWaiting(false); setNotaOpen(true);
  }
  function openNotaPage() {
    if (!notaLink) return;
    window.open(notaLink, "_blank", "noopener");
    setNotaWaiting(true);
  }
  // Voltou da página da nota: lê sozinho o que foi copiado
  useEffect(() => {
    if (!notaWaiting) return;
    const onBack = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const t = await navigator.clipboard.readText();
        if (t && t.trim() !== notaLink && /qtd|vl\.?\s*total|valor/i.test(t)) { setNotaText(t); await readNota(t); }
      } catch { /* navegador pede um toque: botão Colar e ler */ }
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => { document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); };
  }, [notaWaiting, notaLink]);

  async function pasteNota() {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) { if (!/^https?:\/\/\S+$/i.test(t.trim())) setNotaText(t); await readNota(t); return; }
    } catch { /* sem permissão: cola no campo */ }
    document.getElementById("nota-text")?.focus();
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
    const cat = newCat !== null ? catSlug(newCat) : category;
    if (!cat) { setError("Digite o nome da nova categoria."); return; }
    setSaving(true);
    try {
      const sup = await supplierForDay();
      // Insumos novos são criados na hora (mesmo cadastro da aba Estoque)
      const ids: string[] = [];
      for (const r of filled) {
        const ex = findItem(r.name);
        if (ex) {
          ids.push(ex.id);
          if (r.kind && r.kind !== (isDrinkItem(ex) ? "bebida" : "cozinha")) {
            await supabase.from("stock_items").update({ category: r.kind }).eq("id", ex.id);
          }
          continue;
        }
        const { data, error } = await supabase.from("stock_items").insert({
          name: r.name.trim(), unit: r.unit, current_qty: 0, min_qty: 0, cost_price: 0, supplier_id: supplierId || null,
          category: r.kind ?? null,
        }).select("id").single();
        if (error || !data) throw new Error(error?.message ?? "Erro ao criar insumo");
        ids.push(data.id);
      }
      const items = filled.map((r, i) => {
        const q = parseNum(r.qty), t = parseNum(r.total) || 0;
        return { ref_type: "ingredient", item_id: ids[i], quantity: q, unit_cost: Math.round((t / q) * 10000) / 10000 };
      });
      const { data: poId, error } = await supabase.rpc("register_purchase", {
        p_supplier_id: sup, p_notes: notaKey ? `Compras do dia · NFC-e ${notaKey}` : "Compras do dia", p_due_date: day, p_installments: 1, p_items: items,
      });
      if (error || !poId) throw new Error(error?.message ?? "Erro ao salvar a compra");
      // Data escolhida (compra de ontem lançada hoje, por exemplo)
      if (day !== today) {
        const when = new Date(parseDay(day).setHours(12)).toISOString();
        await supabase.from("purchase_orders").update({ created_at: when, received_at: when }).eq("id", poId as string);
      }
      // Forma de pagamento em Contas a Pagar (mesmo que a aba Compras faz)
      const { data: bills } = await supabase.from("accounts_payable").select("id, amount").eq("purchase_order_id", poId as string);
      // Título da conta = categoria escolhida (ex.: "Verdura"), e o fornecedor quando não é "Diversos"
      const supLabel = supplierId ? suppliers.find(s => s.id === supplierId)?.name : null;
      const description = billLabel(cat) + (supLabel ? " - " + supLabel : "");
      for (const b of bills ?? []) {
        await supabase.from("accounts_payable").update(paid
          ? { payment_method: payMethod, category: cat, description, status: "paid", paid_date: day, paid_amount: b.amount, updated_at: new Date().toISOString() }
          : { payment_method: payMethod, category: cat, description, updated_at: new Date().toISOString() }).eq("id", b.id);
      }
      setCategory(cat); setNewCat(null);
      try { localStorage.setItem(BUY_CAT_KEY, cat); } catch { /* sem armazenamento */ }
      if (!usedCats.includes(cat)) setUsedCats(c => [...c, cat]);
      // Histórico do estoque (aparece na aba Estoque); falhar aqui não desfaz a compra
      const { data: bal } = await supabase.from("stock_items").select("id, current_qty").in("id", ids);
      const balance = new Map(((bal ?? []) as any[]).map(b => [b.id, Number(b.current_qty)]));
      const supName = supplierId ? suppliers.find(s => s.id === supplierId)?.name : "Diversos";
      await supabase.from("inventory_movements").insert(items.map(i => ({
        product_id: null, stock_item_id: i.item_id, type: "purchase", quantity: i.quantity,
        balance_after: balance.get(i.item_id) ?? null, unit_cost: i.unit_cost || null,
        reference_type: "purchase", reference_id: poId, notes: `Compra${supName ? " - " + supName : ""}`,
      })));
      // Aprende: nome da nota → item do estoque (falhar aqui não desfaz a compra)
      const learn = filled.map((r, i) => r.nota ? { nota_name: r.nota.toUpperCase(), stock_item_id: ids[i], updated_at: new Date().toISOString() } : null)
        .filter((x): x is { nota_name: string; stock_item_id: string; updated_at: string } => !!x);
      if (learn.length) {
        const uniq = [...new Map(learn.map(l => [l.nota_name, l])).values()];
        try { await supabase.from("nfce_item_alias").upsert(uniq, { onConflict: "user_id,nota_name" }); } catch { /* ok */ }
      }
      setNotaKey(null); setNotaMsg(null); setConfirmClear(false);
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      setDone(`${filled.length} ite${filled.length === 1 ? "m lançado" : "ns lançados"} · ${fmt(total)}`);
      await Promise.all([onItemsChanged(), loadRecent()]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    setSaving(false);
  }

  function startEdit(o: RecentBuy) {
    setEditError(null); setConfirmDelete(false); setEditDone(null);
    const diversos = o.supplierName && norm(o.supplierName) === "diversos";
    setEditing({
      id: o.id, day: o.day,
      supplierId: o.supplierId && !diversos ? o.supplierId : "",
      category: o.category || "fornecedores", newCat: null,
      lines: o.items.map(i => ({
        key: i.id, id: i.id, name: i.name, unit: i.unit, removed: false,
        qty: String(i.qty).replace(".", ","), total: (Math.round(i.qty * i.cost * 100) / 100).toFixed(2).replace(".", ","),
      })),
    });
  }
  const setEditLine = (key: string, patch: Partial<EditLine>) =>
    setEditing(e => e && { ...e, lines: e.lines.map(l => l.key === key ? { ...l, ...patch } : l) });
  const addEditLine = () =>
    setEditing(e => e && { ...e, lines: [...e.lines, { key: "n" + Date.now(), id: null, name: "", unit: "kg", qty: "", total: "", removed: false }] });

  // Grava a correção (ou exclui, sem linhas): estoque, Contas a Pagar e o Resultado se ajustam juntos
  async function saveEdit(removeAll = false) {
    if (!editing) return;
    setEditError(null);
    // Linha nova deixada em branco não conta
    const keep = removeAll ? [] : editing.lines.filter(l => !l.removed && (l.id || l.name.trim() || l.qty || l.total));
    for (const l of keep) {
      if (!l.name.trim()) { setEditError("Tem item sem nome."); return; }
      if (!(parseNum(l.qty) > 0)) { setEditError(`Quantidade inválida em "${l.name}".`); return; }
      if (!(parseNum(l.total) >= 0)) { setEditError(`Valor inválido em "${l.name}".`); return; }
    }
    if (editing.day > today) { setEditError("A data não pode ser no futuro."); return; }
    if (!removeAll && keep.length === 0) { setConfirmDelete(true); return; }
    const cat = editing.newCat !== null ? catSlug(editing.newCat) : editing.category;
    if (keep.length && !cat) { setEditError("Digite o nome da nova categoria."); return; }
    setEditSaving(true);
    try {
      // Nome trocado ou item acrescentado: usa o insumo com esse nome ou cria (igual ao lançamento)
      const items: { id?: string; stock_item_id?: string; quantity: number; unit_cost: number }[] = [];
      const original = new Map((recent.find(r => r.id === editing.id)?.items ?? []).map(i => [i.id, i]));
      for (const l of keep) {
        const q = parseNum(l.qty), t = parseNum(l.total) || 0;
        const orig = l.id ? original.get(l.id) : undefined;
        let itemId: string | undefined;
        if (!orig || norm(orig.name) !== norm(l.name)) {
          const ex = findItem(l.name);
          if (ex) itemId = ex.id;
          else {
            const { data, error } = await supabase.from("stock_items").insert({
              name: l.name.trim(), unit: l.unit, current_qty: 0, min_qty: 0, cost_price: 0, supplier_id: editing.supplierId || null,
            }).select("id").single();
            if (error || !data) throw new Error(error?.message ?? "Erro ao criar insumo");
            itemId = data.id;
          }
        }
        items.push({ ...(l.id ? { id: l.id } : {}), ...(itemId ? { stock_item_id: itemId } : {}), quantity: q, unit_cost: Math.round((t / q) * 10000) / 10000 });
      }
      const sup = keep.length ? await supplierForDay(editing.supplierId) : null;
      const supLabel = editing.supplierId ? suppliers.find(x => x.id === editing.supplierId)?.name : null;
      const { error } = await supabase.rpc("edit_purchase_lines", {
        p_purchase_order_id: editing.id,
        p_items: items,
        p_day: keep.length ? editing.day : null,
        p_when: keep.length ? new Date(parseDay(editing.day).setHours(12)).toISOString() : null,
        p_supplier_id: sup,
        p_category: keep.length ? cat : null,
        // Título da conta acompanha a categoria (ex.: "Verdura - Ceasa")
        p_description: keep.length ? billLabel(cat) + (supLabel ? " - " + supLabel : "") : null,
      });
      if (error) throw new Error(error.message);
      if (cat && !usedCats.includes(cat)) setUsedCats(c => [...c, cat]);
      setEditDone(keep.length ? "✓ Compra corrigida: estoque, Contas a Pagar e Resultado ajustados." : "✓ Compra excluída: o estoque voltou e a conta saiu de Contas a Pagar.");
      setEditing(null); setConfirmDelete(false);
      await Promise.all([onItemsChanged(), loadRecent()]);
    } catch (e: any) {
      setEditError(e?.message ?? String(e));
    }
    setEditSaving(false);
  }

  void uid;
  return (
    <div className="space-y-4">
      <div className={`${card} p-4 space-y-3`}>
        <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0"><ScanLine className="w-5 h-5" /></span>
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-bold text-gray-900">Lançar pela notinha (QR Code)</p>
              <p className="text-[11px] text-gray-500">Os itens da nota entram sozinhos aqui embaixo. Você confere e salva.</p>
            </div>
            <button onClick={() => { setNotaMsg(null); setScanOpen(true); }} className={btnPrimary} style={WHITE}>
              <Camera className="w-4 h-4" /> Ler QR Code
            </button>
            <button onClick={() => { setNotaOpen(o => !o); setNotaMsg(null); setNotaLink(null); setNotaWaiting(false); }} className={btnGhost}>
              <ClipboardPaste className="w-4 h-4" /> {notaOpen ? "Fechar" : "Colar link ou nota"}
            </button>
          </div>
          {scanOpen && <QrScanner onResult={gotLink} onClose={() => setScanOpen(false)} />}
          {notaOpen && notaLink && (
            <div className="rounded-xl bg-white border border-brand-200 p-3 space-y-2">
              <p className="text-sm font-bold text-emerald-700">✓ QR Code da nota pronto</p>
              <ol className="text-xs text-gray-700 space-y-1 list-decimal pl-5">
                <li>Toque em <b>Abrir a nota</b>: a página da SEFAZ abre em outra aba.</li>
                <li>Lá, toque em <b>Selecionar tudo</b> e depois em <b>Copiar</b>.</li>
                <li><b>Volte para esta aba</b>: os itens aparecem sozinhos aqui embaixo. Se não aparecerem, toque em <b>Colar e ler</b>.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <button onClick={openNotaPage} className={btnPrimary} style={WHITE}><ExternalLink className="w-4 h-4" /> Abrir a nota</button>
                <button onClick={pasteNota} disabled={notaBusy} className={btnGhost}>
                  {notaBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />} Colar e ler
                </button>
                <button onClick={() => { setNotaLink(null); setNotaWaiting(false); setNotaOpen(false); }} className={btnGhost}>Cancelar</button>
              </div>
              {notaWaiting && <p className="text-[11px] text-gray-500">Esperando você copiar a página da nota…</p>}
            </div>
          )}
          {notaOpen && !notaLink && (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">Cole aqui o <b>link do QR Code</b> ou o <b>texto da página da nota</b> (Selecionar tudo → Copiar).</p>
              <textarea id="nota-text" value={notaText} rows={4}
                onChange={e => setNotaText(e.target.value)}
                onPaste={e => { const t = e.clipboardData.getData("text"); if (t.trim()) { e.preventDefault(); setNotaText(t); readNota(t); } }}
                placeholder="Cole aqui o link do QR Code ou o texto da página da nota…" className={fieldCls + " text-xs"} />
              <div className="flex flex-wrap gap-2">
                <button onClick={pasteNota} disabled={notaBusy} className={btnPrimary} style={WHITE}>
                  {notaBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />} Colar e ler
                </button>
                {notaText.trim() && (
                  <button onClick={() => readNota(notaText)} disabled={notaBusy} className={btnGhost}>Ler o texto do campo</button>
                )}
              </div>
            </div>
          )}
          {notaMsg && (
            <div className={`rounded-xl px-3 py-2 text-xs space-y-0.5 ${notaMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              {notaMsg.lines.map((l, i) => <p key={i} className={i === 0 ? "font-semibold" : ""}>{l}</p>)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <label className="text-xs text-gray-500">Data da compra
            <input type="date" value={day} max={today} onChange={e => setDay(e.target.value)} className={fieldCls + " mt-1"} />
          </label>
          <label className="text-xs text-gray-500">Onde comprou
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={fieldCls + " mt-1"}>
              <option value="">Diversos (mercado, feira…)</option>
              {suppliers.filter(s => norm(s.name) !== "diversos").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Categoria (Contas a Pagar)
            <select value={newCat !== null ? "__new__" : category}
              onChange={e => { if (e.target.value === "__new__") setNewCat(""); else { setNewCat(null); setCategory(e.target.value); } }}
              className={fieldCls + " mt-1"}>
              {catOptions.map(k => <option key={k} value={k}>{billLabel(k)}</option>)}
              <option value="__new__">✚ Nova categoria...</option>
            </select>
            {newCat !== null && (
              <input autoFocus value={newCat} onChange={e => setNewCat(e.target.value)}
                placeholder="Ex.: Carnes, Hortifruti, Embalagens…" className={fieldCls + " mt-1"} />
            )}
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
                <div className="col-span-2 md:col-span-1">
                  <input list="cost-items" value={r.name} onChange={e => setRow(idx, { name: e.target.value })}
                    placeholder="Ex.: Bife, Alho, Arroz…" className={fieldCls} />
                  {r.nota && norm(r.nota) !== norm(r.name) && <p className="text-[10px] text-gray-400 px-1 mt-0.5 truncate">na nota: {r.nota}</p>}
                </div>
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
                  {r.name.trim() && (() => {
                    const drink = r.kind ? r.kind === "bebida" : ex ? isDrinkItem(ex) : autoDrinkName(r.name);
                    return (
                      <button type="button" onClick={() => setRow(idx, { kind: drink ? "cozinha" : "bebida" })}
                        title="Toque para trocar" className={`mt-0.5 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${drink ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-500"}`}>
                        {drink ? "🥤 bebida · fora do prato" : "🍲 custo do prato"}
                      </button>
                    );
                  })()}
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
          {/* Desistir do lançamento (ex.: nota lida só para testar): limpa tudo, nada é salvo */}
          {filled.length > 0 && (confirmClear ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              Apagar todos os itens da tela?
              <button onClick={() => { setRows([emptyRow(), emptyRow(), emptyRow()]); setNotaKey(null); setNotaMsg(null); setNotaLink(null); setNotaWaiting(false); setError(null); setConfirmClear(false); }}
                className="px-2.5 py-1.5 rounded-lg font-semibold bg-red-600 hover:bg-red-700" style={WHITE}>Sim, cancelar</button>
              <button onClick={() => setConfirmClear(false)} className="px-2.5 py-1.5 rounded-lg font-semibold border border-gray-200 bg-white">Não</button>
            </span>
          ) : (
            <button onClick={() => setConfirmClear(true)} className={btnGhost + " text-red-600"}><X className="w-4 h-4" /> Cancelar lançamento</button>
          ))}
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
          <p className="text-[11px] text-gray-400">Lançou errado? Toque em "Corrigir" para mudar itens, valores, data, onde comprou, categoria ou excluir.</p>
          {editDone && <p className="text-xs font-semibold text-emerald-700 mt-1">{editDone}</p>}
        </div>
        {recent.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-500">Nada lançado ainda.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map(o => editing?.id === o.id ? (
              <div key={o.id} className="m-2 rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-3 sm:p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center"><Pencil className="w-4 h-4" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">Corrigir compra</p>
                    <p className="text-[11px] text-gray-500">Muda o estoque, Contas a Pagar e o Resultado juntos.</p>
                  </div>
                  <button onClick={() => { setEditing(null); setConfirmDelete(false); }} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white" title="Fechar sem salvar">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="text-xs text-gray-500">Data da compra
                    <input type="date" value={editing.day} max={today} onChange={e => setEditing(ed => ed && { ...ed, day: e.target.value })} className={fieldCls + " mt-1"} />
                  </label>
                  <label className="text-xs text-gray-500">Onde comprou
                    <select value={editing.supplierId} onChange={e => setEditing(ed => ed && { ...ed, supplierId: e.target.value })} className={fieldCls + " mt-1"}>
                      <option value="">Diversos (mercado, feira…)</option>
                      {suppliers.filter(x => norm(x.name) !== "diversos").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">Categoria (Contas a Pagar)
                    <select value={editing.newCat !== null ? "__new__" : editing.category}
                      onChange={e => { const v = e.target.value; setEditing(ed => ed && (v === "__new__" ? { ...ed, newCat: "" } : { ...ed, newCat: null, category: v })); }}
                      className={fieldCls + " mt-1"}>
                      {[...catOptions, ...(catOptions.includes(editing.category) ? [] : [editing.category])].map(k => <option key={k} value={k}>{billLabel(k)}</option>)}
                      <option value="__new__">✚ Nova categoria...</option>
                    </select>
                    {editing.newCat !== null && (
                      <input autoFocus value={editing.newCat} onChange={e => setEditing(ed => ed && { ...ed, newCat: e.target.value })}
                        placeholder="Ex.: Carnes, Hortifruti, Embalagens…" className={fieldCls + " mt-1"} />
                    )}
                  </label>
                </div>

                <div className="rounded-xl bg-white border border-gray-100 p-2 space-y-2">
                  <div className="hidden md:grid grid-cols-[1fr_100px_110px_130px_110px_36px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1">
                    <span>Item</span><span>Unidade</span><span>Quantidade</span><span>Valor pago (total)</span><span className="text-right">Preço por un.</span><span />
                  </div>
                  {editing.lines.map(l => {
                    const q = parseNum(l.qty), t = parseNum(l.total);
                    const ex = l.name.trim() ? findItem(l.name) : undefined;
                    const unit = ex?.unit ?? l.unit;
                    return (
                      <div key={l.key} className={`grid grid-cols-2 md:grid-cols-[1fr_100px_110px_130px_110px_36px] gap-2 items-center p-2 md:p-0 rounded-xl border border-gray-100 md:border-0 ${l.removed ? "opacity-50" : ""}`}>
                        <input list="cost-items" value={l.name} disabled={l.removed} onChange={e => setEditLine(l.key, { name: e.target.value })}
                          placeholder="Ex.: Bife, Alho, Arroz…" className={fieldCls + " col-span-2 md:col-span-1 !py-2" + (l.removed ? " line-through" : "")} />
                        {ex ? (
                          <span className="text-sm text-gray-600 px-1">{ex.unit}</span>
                        ) : (
                          <select value={l.unit} disabled={l.removed} onChange={e => setEditLine(l.key, { unit: e.target.value })} className={fieldCls + " !py-2"} title="Unidade do item novo">
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        )}
                        <input inputMode="decimal" value={l.qty} disabled={l.removed} onChange={e => setEditLine(l.key, { qty: e.target.value })} placeholder={`Qtd (${unit})`} className={fieldCls + " !py-2"} />
                        <input inputMode="decimal" value={l.total} disabled={l.removed} onChange={e => setEditLine(l.key, { total: e.target.value })} placeholder="R$ 0,00" className={fieldCls + " !py-2"} />
                        <span className="text-xs text-gray-500 md:text-right tabular-nums">
                          {l.removed ? "sai da compra" : q > 0 && t >= 0 ? `${fmt(t / q)}/${unit}` : ""}
                          {!l.removed && l.name.trim() && !ex && <span className="block text-[10px] font-semibold text-brand-600">item novo</span>}
                        </span>
                        <button onClick={() => l.id ? setEditLine(l.key, { removed: !l.removed }) : setEditing(ed => ed && { ...ed, lines: ed.lines.filter(x => x.key !== l.key) })}
                          className={`justify-self-end p-2 rounded-lg ${l.removed ? "text-brand-600 hover:bg-brand-50" : "text-gray-400 hover:text-red-600 hover:bg-red-50"}`}
                          title={l.removed ? "Manter este item" : "Tirar este item da compra"}>
                          {l.removed ? <RefreshCw className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    );
                  })}
                  <button onClick={addEditLine} className={btnGhost + " !py-2"}><Plus className="w-4 h-4" /> Mais um item</button>
                </div>

                {confirmDelete ? (
                  <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-red-200 bg-red-50">
                    <p className="text-xs text-red-800 flex-1">Excluir a compra inteira? O estoque volta e a conta sai de Contas a Pagar e do Resultado.</p>
                    <button onClick={() => setConfirmDelete(false)} className={btnGhost + " !py-1.5"}>Não</button>
                    <button onClick={() => saveEdit(true)} disabled={editSaving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40" style={WHITE}>
                      {editSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Sim, excluir
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline">
                      <Trash2 className="w-3.5 h-3.5" /> Excluir compra inteira
                    </button>
                    <div className="flex-1" />
                    <span className="text-sm text-gray-600">Total: <b className="text-gray-900 text-base">{fmt(editing.lines.filter(l => !l.removed).reduce((x, l) => x + (parseNum(l.total) || 0), 0))}</b></span>
                    <button onClick={() => { setEditing(null); setConfirmDelete(false); }} className={btnGhost + " !py-2"}>Cancelar</button>
                    <button onClick={() => saveEdit()} disabled={editSaving} className={btnPrimary + " !py-2"} style={WHITE}>
                      {editSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar correção
                    </button>
                  </div>
                )}
                {editError && <p className="text-sm text-red-600">{editError}</p>}
              </div>
            ) : (
              <div key={o.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {o.title && !/^compra( - |$)/i.test(o.title) ? o.title : o.category ? billLabel(o.category) : "Compra"}
                    </p>
                    <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2">
                      <span>{fmtDay(o.day)}</span>
                      {o.supplierName && <span>· {o.supplierName}</span>}
                      {o.category && <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 font-semibold">{billLabel(o.category)}</span>}
                      {o.billStatus && <span className={o.billStatus === "paid" ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>{o.billStatus === "paid" ? "pago" : "a pagar"}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-bold tabular-nums">{fmt(o.items.reduce((s, i) => s + i.qty * i.cost, 0))}</span>
                    {o.editable && (
                      <button onClick={() => startEdit(o)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-brand-200 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                        <Pencil className="w-3.5 h-3.5" /> Corrigir
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
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
