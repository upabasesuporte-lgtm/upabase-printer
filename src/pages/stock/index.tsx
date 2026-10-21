import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { ProductModal, type Category, type Product } from "../products";
import {
  Search, X, Plus, RefreshCw, Pencil, Trash2, AlertTriangle, Boxes, Package, BookOpen, History,
  ArrowDownToLine, ArrowUpFromLine, Flame, ClipboardCheck, ShoppingCart, Truck, Undo2, Info,
  ChevronRight, Infinity as InfinityIcon, Check,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface StockItemRow {
  id: string; name: string; unit: string; current_qty: number; min_qty: number;
  max_qty: number | null; cost_price: number; supplier_id: string | null;
  category: string | null; notes: string | null;
  suppliers?: { name: string } | null;
}

interface ProductRow {
  id: string; name: string; unit: string | null; stock: number; stock_min: number | null;
  stock_max: number | null; cost_price: number | null; sale_price: number | null;
  stock_type: string | null; unlimited_stock: boolean | null; is_active: boolean; status: string | null;
}

type Kind = "product" | "ingredient";

// Linha unificada da lista de estoque
interface Row {
  key: string; kind: Kind; id: string; name: string; unit: string;
  qty: number; min: number; max: number | null; cost: number;
  subtitle: string | null; paused: boolean;
}

interface Movement {
  id: string; product_id: string | null; stock_item_id: string | null; type: string;
  quantity: number; balance_after: number | null; unit_cost: number | null;
  notes: string | null; created_at: string;
  products?: { name: string; unit: string | null } | null;
  stock_items?: { name: string; unit: string } | null;
}

interface RecipeLine { id: string; product_id: string; stock_item_id: string; quantity: number; }

type View = "stock" | "history" | "recipes";
type StatusFilter = "all" | "low" | "out" | "uncontrolled";
type MoveType = "entry" | "exit" | "loss" | "count";

// ─── Constantes ───────────────────────────────────────────────────────────────

const UNITS = ["unidade", "kg", "g", "litro", "ml", "metro", "cm", "caixa", "dúzia", "pacote", "porção"];

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmtQty = (v: number, unit: string) => `${fmtNum(v)} ${unit}`;
const num = (v: string) => parseFloat(v.replace(",", ".")) || 0;
const fmtDateTime = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const isControlled = (p: ProductRow) => p.stock_type !== "unlimited" && p.unlimited_stock !== true;

function statusOf(qty: number, min: number): "out" | "low" | "ok" {
  if (qty <= 0) return "out";
  if (min > 0 && qty <= min) return "low";
  return "ok";
}

const STATUS = {
  out: { label: "Zerado", badge: "bg-red-50 text-red-700 ring-1 ring-red-100", bar: "bg-red-500", text: "text-red-600" },
  low: { label: "Baixo", badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-100", bar: "bg-amber-500", text: "text-amber-600" },
  ok: { label: "Normal", badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100", bar: "bg-emerald-500", text: "text-gray-900" },
};

const MOVE_INFO: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  entry: { label: "Entrada", icon: <ArrowDownToLine className="w-3.5 h-3.5" />, tone: "bg-emerald-50 text-emerald-700" },
  purchase: { label: "Compra", icon: <Truck className="w-3.5 h-3.5" />, tone: "bg-emerald-50 text-emerald-700" },
  return: { label: "Devolução", icon: <Undo2 className="w-3.5 h-3.5" />, tone: "bg-emerald-50 text-emerald-700" },
  sale: { label: "Venda", icon: <ShoppingCart className="w-3.5 h-3.5" />, tone: "bg-blue-50 text-blue-700" },
  exit: { label: "Saída", icon: <ArrowUpFromLine className="w-3.5 h-3.5" />, tone: "bg-gray-100 text-gray-700" },
  loss: { label: "Perda", icon: <Flame className="w-3.5 h-3.5" />, tone: "bg-red-50 text-red-700" },
  count: { label: "Contagem", icon: <ClipboardCheck className="w-3.5 h-3.5" />, tone: "bg-violet-50 text-violet-700" },
  purchase_cancel: { label: "Compra cancelada", icon: <Undo2 className="w-3.5 h-3.5" />, tone: "bg-gray-100 text-gray-700" },
};

const MOVE_TYPES: { key: MoveType; label: string; hint: string }[] = [
  { key: "entry", label: "Entrada", hint: "Chegou mercadoria fora de uma compra lançada" },
  { key: "exit", label: "Saída", hint: "Uso interno, consumo, transferência" },
  { key: "loss", label: "Perda", hint: "Vencido, quebrado, estragado" },
  { key: "count", label: "Contagem", hint: "Digite quanto tem de verdade — o sistema acerta a diferença" },
];

const card = "bg-white border border-gray-200 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]";
const fieldCls = "w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all";
const btnPrimary = "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const btnGhost = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors";
const WHITE = { color: "#fff" };

// ─── Página ───────────────────────────────────────────────────────────────────

export default function StockPage() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("stock");

  const [stockItems, setStockItems] = useState<StockItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recipeCount, setRecipeCount] = useState<Record<string, number>>({});

  // Filtros da lista
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | Kind>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Painel do item
  const [selected, setSelected] = useState<{ kind: Kind; id: string } | null>(null);

  // Modais
  const [ingredientModal, setIngredientModal] = useState<{ item: StockItemRow | null } | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [controlTarget, setControlTarget] = useState<ProductRow | null>(null);

  useEffect(() => {
    (async () => {
      await Promise.all([loadStockItems(), loadProducts(), loadSuppliers(), loadCategories(), loadRecipeCounts()]);
      setLoading(false);
    })();
  }, []);

  async function loadStockItems() {
    const { data } = await supabase.from("stock_items").select("*, suppliers(name)").eq("is_active", true).order("name");
    setStockItems(((data ?? []) as any[]).map(i => ({ ...i, current_qty: Number(i.current_qty) || 0, min_qty: Number(i.min_qty) || 0, cost_price: Number(i.cost_price) || 0 })));
  }
  async function loadProducts() {
    // Inativo = excluído pelo usuário. Ativo com is_active=false = pausado porque zerou.
    const { data } = await supabase.from("products")
      .select("id, name, unit, stock, stock_min, stock_max, cost_price, sale_price, stock_type, unlimited_stock, is_active, status")
      .or("status.is.null,status.neq.inactive").order("name");
    setProducts(((data ?? []) as any[]).map(p => ({ ...p, stock: Number(p.stock) || 0 })));
  }
  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("id, name").order("name");
    setSuppliers((data ?? []) as { id: string; name: string }[]);
  }
  async function loadCategories() {
    const { data } = await supabase.from("categories").select("id, name, parent_id, color, description").order("name");
    setCategories((data ?? []) as Category[]);
  }
  async function loadRecipeCounts() {
    const { data } = await supabase.from("recipe_items").select("product_id");
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as { product_id: string }[]) counts[r.product_id] = (counts[r.product_id] ?? 0) + 1;
    setRecipeCount(counts);
  }
  const reloadItems = () => Promise.all([loadStockItems(), loadProducts()]);

  // ── Derivados ──────────────────────────────────────────────────────────────

  const controlledProducts = products.filter(isControlled);
  const uncontrolledProducts = products.filter(p => !isControlled(p));

  const rows: Row[] = useMemo(() => [
    ...controlledProducts.map(p => ({
      key: `product:${p.id}`, kind: "product" as const, id: p.id, name: p.name, unit: p.unit || "unidade",
      qty: p.stock, min: p.stock_min ?? 0, max: p.stock_max, cost: Number(p.cost_price) || 0,
      subtitle: null, paused: !p.is_active,
    })),
    ...stockItems.map(i => ({
      key: `ingredient:${i.id}`, kind: "ingredient" as const, id: i.id, name: i.name, unit: i.unit,
      qty: i.current_qty, min: i.min_qty, max: i.max_qty, cost: i.cost_price,
      subtitle: [i.category, i.suppliers?.name].filter(Boolean).join(" · ") || null, paused: false,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [products, stockItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalValue = rows.reduce((s, r) => s + Math.max(r.qty, 0) * r.cost, 0);
  const lowCount = rows.filter(r => statusOf(r.qty, r.min) === "low").length;
  const outCount = rows.filter(r => statusOf(r.qty, r.min) === "out").length;

  const q = search.trim().toLowerCase();
  const filteredRows = rows.filter(r =>
    (q === "" || r.name.toLowerCase().includes(q) || (r.subtitle ?? "").toLowerCase().includes(q)) &&
    (kindFilter === "all" || r.kind === kindFilter) &&
    (statusFilter === "all" || statusFilter === "uncontrolled" || statusOf(r.qty, r.min) === statusFilter));
  const filteredUncontrolled = uncontrolledProducts.filter(p => q === "" || p.name.toLowerCase().includes(q));

  const selectedRow = selected ? rows.find(r => r.kind === selected.kind && r.id === selected.id) ?? null : null;

  // Esc fecha a camada de cima
  useEscapeKey(() => {
    if (editProduct) setEditProduct(null);
    else if (controlTarget) setControlTarget(null);
    else if (ingredientModal) setIngredientModal(null);
    else if (selected) setSelected(null);
  }, !!(editProduct || controlTarget || ingredientModal || selected));

  async function openEditProduct(id: string) {
    const { data } = await supabase.from("products").select("*").eq("id", id).single();
    if (data) setEditProduct(data as Product);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Cabeçalho */}
        <div className={`${card} p-5`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">Estoque</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {rows.length} ite{rows.length !== 1 ? "ns" : "m"} com controle de estoque
                {uncontrolledProducts.length > 0 && <> · {uncontrolledProducts.length} produto{uncontrolledProducts.length !== 1 ? "s" : ""} vendido{uncontrolledProducts.length !== 1 ? "s" : ""} sem controle</>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex p-1 bg-gray-100 rounded-xl">
                {([
                  { key: "stock", label: "Estoque", icon: <Boxes className="w-4 h-4" /> },
                  { key: "history", label: "Histórico", icon: <History className="w-4 h-4" /> },
                  { key: "recipes", label: "Fichas técnicas", icon: <BookOpen className="w-4 h-4" /> },
                ] as const).map(t => (
                  <button key={t.key} onClick={() => setView(t.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${view === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                    {t.icon}<span className="hidden sm:inline">{t.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setIngredientModal({ item: null })} className={btnPrimary} style={WHITE}>
                <Plus className="w-4 h-4" /> Novo insumo
              </button>
            </div>
          </div>
        </div>

        {view === "stock" && (
          <>
            {/* Indicadores */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Valor em estoque" value={fmt(totalValue)} sub="pelo custo de compra" />
              <Kpi label="Itens controlados" value={String(rows.length)}
                sub={`${controlledProducts.length} produto${controlledProducts.length !== 1 ? "s" : ""} · ${stockItems.length} insumo${stockItems.length !== 1 ? "s" : ""}`}
                active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
              <Kpi label="Abaixo do mínimo" value={String(lowCount)} sub="precisam de reposição" tone={lowCount > 0 ? "amber" : undefined}
                active={statusFilter === "low"} onClick={() => setStatusFilter(statusFilter === "low" ? "all" : "low")} />
              <Kpi label="Zerados" value={String(outCount)} sub="sem nada em estoque" tone={outCount > 0 ? "red" : undefined}
                active={statusFilter === "out"} onClick={() => setStatusFilter(statusFilter === "out" ? "all" : "out")} />
            </div>

            {/* Barra de filtros */}
            <div className={`${card} p-3 flex flex-col lg:flex-row gap-3 lg:items-center`}>
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto ou insumo..."
                  className={fieldCls + " pl-10 bg-gray-50"} />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Segmented value={kindFilter} onChange={v => setKindFilter(v)} disabled={statusFilter === "uncontrolled"}
                  options={[{ value: "all", label: "Todos" }, { value: "product", label: "Produtos" }, { value: "ingredient", label: "Insumos" }]} />
                <Segmented value={statusFilter} onChange={v => setStatusFilter(v)}
                  options={[
                    { value: "all", label: "Tudo" },
                    { value: "low", label: "Baixo" },
                    { value: "out", label: "Zerado" },
                    { value: "uncontrolled", label: `Sem controle${uncontrolledProducts.length ? ` (${uncontrolledProducts.length})` : ""}` },
                  ]} />
              </div>
            </div>

            {statusFilter === "uncontrolled" ? (
              <UncontrolledList products={filteredUncontrolled} recipeCount={recipeCount}
                onControl={p => setControlTarget(p)}
                onRecipe={() => setView("recipes")} />
            ) : (
              <>
                {uncontrolledProducts.length > 0 && statusFilter === "all" && kindFilter !== "ingredient" && q === "" && (
                  <div className="flex items-start sm:items-center gap-3 px-4 py-3 rounded-2xl bg-blue-50/60 border border-blue-100 text-sm text-blue-900">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5 sm:mt-0 text-blue-600" />
                    <p className="flex-1">
                      <span className="font-semibold">{uncontrolledProducts.length} produto{uncontrolledProducts.length !== 1 ? "s são vendidos" : " é vendido"} sem controle de estoque</span>
                      {" "}(como pratos feitos na hora) e não aparece{uncontrolledProducts.length !== 1 ? "m" : ""} nesta lista.
                    </p>
                    <button onClick={() => setStatusFilter("uncontrolled")} className="flex-shrink-0 text-sm font-semibold text-blue-700 hover:underline">Ver</button>
                  </div>
                )}

                {filteredRows.length === 0 ? (
                  <div className={`${card} text-center py-16 px-6`}>
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
                      <Boxes className="w-6 h-6 text-gray-300" />
                    </div>
                    <p className="text-sm font-semibold text-gray-700">
                      {rows.length === 0 ? "Nenhum item com controle de estoque ainda" : "Nenhum item encontrado"}
                    </p>
                    <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                      {rows.length === 0
                        ? "Produtos com estoque controlado e insumos aparecem aqui. Cadastre um insumo ou ative o controle de um produto em \"Sem controle\"."
                        : "Tente outro nome ou limpe os filtros."}
                    </p>
                  </div>
                ) : (
                  <StockTable rows={filteredRows} onOpen={r => setSelected({ kind: r.kind, id: r.id })} />
                )}
              </>
            )}
          </>
        )}

        {view === "history" && <HistoryView />}

        {view === "recipes" && (
          <RecipesView products={products} stockItems={stockItems}
            onCountsChange={loadRecipeCounts} onNewIngredient={() => setIngredientModal({ item: null })} />
        )}
      </div>

      {/* Painel do item */}
      {selectedRow && (
        <ItemDrawer
          row={selectedRow}
          product={selectedRow.kind === "product" ? products.find(p => p.id === selectedRow.id) ?? null : null}
          ingredient={selectedRow.kind === "ingredient" ? stockItems.find(i => i.id === selectedRow.id) ?? null : null}
          onClose={() => setSelected(null)}
          onChanged={reloadItems}
          onEditProduct={openEditProduct}
          onEditIngredient={item => setIngredientModal({ item })}
          onDeleted={() => { setSelected(null); reloadItems(); }}
        />
      )}

      {ingredientModal && (
        <IngredientModal item={ingredientModal.item} suppliers={suppliers}
          onClose={() => setIngredientModal(null)}
          onSaved={async () => { setIngredientModal(null); await loadStockItems(); }} />
      )}

      {controlTarget && (
        <ControlDialog product={controlTarget} onClose={() => setControlTarget(null)}
          onDone={async () => {
            const id = controlTarget.id;
            setControlTarget(null);
            await loadProducts();
            setStatusFilter("all");
            setSelected({ kind: "product", id });
          }} />
      )}

      {editProduct && (
        <ProductModal product={editProduct} categories={categories}
          onClose={() => setEditProduct(null)}
          onSave={async () => { await reloadItems(); }} />
      )}
    </>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone, active, onClick }: {
  label: string; value: string; sub: string; tone?: "amber" | "red"; active?: boolean; onClick?: () => void;
}) {
  const valueColor = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-gray-900";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`${card} text-left p-4 transition-all ${onClick ? "hover:border-gray-300 cursor-pointer" : ""} ${active && onClick ? "ring-2 ring-blue-500/30 border-blue-300" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-2xl font-black tabular-nums tracking-tight mt-1 ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </Tag>
  );
}

function Segmented<T extends string>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean;
}) {
  return (
    <div className={`flex p-1 bg-gray-100 rounded-xl ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${value === o.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${kind === "product" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
      {kind === "product" ? "Produto" : "Insumo"}
    </span>
  );
}

function LevelBar({ qty, min, max }: { qty: number; min: number; max: number | null }) {
  const st = statusOf(qty, min);
  const target = max && max > 0 ? max : min > 0 ? min * 2 : Math.max(qty, 1);
  const pct = Math.max(0, Math.min(100, (qty / target) * 100));
  return (
    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${STATUS[st].bar}`} style={{ width: `${st === "out" ? 0 : Math.max(pct, 4)}%` }} />
    </div>
  );
}

function StockTable({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  const total = rows.reduce((s, r) => s + Math.max(r.qty, 0) * r.cost, 0);
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="hidden md:grid grid-cols-[minmax(0,1fr)_180px_100px_110px_120px_28px] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <span>Item</span><span>Estoque</span><span className="text-right">Mínimo</span>
        <span className="text-right">Custo un.</span><span className="text-right">Valor</span><span />
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(r => {
          const st = statusOf(r.qty, r.min);
          return (
            <button key={r.key} onClick={() => onOpen(r)}
              className="w-full text-left grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_180px_100px_110px_120px_28px] gap-x-4 gap-y-1 items-center px-4 md:px-5 py-3 hover:bg-gray-50 transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 truncate max-w-full">{r.name}</span>
                  <KindBadge kind={r.kind} />
                  {st !== "ok" && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS[st].badge}`}>{STATUS[st].label}</span>}
                  {r.paused && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600" title="Pausado nas vendas porque o estoque zerou">Pausado nas vendas</span>}
                </div>
                {r.subtitle && <p className="text-xs text-gray-500 truncate mt-0.5">{r.subtitle}</p>}
              </div>
              {/* Celular: quantidade à direita */}
              <div className="md:hidden text-right">
                <p className={`text-sm font-bold tabular-nums ${STATUS[st].text}`}>{fmtQty(r.qty, r.unit)}</p>
                <p className="text-[11px] text-gray-400">{r.min > 0 ? `mín ${fmtNum(r.min)}` : "sem mínimo"}</p>
              </div>
              <div className="hidden md:block">
                <p className={`text-sm font-bold tabular-nums ${STATUS[st].text}`}>{fmtQty(r.qty, r.unit)}</p>
                <div className="mt-1.5"><LevelBar qty={r.qty} min={r.min} max={r.max} /></div>
              </div>
              <span className="hidden md:block text-right text-sm text-gray-500 tabular-nums">{r.min > 0 ? fmtNum(r.min) : "—"}</span>
              <span className="hidden md:block text-right text-sm text-gray-700 tabular-nums">{r.cost > 0 ? fmt(r.cost) : "—"}</span>
              <span className="hidden md:block text-right text-sm font-semibold text-gray-900 tabular-nums">{fmt(Math.max(r.qty, 0) * r.cost)}</span>
              <ChevronRight className="hidden md:block w-4 h-4 text-gray-300" />
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60 text-xs text-gray-500">
        <span>{rows.length} ite{rows.length !== 1 ? "ns" : "m"}</span>
        <span>Valor: <span className="font-semibold text-gray-900">{fmt(total)}</span></span>
      </div>
    </div>
  );
}

function UncontrolledList({ products, recipeCount, onControl, onRecipe }: {
  products: ProductRow[]; recipeCount: Record<string, number>;
  onControl: (p: ProductRow) => void; onRecipe: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-gray-50 border border-gray-200 text-sm text-gray-700">
        <InfinityIcon className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-500" />
        <p>
          Estes produtos são vendidos <span className="font-semibold">sem contar estoque</span> — nunca travam no PDV.
          Bom para o que você repõe todo dia e não quer controlar. Quer saber o que eles gastam de ingredientes?
          Monte uma <button onClick={onRecipe} className="font-semibold text-blue-700 hover:underline">ficha técnica</button>.
          Quer contar a quantidade? Use <span className="font-semibold">Controlar estoque</span>.
        </p>
      </div>
      {products.length === 0 ? (
        <div className={`${card} text-center py-12 text-sm text-gray-500`}>Nenhum produto sem controle encontrado.</div>
      ) : (
        <div className={`${card} overflow-hidden divide-y divide-gray-100`}>
          {products.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 md:px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {recipeCount[p.id] ? `Ficha técnica com ${recipeCount[p.id]} insumo${recipeCount[p.id] !== 1 ? "s" : ""}` : "Sem ficha técnica"}
                  {p.sale_price ? ` · venda ${fmt(Number(p.sale_price))}` : ""}
                </p>
              </div>
              <button onClick={() => onControl(p)} className={btnGhost + " !py-1.5 !px-3 text-xs"}>
                Controlar estoque
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Painel lateral do item ───────────────────────────────────────────────────

function ItemDrawer({ row, product, ingredient, onClose, onChanged, onEditProduct, onEditIngredient, onDeleted }: {
  row: Row; product: ProductRow | null; ingredient: StockItemRow | null;
  onClose: () => void; onChanged: () => Promise<unknown>;
  onEditProduct: (id: string) => void; onEditIngredient: (i: StockItemRow) => void; onDeleted: () => void;
}) {
  const [moveType, setMoveType] = useState<MoveType>("entry");
  const [moveQty, setMoveQty] = useState("");
  const [moveCost, setMoveCost] = useState("");
  const [moveNotes, setMoveNotes] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveOk, setMoveOk] = useState<string | null>(null);

  const [minStr, setMinStr] = useState(String(row.min || ""));
  const [maxStr, setMaxStr] = useState(row.max != null ? String(row.max) : "");
  const [savingLimits, setSavingLimits] = useState(false);

  const [history, setHistory] = useState<Movement[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refType = row.kind === "product" ? "product" : "ingredient";

  useEffect(() => {
    setMinStr(String(row.min || "")); setMaxStr(row.max != null ? String(row.max) : "");
    setMoveQty(""); setMoveCost(""); setMoveNotes(""); setMoveError(null); setMoveOk(null); setMoveType("entry");
    loadHistory();
  }, [row.key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory() {
    const col = row.kind === "product" ? "product_id" : "stock_item_id";
    const { data } = await supabase.from("inventory_movements").select("*").eq(col, row.id)
      .order("created_at", { ascending: false }).limit(50);
    setHistory((data ?? []) as Movement[]);
  }

  const qtyVal = num(moveQty);
  const preview = moveType === "entry" ? row.qty + qtyVal
    : moveType === "count" ? qtyVal
    : Math.max(row.qty - qtyVal, 0);
  const canMove = moveQty.trim() !== "" && (moveType === "count" ? qtyVal >= 0 : qtyVal > 0) && !moving;

  async function registerMove() {
    if (!canMove) return;
    setMoving(true); setMoveError(null); setMoveOk(null);
    const { error } = await supabase.rpc("adjust_inventory", {
      p_ref_type: refType, p_item_id: row.id, p_type: moveType, p_quantity: qtyVal,
      p_notes: moveNotes || null, p_unit_cost: moveType === "entry" && moveCost ? num(moveCost) : null,
    });
    if (error) { setMoveError(error.message); setMoving(false); return; }
    setMoveOk(`${MOVE_TYPES.find(t => t.key === moveType)?.label} registrada. Estoque agora: ${fmtQty(preview, row.unit)}.`);
    setMoveQty(""); setMoveCost(""); setMoveNotes("");
    await Promise.all([onChanged(), loadHistory()]);
    setMoving(false);
  }

  const limitsChanged = num(minStr) !== (row.min || 0) || (maxStr.trim() === "" ? null : num(maxStr)) !== row.max;
  async function saveLimits() {
    setSavingLimits(true);
    const min = num(minStr);
    const max = maxStr.trim() === "" ? null : num(maxStr);
    if (row.kind === "product") {
      // stock_min / stock_max são inteiros no cadastro de produto
      await supabase.from("products").update({ stock_min: Math.round(min), stock_max: max == null ? null : Math.round(max) }).eq("id", row.id);
    } else {
      await supabase.from("stock_items").update({ min_qty: min, max_qty: max }).eq("id", row.id);
    }
    await onChanged();
    setSavingLimits(false);
  }

  async function stopControlling() {
    if (!product || busy) return;
    if (!confirm(`Parar de controlar o estoque de "${product.name}"?\n\nEle passa a ser vendido sem contar quantidade e nunca trava no PDV. O histórico fica guardado.`)) return;
    setBusy(true);
    await supabase.from("products").update({
      stock_type: "unlimited", unlimited_stock: false,
      is_active: (product.status ?? "active") === "active",
    }).eq("id", product.id);
    await onChanged();
    setBusy(false);
    onClose();
  }

  async function deleteIngredient() {
    if (!ingredient || busy) return;
    if (!confirm(`Excluir o insumo "${ingredient.name}"?\n\nEle some da lista e das fichas técnicas deixa de ser descontado.`)) return;
    setBusy(true);
    await supabase.from("stock_items").update({ is_active: false }).eq("id", ingredient.id);
    await supabase.from("recipe_items").delete().eq("stock_item_id", ingredient.id);
    setBusy(false);
    onDeleted();
  }

  const st = statusOf(row.qty, row.min);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full sm:w-[460px] h-full bg-white shadow-2xl flex flex-col sm:m-3 sm:h-[calc(100%-24px)] sm:rounded-2xl overflow-hidden">
        {/* Topo */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1"><KindBadge kind={row.kind} />
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS[st].badge}`}>{STATUS[st].label}</span>
              {row.paused && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600">Pausado nas vendas</span>}
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">{row.name}</h2>
            {row.subtitle && <p className="text-xs text-gray-500 mt-0.5">{row.subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-xl text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Números */}
          <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
            <div className="bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Em estoque</p>
              <p className={`text-xl font-black tabular-nums mt-0.5 ${STATUS[st].text}`}>{fmtNum(row.qty)}</p>
              <p className="text-[11px] text-gray-400">{row.unit}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Custo un.</p>
              <p className="text-xl font-black tabular-nums mt-0.5 text-gray-900">{row.cost > 0 ? fmt(row.cost) : "—"}</p>
              <p className="text-[11px] text-gray-400">última compra</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Valor</p>
              <p className="text-xl font-black tabular-nums mt-0.5 text-gray-900">{fmt(Math.max(row.qty, 0) * row.cost)}</p>
              <p className="text-[11px] text-gray-400">parado</p>
            </div>
          </div>

          {row.paused && (
            <div className="mx-5 mt-4 flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Este produto zerou e foi pausado no PDV e no cardápio. Ao dar entrada, ele volta a ser vendido.
            </div>
          )}

          {/* Movimentar */}
          <section className="px-5 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Movimentar estoque</p>
            <div className="grid grid-cols-4 gap-1 p-1 bg-gray-100 rounded-xl">
              {MOVE_TYPES.map(t => (
                <button key={t.key} onClick={() => { setMoveType(t.key); setMoveError(null); setMoveOk(null); }}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${moveType === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">{MOVE_TYPES.find(t => t.key === moveType)?.hint}</p>
            <div className={`grid ${moveType === "entry" ? "grid-cols-2" : "grid-cols-1"} gap-2 mt-3`}>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{moveType === "count" ? `Quantidade contada (${row.unit})` : `Quantidade (${row.unit})`}</label>
                <input value={moveQty} onChange={e => setMoveQty(e.target.value)} type="number" min="0" step="0.001"
                  onKeyDown={e => { if (e.key === "Enter") registerMove(); }}
                  placeholder="0" className={fieldCls} />
              </div>
              {moveType === "entry" && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Custo unitário (opcional)</label>
                  <input value={moveCost} onChange={e => setMoveCost(e.target.value)} type="number" min="0" step="0.01" placeholder="0,00" className={fieldCls} />
                </div>
              )}
            </div>
            <input value={moveNotes} onChange={e => setMoveNotes(e.target.value)} placeholder="Observação (opcional)" className={fieldCls + " mt-2"} />
            <div className="flex items-center justify-between gap-3 mt-3">
              <p className="text-xs text-gray-500">
                {moveQty.trim() !== "" && <>Estoque: <span className="font-semibold text-gray-900">{fmtNum(row.qty)}</span> → <span className="font-semibold text-gray-900">{fmtNum(preview)} {row.unit}</span></>}
              </p>
              <button onClick={registerMove} disabled={!canMove} className={btnPrimary} style={WHITE}>
                {moving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Registrar
              </button>
            </div>
            {moveError && <p className="text-xs text-red-600 mt-2">{moveError}</p>}
            {moveOk && <p className="text-xs text-emerald-700 mt-2">{moveOk}</p>}
          </section>

          {/* Limites */}
          <section className="px-5 pt-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Alerta de reposição</p>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mínimo</label>
                <input value={minStr} onChange={e => setMinStr(e.target.value)} type="number" min="0" step={row.kind === "product" ? "1" : "0.001"} placeholder="0" className={fieldCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Máximo (opcional)</label>
                <input value={maxStr} onChange={e => setMaxStr(e.target.value)} type="number" min="0" step={row.kind === "product" ? "1" : "0.001"} placeholder="—" className={fieldCls} />
              </div>
              <button onClick={saveLimits} disabled={!limitsChanged || savingLimits} className={btnGhost}>
                {savingLimits ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Salvar"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Quando chegar no mínimo, o item aparece como "Baixo".</p>
          </section>

          {/* Histórico */}
          <section className="px-5 pt-6 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Histórico</p>
            {history === null ? (
              <div className="py-6 flex justify-center"><RefreshCw className="w-4 h-4 animate-spin text-gray-300" /></div>
            ) : history.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-xl">
                Nenhuma movimentação registrada ainda. Compras, vendas e ajustes aparecem aqui a partir de agora.
              </p>
            ) : (
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-100">
                {history.map(m => <MovementLine key={m.id} m={m} unit={row.unit} />)}
              </div>
            )}
          </section>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60">
          {row.kind === "product" ? (
            <button onClick={stopControlling} disabled={busy} className="text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-40">
              Parar de controlar estoque
            </button>
          ) : (
            <button onClick={deleteIngredient} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" /> Excluir insumo
            </button>
          )}
          <button onClick={() => row.kind === "product" ? onEditProduct(row.id) : ingredient && onEditIngredient(ingredient)} className={btnGhost}>
            <Pencil className="w-4 h-4" /> Editar cadastro
          </button>
        </div>
      </div>
    </div>
  );
}

function MovementLine({ m, unit, showItem }: { m: Movement; unit: string; showItem?: boolean }) {
  const info = MOVE_INFO[m.type] ?? { label: m.type, icon: <Package className="w-3.5 h-3.5" />, tone: "bg-gray-100 text-gray-700" };
  const q = Number(m.quantity);
  const itemName = m.products?.name ?? m.stock_items?.name ?? "—";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${info.tone}`}>{info.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 truncate">
          {showItem ? <><span className="font-semibold">{itemName}</span> <span className="text-gray-500">· {info.label}</span></> : <span className="font-medium">{info.label}</span>}
        </p>
        <p className="text-[11px] text-gray-500 truncate">{fmtDateTime(m.created_at)}{m.notes ? ` · ${m.notes}` : ""}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-bold tabular-nums ${q > 0 ? "text-emerald-600" : q < 0 ? "text-red-600" : "text-gray-500"}`}>
          {q > 0 ? "+" : ""}{fmtNum(q)} {unit}
        </p>
        {m.balance_after != null && <p className="text-[11px] text-gray-400 tabular-nums">saldo {fmtNum(Number(m.balance_after))}</p>}
      </div>
    </div>
  );
}

// ─── Histórico geral ──────────────────────────────────────────────────────────

function HistoryView() {
  const [moves, setMoves] = useState<Movement[] | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "sale" | "out" | "count">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("inventory_movements")
        .select("*, products(name, unit), stock_items(name, unit)")
        .order("created_at", { ascending: false }).limit(300);
      setMoves((data ?? []) as Movement[]);
    })();
  }, []);

  const groups: Record<string, string[]> = {
    in: ["entry", "purchase", "return"], sale: ["sale"], out: ["exit", "loss", "purchase_cancel"], count: ["count"],
  };
  const q = search.trim().toLowerCase();
  const list = (moves ?? []).filter(m =>
    (filter === "all" || groups[filter].includes(m.type)) &&
    (q === "" || (m.products?.name ?? m.stock_items?.name ?? "").toLowerCase().includes(q)));

  return (
    <div className="space-y-3">
      <div className={`${card} p-3 flex flex-col lg:flex-row gap-3 lg:items-center`}>
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar por item..." className={fieldCls + " pl-10 bg-gray-50"} />
        </div>
        <Segmented value={filter} onChange={v => setFilter(v as typeof filter)} options={[
          { value: "all", label: "Tudo" }, { value: "in", label: "Entradas" }, { value: "sale", label: "Vendas" },
          { value: "out", label: "Saídas e perdas" }, { value: "count", label: "Contagens" },
        ]} />
      </div>
      <div className={`${card} overflow-hidden`}>
        {moves === null ? (
          <div className="py-16 flex justify-center"><RefreshCw className="w-5 h-5 animate-spin text-gray-300" /></div>
        ) : list.length === 0 ? (
          <div className="text-center py-16 px-6">
            <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-700">Nenhuma movimentação {moves.length > 0 ? "com esse filtro" : "ainda"}</p>
            <p className="text-xs text-gray-500 mt-1">Compras, vendas de itens controlados, fichas técnicas e ajustes aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {list.map(m => <MovementLine key={m.id} m={m} unit={m.products?.unit ?? m.stock_items?.unit ?? ""} showItem />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fichas técnicas ──────────────────────────────────────────────────────────

function RecipesView({ products, stockItems, onCountsChange, onNewIngredient }: {
  products: ProductRow[]; stockItems: StockItemRow[]; onCountsChange: () => void; onNewIngredient: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadCounts(); }, []);
  async function loadCounts() {
    const { data } = await supabase.from("recipe_items").select("product_id");
    const c: Record<string, number> = {};
    for (const r of (data ?? []) as { product_id: string }[]) c[r.product_id] = (c[r.product_id] ?? 0) + 1;
    setCounts(c);
  }
  async function loadLines(productId: string) {
    const { data } = await supabase.from("recipe_items").select("id, product_id, stock_item_id, quantity").eq("product_id", productId);
    setLines(((data ?? []) as any[]).map(l => ({ ...l, quantity: Number(l.quantity) })));
  }

  const q = search.trim().toLowerCase();
  const list = products.filter(p => q === "" || p.name.toLowerCase().includes(q))
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
  const selected = products.find(p => p.id === selectedId) ?? null;
  const ingById = (id: string) => stockItems.find(s => s.id === id);
  const addIng = ingById(addItemId);

  async function addLine() {
    if (!selected || !addItemId || num(addQty) <= 0 || saving) return;
    setSaving(true); setError(null);
    const { error } = await supabase.from("recipe_items").upsert(
      { product_id: selected.id, stock_item_id: addItemId, quantity: num(addQty) },
      { onConflict: "product_id,stock_item_id" });
    if (error) setError(error.message);
    setAddItemId(""); setAddQty("");
    await Promise.all([loadLines(selected.id), loadCounts()]);
    onCountsChange();
    setSaving(false);
  }
  async function removeLine(id: string) {
    if (!selected) return;
    await supabase.from("recipe_items").delete().eq("id", id);
    await Promise.all([loadLines(selected.id), loadCounts()]);
    onCountsChange();
  }

  const recipeCost = lines.reduce((s, l) => s + (ingById(l.stock_item_id)?.cost_price ?? 0) * l.quantity, 0);
  const salePrice = Number(selected?.sale_price) || 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-blue-50/60 border border-blue-100 text-sm text-blue-900">
        <BookOpen className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-600" />
        <p>
          <span className="font-semibold">Ficha técnica</span> é a receita do produto: quanto de cada insumo ele gasta.
          A cada venda no PDV ou nas Mesas, o sistema desconta os insumos sozinho e mostra o custo real do prato.
          Funciona até para produtos vendidos sem controle de estoque.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-3 items-start">
        {/* Lista de produtos */}
        <div className={`${card} overflow-hidden ${selected ? "hidden lg:block" : ""}`}>
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className={fieldCls + " pl-9 bg-gray-50 !py-2"} />
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-50">
            {list.map(p => (
              <button key={p.id} onClick={() => { setSelectedId(p.id); setLines([]); setError(null); loadLines(p.id); }}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${selectedId === p.id ? "bg-blue-50 text-blue-800" : "text-gray-800 hover:bg-gray-50"}`}>
                <span className="flex-1 truncate">{p.name}</span>
                {counts[p.id] ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700">{counts[p.id]} insumo{counts[p.id] !== 1 ? "s" : ""}</span>
                ) : <span className="text-[10px] text-gray-400">vazia</span>}
              </button>
            ))}
            {list.length === 0 && <p className="text-xs text-gray-400 text-center py-8">Nenhum produto encontrado.</p>}
          </div>
        </div>

        {/* Editor */}
        {!selected ? (
          <div className={`${card} hidden lg:flex flex-col items-center justify-center text-center py-20 px-6`}>
            <BookOpen className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm font-semibold text-gray-700">Escolha um produto</p>
            <p className="text-xs text-gray-500 mt-1">para ver ou montar a ficha técnica dele.</p>
          </div>
        ) : (
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <button onClick={() => setSelectedId(null)} className="lg:hidden text-xs font-semibold text-blue-700 mb-1">← Produtos</button>
                <h2 className="text-base font-bold text-gray-900 truncate">{selected.name}</h2>
                <p className="text-xs text-gray-500">Insumos gastos em 1 unidade vendida</p>
              </div>
            </div>

            {stockItems.length === 0 ? (
              <div className="text-center py-12 px-6">
                <p className="text-sm font-semibold text-gray-700">Você ainda não tem insumos cadastrados</p>
                <p className="text-xs text-gray-500 mt-1">Cadastre os ingredientes (ex.: arroz, óleo, carne) para montar a ficha.</p>
                <button onClick={onNewIngredient} className={btnPrimary + " mt-4"} style={WHITE}><Plus className="w-4 h-4" /> Novo insumo</button>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-end">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Insumo</label>
                      <select value={addItemId} onChange={e => setAddItemId(e.target.value)} className={fieldCls + " cursor-pointer"}>
                        <option value="">Selecionar...</option>
                        {stockItems.map(s => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Quantidade{addIng ? ` (${addIng.unit})` : ""}</label>
                      <input value={addQty} onChange={e => setAddQty(e.target.value)} type="number" min="0" step="0.001" placeholder="0"
                        onKeyDown={e => { if (e.key === "Enter") addLine(); }} className={fieldCls} />
                    </div>
                    <button onClick={addLine} disabled={!addItemId || num(addQty) <= 0 || saving} className={btnPrimary} style={WHITE}>
                      <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Adicionar</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">A quantidade é na mesma unidade do insumo. Ex.: arroz em kg → 0,2 para 200 g.</p>
                  {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
                </div>

                {lines.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-10">Nenhum insumo nesta ficha ainda.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {lines.map(l => {
                      const ing = ingById(l.stock_item_id);
                      const enough = ing ? ing.current_qty >= l.quantity : true;
                      return (
                        <div key={l.id} className="flex items-center gap-3 px-5 py-3">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${enough ? "bg-emerald-500" : "bg-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{ing?.name ?? "Insumo removido"}</p>
                            <p className="text-xs text-gray-500">
                              {fmtQty(l.quantity, ing?.unit ?? "")} por unidade
                              {ing && <> · estoque {fmtQty(ing.current_qty, ing.unit)}</>}
                            </p>
                          </div>
                          <span className="text-sm text-gray-700 tabular-nums">{ing?.cost_price ? fmt(ing.cost_price * l.quantity) : "—"}</span>
                          <button onClick={() => removeLine(l.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-px bg-gray-100 border-t border-gray-100">
                  <div className="bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Custo da ficha</p>
                    <p className="text-lg font-black text-gray-900 tabular-nums">{fmt(recipeCost)}</p>
                  </div>
                  <div className="bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Preço de venda</p>
                    <p className="text-lg font-black text-gray-900 tabular-nums">{salePrice > 0 ? fmt(salePrice) : "—"}</p>
                  </div>
                  <div className="bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Margem</p>
                    <p className={`text-lg font-black tabular-nums ${salePrice > 0 && recipeCost > 0 ? ((salePrice - recipeCost) / salePrice < 0.2 ? "text-amber-600" : "text-emerald-600") : "text-gray-300"}`}>
                      {salePrice > 0 && recipeCost > 0 ? `${(((salePrice - recipeCost) / salePrice) * 100).toFixed(0)}%` : "—"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cadastro de insumo ───────────────────────────────────────────────────────

function IngredientModal({ item, suppliers, onClose, onSaved }: {
  item: StockItemRow | null; suppliers: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "kg");
  const [category, setCategory] = useState(item?.category ?? "");
  const [supplierId, setSupplierId] = useState(item?.supplier_id ?? "");
  const [cost, setCost] = useState(item ? String(item.cost_price || "") : "");
  const [initialQty, setInitialQty] = useState("");
  const [minQty, setMinQty] = useState(item ? String(item.min_qty || "") : "");
  const [maxQty, setMaxQty] = useState(item?.max_qty != null ? String(item.max_qty) : "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Informe o nome do insumo."); return; }
    setSaving(true); setError(null);
    const payload = {
      name: name.trim(), unit, category: category.trim() || null, supplier_id: supplierId || null,
      cost_price: num(cost), min_qty: num(minQty), max_qty: maxQty.trim() ? num(maxQty) : null, notes: notes.trim() || null,
    };
    if (item) {
      const { error } = await supabase.from("stock_items").update(payload).eq("id", item.id);
      if (error) { setError(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from("stock_items").insert({ ...payload, current_qty: 0 }).select("id").single();
      if (error || !data) { setError(error?.message ?? "Erro ao salvar."); setSaving(false); return; }
      // Estoque inicial entra pelo histórico, como qualquer entrada
      if (num(initialQty) > 0) {
        await supabase.rpc("adjust_inventory", {
          p_ref_type: "ingredient", p_item_id: data.id, p_type: "entry", p_quantity: num(initialQty),
          p_notes: "Estoque inicial", p_unit_cost: num(cost) || null,
        });
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">{item ? "Editar insumo" : "Novo insumo"}</h2>
            <p className="text-xs text-gray-500">Ingrediente ou material usado no preparo — não é vendido direto.</p>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-xl text-gray-400 hover:text-gray-900 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome *</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Arroz, Óleo de soja, Carne moída" className={fieldCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unidade</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className={fieldCls + " cursor-pointer"}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Custo por {unit}</label>
              <input value={cost} onChange={e => setCost(e.target.value)} type="number" min="0" step="0.01" placeholder="0,00" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Categoria</label>
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex.: Grãos, Carnes" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fornecedor</label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={fieldCls + " cursor-pointer"}>
                <option value="">—</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className={`grid ${item ? "grid-cols-2" : "grid-cols-3"} gap-3`}>
            {!item && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Qtd. atual</label>
                <input value={initialQty} onChange={e => setInitialQty(e.target.value)} type="number" min="0" step="0.001" placeholder="0" className={fieldCls} />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mínimo</label>
              <input value={minQty} onChange={e => setMinQty(e.target.value)} type="number" min="0" step="0.001" placeholder="0" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Máximo</label>
              <input value={maxQty} onChange={e => setMaxQty(e.target.value)} type="number" min="0" step="0.001" placeholder="—" className={fieldCls} />
            </div>
          </div>
          {item && <p className="text-xs text-gray-400 -mt-2">Para mudar a quantidade, use "Movimentar estoque" no painel do insumo.</p>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" className={fieldCls} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className={btnGhost + " flex-1"}>Cancelar</button>
          <button onClick={save} disabled={saving} className={btnPrimary + " flex-1"} style={WHITE}>
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ativar controle de estoque de um produto ─────────────────────────────────

function ControlDialog({ product, onClose, onDone }: { product: ProductRow; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("");
  const [min, setMin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmControl() {
    if (qty.trim() === "" || num(qty) < 0) { setError("Informe quanto você tem hoje (pode ser 0)."); return; }
    setSaving(true); setError(null);
    const { error: upErr } = await supabase.from("products").update({
      stock_type: "controlled", unlimited_stock: false, stock_min: Math.round(num(min)),
    }).eq("id", product.id);
    if (upErr) { setError(upErr.message); setSaving(false); return; }
    // Saldo inicial entra como contagem no histórico
    const { error: rpcErr } = await supabase.rpc("adjust_inventory", {
      p_ref_type: "product", p_item_id: product.id, p_type: "count", p_quantity: num(qty), p_notes: "Início do controle de estoque",
    });
    if (rpcErr) { setError(rpcErr.message); setSaving(false); return; }
    setSaving(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900">Controlar estoque</h2>
            <p className="text-xs text-gray-500 truncate">{product.name}</p>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-xl text-gray-400 hover:text-gray-900 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quanto tem hoje? *</label>
              <input autoFocus value={qty} onChange={e => setQty(e.target.value)} type="number" min="0" step="1" placeholder="0" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Estoque mínimo</label>
              <input value={min} onChange={e => setMin(e.target.value)} type="number" min="0" step="1" placeholder="0" className={fieldCls} />
            </div>
          </div>
          <div className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>A partir de agora cada venda desconta do estoque. <b>Quando zerar, o produto é pausado</b> no PDV e no cardápio até você repor (por uma compra ou entrada).</span>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className={btnGhost + " flex-1"}>Cancelar</button>
          <button onClick={confirmControl} disabled={saving} className={btnPrimary + " flex-1"} style={WHITE}>
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Ativar controle
          </button>
        </div>
      </div>
    </div>
  );
}
