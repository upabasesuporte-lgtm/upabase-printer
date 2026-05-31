import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Boxes, Plus, Search, X, Edit2, Trash2, RefreshCw, AlertTriangle,
  TrendingUp, ShoppingCart, Truck, BarChart3, ArrowDownToLine,
  ArrowUpFromLine, RotateCcw, Flame, ClipboardList, DollarSign,
  Building2, Phone, Mail, Check, ChevronDown, BookOpen,
  Package, Save, Warehouse,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string; name: string; cnpj: string | null; phone: string | null;
  email: string | null; contact_name: string | null; address: string | null;
  notes: string | null; is_active: boolean; created_at: string;
}

interface StockItem {
  id: string; name: string; unit: string; current_qty: number; min_qty: number;
  max_qty: number | null; cost_price: number; supplier_id: string | null;
  category: string | null; notes: string | null; is_active: boolean; created_at: string;
  suppliers?: { name: string } | null;
}

interface RecipeIngredient {
  id: string; product_id: string; stock_item_id: string; quantity: number; unit: string;
  stock_items?: { name: string; unit: string; current_qty: number } | null;
}

interface StockMovement {
  id: string; stock_item_id: string | null; type: string; quantity: number;
  cost_price: number | null; reference_type: string | null; notes: string | null;
  created_at: string; stock_items?: { name: string; unit: string } | null;
}

interface PurchaseOrder {
  id: string; supplier_id: string | null; status: string; notes: string | null;
  created_at: string; received_at: string | null;
  suppliers?: { name: string } | null;
  purchase_order_items?: POItem[];
}

interface POItem {
  id?: string; stock_item_id: string; quantity: number; unit_cost: number;
  stock_items?: { name: string; unit: string } | null;
}

interface SimpleProduct { id: string; name: string; unit: string; }

interface LimitedProduct {
  id: string; name: string; unit: string; stock: number; stock_min: number;
  stock_max: number | null; cost_price: number; is_active: boolean;
  unlimited_stock: boolean | null;
}

// item unificado para exibição na lista
interface UnifiedItem {
  id: string; name: string; unit: string; current_qty: number; min_qty: number;
  max_qty: number | null; cost_price: number; category: string | null;
  supplier_name: string | null; entry_type: "product" | "ingredient"; is_active: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNITS = ["unidade","kg","g","litro","ml","metro","cm","caixa","dúzia","pacote","porção"];

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtQty = (v: number, unit: string) =>
  `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";
const selectCls = inputCls + " cursor-pointer";

function getStockStatus(item: StockItem): "out" | "low" | "ok" {
  if (item.current_qty <= 0) return "out";
  if (item.min_qty > 0 && item.current_qty <= item.min_qty) return "low";
  return "ok";
}

const STATUS_CFG = {
  out: { label: "Sem Estoque", badge: "text-red-400 bg-red-500/10 border border-red-500/20", bar: "bg-red-500" },
  low: { label: "Estoque Baixo", badge: "text-amber-400 bg-amber-500/10 border border-amber-500/20", bar: "bg-amber-500" },
  ok:  { label: "Normal", badge: "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20", bar: "bg-emerald-500" },
};

const MOV_INFO: Record<string, { label: string; color: string; sign: string; bg: string }> = {
  entry:      { label: "Entrada",   color: "text-emerald-400", sign: "+", bg: "bg-emerald-500/10" },
  exit:       { label: "Saída",     color: "text-red-400",     sign: "-", bg: "bg-red-500/10"     },
  adjustment: { label: "Ajuste",    color: "text-blue-400",    sign: "±", bg: "bg-blue-500/10"    },
  loss:       { label: "Perda",     color: "text-orange-400",  sign: "-", bg: "bg-orange-500/10"  },
  sale:       { label: "Venda",     color: "text-violet-400",  sign: "-", bg: "bg-violet-500/10"  },
  return:     { label: "Devolução", color: "text-teal-400",    sign: "+", bg: "bg-teal-500/10"    },
};

type Tab = "overview" | "items" | "recipes" | "movements" | "purchases" | "suppliers";
type Modal = "none" | "item" | "movement" | "purchase" | "supplier" | "deleteItem";

// ─── Component ────────────────────────────────────────────────────────────────

export default function StockPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const card = isLight ? {
    bg: "#ffffff",
    border: "1px solid #e5e7eb",
    shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    bg: "#18181b",
    border: "1px solid rgba(39,39,42,0.8)",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  // Data
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [limitedProducts, setLimitedProducts] = useState<LimitedProduct[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<SimpleProduct[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [itemTypeFilter, setItemTypeFilter] = useState<"all" | "product" | "ingredient">("all");
  const [movFilter, setMovFilter] = useState<"all" | "entry" | "exit" | "adjustment" | "loss" | "sale">("all");
  // movement modal extra
  const [movItemType, setMovItemType] = useState<"ingredient" | "product">("ingredient");

  // Modal
  const [modal, setModal] = useState<Modal>("none");
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; table: string } | null>(null);

  // Recipe
  const [selectedProduct, setSelectedProduct] = useState<SimpleProduct | null>(null);
  const [recipes, setRecipes] = useState<RecipeIngredient[]>([]);
  const [recipeItemId, setRecipeItemId] = useState("");
  const [recipeQty, setRecipeQty] = useState("");
  const [recipeUnit, setRecipeUnit] = useState("unidade");

  // Item form
  const [iName, setIName] = useState("");
  const [iUnit, setIUnit] = useState("unidade");
  const [iCurrentQty, setICurrentQty] = useState("0");
  const [iMinQty, setIMinQty] = useState("0");
  const [iMaxQty, setIMaxQty] = useState("");
  const [iCostPrice, setICostPrice] = useState("0");
  const [iSupplierId, setISupplierId] = useState("");
  const [iCategory, setICategory] = useState("");
  const [iNotes, setINotes] = useState("");

  // Supplier form
  const [sName, setSName] = useState("");
  const [sCnpj, setSCnpj] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sEmail, setSEmail] = useState("");
  const [sContact, setSContact] = useState("");
  const [sAddress, setSAddress] = useState("");
  const [sNotes, setSNotes] = useState("");

  // Movement form
  const [movItemId, setMovItemId] = useState("");
  const [movType, setMovType] = useState("entry");
  const [movQty, setMovQty] = useState("");
  const [movCost, setMovCost] = useState("");
  const [movNotes, setMovNotes] = useState("");

  // Purchase form
  const [poSupplierId, setPOSupplierId] = useState("");
  const [poNotes, setPONotes] = useState("");
  const [poItems, setPOItems] = useState<{ stock_item_id: string; quantity: string; unit_cost: string }[]>([]);
  const [expandedPO, setExpandedPO] = useState<string | null>(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      await Promise.all([loadStockItems(), loadSuppliers(), loadProducts(), loadLimitedProducts()]);
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (tab === "movements") loadMovements();
    if (tab === "purchases") loadPurchases();
  }, [tab]);

  // ── Loaders ───────────────────────────────────────────────────────────────

  async function loadStockItems() {
    const { data } = await supabase
      .from("stock_items").select("*, suppliers(name)")
      .eq("is_active", true).order("name");
    setStockItems((data ?? []) as StockItem[]);
  }

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers((data ?? []) as Supplier[]);
  }

  async function loadMovements() {
    const { data } = await supabase
      .from("stock_movements").select("*, stock_items(name, unit)")
      .order("created_at", { ascending: false }).limit(300);
    setMovements((data ?? []) as StockMovement[]);
  }

  async function loadPurchases() {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_items(*, stock_items(name, unit))")
      .order("created_at", { ascending: false });
    setPurchases((data ?? []) as PurchaseOrder[]);
  }

  async function loadProducts() {
    const { data } = await supabase
      .from("products").select("id, name, unit").eq("is_active", true).order("name");
    setProducts((data ?? []) as SimpleProduct[]);
  }

  async function loadLimitedProducts() {
    const { data } = await supabase
      .from("products")
      .select("id, name, unit, stock, stock_min, stock_max, cost_price, is_active, unlimited_stock")
      .or("unlimited_stock.eq.false,unlimited_stock.is.null")
      .order("name");
    setLimitedProducts((data ?? []) as LimitedProduct[]);
  }

  async function loadRecipes(productId: string) {
    const { data } = await supabase
      .from("product_recipes")
      .select("*, stock_items(name, unit, current_qty)")
      .eq("product_id", productId);
    setRecipes((data ?? []) as RecipeIngredient[]);
  }

  // ── Stock Items CRUD ──────────────────────────────────────────────────────

  function openItemModal(item?: StockItem) {
    if (item) {
      setEditingItem(item);
      setIName(item.name); setIUnit(item.unit);
      setICurrentQty(String(item.current_qty)); setIMinQty(String(item.min_qty));
      setIMaxQty(item.max_qty != null ? String(item.max_qty) : "");
      setICostPrice(String(item.cost_price)); setISupplierId(item.supplier_id ?? "");
      setICategory(item.category ?? ""); setINotes(item.notes ?? "");
    } else {
      setEditingItem(null);
      setIName(""); setIUnit("unidade"); setICurrentQty("0"); setIMinQty("0");
      setIMaxQty(""); setICostPrice("0"); setISupplierId(""); setICategory(""); setINotes("");
    }
    setModal("item");
  }

  async function saveItem() {
    if (!iName.trim() || saving) return;
    setSaving(true);
    const payload = {
      name: iName.trim(), unit: iUnit,
      current_qty: parseFloat(iCurrentQty) || 0,
      min_qty: parseFloat(iMinQty) || 0,
      max_qty: iMaxQty ? parseFloat(iMaxQty) : null,
      cost_price: parseFloat(iCostPrice) || 0,
      supplier_id: iSupplierId || null,
      category: iCategory || null,
      notes: iNotes || null,
    };
    if (editingItem) {
      await supabase.from("stock_items").update(payload).eq("id", editingItem.id);
    } else {
      const { data: created } = await supabase.from("stock_items").insert(payload).select("id").single();
      if (created && payload.current_qty > 0) {
        await supabase.from("stock_movements").insert({
          stock_item_id: created.id, user_id: userId,
          type: "entry", quantity: payload.current_qty,
          cost_price: payload.cost_price, notes: "Estoque inicial",
        });
      }
    }
    await loadStockItems();
    setSaving(false);
    setModal("none");
  }

  // ── Suppliers CRUD ────────────────────────────────────────────────────────

  function openSupplierModal(s?: Supplier) {
    if (s) {
      setEditingSupplier(s);
      setSName(s.name); setSCnpj(s.cnpj ?? ""); setSPhone(s.phone ?? "");
      setSEmail(s.email ?? ""); setSContact(s.contact_name ?? "");
      setSAddress(s.address ?? ""); setSNotes(s.notes ?? "");
    } else {
      setEditingSupplier(null);
      setSName(""); setSCnpj(""); setSPhone(""); setSEmail(""); setSContact(""); setSAddress(""); setSNotes("");
    }
    setModal("supplier");
  }

  async function saveSupplier() {
    if (!sName.trim() || saving) return;
    setSaving(true);
    const payload = {
      name: sName.trim(), cnpj: sCnpj || null, phone: sPhone || null,
      email: sEmail || null, contact_name: sContact || null,
      address: sAddress || null, notes: sNotes || null,
    };
    if (editingSupplier) {
      await supabase.from("suppliers").update(payload).eq("id", editingSupplier.id);
    } else {
      await supabase.from("suppliers").insert(payload);
    }
    await loadSuppliers();
    setSaving(false);
    setModal("none");
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  function openMovModal() {
    setMovItemId(""); setMovType("entry"); setMovQty(""); setMovCost(""); setMovNotes("");
    setModal("movement");
  }

  async function saveMovement() {
    if (!movItemId || !movQty || saving) return;
    setSaving(true);
    const qty = parseFloat(movQty);
    const isAdd = movType === "entry" || movType === "return" || movType === "adjustment";

    if (movItemType === "ingredient") {
      await supabase.from("stock_movements").insert({
        stock_item_id: movItemId, user_id: userId,
        type: movType, quantity: qty,
        cost_price: parseFloat(movCost) || null,
        notes: movNotes || null,
      });
      const item = stockItems.find(i => i.id === movItemId);
      if (item) {
        const newQty = isAdd ? item.current_qty + qty : Math.max(0, item.current_qty - qty);
        await supabase.from("stock_items").update({ current_qty: newQty }).eq("id", movItemId);
      }
      await loadStockItems();
    } else {
      // produto com estoque contado
      const prod = limitedProducts.find(p => p.id === movItemId);
      if (prod) {
        const newQty = isAdd ? prod.stock + qty : Math.max(0, prod.stock - qty);
        const updates: Record<string, unknown> = { stock: newQty };
        if (newQty > 0 && !prod.is_active) updates.is_active = true;
        await supabase.from("products").update(updates).eq("id", movItemId);
        await supabase.from("stock_movements").insert({
          stock_item_id: null, user_id: userId,
          type: movType, quantity: qty,
          cost_price: parseFloat(movCost) || null,
          reference_type: "product", reference_id: movItemId,
          notes: movNotes || `Ajuste manual - ${prod.name}`,
        });
      }
      await loadLimitedProducts();
    }

    if (tab === "movements") await loadMovements();
    setSaving(false);
    setModal("none");
  }

  // ── Purchases ─────────────────────────────────────────────────────────────

  function openPurchaseModal() {
    setPOSupplierId(""); setPONotes("");
    setPOItems([{ stock_item_id: "", quantity: "", unit_cost: "" }]);
    setModal("purchase");
  }

  async function savePurchase() {
    const validItems = poItems.filter(i => i.stock_item_id && i.quantity);
    if (validItems.length === 0 || saving) return;
    setSaving(true);
    const { data: po } = await supabase.from("purchase_orders").insert({
      supplier_id: poSupplierId || null, notes: poNotes || null,
      status: "received", received_at: new Date().toISOString(), user_id: userId,
    }).select("id").single();
    if (po) {
      for (const item of validItems) {
        const qty = parseFloat(item.quantity);
        const cost = parseFloat(item.unit_cost) || 0;
        await supabase.from("purchase_order_items").insert({
          purchase_order_id: po.id, stock_item_id: item.stock_item_id,
          quantity: qty, unit_cost: cost,
        });
        await supabase.from("stock_movements").insert({
          stock_item_id: item.stock_item_id, user_id: userId,
          type: "entry", quantity: qty, cost_price: cost,
          reference_type: "purchase", reference_id: po.id, notes: "Entrada via compra",
        });
        const si = stockItems.find(i => i.id === item.stock_item_id);
        if (si) {
          await supabase.from("stock_items").update({
            current_qty: si.current_qty + qty,
            ...(cost > 0 ? { cost_price: cost } : {}),
          }).eq("id", item.stock_item_id);
        }
      }
    }
    await loadStockItems();
    await loadPurchases();
    setSaving(false);
    setModal("none");
  }

  // ── Recipes ───────────────────────────────────────────────────────────────

  async function addRecipeItem() {
    if (!selectedProduct || !recipeItemId || !recipeQty) return;
    await supabase.from("product_recipes").upsert({
      product_id: selectedProduct.id, stock_item_id: recipeItemId,
      quantity: parseFloat(recipeQty), unit: recipeUnit,
    }, { onConflict: "product_id,stock_item_id" });
    setRecipeItemId(""); setRecipeQty(""); setRecipeUnit("unidade");
    await loadRecipes(selectedProduct.id);
  }

  async function removeRecipeItem(id: string) {
    await supabase.from("product_recipes").delete().eq("id", id);
    if (selectedProduct) await loadRecipes(selectedProduct.id);
  }

  async function deleteConfirmed() {
    if (!deleteTarget || saving) return;
    setSaving(true);
    await (supabase.from(deleteTarget.table as any) as any)
      .update({ is_active: false }).eq("id", deleteTarget.id);
    await loadStockItems();
    await loadSuppliers();
    await loadLimitedProducts();
    setDeleteTarget(null);
    setSaving(false);
    setModal("none");
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  // Unified item list
  function getUnifiedStatus(item: UnifiedItem): "out" | "low" | "ok" {
    if (item.current_qty <= 0) return "out";
    if (item.min_qty > 0 && item.current_qty <= item.min_qty) return "low";
    return "ok";
  }

  const allUnified: UnifiedItem[] = [
    ...stockItems.map(i => ({
      id: i.id, name: i.name, unit: i.unit, current_qty: i.current_qty,
      min_qty: i.min_qty, max_qty: i.max_qty, cost_price: i.cost_price,
      category: i.category, supplier_name: i.suppliers?.name ?? null,
      entry_type: "ingredient" as const, is_active: i.is_active,
    })),
    ...limitedProducts.map(p => ({
      id: p.id, name: p.name, unit: p.unit, current_qty: p.stock,
      min_qty: p.stock_min, max_qty: p.stock_max, cost_price: p.cost_price,
      category: null, supplier_name: null,
      entry_type: "product" as const, is_active: p.is_active,
    })),
  ];

  const filteredItems = allUnified.filter(item => {
    const matchSearch = search === "" ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.category ?? "").toLowerCase().includes(search.toLowerCase());
    const status = getUnifiedStatus(item);
    const matchStock = stockFilter === "all" || status === stockFilter;
    const matchType = itemTypeFilter === "all" || item.entry_type === itemTypeFilter;
    return matchSearch && matchStock && matchType;
  });

  const lowStockItems = allUnified.filter(i => getUnifiedStatus(i) !== "ok");
  const totalValue = allUnified.reduce((s, i) => s + i.current_qty * i.cost_price, 0);
  const filteredMovements = movFilter === "all" ? movements : movements.filter(m => m.type === movFilter);
  const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  const TABS = [
    { key: "overview",   label: "Visão Geral",  icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { key: "items",      label: "Itens",         icon: <Boxes className="w-3.5 h-3.5" /> },
    { key: "recipes",    label: "Ficha Técnica", icon: <BookOpen className="w-3.5 h-3.5" /> },
    { key: "movements",  label: "Movimentações", icon: <ClipboardList className="w-3.5 h-3.5" /> },
    { key: "purchases",  label: "Compras",       icon: <Truck className="w-3.5 h-3.5" /> },
    { key: "suppliers",  label: "Fornecedores",  icon: <Building2 className="w-3.5 h-3.5" /> },
  ] as const;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl p-5"
          style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
            backgroundImage:"radial-gradient(rgba(59,130,246,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 to-transparent pointer-events-none" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{background:"#3b82f6",boxShadow:"0 0 6px #3b82f6"}} />
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#3b82f6"}}>Armazém</span>
            </div>
            <h1 className="text-2xl font-black g-text g-text-blue">
              Estoque
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {allUnified.length} itens · {limitedProducts.length} produto{limitedProducts.length !== 1 ? "s" : ""} + {stockItems.length} insumo{stockItems.length !== 1 ? "s" : ""}
              {lowStockItems.length > 0 && (
                <span className="text-amber-400 ml-1">· {lowStockItems.length} com alerta</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "items" && <>
              <button onClick={openMovModal}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm font-medium transition-all border border-zinc-700">
                <ArrowDownToLine className="w-4 h-4" /> Movimentação
              </button>
              <button onClick={() => openItemModal()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",color:"#fff",boxShadow:"0 0 16px rgba(59,130,246,0.35)"}}>
                <Plus className="w-4 h-4" /> Novo Item
              </button>
            </>}
            {tab === "movements" && (
              <button onClick={openMovModal}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Nova Movimentação
              </button>
            )}
            {tab === "purchases" && (
              <button onClick={openPurchaseModal}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Registrar Compra
              </button>
            )}
            {tab === "suppliers" && (
              <button onClick={() => openSupplierModal()}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Novo Fornecedor
              </button>
            )}
          </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setSearch(""); }}
              style={tab !== t.key ? { background: card.bg, border: card.border } : isLight ? { background: "#2563eb", color: "#fff" } : undefined}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${tab === t.key ? (isLight ? "" : "bg-violet-600 text-white shadow-lg shadow-violet-900/30") : "text-zinc-400 hover:text-white"}`}>
              {t.icon}{t.label}
              {t.key === "items" && lowStockItems.length > 0 && (
                <span className="bg-amber-500 text-black text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                  {lowStockItems.length > 9 ? "9+" : lowStockItems.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ═══ OVERVIEW ═══════════════════════════════════════════════════════ */}
        {tab === "overview" && (
          <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { gFrom:"#8b5cf6", gTo:"#a78bfa", glow:"rgba(139,92,246,0.13)",
                  icon:<Boxes className="w-4 h-4" style={{color:"#8b5cf6"}} />,
                  iconBg:"rgba(139,92,246,0.1)", iconBorder:"rgba(139,92,246,0.25)",
                  value: String(allUnified.length), label:"Total de Itens",
                  sub:`${limitedProducts.length} produto${limitedProducts.length !== 1 ? "s" : ""} · ${stockItems.length} insumo${stockItems.length !== 1 ? "s" : ""}`,
                  darkValue:"#fff" },
                { gFrom: lowStockItems.length > 0 ? "#f59e0b" : "#71717a",
                  gTo: lowStockItems.length > 0 ? "#fbbf24" : "#a1a1aa",
                  glow: lowStockItems.length > 0 ? "rgba(245,158,11,0.18)" : "rgba(113,113,122,0.08)",
                  icon:<AlertTriangle className="w-4 h-4" style={{color: lowStockItems.length > 0 ? "#f59e0b" : "#71717a"}} />,
                  iconBg: lowStockItems.length > 0 ? "rgba(245,158,11,0.1)" : "rgba(113,113,122,0.1)",
                  iconBorder: lowStockItems.length > 0 ? "rgba(245,158,11,0.25)" : "rgba(113,113,122,0.2)",
                  value: String(lowStockItems.length), label:"Alertas de Estoque",
                  sub: lowStockItems.length > 0 ? "Itens precisam de reposição" : "Todos os itens em dia",
                  darkValue: lowStockItems.length > 0 ? "#f59e0b" : "#fff" },
                { gFrom:"#10b981", gTo:"#34d399", glow:"rgba(16,185,129,0.13)",
                  icon:<DollarSign className="w-4 h-4" style={{color:"#10b981"}} />,
                  iconBg:"rgba(16,185,129,0.1)", iconBorder:"rgba(16,185,129,0.25)",
                  value: fmt(totalValue), label:"Valor em Estoque",
                  sub:`${allUnified.length} ite${allUnified.length !== 1 ? "ns" : "m"} contabilizados`,
                  darkValue:"#10b981" },
                { gFrom:"#3b82f6", gTo:"#60a5fa", glow:"rgba(59,130,246,0.13)",
                  icon:<Truck className="w-4 h-4" style={{color:"#3b82f6"}} />,
                  iconBg:"rgba(59,130,246,0.1)", iconBorder:"rgba(59,130,246,0.25)",
                  value: String(suppliers.length), label:"Fornecedores",
                  sub: suppliers.length > 0 ? `${suppliers.length} cadastrado${suppliers.length !== 1 ? "s" : ""}` : "Nenhum cadastrado",
                  darkValue:"#fff" },
              ].map((cfg, i) => (
                <div key={i} className="relative overflow-hidden rounded-2xl p-5 cursor-default"
                  style={isLight ? {
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
                  } : {
                    background: card.bg, border: card.border,
                    boxShadow: `0 0 24px ${cfg.glow}`,
                  }}>
                  {isLight
                    ? <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${cfg.gFrom},${cfg.gTo})`, borderRadius:"12px 12px 0 0" }} />
                    : <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-20 blur-2xl pointer-events-none" style={{ background: cfg.gFrom }} />
                  }
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>{cfg.label}</span>
                      <div className="p-2 rounded-xl" style={{ background: cfg.iconBg, border:`1px solid ${cfg.iconBorder}` }}>{cfg.icon}</div>
                    </div>
                    <div className="text-2xl font-black tabular-nums"
                      style={isLight
                        ? { background:`linear-gradient(135deg,${cfg.gFrom},${cfg.gTo})`, WebkitBackgroundClip:"text", display:"inline-block", WebkitTextFillColor:"transparent", backgroundClip:"text" }
                        : { color: cfg.darkValue }}>
                      {cfg.value}
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>{cfg.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Alerts */}
            {lowStockItems.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                <div className={`flex items-center gap-2 px-5 py-4 border-b ${isLight ? "border-gray-100" : "border-zinc-800"}`}>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-semibold" style={{ color: isLight ? "#111827" : undefined }}>Alertas de Estoque</h2>
                  <span className="ml-auto text-xs" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>{lowStockItems.length} ite{lowStockItems.length !== 1 ? "ns" : "m"}</span>
                </div>
                <div className={isLight ? "p-2 flex flex-col gap-1" : "divide-y divide-zinc-800/50"}>
                  {lowStockItems.map(item => {
                    const status = getUnifiedStatus(item);
                    const stCfg = STATUS_CFG[status];
                    const pct = item.min_qty > 0 ? Math.min(100, (item.current_qty / item.min_qty) * 100) : 0;
                    return (
                      <div key={item.id} className={`flex items-center gap-4 px-4 py-3 ${isLight ? "rounded-xl hover:bg-gray-50 transition-colors" : ""}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-sm font-semibold truncate ${isLight ? "text-gray-900" : "text-white"}`}>{item.name}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stCfg.badge}`}>{stCfg.label}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${item.entry_type === "product" ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : "text-violet-400 bg-violet-500/10 border-violet-500/20"}`}>
                              {item.entry_type === "product" ? "Produto" : "Insumo"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isLight ? "bg-gray-200" : "bg-zinc-800"}`}>
                              <div className={`h-full rounded-full transition-all ${stCfg.bar}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs flex-shrink-0" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>
                              {fmtQty(item.current_qty, item.unit)} / mín {fmtQty(item.min_qty, item.unit)}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => {
                          setTab("items");
                          if (item.entry_type === "ingredient") {
                            openItemModal(stockItems.find(i => i.id === item.id));
                          } else {
                            setMovItemType("product"); setMovItemId(item.id);
                            setMovType("entry"); setMovQty(""); setMovCost(""); setMovNotes("");
                            setModal("movement");
                          }
                        }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white border border-blue-600" : "bg-violet-600/20 hover:bg-violet-600 text-violet-400 hover:text-white border border-violet-500/30"}`}>
                          Repor
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top items by value */}
            {stockItems.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-zinc-800">
                  <BarChart3 className="w-4 h-4 text-violet-400" />
                  <h2 className="text-sm font-semibold">Distribuição por Valor</h2>
                </div>
                <div className="divide-y divide-zinc-800/30 px-5">
                  {[...allUnified]
                    .sort((a, b) => (b.current_qty * b.cost_price) - (a.current_qty * a.cost_price))
                    .slice(0, 8)
                    .map(item => {
                      const value = item.current_qty * item.cost_price;
                      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
                      return (
                        <div key={item.id} className="flex items-center gap-4 py-2.5">
                          <span className="text-sm text-white w-36 truncate flex-shrink-0">{item.name}</span>
                          <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-zinc-300 w-24 text-right flex-shrink-0">{fmt(value)}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {allUnified.length === 0 && (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
                <Warehouse className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 font-semibold">Estoque vazio</p>
                <p className="text-zinc-600 text-sm mt-1">Cadastre itens na aba "Itens" para começar</p>
                <button onClick={() => setTab("items")}
                  className="mt-5 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold transition-colors">
                  Ir para Itens
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ ITEMS ══════════════════════════════════════════════════════════ */}
        {tab === "items" && (
          <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-52">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar item ou categoria..."
                  style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-all" />
              </div>
              <div className="flex rounded-xl p-1 gap-1" style={{ background: card.bg, border: card.border }}>
                {(["all", "product", "ingredient"] as const).map(f => (
                  <button key={f} onClick={() => setItemTypeFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${itemTypeFilter === f ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                    {f === "all" ? "Todos" : f === "product" ? "Produtos" : "Insumos"}
                  </button>
                ))}
              </div>
              <div className="flex rounded-xl p-1 gap-1" style={{ background: card.bg, border: card.border }}>
                {(["all", "low", "out"] as const).map(f => (
                  <button key={f} onClick={() => setStockFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${stockFilter === f ? "bg-amber-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                    {f === "all" ? "Todos" : f === "low" ? "Baixo" : "Zerado"}
                  </button>
                ))}
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
                <Boxes className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 font-semibold">Nenhum item encontrado</p>
                <button onClick={() => openItemModal()}
                  className="mt-5 text-violet-400 text-sm hover:underline">Cadastrar primeiro item</button>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                <div className="hidden sm:grid grid-cols-[1fr_80px_130px_120px_100px_90px] gap-x-4 px-5 py-2.5 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
                  <span>Item / Categoria</span>
                  <span>Unidade</span>
                  <span>Qtd. Atual</span>
                  <span>Mín / Máx</span>
                  <span>Custo Unit.</span>
                  <span />
                </div>
                <div className="divide-y divide-zinc-800">
                  {filteredItems.map(item => {
                    const status = getUnifiedStatus(item);
                    const cfg = STATUS_CFG[status];
                    const isProduct = item.entry_type === "product";
                    return (
                      <div key={item.id}
                        className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_80px_130px_120px_100px_100px] gap-x-4 px-5 py-3.5 items-center hover:bg-zinc-800/30 transition-colors">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white">{item.name}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${isProduct ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : "text-violet-400 bg-violet-500/10 border-violet-500/20"}`}>
                              {isProduct ? "Produto" : "Insumo"}
                            </span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                            {isProduct && !item.is_active && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-red-400 bg-red-500/10 border border-red-500/20">Pausado</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {item.category && <span className="text-xs text-zinc-500">{item.category}</span>}
                            {item.supplier_name && <span className="text-xs text-zinc-600">· {item.supplier_name}</span>}
                          </div>
                        </div>
                        <span className="hidden sm:block text-xs text-zinc-400">{item.unit}</span>
                        <div className="hidden sm:block">
                          <span className={`text-sm font-bold ${status === "out" ? "text-red-400" : status === "low" ? "text-amber-400" : "text-emerald-400"}`}>
                            {fmtQty(item.current_qty, item.unit)}
                          </span>
                        </div>
                        <div className="hidden sm:block">
                          <span className="text-xs text-zinc-500">
                            {fmtQty(item.min_qty, item.unit)}
                            {item.max_qty != null && ` / ${fmtQty(item.max_qty, item.unit)}`}
                          </span>
                        </div>
                        <span className="hidden sm:block text-sm text-zinc-300">{fmt(item.cost_price)}</span>
                        <div className="flex items-center gap-1 justify-end">
                          {isProduct ? (
                            <button onClick={() => {
                              setMovItemType("product"); setMovItemId(item.id);
                              setMovType("entry"); setMovQty(""); setMovCost(""); setMovNotes("");
                              setModal("movement");
                            }} className="p-1.5 text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" title="Ajustar estoque">
                              <ArrowDownToLine className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => openItemModal(stockItems.find(i => i.id === item.id))}
                              className="p-1.5 text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!isProduct && (
                            <button onClick={() => { setDeleteTarget({ id: item.id, name: item.name, table: "stock_items" }); setModal("deleteItem"); }}
                              className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{filteredItems.length} de {allUnified.length} ite{allUnified.length !== 1 ? "ns" : "m"}</span>
                  <span className="text-xs text-zinc-400">Valor filtrado: <span className="text-emerald-400 font-semibold">{fmt(filteredItems.reduce((s, i) => s + i.current_qty * i.cost_price, 0))}</span></span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ FICHA TÉCNICA ══════════════════════════════════════════════════ */}
        {tab === "recipes" && (
          <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-5 items-start">
            {/* Product selector */}
            <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <div className="px-4 py-3 border-b border-zinc-800">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Selecione o Produto</p>
              </div>
              <div className="divide-y divide-zinc-800 max-h-[65vh] overflow-y-auto">
                {products.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center py-8">Nenhum produto cadastrado</p>
                )}
                {products.map(p => (
                  <button key={p.id}
                    onClick={() => { setSelectedProduct(p); loadRecipes(p.id); }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2.5 ${selectedProduct?.id === p.id ? "bg-violet-600/20 text-violet-300 border-l-2 border-violet-500" : "text-zinc-300 hover:bg-zinc-800/50"}`}>
                    <Package className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500" />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Recipe editor */}
            {!selectedProduct ? (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
                <BookOpen className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 font-semibold">Selecione um produto</p>
                <p className="text-zinc-600 text-sm mt-1">para ver ou editar sua ficha técnica</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
                  <div className="w-9 h-9 bg-violet-500/10 rounded-xl flex items-center justify-center">
                    <BookOpen className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">{selectedProduct.name}</h2>
                    <p className="text-xs text-zinc-500">Ingredientes consumidos por unidade vendida</p>
                  </div>
                </div>

                {/* Add row */}
                <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/40 space-y-3">
                  <p className="text-xs font-medium text-zinc-400">Adicionar Ingrediente</p>
                  <div className="flex gap-2 flex-wrap">
                    <select value={recipeItemId} onChange={e => {
                      setRecipeItemId(e.target.value);
                      const si = stockItems.find(i => i.id === e.target.value);
                      if (si) setRecipeUnit(si.unit);
                    }} className={selectCls + " flex-1 min-w-40"}>
                      <option value="">Selecionar insumo...</option>
                      {stockItems.map(si => (
                        <option key={si.id} value={si.id}>{si.name} ({si.unit})</option>
                      ))}
                    </select>
                    <input value={recipeQty} onChange={e => setRecipeQty(e.target.value)}
                      placeholder="Qtd" type="number" min="0.001" step="0.001"
                      className={inputCls + " w-24"} />
                    <select value={recipeUnit} onChange={e => setRecipeUnit(e.target.value)}
                      className={selectCls + " w-28"}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button onClick={addRecipeItem} disabled={!recipeItemId || !recipeQty}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                      <Plus className="w-4 h-4" /> Adicionar
                    </button>
                  </div>
                </div>

                {/* Ingredient list */}
                {recipes.length === 0 ? (
                  <div className="text-center py-10 text-xs text-zinc-600">
                    Nenhum ingrediente na ficha técnica. Adicione acima.
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-zinc-800/50">
                      {recipes.map(r => {
                        const si = r.stock_items;
                        const hasStock = si ? si.current_qty >= r.quantity : true;
                        return (
                          <div key={r.id} className="flex items-center gap-4 px-5 py-3">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasStock ? "bg-emerald-500" : "bg-red-500"}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white">{si?.name ?? "—"}</p>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                {fmtQty(r.quantity, r.unit)} por unidade
                                {si && <span className={`ml-2 font-medium ${hasStock ? "text-emerald-400" : "text-red-400"}`}>
                                  · estoque: {fmtQty(si.current_qty, si.unit)}
                                </span>}
                              </p>
                            </div>
                            {!hasStock && <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                            <button onClick={() => removeRecipeItem(r.id)}
                              className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/30 flex items-center justify-between">
                      <span className="text-xs text-zinc-500">{recipes.length} ingrediente{recipes.length !== 1 ? "s" : ""}</span>
                      <span className="text-xs text-zinc-400">
                        Custo estimado:{" "}
                        <span className="text-violet-400 font-semibold">
                          {fmt(recipes.reduce((s, r) => {
                            const si = stockItems.find(i => i.id === r.stock_item_id);
                            return s + (si ? si.cost_price * r.quantity : 0);
                          }, 0))}
                        </span>
                        {" "}/ unidade
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ MOVEMENTS ══════════════════════════════════════════════════════ */}
        {tab === "movements" && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <div className="flex rounded-xl p-1 gap-1 flex-wrap" style={{ background: card.bg, border: card.border }}>
                {(["all", "entry", "exit", "adjustment", "loss", "sale", "return"] as const).map(f => (
                  <button key={f} onClick={() => setMovFilter(f as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${movFilter === f ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                    {f === "all" ? "Todas" : MOV_INFO[f]?.label ?? f}
                  </button>
                ))}
              </div>
            </div>

            {filteredMovements.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
                <ClipboardList className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 font-semibold">Nenhuma movimentação encontrada</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                <div className="hidden sm:grid grid-cols-[150px_1fr_100px_100px_80px_1fr] gap-x-4 px-5 py-2.5 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
                  <span>Data/Hora</span><span>Item</span><span>Tipo</span><span>Quantidade</span><span>Custo</span><span>Obs</span>
                </div>
                <div className="divide-y divide-zinc-800">
                  {filteredMovements.map(m => {
                    const info = MOV_INFO[m.type] ?? { label: m.type, color: "text-zinc-400", sign: "?", bg: "bg-zinc-800" };
                    return (
                      <div key={m.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[150px_1fr_100px_100px_80px_1fr] gap-x-4 px-5 py-3 items-center">
                        <span className="hidden sm:block text-xs text-zinc-500">
                          {new Date(m.created_at).toLocaleString("pt-BR")}
                        </span>
                        <div>
                          <span className="text-sm font-semibold text-white">{m.stock_items?.name ?? "—"}</span>
                          <span className="sm:hidden text-xs text-zinc-500 ml-2">
                            {new Date(m.created_at).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        <span className={`hidden sm:inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${info.bg} ${info.color}`}>
                          {info.label}
                        </span>
                        <span className={`text-sm font-bold ${info.color}`}>
                          {info.sign}{fmtQty(m.quantity, m.stock_items?.unit ?? "")}
                        </span>
                        <span className="hidden sm:block text-xs text-zinc-500">
                          {m.cost_price != null ? fmt(m.cost_price) : "—"}
                        </span>
                        <span className="hidden sm:block text-xs text-zinc-500 truncate">{m.notes ?? "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ PURCHASES ══════════════════════════════════════════════════════ */}
        {tab === "purchases" && (
          <div className="space-y-4">
            {purchases.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
                <Truck className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 font-semibold">Nenhuma compra registrada</p>
                <button onClick={openPurchaseModal} className="mt-5 text-violet-400 text-sm hover:underline">
                  Registrar primeira compra
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {purchases.map(po => {
                  const total = (po.purchase_order_items ?? []).reduce((s, i) => s + i.quantity * i.unit_cost, 0);
                  const isExpanded = expandedPO === po.id;
                  const itemCount = (po.purchase_order_items ?? []).length;
                  return (
                    <div key={po.id} className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                      <button onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors">
                        <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Truck className="w-4 h-4 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">
                              {po.suppliers?.name ?? "Fornecedor não informado"}
                            </span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Recebida
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {new Date(po.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                            {" · "}{itemCount} ite{itemCount !== 1 ? "ns" : "m"}
                            {po.notes && ` · ${po.notes}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 mr-2">
                          <p className="text-base font-bold text-white">{fmt(total)}</p>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      {isExpanded && (
                        <div className="border-t border-zinc-800">
                          <div className="hidden sm:grid grid-cols-[1fr_100px_100px_100px] gap-x-4 px-5 py-2 bg-zinc-950/40 text-xs text-zinc-500 font-medium">
                            <span>Item</span><span>Quantidade</span><span>Custo Unit.</span><span className="text-right">Total</span>
                          </div>
                          <div className="divide-y divide-zinc-800/50">
                            {(po.purchase_order_items ?? []).map((item, idx) => (
                              <div key={idx} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_100px_100px_100px] gap-x-4 px-5 py-2.5 items-center">
                                <span className="text-sm text-zinc-200">{item.stock_items?.name ?? "—"}</span>
                                <span className="hidden sm:block text-sm text-zinc-400">{fmtQty(item.quantity, item.stock_items?.unit ?? "")}</span>
                                <span className="hidden sm:block text-sm text-zinc-400">{fmt(item.unit_cost)}</span>
                                <span className="text-sm font-bold text-white sm:text-right">{fmt(item.quantity * item.unit_cost)}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between px-5 py-3 bg-zinc-950/40">
                              <span className="text-xs text-zinc-500">Total da compra</span>
                              <span className="text-base font-black text-white">{fmt(total)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ SUPPLIERS ══════════════════════════════════════════════════════ */}
        {tab === "suppliers" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar fornecedor..."
                style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-all" />
            </div>

            {filteredSuppliers.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
                <Building2 className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 font-semibold">Nenhum fornecedor cadastrado</p>
                <button onClick={() => openSupplierModal()}
                  className="mt-5 text-violet-400 text-sm hover:underline">Cadastrar primeiro fornecedor</button>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden divide-y divide-zinc-800" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                {filteredSuppliers.map(s => (
                  <div key={s.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800/30 transition-colors">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{s.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {s.contact_name && <span className="text-xs text-zinc-500">{s.contact_name}</span>}
                        {s.phone && <span className="flex items-center gap-1 text-xs text-zinc-500"><Phone className="w-3 h-3" />{s.phone}</span>}
                        {s.email && <span className="flex items-center gap-1 text-xs text-zinc-500"><Mail className="w-3 h-3" />{s.email}</span>}
                        {s.cnpj && <span className="text-xs text-zinc-600">CNPJ: {s.cnpj}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openSupplierModal(s)}
                        className="p-1.5 text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { setDeleteTarget({ id: s.id, name: s.name, table: "suppliers" }); setModal("deleteItem"); }}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODALS
      ═══════════════════════════════════════════════════════════════════════ */}

      {/* Stock Item Modal */}
      {modal === "item" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">{editingItem ? "Editar Item" : "Novo Item de Estoque"}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Insumo, ingrediente ou material</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome do item *</label>
                <input value={iName} onChange={e => setIName(e.target.value)}
                  placeholder="Ex: Farinha de trigo, Carne bovina, Camiseta P..."
                  className={inputCls} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Unidade de medida</label>
                  <select value={iUnit} onChange={e => setIUnit(e.target.value)} className={selectCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Categoria</label>
                  <input value={iCategory} onChange={e => setICategory(e.target.value)}
                    placeholder="Ex: Proteínas, Bebidas, Embalagens..." className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Qtd. Atual</label>
                  <input value={iCurrentQty} onChange={e => setICurrentQty(e.target.value)}
                    type="number" min="0" step="0.001" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Qtd. Mínima</label>
                  <input value={iMinQty} onChange={e => setIMinQty(e.target.value)}
                    type="number" min="0" step="0.001" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Qtd. Máxima</label>
                  <input value={iMaxQty} onChange={e => setIMaxQty(e.target.value)}
                    type="number" min="0" step="0.001" placeholder="Opcional" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Custo unitário (R$)</label>
                  <input value={iCostPrice} onChange={e => setICostPrice(e.target.value)}
                    type="number" min="0" step="0.01" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Fornecedor</label>
                  <select value={iSupplierId} onChange={e => setISupplierId(e.target.value)} className={selectCls}>
                    <option value="">Nenhum</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Observações</label>
                <input value={iNotes} onChange={e => setINotes(e.target.value)} placeholder="Opcional" className={inputCls} />
              </div>
              {parseFloat(iCurrentQty) > 0 && parseFloat(iCostPrice) > 0 && (
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Valor total em estoque</span>
                    <span className="text-violet-400 font-semibold">
                      {fmt((parseFloat(iCurrentQty) || 0) * (parseFloat(iCostPrice) || 0))}
                    </span>
                  </div>
                  {parseFloat(iMinQty) > 0 && parseFloat(iCurrentQty) <= parseFloat(iMinQty) && (
                    <p className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Quantidade abaixo do mínimo configurado
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveItem} disabled={!iName.trim() || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingItem ? "Salvar" : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Movement Modal */}
      {modal === "movement" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <h2 className="text-base font-semibold">Nova Movimentação</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Entrada, saída ou ajuste manual</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">Tipo de item *</label>
                <div className="flex gap-2 mb-3">
                  {(["ingredient", "product"] as const).map(t => (
                    <button key={t} onClick={() => { setMovItemType(t); setMovItemId(""); }}
                      className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${movItemType === t ? "bg-violet-600/20 text-violet-400 border-violet-500/40" : "border-zinc-700 text-zinc-500 hover:border-zinc-600"}`}>
                      {t === "ingredient" ? "Insumo / Ingrediente" : "Produto com Estoque"}
                    </button>
                  ))}
                </div>
                <select value={movItemId} onChange={e => setMovItemId(e.target.value)} className={selectCls}>
                  <option value="">Selecionar...</option>
                  {movItemType === "ingredient"
                    ? stockItems.map(i => <option key={i.id} value={i.id}>{i.name} — {fmtQty(i.current_qty, i.unit)}</option>)
                    : limitedProducts.map(p => <option key={p.id} value={p.id}>{p.name} — {fmtQty(p.stock, p.unit)}{!p.is_active ? " (pausado)" : ""}</option>)
                  }
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">Tipo de movimentação *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["entry", "exit", "adjustment", "loss", "return"] as const).map(t => {
                    const info = MOV_INFO[t];
                    return (
                      <button key={t} onClick={() => setMovType(t)}
                        className={`py-2.5 px-2 rounded-xl border text-xs font-semibold transition-all text-center ${movType === t ? `${info.bg} ${info.color} border-current` : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}>
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Quantidade *</label>
                  <input value={movQty} onChange={e => setMovQty(e.target.value)}
                    type="number" min="0.001" step="0.001" placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Custo unitário</label>
                  <input value={movCost} onChange={e => setMovCost(e.target.value)}
                    type="number" min="0" step="0.01" placeholder="0,00" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Observação</label>
                <input value={movNotes} onChange={e => setMovNotes(e.target.value)} placeholder="Opcional" className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveMovement} disabled={!movItemId || !movQty || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Modal */}
      {modal === "purchase" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Registrar Compra</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Entrada de mercadoria — estoque atualizado imediatamente</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Fornecedor</label>
                  <select value={poSupplierId} onChange={e => setPOSupplierId(e.target.value)} className={selectCls}>
                    <option value="">Selecionar...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Referência / NF</label>
                  <input value={poNotes} onChange={e => setPONotes(e.target.value)} placeholder="Número da nota, pedido..." className={inputCls} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-zinc-400">Itens da compra *</label>
                  <button onClick={() => setPOItems(prev => [...prev, { stock_item_id: "", quantity: "", unit_cost: "" }])}
                    className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <Plus className="w-3 h-3" /> Adicionar linha
                  </button>
                </div>
                <div className="space-y-2">
                  {poItems.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select value={item.stock_item_id}
                        onChange={e => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, stock_item_id: e.target.value } : p))}
                        className={selectCls + " flex-1"}>
                        <option value="">Selecionar item...</option>
                        {stockItems.map(si => <option key={si.id} value={si.id}>{si.name}</option>)}
                      </select>
                      <input value={item.quantity} placeholder="Qtd"
                        onChange={e => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, quantity: e.target.value } : p))}
                        type="number" min="0" step="0.001" className={inputCls + " w-20"} />
                      <input value={item.unit_cost} placeholder="R$/un"
                        onChange={e => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, unit_cost: e.target.value } : p))}
                        type="number" min="0" step="0.01" className={inputCls + " w-24"} />
                      {poItems.length > 1 && (
                        <button onClick={() => setPOItems(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-zinc-600 hover:text-red-400 rounded-lg flex-shrink-0 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-zinc-400">Total da compra</span>
                <span className="text-base font-bold text-white">
                  {fmt(poItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_cost) || 0), 0))}
                </span>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={savePurchase}
                disabled={poItems.every(i => !i.stock_item_id || !i.quantity) || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                Confirmar Recebimento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      {modal === "supplier" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <h2 className="text-base font-semibold">{editingSupplier ? "Editar Fornecedor" : "Novo Fornecedor"}</h2>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome / Razão Social *</label>
                <input value={sName} onChange={e => setSName(e.target.value)}
                  placeholder="Nome do fornecedor" className={inputCls} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">CNPJ / CPF</label>
                  <input value={sCnpj} onChange={e => setSCnpj(e.target.value)} placeholder="00.000.000/0001-00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Contato / Vendedor</label>
                  <input value={sContact} onChange={e => setSContact(e.target.value)} placeholder="Nome do representante" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Telefone / WhatsApp</label>
                  <input value={sPhone} onChange={e => setSPhone(e.target.value)} placeholder="(99) 99999-9999" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">E-mail</label>
                  <input value={sEmail} onChange={e => setSEmail(e.target.value)} placeholder="email@fornecedor.com" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Endereço</label>
                <input value={sAddress} onChange={e => setSAddress(e.target.value)} placeholder="Rua, número, cidade, UF" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Observações</label>
                <input value={sNotes} onChange={e => setSNotes(e.target.value)} placeholder="Prazo de entrega, condições de pagamento..." className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveSupplier} disabled={!sName.trim() || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingSupplier ? "Salvar" : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {modal === "deleteItem" && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">Excluir item?</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  <span className="text-white font-medium">{deleteTarget.name}</span> será desativado do sistema.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setModal("none"); }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={deleteConfirmed} disabled={saving}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
