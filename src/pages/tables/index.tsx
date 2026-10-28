import { useState, useEffect, useCallback } from "react";
import { createPortal, flushSync } from "react-dom";
import { supabase } from "../../lib/supabase";
import { requireApproval, useOperators } from "../../lib/operators";
import { printDocument } from "../../lib/printing";
import { printItemsHere, onlineSectors, getPrintHere, setPrintHere, printTickets, thermalHtml, SECTOR_LABEL, type Sector } from "../../lib/kitchen";
import { matchesSearch } from "../../lib/search";
import { useTheme } from "../../contexts/ThemeContext";
import { PageHeader, btnPrimary, btnSecondary, WHITE_TEXT } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import {
  UtensilsCrossed, Plus, Search, X, ChevronLeft, RefreshCw,
  Clock, Users, CheckCircle2, Settings, Edit2, Trash2,
  Banknote, CreditCard, Smartphone, Receipt, AlertTriangle, ChevronUp, ChevronDown, ListOrdered,
  ShoppingCart, Minus, Save, Tag, Coffee, Star, StarOff, MessageSquare, ArrowLeftRight, Send, Printer,
} from "lucide-react";
import { getStoreSettings, getSellers, refreshStoreCache } from "../settings";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TableRecord {
  id: string;
  name: string;
  number: number | null;
  capacity: number;
  area: string;
  status: "free" | "occupied" | "reserved" | "cleaning";
  current_sale_id: string | null;
  is_active: boolean;
}

interface Product {
  id: string;
  name: string;
  sale_price: number;
  stock: number;
  stock_type: string | null;
  unlimited_stock: boolean | null;
  image_url: string | null;
  category_id: string | null;
  item_type: string | null;
  is_active: boolean;
}

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

interface OrderItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  kds_state?: string | null;
  products?: { name: string; item_type?: string | null } | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
  fiado_balance: number;
  credit_limit: number;
}

type PayMethod = "cash" | "credit" | "debit" | "pix" | "fiado" | "house_credit";
interface PaymentEntry { method: PayMethod; amount: number; part?: boolean; items?: string[]; } // part/items: só para a divisão da conta (não vão para o banco)

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/10 transition-all";
const selectCls = inputCls + " cursor-pointer";

const STATUS_CFG: Record<string, { label: string; hex: string; glow: string; badge: string; dot: string }> = {
  free:     { label: "Livre",     hex: "#10b981", glow: "rgba(16,185,129,0.18)",   badge: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-500" },
  occupied: { label: "Ocupada",   hex: "#f59e0b", glow: "rgba(245,158,11,0.18)",   badge: "text-amber-400 bg-amber-500/10 border-amber-500/20",       dot: "bg-amber-500"   },
  reserved: { label: "Reservada", hex: "#6366f1", glow: "rgba(99,102,241,0.18)",   badge: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",    dot: "bg-indigo-500"  },
  cleaning: { label: "Limpeza",   hex: "#94a3b8", glow: "rgba(148,163,184,0.12)", badge: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",           dot: "bg-zinc-500"    },
};
const fallbackCfg = STATUS_CFG.free;

const PAY_INFO: Record<PayMethod, { label: string; icon: React.ReactNode; color: string }> = {
  cash:         { label: "Dinheiro",   icon: <Banknote className="w-4 h-4" />,   color: "border-emerald-500 bg-emerald-500/10 text-emerald-300" },
  pix:          { label: "PIX",        icon: <Smartphone className="w-4 h-4" />, color: "border-brand-500 bg-brand-500/10 text-brand-700"   },
  credit:       { label: "Crédito",    icon: <CreditCard className="w-4 h-4" />, color: "border-blue-500 bg-blue-500/10 text-blue-300"         },
  debit:        { label: "Débito",     icon: <CreditCard className="w-4 h-4" />, color: "border-indigo-500 bg-indigo-500/10 text-indigo-300"   },
  fiado:        { label: "Fiado",      icon: <Receipt className="w-4 h-4" />,    color: "border-amber-500 bg-amber-500/10 text-amber-300"      },
  house_credit: { label: "Saldo",      icon: <Tag className="w-4 h-4" />,        color: "border-pink-500 bg-pink-500/10 text-pink-300"         },
};

function isUnlimited(p: Product) {
  return p.stock_type === "unlimited" || p.unlimited_stock === true;
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return "agora";
  if (diff < 60) return `${diff}min`;
  const h = Math.floor(diff / 60), m = diff % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TablesPage() {
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

  const [userId, setUserId]         = useState<string | null>(null);
  const [cashRegisterId, setCashRegisterId] = useState<string | null>(null);

  // Data
  const [tables, setTables]         = useState<TableRecord[]>([]);
  const [openInfo, setOpenInfo]     = useState<Record<string, { since: string; total: number; items: number }>>({});
  const [topProductIds, setTopProductIds] = useState<string[]>([]);
  const [products, setProducts]     = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [sellers, setSellers]       = useState<string[]>([]);

  // Views
  const [view, setView]             = useState<"grid" | "table">("grid");
  const [selectedTable, setSelectedTable] = useState<TableRecord | null>(null);
  const [openedAt, setOpenedAt]     = useState<string | null>(null);
  const [comandaTab, setComandaTab] = useState<"catalog" | "order">("catalog");

  // Order state
  const [currentSaleId, setCurrentSaleId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);

  // Product search / filter
  const [search, setSearch]         = useState("");
  const [catFilter, setCatFilter]   = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);

  // Ordem das categorias na comanda — salva em localStorage
  const [catOrder, setCatOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("upabase_cat_order_tables") ?? "[]"); }
    catch { return []; }
  });
  const [showCatOrder, setShowCatOrder] = useState(false);

  // Itens do dia por categoria — lista escolhida a dedo (qualquer produto do estoque, não só os da categoria real)
  // salvo em localStorage; categoria sem lista configurada = comportamento automático de sempre
  const [curatedProducts, setCuratedProducts] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("upabase_curated_products_tables") ?? "{}"); }
    catch { return {}; }
  });
  const [showCurateManager, setShowCurateManager] = useState(false);
  const [curateActiveCat, setCurateActiveCat] = useState<string | null>(null);
  const [curateSearch, setCurateSearch] = useState("");

  function toggleCuratedProduct(catName: string, productId: string) {
    const current = curatedProducts[catName] ?? [];
    const updated = current.includes(productId) ? current.filter(id => id !== productId) : [...current, productId];
    const next = { ...curatedProducts, [catName]: updated };
    setCuratedProducts(next);
    localStorage.setItem("upabase_curated_products_tables", JSON.stringify(next));
  }

  function resetCuratedCategory(catName: string) {
    const next = { ...curatedProducts };
    delete next[catName];
    setCuratedProducts(next);
    localStorage.setItem("upabase_curated_products_tables", JSON.stringify(next));
  }

  const [newCatName, setNewCatName] = useState("");

  async function createCategory() {
    if (!newCatName.trim()) return;
    await supabase.from("categories").insert({ name: newCatName.trim(), parent_id: null });
    setNewCatName("");
    await loadAll();
  }

  async function renameCategory(catName: string) {
    const ids = catNameMap[catName] ?? [];
    const current = catName.charAt(0) + catName.slice(1).toLowerCase();
    const newName = prompt("Novo nome da categoria:", current);
    if (!newName || !newName.trim() || newName.trim() === current) return;
    const trimmed = newName.trim();
    await Promise.all(ids.map(id => supabase.from("categories").update({ name: trimmed }).eq("id", id)));
    // Migra os itens do dia salvos e a categoria ativa pra chave do novo nome
    const newKey = trimmed.toUpperCase();
    if (curatedProducts[catName]) {
      const next = { ...curatedProducts, [newKey]: curatedProducts[catName] };
      delete next[catName];
      setCuratedProducts(next);
      localStorage.setItem("upabase_curated_products_tables", JSON.stringify(next));
    }
    if (curateActiveCat === catName) setCurateActiveCat(newKey);
    if (catFilter === catName) setCatFilter(newKey);
    await loadAll();
  }

  async function deleteCategory(catName: string) {
    if (!confirm(`Excluir a categoria "${catName.charAt(0) + catName.slice(1).toLowerCase()}"? Os produtos dela ficam sem categoria.`)) return;
    const ids = catNameMap[catName] ?? [];
    await Promise.all(ids.map(id => supabase.from("categories").delete().eq("id", id)));
    if (curatedProducts[catName]) resetCuratedCategory(catName);
    if (curateActiveCat === catName) setCurateActiveCat(null);
    if (catFilter === catName) setCatFilter(null);
    await loadAll();
  }

  // Checkout
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutPayments, setCheckoutPayments] = useState<PaymentEntry[]>([]);
  const [checkoutMethod, setCheckoutMethod] = useState<PayMethod>("cash");
  const [checkoutInput, setCheckoutInput] = useState("");
  const [checkoutDiscount, setCheckoutDiscount] = useState("0");
  const [checkoutCustomer, setCheckoutCustomer] = useState<Customer | null>(null);
  const [checkoutSeller, setCheckoutSeller] = useState("");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [servicePct, setServicePct] = useState(0);          // taxa de serviço da loja (0 = desligada)
  const [checkoutService, setCheckoutService] = useState(false); // cobrar nesta conta?

  // Modals
  type Modal = "none" | "manage" | "editTable" | "reserve" | "openConfirm" | "statusChange" | "itemNote" | "cancelOrder" | "moveTable" | "pendingLeave";
  const [moveTarget, setMoveTarget] = useState<TableRecord | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Dividir a conta: em partes iguais ou pelos itens de cada um
  const [splitMode, setSplitMode] = useState<"none" | "equal" | "items">("none");
  const [splitN, setSplitN] = useState(2);
  const [splitPaidParts, setSplitPaidParts] = useState(0);
  const [splitSel, setSplitSel] = useState<string[]>([]);
  const [splitPaidItems, setSplitPaidItems] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>("none");
  const [editingTable, setEditingTable] = useState<TableRecord | null>(null);
  const [reserveNotes, setReserveNotes] = useState("");
  const [statusChangeTarget, setStatusChangeTarget] = useState<{ table: TableRecord; status: TableRecord["status"] } | null>(null);
  const [noteTarget, setNoteTarget] = useState<OrderItem | null>(null);
  const [noteText, setNoteText] = useState("");

  // Table form — single
  const [fName, setFName] = useState("");
  const [fNumber, setFNumber] = useState("");
  const [fCapacity, setFCapacity] = useState("4");
  const [fArea, setFArea] = useState("Salão");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Table form — bulk
  const [tableFormTab, setTableFormTab] = useState<"single" | "bulk">("single");
  const [bulkCount, setBulkCount] = useState("10");
  const [bulkStart, setBulkStart] = useState("1");
  const [bulkPrefix, setBulkPrefix] = useState("Mesa ");
  const [bulkCapacity, setBulkCapacity] = useState("4");
  const [bulkArea, setBulkArea] = useState("Salão");

  // ── Init ────────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession(); // sessão local; RLS protege no banco
    const user = session?.user ?? null;
    if (user) {
      setUserId(user.id);
      refreshStoreCache(user.id);
    }
    // Caixa aberto junto com o resto (antes era buscado antes, em fila)
    const [{ data: t }, { data: p }, { data: c }, { data: custs }, regRes] = await Promise.all([
      supabase.from("tables").select("*").eq("is_active", true).order("number").order("name"),
      supabase.from("products").select("*").neq("is_active", false).order("name"),
      supabase.from("categories").select("*").order("name"),
      supabase.from("customers").select("id,name,phone,balance,fiado_balance,credit_limit").order("name"),
      user
        ? supabase.from("cash_registers")
            .select("id").eq("user_id", user.id).eq("status", "open")
            .order("opened_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve(null),
    ]);
    if (user) setCashRegisterId(regRes?.data?.id ?? null);
    setTables((t ?? []) as TableRecord[]);
    // Mais pedidos dos últimos 30 dias (se falhar, a seção só não aparece)
    supabase.rpc("top_products_recent", { p_days: 30, p_limit: 12 })
      .then(({ data }) => setTopProductIds(((data ?? []) as { product_id: string }[]).map(r => r.product_id)));
    // Mesas ocupadas: tempo aberta e valor da comanda, mostrados no cartão da mesa
    const openIds = ((t ?? []) as TableRecord[]).map(x => x.current_sale_id).filter(Boolean) as string[];
    if (openIds.length) {
      const { data: os } = await supabase.from("sales")
        .select("id, created_at, sale_items(quantity, unit_price)").in("id", openIds);
      const info: Record<string, { since: string; total: number; items: number }> = {};
      for (const s of (os ?? []) as any[]) {
        const its = (s.sale_items ?? []) as { quantity: number; unit_price: number }[];
        info[s.id] = {
          since: s.created_at,
          total: its.reduce((a, i) => a + Number(i.quantity) * Number(i.unit_price), 0),
          items: its.reduce((a, i) => a + Number(i.quantity), 0),
        };
      }
      setOpenInfo(info);
    } else setOpenInfo({});
    setProducts((p ?? []) as Product[]);
    setCategories((c ?? []) as Category[]);
    setCustomers((custs ?? []) as Customer[]);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Comanda aberta: atualiza só a situação de cada item na cozinha (sem recarregar a tela)
  useEffect(() => {
    if (view !== "table" || !currentSaleId) return;
    const saleId = currentSaleId;
    const t = setInterval(async () => {
      const { data } = await supabase.from("sale_items").select("id, kds_state").eq("sale_id", saleId);
      const map = new Map(((data ?? []) as { id: string; kds_state: string | null }[]).map(r => [r.id, r.kds_state]));
      setOrderItems(prev => prev.some(i => map.has(i.id) && map.get(i.id) !== (i.kds_state ?? null))
        ? prev.map(i => map.has(i.id) ? { ...i, kds_state: map.get(i.id) ?? null } : i)
        : prev);
    }, 10_000);
    return () => clearInterval(t);
  }, [view, currentSaleId]);

  // Esc fecha o modal/checkout aberto no momento
  useEscapeKey(() => {
    if (showCheckout) { setShowCheckout(false); return; }
    if (modal === "openConfirm") { setSelectedTable(null); setModal("none"); return; }
    if (modal === "itemNote") { setNoteTarget(null); setNoteText(""); setModal("none"); return; }
    if (modal !== "none") setModal("none");
  }, showCheckout || modal !== "none");

  async function loadOrderItems(saleId: string) {
    setOrderLoading(true);
    const { data } = await supabase
      .from("sale_items").select("*")
      .eq("sale_id", saleId).order("id");
    const enriched = (data ?? []).map(i => {
      const p = products.find(p => p.id === i.product_id);
      return { ...i, products: { name: p?.name ?? "Produto", item_type: p?.item_type ?? "principal" } };
    });
    setOrderItems(enriched as OrderItem[]);
    setOrderLoading(false);
  }

  // ── Table actions ────────────────────────────────────────────────────────────

  async function openTable(table: TableRecord) {
    if (!userId) return;
    setSaving(true);
    const { data: sale, error: saleErr } = await supabase.from("sales").insert({
      user_id: userId, status: "open", origin: "mesa",
      table_id: table.id, payments: [], discount: 0,
    }).select().single();
    if (saleErr || !sale) {
      alert("Erro ao abrir mesa: " + (saleErr?.message ?? "Tente novamente"));
      setSaving(false);
      return;
    }
    const { error: tableErr } = await supabase.from("tables").update({
      status: "occupied", current_sale_id: sale.id,
    }).eq("id", table.id);
    if (tableErr) {
      alert("Erro ao atualizar mesa: " + tableErr.message);
      setSaving(false);
      return;
    }
    // All setState calls after the last await are batched into ONE render by React 18
    // — no intermediate re-renders during the grid→table transition
    const updated = { ...table, status: "occupied" as const, current_sale_id: sale.id };
    setTables(prev => prev.map(t => t.id === table.id ? updated : t));
    setSelectedTable(updated);
    setCurrentSaleId(sale.id);
    setOpenedAt(sale.created_at ?? new Date().toISOString());
    setOrderItems([]);
    setSearch("");      // resetar catálogo ao ENTRAR na mesa, não ao sair
    setCatFilter(null);
    setView("table");
    setSaving(false);
    setModal("none");
  }

  async function enterTable(table: TableRecord) {
    if (table.status === "occupied" && table.current_sale_id) {
      const saleId = table.current_sale_id;
      // Fetch sale time + order items in parallel before touching state
      const [{ data: sale }, { data: items }] = await Promise.all([
        supabase.from("sales").select("created_at").eq("id", saleId).single(),
        supabase.from("sale_items").select("*").eq("sale_id", saleId).order("id"),
      ]);
      const enriched = (items ?? []).map(i => ({
        ...i,
        products: { name: products.find(p => p.id === i.product_id)?.name ?? "Produto" },
      }));
      // Single batched state update — avoids intermediate renders during grid→table transition
      setSelectedTable(table);
      setCurrentSaleId(saleId);
      setOpenedAt(sale?.created_at ?? null);
      setOrderItems(enriched as OrderItem[]);
      setSearch("");      // resetar catálogo ao ENTRAR na mesa
      setCatFilter(null);
      setView("table");
    } else if (table.status === "free") {
      setSelectedTable(table);
      setModal("openConfirm");
    } else if (table.status === "reserved") {
      setSelectedTable(table);
      setModal("openConfirm");
    } else {
      // cleaning — offer to free it
      setStatusChangeTarget({ table, status: "free" });
      setModal("statusChange");
    }
  }

  async function setTableStatus(table: TableRecord, status: TableRecord["status"]) {
    await supabase.from("tables").update({ status }).eq("id", table.id);
    await loadAll();
    setModal("none");
  }

  async function reserveTable(table: TableRecord) {
    await supabase.from("tables").update({ status: "reserved" }).eq("id", table.id);
    await loadAll();
    setReserveNotes("");
    setModal("none");
  }

  async function goBack(force = false) {
    // Itens lançados e ainda não enviados à cozinha: pergunta antes de sair
    if (!force && orderItems.some(i => i.kds_state === "pending")) { setModal("pendingLeave"); return; }
    // If the open sale has no items, delete it entirely so it doesn't appear
    // in "Vendas em Pausa" on the PDV page
    if (currentSaleId && orderItems.length === 0 && selectedTable) {
      await supabase.from("sales").delete().eq("id", currentSaleId);
      await supabase.from("tables").update({ status: "free", current_sale_id: null }).eq("id", selectedTable.id);
    }
    setModal("none");
    setView("grid");
    setSelectedTable(null);
    setCurrentSaleId(null);
    setOrderItems([]);
    setOpenedAt(null);
    setShowCheckout(false);
    loadAll();
  }

  // ── Order actions ────────────────────────────────────────────────────────────

  async function addProduct(product: Product) {
    if (!currentSaleId) return;
    // Item que já foi para a cozinha não é somado: vira uma linha nova, para a
    // cozinha receber o acréscimo. Sem setor de impressão, soma como antes.
    // Soma na linha ainda não enviada (ou sem setor); o que já foi para a cozinha vira linha nova
    const existing = orderItems.find(i => i.product_id === product.id && !i.notes && (!i.kds_state || i.kds_state === "pending"));
    if (existing) {
      const newQty = existing.quantity + 1;
      await supabase.from("sale_items").update({
        quantity: newQty, total_price: existing.unit_price * newQty,
      }).eq("id", existing.id);
      setOrderItems(prev => prev.map(i => i.id === existing.id
        ? { ...i, quantity: newQty, total_price: existing.unit_price * newQty }
        : i));
    } else {
      const { data, error: insertErr } = await supabase.from("sale_items").insert({
        sale_id: currentSaleId, product_id: product.id,
        quantity: 1, unit_price: product.sale_price,
        total_price: product.sale_price, notes: null,
        kds_state: "pending", // fica na comanda até "Enviar pedido"
      }).select("*").single();
      if (insertErr) { alert("Erro ao adicionar item: " + insertErr.message); return; }
      if (data) setOrderItems(prev => [...prev, { ...data, products: { name: product.name } } as OrderItem]);
    }
    setSearch("");
  }

  async function changeQty(item: OrderItem, delta: number) {
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      await supabase.from("sale_items").delete().eq("id", item.id);
      setOrderItems(prev => prev.filter(i => i.id !== item.id));
    } else {
      await supabase.from("sale_items").update({
        quantity: newQty, total_price: item.unit_price * newQty,
      }).eq("id", item.id);
      setOrderItems(prev => prev.map(i => i.id === item.id
        ? { ...i, quantity: newQty, total_price: item.unit_price * newQty }
        : i));
    }
  }

  async function saveItemNote() {
    if (!noteTarget) return;
    await supabase.from("sale_items").update({ notes: noteText || null }).eq("id", noteTarget.id);
    setOrderItems(prev => prev.map(i => i.id === noteTarget.id ? { ...i, notes: noteText || null } : i));
    setNoteTarget(null);
    setNoteText("");
    setModal("none");
  }

  // ── Enviar pedido / impressão ────────────────────────────────────────────────

  const ops = useOperators();
  const pendingItems = orderItems.filter(i => i.kds_state === "pending");
  const pendingQty = pendingItems.reduce((s, i) => s + i.quantity, 0);
  const [sending, setSending] = useState(false);
  const [sentFlash, setSentFlash] = useState<{ text: string; key: number } | null>(null);
  // Setores sem impressora ligada no momento do envio
  const [printNotice, setPrintNotice] = useState<{ ids: string[]; sectors: Sector[] } | null>(null);
  const [printHereAlways, setPrintHereAlways] = useState(getPrintHere);

  function flashSent(text: string) {
    const key = Date.now();
    setSentFlash({ text, key });
    setTimeout(() => setSentFlash(f => (f?.key === key ? null : f)), 2200);
  }

  // Manda de uma vez tudo que está "não enviado": cada setor recebe o seu papel
  // (a estação ligada daquele setor imprime; sem estação, oferece imprimir aqui)
  async function sendOrder(): Promise<boolean> {
    if (!currentSaleId || sending || pendingItems.length === 0) return false;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("send_table_order", { p_sale_id: currentSaleId, p_sent_by: ops.current?.name ?? null });
      if (error) { alert("Não foi possível enviar o pedido: " + error.message + "\nNada foi alterado — tente de novo."); return false; }
      const rows = (data ?? []) as { item_id: string; sector: Sector | null }[];
      const sectorOf = new Map(rows.map(r => [r.item_id, r.sector]));
      setOrderItems(prev => prev.map(i => sectorOf.has(i.id) ? { ...i, kds_state: sectorOf.get(i.id) ? "new" : null } : i));
      const toKitchen = rows.filter(r => r.sector);
      flashSent(toKitchen.length ? "Pedido enviado" : "Itens confirmados");
      if (toKitchen.length) {
        const online = await onlineSectors().catch(() => new Set<Sector>());
        const missing = toKitchen.filter(r => !online.has(r.sector!));
        if (missing.length) {
          const ids = missing.map(r => r.item_id);
          if (getPrintHere()) await printItemsHere(ids).catch(() => setPrintNotice({ ids, sectors: [...new Set(missing.map(r => r.sector!))] }));
          else setPrintNotice({ ids, sectors: [...new Set(missing.map(r => r.sector!))] });
        }
      }
      return true;
    } finally {
      setSending(false);
    }
  }

  async function printNoticeHere() {
    if (!printNotice) return;
    setPrintHere(printHereAlways);
    try { await printItemsHere(printNotice.ids); } catch (e: any) { alert("Não foi possível imprimir: " + (e?.message ?? "")); }
    setPrintNotice(null);
  }

  // Segunda via dos itens já enviados, por setor, neste aparelho
  function reprintSent() {
    const sent = orderItems.filter(i => i.kds_state && i.kds_state !== "pending");
    if (!sent.length || !selectedTable || !currentSaleId) return;
    const sectorOfProduct = (pid: string): Sector => {
      const p = products.find(x => x.id === pid);
      const c = categories.find(x => x.id === p?.category_id) as (Category & { print_sector?: Sector | null }) | undefined;
      return c?.print_sector ?? "counter";
    };
    const by = new Map<Sector, OrderItem[]>();
    for (const i of sent) { const s = ((i as any).sector as Sector | null) ?? sectorOfProduct(i.product_id); by.set(s, [...(by.get(s) ?? []), i]); }
    printTickets([...by.entries()].map(([sector, its]) => ({
      sector, origin: `MESA ${selectedTable.name}`, orderNum: currentSaleId.slice(-6).toUpperCase(), reprint: true,
      lines: its.map(i => ({ quantity: i.quantity, product_name: i.products?.name ?? "Produto", notes: i.notes })),
    })));
  }

  // Pré-conta: conferência do cliente antes de pagar (não é cupom fiscal)
  function printPreBill() {
    if (!selectedTable || !orderItems.length) return;
    const store = getStoreSettings();
    const pct = Number(store.service_fee_pct) || 0;
    const service = pct > 0 ? Math.round(orderTotal * pct) / 100 : 0;
    const e = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const row = (a: string, b: string, big = false) => `<div class="r${big ? " big" : ""}"><span>${a}</span><span>${b}</span></div>`;
    const dt = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    printDocument(thermalHtml(`<div class="t">
      <div class="c b">${e(store.name)}</div>
      <div class="c big">MESA ${e(selectedTable.name)}</div>
      <div class="c s">CONFERÊNCIA DE CONTA · ${dt}</div>
      <div class="sep"></div>
      ${orderItems.map(i => row(`${i.quantity}x ${e(i.products?.name ?? "Produto")}`, fmt(i.unit_price * i.quantity))).join("")}
      <div class="sep"></div>
      ${service > 0 ? row("Subtotal", fmt(orderTotal)) + row(`Serviço (${pct}%) — opcional`, fmt(service)) : ""}
      ${row("TOTAL", fmt(orderTotal + service), true)}
      <div class="sep"></div>
      <div class="c s">Não é documento fiscal</div>
    </div>`, `
      .t { padding: 8px 10px 14px; }
      .c { text-align: center; } .b { font-weight: 800; font-size: 15px; } .s { font-size: 11px; }
      .big { font-size: 18px; font-weight: 900; }
      .r { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; margin: 3px 0; }
      .sep { border-top: 1px dashed #000; margin: 6px 0; }
    `), { kind: "prebill", title: `Mesa ${selectedTable.name}` });
  }

  // ── Checkout ────────────────────────────────────────────────────────────────

  const orderTotal = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const orderQty = orderItems.reduce((s, i) => s + i.quantity, 0);
  // Quantas unidades de cada produto já estão na comanda (badge no cartão do produto)
  const qtyInOrder: Record<string, number> = {};
  for (const i of orderItems) qtyInOrder[i.product_id] = (qtyInOrder[i.product_id] ?? 0) + i.quantity;

  // Confirmação rápida ao tocar num produto (o garçom não precisa abrir a comanda)
  const [addedFlash, setAddedFlash] = useState<{ name: string; key: number } | null>(null);
  function addWithFlash(p: Product) {
    addProduct(p);
    const key = Date.now();
    setAddedFlash({ name: p.name, key });
    setTimeout(() => setAddedFlash(f => (f?.key === key ? null : f)), 1400);
  }

  function renderProduct(p: Product) {
    const inOrder = qtyInOrder[p.id] ?? 0;
    return (
      <button key={p.id} onClick={() => addWithFlash(p)}
        style={{ background: card.bg, border: inOrder > 0 ? "1px solid rgba(49,93,251,0.55)" : card.border }}
        className="relative flex flex-col items-start gap-1.5 p-3 min-h-[76px] hover:border-brand-500/50 rounded-xl text-left transition-all active:scale-95">
        {inOrder > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center"
            style={{ background: "#315DFB", color: "#fff" }}>{inOrder}</span>
        )}
        <span className="text-sm font-semibold leading-tight line-clamp-2 pr-6" style={{ color: isLight ? "#111" : "#fff" }}>{p.name}</span>
        <span className="text-sm font-bold text-brand-600">{fmt(p.sale_price)}</span>
        {!isUnlimited(p) && p.stock <= 5 && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.stock === 0 ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
            {p.stock === 0 ? "Esgotado" : `${p.stock} rest.`}
          </span>
        )}
      </button>
    );
  }

  // Situação de cada item na cozinha (aparece na comanda)
  const KDS_BADGE: Record<string, { label: string; color: string }> = {
    pending: { label: "não enviado", color: "#ef4444" },
    new: { label: "na cozinha", color: "#f59e0b" },
    preparing: { label: "preparando", color: "#315DFB" },
    ready: { label: "pronto", color: "#10b981" },
    done: { label: "entregue", color: "#94a3b8" },
  };
  const discountVal = parseFloat(checkoutDiscount) || 0;
  const serviceVal = checkoutService && servicePct > 0 ? Math.round(orderTotal * servicePct) / 100 : 0;
  const finalTotal = Math.max(0, Math.round((orderTotal - discountVal + serviceVal) * 100) / 100);
  const totalPaid = checkoutPayments.reduce((s, p) => s + p.amount, 0);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Divisão da conta: cada parte vira um pagamento próprio (pode ser outra forma)
  const remainingToPay = Math.max(0, round2(finalTotal - totalPaid));
  const partsLeft = Math.max(1, splitN - splitPaidParts);
  const equalPart = partsLeft <= 1 ? remainingToPay : round2(remainingToPay / partsLeft);
  const splitSelTotal = round2(orderItems.filter(i => splitSel.includes(i.id)).reduce((s, i) => s + i.unit_price * i.quantity, 0));
  function launchSplit(amount: number, itemIds?: string[]) {
    const amt = round2(amount);
    if (amt <= 0) return;
    setCheckoutPayments(prev => [...prev, itemIds ? { method: checkoutMethod, amount: amt, items: itemIds } : { method: checkoutMethod, amount: amt, part: true }]);
    if (itemIds) { setSplitPaidItems(prev => [...prev, ...itemIds]); setSplitSel([]); }
    else setSplitPaidParts(n => n + 1);
  }
  function removePayment(idx: number) {
    const p = checkoutPayments[idx];
    if (p?.part) setSplitPaidParts(n => Math.max(0, n - 1));
    if (p?.items) setSplitPaidItems(prev => prev.filter(id => !p.items!.includes(id)));
    setCheckoutPayments(prev => prev.filter((_, j) => j !== idx));
  }

  function addPayment() {
    const amt = parseFloat(checkoutInput);
    if (isNaN(amt) || amt <= 0) return;
    // Valor digitado substitui o da mesma forma (as partes da divisão ficam separadas)
    const manual = (p: PaymentEntry) => p.method === checkoutMethod && !p.part && !p.items;
    if (checkoutPayments.some(manual)) {
      setCheckoutPayments(prev => prev.map(p => manual(p) ? { ...p, amount: amt } : p));
    } else {
      setCheckoutPayments(prev => [...prev, { method: checkoutMethod, amount: amt }]);
    }
    setCheckoutInput("");
  }

  async function confirmPayment() {
    if (!currentSaleId || !userId) return;
    if (checkoutPayments.length === 0) { setCheckoutError("Selecione pelo menos uma forma de pagamento."); return; }
    if (totalPaid < finalTotal && !checkoutPayments.some(p => p.method === "fiado")) {
      setCheckoutError("Valor pago insuficiente."); return;
    }
    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const orderNum = currentSaleId.slice(-6).toUpperCase();
      const saleId   = currentSaleId;
      const tableName = selectedTable?.name ?? "";
      const tableId   = selectedTable?.id ?? "";

      // Tudo numa única transação no banco (finalize_sale): marca a venda como
      // paga, baixa estoque (atômico, sem sobrescrever outro caixa), lança
      // caixa, fiado, saldo e libera a mesa. Se algo falhar, nada é gravado e a
      // mesa continua aberta. Repetir não duplica (a venda já paga é reconhecida).
      // Soma as linhas do mesmo produto antes de baixar — o mesmo item pode ter
      // sido pedido mais de uma vez.
      const saleQtyByProduct: Record<string, number> = {};
      for (const item of orderItems) {
        saleQtyByProduct[item.product_id] = (saleQtyByProduct[item.product_id] ?? 0) + item.quantity;
      }
      const stock = Object.entries(saleQtyByProduct)
        .filter(([productId]) => { const prod = products.find(p => p.id === productId); return !!prod && !isUnlimited(prod); })
        .map(([product_id, qty]) => ({ product_id, qty }));

      // Somados: com a conta dividida, a mesma forma pode aparecer mais de uma vez
      const sumOf = (m: PayMethod) => round2(checkoutPayments.filter(p => p.method === m).reduce((s, p) => s + p.amount, 0));
      const fiadoAmt = checkoutCustomer ? sumOf("fiado") : 0;
      const houseAmt = checkoutCustomer ? sumOf("house_credit") : 0;
      const payments = checkoutPayments.map(p => ({ method: p.method, amount: p.amount }));

      const { data: result, error } = await supabase.rpc("finalize_sale", { p: {
        mode: "update", sale_id: saleId,
        sale: {
          payments, discount: discountVal,
          total_amount: finalTotal,
          customer_id: checkoutCustomer?.id ?? null,
          seller_name: checkoutSeller || null,
          notes: checkoutNotes || null,
          service_tax: serviceVal,
        },
        stock,
        recipe_lines: orderItems.map(oi => ({ product_id: oi.product_id, qty: oi.quantity })),
        stock_note: `Mesa ${tableName} - Venda #${orderNum}`,
        cash: cashRegisterId
          ? payments.map(p => ({
              register_id: cashRegisterId, amount: p.amount, payment_method: p.method,
              channel: "tables", description: `Mesa ${tableName} - #${orderNum}`,
            }))
          : [],
        customer_movements: [
          ...(fiadoAmt > 0 ? [{ customer_id: checkoutCustomer!.id, type: "debit", amount: fiadoAmt, description: `Fiado - Mesa ${tableName} #${orderNum}` }] : []),
          ...(houseAmt > 0 ? [{ customer_id: checkoutCustomer!.id, type: "saldo", amount: houseAmt, description: `Saldo usado - Mesa ${tableName} #${orderNum}` }] : []),
        ],
        house_amount: houseAmt, house_customer_id: houseAmt > 0 ? checkoutCustomer!.id : null,
        free_table_id: tableId || null,
      } });
      if (error || !(result as any)?.sale) {
        setCheckoutError("Erro ao fechar conta" + (error?.message ? `: ${error.message}` : ".") + " Nada foi gravado — pode tentar de novo.");
        setCheckoutLoading(false);
        return;
      }
      for (const w of ((result as any)?.warnings ?? []) as string[]) console.warn("finalize_sale:", w);

      // Print receipt (safe wrapper)
      try { printReceipt(saleId, orderNum); } catch (_) { /* popup blocked — ignore */ }

      // flushSync garante um único commit DOM síncrono — evita o insertBefore do concurrent mode
      flushSync(() => {
        setShowCheckout(false);
        setView("grid");
        setSelectedTable(null);
        setCurrentSaleId(null);
        setOrderItems([]);
        setOpenedAt(null);
        setCheckoutLoading(false);
        if (tableId) {
          setTables(prev => prev.map(t =>
            t.id === tableId ? { ...t, status: "free" as const, current_sale_id: null } : t
          ));
        }
      });

    } catch (err: any) {
      setCheckoutError("Erro inesperado: " + (err?.message ?? "Tente novamente"));
      setCheckoutLoading(false);
    }
  }

  function printReceipt(_saleId: string, orderNum: string) {
    const store = getStoreSettings();
    const dt = new Date().toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const subtotal = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const paid = checkoutPayments.reduce((s, p) => s + p.amount, 0);
    const chg = Math.max(0, paid - finalTotal);

    const SEP = () => `<div style="border-top:1px dashed #000;margin:8px 0"></div>`;
    const ROW = (a: string, b: string) =>
      `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:400;color:#000"><span>${a}</span><span>${b}</span></div>`;
    const LABEL = (t: string) =>
      `<div style="font-size:11px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 3px">${t}</div>`;
    const TOTAL_BOX = (v: string) =>
      `<div style="border:1px solid #000;border-radius:4px;padding:8px 0;margin:6px 0;text-align:center">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#000">TOTAL</div>
        <div style="font-size:20px;font-weight:800;color:#000;margin-top:2px">${v}</div>
      </div>`;

    const isDrink = (name: string) => /bebida|coca|água|suco|refrigerante|vinho|cerveja|chopp|açaí|milkshake|café|leite/i.test(name);
    const mainItems = orderItems.filter(i => !isDrink(i.products?.name ?? ""));
    const drinkItems = orderItems.filter(i => isDrink(i.products?.name ?? ""));

    const mainItemsHtml = mainItems.length > 0 ? mainItems.map((i, idx) => {
      const name = i.products?.name ?? "Produto";
      const isAdicional = i.products?.item_type === "adicional";
      const endsGroup = idx === mainItems.length - 1 || mainItems[idx + 1]?.products?.item_type !== "adicional";
      const border = endsGroup ? "border-bottom:1px dashed #ccc" : "";
      const unitLine = i.quantity > 1
        ? `<div style="font-size:${isAdicional ? "9px" : "10px"};font-weight:400;color:#333;margin-top:1px">${i.quantity} un x ${fmt(i.unit_price)}</div>` : "";
      const obsLine = i.notes
        ? `<div style="font-size:11px;font-weight:700;color:#000;margin-top:2px">Obs: ${i.notes}</div>` : "";
      if (isAdicional) {
        return `<div style="padding:2px 0 3px 16px;${border}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1;padding-right:8px">
              <div style="font-size:11px;font-weight:400;color:#000">+ ${i.quantity}x ${name}</div>
              ${unitLine}
            </div>
            <div style="font-size:11px;font-weight:400;color:#000;white-space:nowrap">${fmt(i.unit_price * i.quantity)}</div>
          </div>
          ${obsLine}
        </div>`;
      }
      return `<div style="padding:6px 0 4px;${border}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;padding-right:8px">
            <div style="font-size:13px;font-weight:700;color:#000">${i.quantity}x ${name}</div>
            ${unitLine}
          </div>
          <div style="font-size:12px;font-weight:700;color:#000;white-space:nowrap">${fmt(i.unit_price * i.quantity)}</div>
        </div>
        ${obsLine}
      </div>`;
    }).join("") : "";

    const drinksHtml = drinkItems.length > 0 ? `
      ${mainItems.length > 0 ? `<div style="margin:10px 0;padding:8px 0;border-top:2px solid #000;border-bottom:2px solid #000;text-align:center">
        <div style="font-size:11px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:0.5px">🍹 BEBIDAS 🍹</div>
      </div>` : ""}
      ${drinkItems.map(i => {
        const name = i.products?.name ?? "Produto";
        const unitLine = i.quantity > 1
          ? `<div style="font-size:10px;font-weight:400;color:#333;margin-top:1px">${i.quantity} un x ${fmt(i.unit_price)}</div>` : "";
        const obsLine = i.notes
          ? `<div style="font-size:11px;font-weight:700;color:#000;margin-top:2px">Obs: ${i.notes}</div>` : "";
        return `<div style="padding:5px 0;border-bottom:1px dashed #ccc">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1;padding-right:8px">
              <div style="font-size:12px;font-weight:700;color:#000">${i.quantity}x ${name}</div>
              ${unitLine}
            </div>
            <div style="font-size:12px;font-weight:700;color:#000;white-space:nowrap">${fmt(i.unit_price * i.quantity)}</div>
          </div>
          ${obsLine}
        </div>`;
      }).join("")}
    ` : "";

    const itemsHtml = mainItemsHtml + drinksHtml || `<div style="font-size:12px;font-weight:400;color:#000;padding:6px 0">Sem itens</div>`;

    const paymentsHtml = checkoutPayments.map(p =>
      ROW(PAY_INFO[p.method]?.label ?? p.method, fmt(p.amount))
    ).join("");

    const pixLine = checkoutPayments.some(p => p.method === "pix") && store.pix
      ? `<div style="font-size:11px;font-weight:400;color:#000">Chave PIX: ${store.pix}</div>` : "";

    const html = (`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Comanda #${orderNum}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:400;color:#000;background:#fff;padding:16px 14px;max-width:320px;margin:0 auto}
      @media print{body{padding:4px 2px;max-width:none}@page{margin:2mm}}
    </style></head><body>

    <div style="text-align:center;padding-bottom:8px">
      <div style="font-size:16px;font-weight:700;color:#000">${store.name}</div>
      ${store.show_cnpj && store.cnpj ? `<div style="font-size:10px;font-weight:400;color:#000">CNPJ: ${store.cnpj}</div>` : ""}
      ${store.address ? `<div style="font-size:10px;font-weight:400;color:#000">${store.address}</div>` : ""}
      ${store.phone ? `<div style="font-size:10px;font-weight:400;color:#000">Tel: ${store.phone}</div>` : ""}
    </div>

    <div style="border-top:1px solid #000;border-bottom:1px dashed #000;padding:5px 0;margin:4px 0;text-align:center">
      <div style="font-size:15px;font-weight:700;color:#000;letter-spacing:1px">#${orderNum}</div>
      <div style="font-size:11px;font-weight:400;color:#000">${dt}</div>
      <div style="font-size:12px;font-weight:700;color:#000">Mesa: ${selectedTable?.name ?? "—"}</div>
    </div>

    ${(checkoutCustomer?.name || checkoutSeller) ? `
    <div style="padding:6px 0">
      ${checkoutCustomer?.name ? `<div style="font-size:12px;color:#000"><span style="font-weight:700">Cliente:</span> ${checkoutCustomer.name}</div>` : ""}
      ${checkoutSeller ? `<div style="font-size:12px;color:#000"><span style="font-weight:700">Vendedor:</span> ${checkoutSeller}</div>` : ""}
    </div>
    ` : ""}

    ${SEP()}
    ${LABEL("Itens do pedido")}
    ${itemsHtml}

    ${SEP()}
    ${subtotal !== finalTotal ? ROW("Subtotal", fmt(subtotal)) : ""}
    ${discountVal > 0 ? ROW("Desconto", "- " + fmt(discountVal)) : ""}
    ${serviceVal > 0 ? ROW(`Serviço (${servicePct}%)`, fmt(serviceVal)) : ""}
    ${TOTAL_BOX(fmt(finalTotal))}

    ${SEP()}
    ${LABEL("Pagamento")}
    ${paymentsHtml}
    ${pixLine}
    ${chg > 0.01 ? ROW("Troco", fmt(chg)) : ""}

    ${checkoutNotes ? `${SEP()}${LABEL("Observacoes")}<div style="font-size:12px;font-weight:400;color:#000">${checkoutNotes}</div>` : ""}

    ${SEP()}
    <div style="text-align:center;font-size:11px;font-weight:400;color:#000;padding-top:4px">
      ${store.footer_message || "Obrigado pela preferencia!"}
    </div>
    </body></html>`);
    printDocument(html, { kind: "receipt", title: `Mesa · #${orderNum}` });
  }

  // ── Table CRUD ───────────────────────────────────────────────────────────────

  function openManage(t?: TableRecord) {
    setSaveError(null);
    if (t) {
      setEditingTable(t);
      setFName(t.name); setFNumber(t.number != null ? String(t.number) : "");
      setFCapacity(String(t.capacity)); setFArea(t.area);
      setTableFormTab("single");
    } else {
      setEditingTable(null);
      setFName(""); setFNumber(""); setFCapacity("4"); setFArea("Salão");
      setTableFormTab("single");
    }
    setModal("editTable");
  }

  async function saveTable() {
    if (!fName.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    const payload = {
      name: fName.trim(), number: fNumber ? parseInt(fNumber) : null,
      capacity: parseInt(fCapacity) || 4, area: fArea || "Salão",
    };
    let error: { message: string } | null = null;
    if (editingTable) {
      const res = await supabase.from("tables").update(payload).eq("id", editingTable.id);
      error = res.error;
    } else {
      const res = await supabase.from("tables").insert(payload);
      error = res.error;
    }
    if (error) {
      setSaveError("Erro ao salvar: " + error.message);
      setSaving(false);
      return;
    }
    await loadAll();
    setSaving(false);
    setModal("none");
  }

  async function bulkCreate() {
    const count = Math.min(50, parseInt(bulkCount) || 0);
    const start = parseInt(bulkStart) || 1;
    if (count <= 0) return;
    setSaving(true);
    setSaveError(null);
    const rows = Array.from({ length: count }, (_, i) => ({
      name: `${bulkPrefix}${start + i}`,
      number: start + i,
      capacity: parseInt(bulkCapacity) || 4,
      area: bulkArea || "Salão",
      status: "free",
      is_active: true,
    }));
    const { error } = await supabase.from("tables").insert(rows);
    if (error) {
      setSaveError("Erro ao criar mesas: " + error.message);
      setSaving(false);
      return;
    }
    await loadAll();
    setSaving(false);
    setModal("none");
  }

  async function deleteTable(t: TableRecord) {
    if (t.status === "occupied" && t.current_sale_id) {
      await supabase.from("sale_items").delete().eq("sale_id", t.current_sale_id);
      await supabase.from("sales").update({ status: "cancelled" }).eq("id", t.current_sale_id);
    }
    await supabase.from("tables").update({ is_active: false, status: "free", current_sale_id: null }).eq("id", t.id);
    await loadAll();
    setModal("none");
  }

  async function cancelOrder() {
    if (!currentSaleId || !selectedTable) return;
    if (!(await requireApproval("Cancelar pedido da mesa"))) return;
    setSaving(true);
    await supabase.from("sale_items").delete().eq("sale_id", currentSaleId);
    // Delete the sale entirely (no items = nothing to keep for history)
    await supabase.from("sales").delete().eq("id", currentSaleId);
    await supabase.from("tables").update({ status: "free", current_sale_id: null }).eq("id", selectedTable.id);
    setSaving(false);
    goBack(true);
  }

  // Transferir a comanda para uma mesa livre, ou juntar com a comanda de uma
  // mesa ocupada. O banco faz tudo de uma vez (move_table_order).
  async function moveTableOrder() {
    if (!selectedTable || !moveTarget || saving) return;
    setSaving(true);
    setMoveError(null);
    const { data, error } = await supabase.rpc("move_table_order", { p_from: selectedTable.id, p_to: moveTarget.id });
    if (error || !(data as any)?.sale_id) {
      setMoveError("Não foi possível: " + (error?.message ?? "tente novamente") + ". Nada foi alterado.");
      setSaving(false);
      return;
    }
    const target = { ...moveTarget, status: "occupied" as const, current_sale_id: (data as any).sale_id as string };
    const fromId = selectedTable.id;
    setTables(prev => prev.map(t => t.id === fromId ? { ...t, status: "free" as const, current_sale_id: null }
      : t.id === target.id ? target : t));
    setModal("none");
    setMoveTarget(null);
    setSaving(false);
    await enterTable(target);
    loadAll();
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  // Agrupa IDs de categoria pelo nome (resolve duplicatas como "BEBIDAS BEBIDAS")
  const catNameMap = categories
    .filter(c => !c.parent_id)
    .reduce<Record<string, string[]>>((acc, c) => {
      const key = c.name.toUpperCase();
      if (!acc[key]) acc[key] = [];
      acc[key].push(c.id);
      return acc;
    }, {});

  // Nomes únicos que têm pelo menos um produto, ordenados pelo catOrder salvo
  const visibleCatNames = Object.keys(catNameMap)
    .filter(name => products.some(p => p.category_id && catNameMap[name].includes(p.category_id)))
    .sort((a, b) => {
      const ai = catOrder.indexOf(a);
      const bi = catOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  function moveCat(idx: number, dir: -1 | 1) {
    const arr = [...visibleCatNames];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= arr.length) return;
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setCatOrder(arr);
    localStorage.setItem("upabase_cat_order_tables", JSON.stringify(arr));
  }

  // catFilter agora guarda o NOME da categoria (maiúsculo) ou null
  const filteredProducts = products.filter(p => {
    const matchSearch = matchesSearch(p.name, search);
    const matchCat    = catFilter === null ||
      (p.category_id !== null && catNameMap[catFilter]?.includes(p.category_id));
    return matchSearch && matchCat;
  });

  // Produtos exibidos numa categoria: usa a lista escolhida a dedo (itens do dia) se existir,
  // senão cai no comportamento automático de sempre (produtos com essa categoria cadastrada)
  function productsForCategory(name: string): Product[] {
    const curated = curatedProducts[name];
    if (curated && curated.length > 0) {
      return curated.map(id => products.find(p => p.id === id)).filter((p): p is Product => !!p);
    }
    return products.filter(p => p.category_id && catNameMap[name]?.includes(p.category_id));
  }

  const areas = [...new Set(tables.map(t => t.area))].filter(Boolean);
  const filteredTables = areaFilter ? tables.filter(t => t.area === areaFilter) : tables;

  const stats = {
    free: tables.filter(t => t.status === "free").length,
    occupied: tables.filter(t => t.status === "occupied").length,
    reserved: tables.filter(t => t.status === "reserved").length,
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ═══ MAIN VIEW — dois divs sempre montados; visibilidade por CSS ════════ */}
      <div className={view === "grid" ? "space-y-5" : "hidden"}>
          <PageHeader title="Mesas"
            subtitle={<>
              <span className="text-emerald-700 font-semibold">{stats.free} livre{stats.free !== 1 ? "s" : ""}</span>
              {stats.occupied > 0 && <span className="text-amber-700 font-semibold ml-1">· {stats.occupied} ocupada{stats.occupied !== 1 ? "s" : ""}</span>}
              {stats.reserved > 0 && <span className="text-brand-700 font-semibold ml-1">· {stats.reserved} reservada{stats.reserved !== 1 ? "s" : ""}</span>}
            </>}
            actions={<>
              <button onClick={loadAll} className={btnSecondary + " !px-2.5"} title="Atualizar">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button onClick={() => setModal("manage")} className={btnSecondary}>
                <Settings className="w-4 h-4" /> Gerenciar
              </button>
              <button onClick={() => openManage()} className={btnPrimary} style={WHITE_TEXT}>
                <Plus className="w-4 h-4" /> Nova Mesa
              </button>
            </>} />

          {/* Area filter */}
          {areas.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setAreaFilter(null)}
                style={areaFilter !== null ? { background: card.bg, border: card.border } : { color: "#fff" }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${areaFilter === null ? "bg-brand-600" : "text-zinc-400 hover:text-white"}`}>
                Todas
              </button>
              {areas.map(area => (
                <button key={area} onClick={() => setAreaFilter(area)}
                  style={areaFilter !== area ? { background: card.bg, border: card.border } : { color: "#fff" }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${areaFilter === area ? "bg-brand-600" : "text-zinc-400 hover:text-white"}`}>
                  {area}
                </button>
              ))}
            </div>
          )}

          {/* KPI Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard compact label="Total de Mesas" value={tables.length} tone="brand" />
            <StatCard compact label="Livres" value={stats.free} tone={stats.free > 0 ? "positive" : "default"} />
            <StatCard compact label="Ocupadas" value={stats.occupied} tone={stats.occupied > 0 ? "warning" : "default"} />
            <StatCard compact label="Reservadas" value={stats.reserved} tone={stats.reserved > 0 ? "brand" : "default"} />
          </div>

          {/* Table grid */}
          {filteredTables.length === 0 ? (
            <div className="text-center py-24 border border-dashed border-zinc-800 rounded-2xl">
              <UtensilsCrossed className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-400 font-semibold">Nenhuma mesa cadastrada</p>
              <p className="text-zinc-600 text-sm mt-1">Crie mesas clicando em "Nova Mesa"</p>
              <button onClick={() => openManage()}
                className="mt-5 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold transition-colors">
                Criar primeira mesa
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-3 gap-y-5">
              {filteredTables.map(table => {
                const info = table.status === "occupied" && table.current_sale_id ? openInfo[table.current_sale_id] : undefined;
                const mins = info ? Math.max(0, Math.floor((Date.now() - new Date(info.since).getTime()) / 60000)) : 0;
                // Cor de cada status: a aba (marcador de fichário) leva a cor cheia;
                // o corpo do cartão só um leve tom dela.
                const TONE: Record<string, { tab: string; tint: string; ink: string; label: string }> = {
                  free:     { tab: "linear-gradient(135deg, #7C3FFA 0%, #315DFB 55%, #00B8C8 100%)", tint: "#315DFB", ink: "#315DFB", label: "Livre" },
                  occupied: { tab: "linear-gradient(135deg,#334155,#1e293b)", tint: "#334155", ink: "#475569", label: "Ocupada" },
                  reserved: { tab: "linear-gradient(135deg,#818cf8,#6366f1)", tint: "#6366f1", ink: "#4f46e5", label: "Reservada" },
                  cleaning: { tab: "linear-gradient(135deg,#cbd5e1,#94a3b8)", tint: "#94a3b8", ink: "#64748b", label: "Em limpeza" },
                };
                const t = TONE[table.status] ?? TONE.free;
                const late = mins >= 90;
                const muted = isLight ? "#9ca3af" : "#71717a";
                return (
                  <button key={table.id} onClick={() => enterTable(table)}
                    className="group relative text-left pt-6 transition-transform hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer">
                    {/* Aba de fichário com o nome da mesa, em relevo */}
                    <span className="absolute top-0 left-3 max-w-[78%] h-7 px-3 rounded-t-xl flex items-center text-[12px] font-extrabold uppercase tracking-wide truncate"
                      style={{
                        background: t.tab, color: "#ffffff",
                        textShadow: "0 1px 0 rgba(0,0,0,0.22)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.08), 0 -2px 8px -2px rgba(17,24,39,0.18)",
                      }}>
                      {table.name}
                    </span>
                    {/* Corpo */}
                    <div className="relative rounded-2xl rounded-tl-md px-4 pt-4 pb-3 min-h-[118px] flex flex-col"
                      style={{
                        background: isLight ? "#ffffff" : "#18181b",
                        border: isLight ? "1px solid #e5e7eb" : "1px solid rgba(63,63,70,0.7)",
                        boxShadow: isLight ? "0 1px 2px rgba(17,24,39,0.04), 0 8px 20px -12px rgba(17,24,39,0.18)" : "none",
                      }}>
                      <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
                        {info ? (
                          <>
                            <p className="text-xl font-black tabular-nums leading-none" style={{ color: isLight ? "#111827" : "#f4f4f5" }}>{fmt(info.total)}</p>
                            <p className="text-[11px] flex items-center gap-1 font-semibold" style={{ color: late ? "#ef4444" : t.ink }}>
                              <Clock className="w-3 h-3" /> {timeAgo(info.since)} · {info.items} ite{info.items === 1 ? "m" : "ns"}
                            </p>
                          </>
                        ) : (
                          <>
                            <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${t.tint}1f` }}>
                              <UtensilsCrossed className="w-4 h-4" style={{ color: t.ink }} />
                            </span>
                            <p className="text-sm font-bold" style={{ color: t.ink }}>{t.label}</p>
                            {table.status === "free" && <p className="text-[10px]" style={{ color: muted }}>toque para abrir</p>}
                          </>
                        )}
                      </div>
                      <p className="mt-2 text-[10px] flex items-center justify-center gap-1" style={{ color: muted }}>
                        <Users className="w-3 h-3" /> {table.capacity} lugares{table.area ? ` · ${table.area}` : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </div>
      <div className={view === "table" ? "flex flex-col h-[calc(100vh-80px)] max-h-[900px]" : "hidden"}>
        {selectedTable && <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 flex-shrink-0">
            <div className="flex items-center gap-3 sm:flex-1 min-w-0">
              <button onClick={() => goBack()}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors flex-shrink-0">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold">{selectedTable.name}</h1>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${(STATUS_CFG[selectedTable.status] ?? fallbackCfg).badge}`}>
                    {(STATUS_CFG[selectedTable.status] ?? fallbackCfg).label}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{selectedTable.capacity} lugares</span>
                  {openedAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(openedAt)}</span>}
                  <span>{selectedTable.area}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {orderItems.length > 0 && (
                <button onClick={() => { setMoveTarget(null); setMoveError(null); setModal("moveTable"); }}
                  title="Transferir para outra mesa ou juntar mesas"
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-zinc-300 hover:text-white rounded-xl text-sm font-bold transition-colors"
                  style={{ background: card.bg, border: card.border }}>
                  <ArrowLeftRight className="w-4 h-4" /> Trocar mesa
                </button>
              )}
              <button onClick={() => setModal("cancelOrder")}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-sm font-bold transition-colors">
                <X className="w-4 h-4" /> Cancelar Mesa
              </button>
              {orderItems.length > 0 && (
                <button onClick={() => { setSellers(getSellers()); setShowCheckout(true); setCheckoutPayments([]); setCheckoutInput(""); setCheckoutDiscount("0"); setCheckoutCustomer(null); setCheckoutSeller(""); setCheckoutNotes(""); setCheckoutError(null); setSplitMode("none"); setSplitN(2); setSplitPaidParts(0); setSplitSel([]); setSplitPaidItems([]); const pct = Number(getStoreSettings().service_fee_pct) || 0; setServicePct(pct); setCheckoutService(pct > 0); }}
                  className="basis-full sm:basis-auto flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold transition-colors shadow-lg shadow-emerald-900/30"
                  style={{ color: "#fff" }}>
                  <CheckCircle2 className="w-4 h-4" /> Fechar Conta · {fmt(orderTotal)}
                </button>
              )}
            </div>
          </div>

          {/* Mobile tab switcher */}
          <div className="flex sm:hidden gap-2 mb-4 flex-shrink-0">
            {(["catalog", "order"] as const).map(t => (
              <button key={t} onClick={() => setComandaTab(t)}
                style={comandaTab !== t ? { background: card.bg, border: card.border } : { color: "#fff" }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-colors ${comandaTab === t ? "bg-brand-600" : "text-zinc-400"}`}>
                {t === "catalog" ? <><Coffee className="w-3.5 h-3.5" />Cardápio</> : <><ShoppingCart className="w-3.5 h-3.5" />Comanda {orderItems.length > 0 && `(${orderItems.reduce((s,i)=>s+i.quantity,0)})`}</>}
              </button>
            ))}
          </div>

          {/* Main split layout */}
          <div className="flex gap-4 flex-1 min-h-0">
            {/* LEFT — Product catalog */}
            <div className={`flex flex-col flex-1 min-w-0 ${comandaTab === "order" ? "hidden sm:flex" : "flex"}`}>
              {/* Search */}
              <div className="relative mb-3 flex-shrink-0">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar produto..."
                  style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-all" />
              </div>

              {/* Category tabs + botão ordenar */}
              {visibleCatNames.length > 0 && (
                <>
                  <div className="flex gap-1.5 mb-1 overflow-x-auto pb-1 flex-shrink-0 scrollbar-none items-center">
                    <button onClick={() => setCatFilter(null)}
                      style={catFilter !== null ? { background: card.bg, border: card.border } : { color: "#fff" }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${catFilter === null ? "bg-brand-600" : "text-zinc-400 hover:text-white"}`}>
                      Todos
                    </button>
                    {visibleCatNames.map(name => (
                      <button key={name} onClick={() => setCatFilter(name)}
                        style={catFilter !== name ? { background: card.bg, border: card.border } : { color: "#fff" }}
                        className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${catFilter === name ? "bg-brand-600" : "text-zinc-400 hover:text-white"}`}>
                        {name.charAt(0) + name.slice(1).toLowerCase()}
                      </button>
                    ))}
                    <button
                      onClick={() => { setShowCurateManager(true); setCurateActiveCat(catFilter ?? visibleCatNames[0] ?? null); setCurateSearch(""); }}
                      title="Escolher itens do dia por categoria"
                      className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors"
                      style={{ background: "#f59e0b", boxShadow: "0 0 12px rgba(245,158,11,0.35)" }}>
                      <Star className="w-3.5 h-3.5" /> Itens do dia
                    </button>
                    <button
                      onClick={() => setShowCatOrder(v => !v)}
                      title="Ordenar categorias"
                      className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                      style={{ background: showCatOrder ? "rgba(139,92,246,0.15)" : card.bg, border: card.border, color: showCatOrder ? "#8b5cf6" : "#71717a" }}>
                      <ListOrdered className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Painel de ordenação inline */}
                  {showCatOrder && (
                    <div className="mb-3 rounded-xl p-3 flex-shrink-0"
                      style={{ background: card.bg, border: card.border }}>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Arrastar para ordenar</p>
                      <div className="space-y-1">
                        {visibleCatNames.map((name, idx) => (
                          <div key={name} className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                            style={{ background: isLight ? "#F3F4F6" : "#27272a" }}>
                            <span className="flex-1 text-xs font-medium" style={{ color: isLight ? "#374151" : "#a1a1aa" }}>
                              {name.charAt(0) + name.slice(1).toLowerCase()}
                            </span>
                            <button onClick={() => moveCat(idx, -1)} disabled={idx === 0}
                              className="p-0.5 rounded disabled:opacity-30 text-zinc-500 hover:text-brand-600 transition-colors">
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => moveCat(idx, 1)} disabled={idx === visibleCatNames.length - 1}
                              className="p-0.5 rounded disabled:opacity-30 text-zinc-500 hover:text-brand-600 transition-colors">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Product area */}
              <div className="flex-1 overflow-y-auto">
                {catFilter === null && !search ? (
                  // ── Todos: agrupado por categoria ──
                  visibleCatNames.reduce((s, name) => s + productsForCategory(name).length, 0) + products.filter(p => !p.category_id).length === 0 ? (
                    <div className="text-center py-10 text-xs text-zinc-600">Nenhum produto encontrado</div>
                  ) : (
                  <>
                    {/* Mais pedidos (últimos 30 dias) — atalho para lançar rápido */}
                    {(() => {
                      const top = topProductIds.map(id => products.find(p => p.id === id)).filter(Boolean).slice(0, 8) as Product[];
                      if (top.length === 0) return null;
                      return (
                        <div className="mb-4">
                          <div className="flex items-center gap-2 py-1.5 mb-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap flex items-center gap-1" style={{ color: "#f59e0b" }}>
                              <Star className="w-3 h-3" /> Mais pedidos
                            </span>
                            <div className="flex-1 h-px bg-zinc-800/60" />
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {top.map(p => renderProduct(p))}
                          </div>
                        </div>
                      );
                    })()}
                    {visibleCatNames.map(name => {
                      const catProds = productsForCategory(name);
                      if (catProds.length === 0) return null;
                      return (
                        <div key={name} className="mb-4">
                          <div className="flex items-center gap-2 py-1.5 mb-2">
                            <span className="text-[11px] font-bold text-brand-600 uppercase tracking-wider whitespace-nowrap">
                              {name.charAt(0) + name.slice(1).toLowerCase()}
                            </span>
                            <div className="flex-1 h-px bg-zinc-800/60" />
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {catProds.map(p => (
                              renderProduct(p)
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {/* Sem categoria */}
                    {(() => {
                      const uncategorized = products.filter(p => !p.category_id);
                      if (uncategorized.length === 0) return null;
                      return (
                        <div className="mb-4">
                          <div className="flex items-center gap-2 py-1.5 mb-2">
                            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Outros</span>
                            <div className="flex-1 h-px bg-zinc-800/60" />
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {uncategorized.map(p => (
                              renderProduct(p)
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                  )
                ) : (
                  // ── Categoria específica ou busca: lista plana ──
                  (() => {
                    const listProds = search !== "" ? filteredProducts : (catFilter !== null ? productsForCategory(catFilter) : []);
                    return listProds.length === 0 ? (
                      <div className="text-center py-10 text-xs text-zinc-600">Nenhum produto encontrado</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {listProds.map(p => (
                          renderProduct(p)
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Celular: barra fixa para ver a comanda sem perder o lugar no cardápio */}
              {orderItems.length > 0 && (
                <div className="sm:hidden mt-2 flex-shrink-0 flex gap-2">
                  <button onClick={() => setComandaTab("order")}
                    className="flex-1 min-w-0 h-12 rounded-2xl flex items-center justify-between px-4 text-sm font-semibold shadow-lg"
                    style={pendingQty > 0 ? { background: card.bg, border: card.border } : { background: "#315DFB", color: "#fff" }}>
                    <span className="flex items-center gap-2 truncate"><ShoppingCart className="w-4 h-4" /> Comanda · {orderQty}</span>
                    <span className="font-black">{fmt(orderTotal)}</span>
                  </button>
                  {pendingQty > 0 && (
                    <button onClick={() => sendOrder()} disabled={sending}
                      className="h-12 px-4 rounded-2xl flex items-center gap-2 text-sm font-bold shadow-lg disabled:opacity-60"
                      style={{ background: "#315DFB", color: "#fff" }}>
                      {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar ({pendingQty})
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT — Order / Comanda */}
            <div className={`flex flex-col w-full sm:w-80 flex-shrink-0 rounded-2xl overflow-hidden ${comandaTab === "catalog" ? "hidden sm:flex" : "flex"}`}
              style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
                <ShoppingCart className="w-4 h-4 text-brand-600" />
                <h2 className="text-sm font-semibold">Comanda</h2>
                {orderItems.length > 0 && (
                  <span className="ml-auto text-xs text-zinc-500">{orderItems.reduce((s,i)=>s+i.quantity,0)} item{orderItems.reduce((s,i)=>s+i.quantity,0)!==1?"s":""}</span>
                )}
              </div>

              {/* Items */}
              {orderLoading ? (
                <div className="flex justify-center py-8"><RefreshCw className="w-4 h-4 animate-spin text-brand-600" /></div>
              ) : orderItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-8">
                  <Coffee className="w-10 h-10 text-zinc-700 mb-3" />
                  <p className="text-xs text-zinc-600">Nenhum item na comanda</p>
                  <p className="text-xs text-zinc-700 mt-1">Toque em um produto para adicionar</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
                  {orderItems.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.products?.name ?? "—"}</p>
                        {item.notes && <p className="text-xs text-zinc-500 italic">{item.notes}</p>}
                        {item.kds_state && KDS_BADGE[item.kds_state] && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5"
                            style={{ color: KDS_BADGE[item.kds_state].color, background: `${KDS_BADGE[item.kds_state].color}18` }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: KDS_BADGE[item.kds_state].color }} />
                            {KDS_BADGE[item.kds_state].label}
                          </span>
                        )}
                        <p className="text-xs text-zinc-500">{fmt(item.unit_price)} /un</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => changeQty(item, -1)}
                          className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-bold text-white w-6 text-center">{item.quantity}</span>
                        <button onClick={() => changeQty(item, 1)}
                          className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={async () => {
                          await supabase.from("sale_items").delete().eq("id", item.id);
                          setOrderItems(prev => prev.filter(i => i.id !== item.id));
                        }}
                          className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-white">{fmt(item.unit_price * item.quantity)}</p>
                        <button onClick={() => { setNoteTarget(item); setNoteText(item.notes ?? ""); setModal("itemNote"); }}
                          title="Observação do item"
                          className={`flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors ${item.notes ? "bg-brand-600/20 text-brand-700" : "text-zinc-500 hover:text-brand-600 hover:bg-zinc-800"}`}>
                          <MessageSquare className="w-3 h-3" /> {item.notes ? "editar obs" : "obs"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Total + pay button */}
              {orderItems.length > 0 && (
                <div className="border-t border-zinc-800 px-4 py-3 flex-shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Total</span>
                    <span className="text-lg font-black text-white">{fmt(orderTotal)}</span>
                  </div>
                  {pendingQty > 0 && (
                    <button onClick={() => sendOrder()} disabled={sending}
                      className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                      style={{ background: "#315DFB", color: "#fff" }}>
                      {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Enviar pedido · {pendingQty} ite{pendingQty === 1 ? "m" : "ns"}
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={printPreBill}
                      className="py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors">
                      <Receipt className="w-3.5 h-3.5" /> Pré-conta
                    </button>
                    <button onClick={reprintSent} disabled={!orderItems.some(i => i.kds_state && i.kds_state !== "pending")}
                      className="py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors">
                      <Printer className="w-3.5 h-3.5" /> 2ª via cozinha
                    </button>
                  </div>
                  <button onClick={() => { setSellers(getSellers()); setShowCheckout(true); setCheckoutPayments([]); setCheckoutInput(""); setCheckoutDiscount("0"); setCheckoutCustomer(null); setCheckoutSeller(""); setCheckoutNotes(""); setCheckoutError(null); setSplitMode("none"); setSplitN(2); setSplitPaidParts(0); setSplitSel([]); setSplitPaidItems([]); const pct = Number(getStoreSettings().service_fee_pct) || 0; setServicePct(pct); setCheckoutService(pct > 0); }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl text-sm transition-colors"
                    style={{ color: "#fff" }}>
                    Fechar Conta
                  </button>
                </div>
              )}
            </div>
          </div>
        </>}
      </div>

      {sentFlash && view === "table" && createPortal(
        <div key={sentFlash.key} className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-8 z-[61] px-4 py-2.5 rounded-full text-sm font-semibold shadow-xl flex items-center gap-2 pointer-events-none"
          style={{ background: "#315DFB", color: "#fff" }}>
          <Send className="w-4 h-4" /> {sentFlash.text}
        </div>,
        document.body,
      )}

      {/* Sem impressora ligada para algum setor */}
      {printNotice && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(245,158,11,0.12)" }}>
                <Printer className="w-7 h-7 text-amber-500" />
              </div>
              <p className="text-base font-bold">Nenhuma impressora ligada para {printNotice.sectors.map(x => SECTOR_LABEL[x]).join(", ")}</p>
              <p className="text-sm text-zinc-500 mt-1">O pedido já aparece na tela da Cozinha. Quer imprimir neste aparelho?</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={printHereAlways} onChange={e => setPrintHereAlways(e.target.checked)} className="w-4 h-4 accent-[#315DFB]" />
              Sempre imprimir neste aparelho quando não houver impressora ligada
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPrintNotice(null)}
                className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Não imprimir</button>
              <button onClick={printNoticeHere}
                className="py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2" style={{ background: "#315DFB", color: "#fff" }}>
                <Printer className="w-4 h-4" /> Imprimir aqui
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Confirmação ao lançar produto */}
      {addedFlash && view === "table" && createPortal(
        <div key={addedFlash.key} className="fixed left-1/2 -translate-x-1/2 bottom-24 sm:bottom-8 z-[60] px-4 py-2.5 rounded-full text-sm font-semibold shadow-xl flex items-center gap-2 pointer-events-none"
          style={{ background: "#111827", color: "#fff" }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "#34d399" }} /> +1 {addedFlash.name}
        </div>,
        document.body,
      )}

      {/* ═══ MODAL — portal ao document.body, totalmente fora da árvore DOM do componente ═══ */}
      {createPortal(modal === "openConfirm" && selectedTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 bg-brand-500/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <UtensilsCrossed className="w-7 h-7 text-brand-600" />
              </div>
              <p className="text-base font-bold">{selectedTable.name}</p>
              <p className="text-sm text-zinc-500 mt-1">{selectedTable.capacity} lugares · {selectedTable.area}</p>
              {selectedTable.status === "reserved" && (
                <p className="text-xs text-blue-400 mt-2">Mesa reservada — abrindo agora</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setSelectedTable(null); setModal("none"); }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={() => openTable(selectedTable!)} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl text-sm font-bold transition-colors"
                style={{ color: "#fff" }}>
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Abrir Mesa
              </button>
            </div>
            {selectedTable.status === "free" && (
              <button onClick={() => setModal("reserve")}
                className="w-full py-2 text-blue-400 text-sm hover:underline">Reservar em vez de abrir</button>
            )}
          </div>
        </div>
      ) : modal === "reserve" && selectedTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold">Reservar {selectedTable.name}</h2>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome / Observação</label>
              <input value={reserveNotes} onChange={e => setReserveNotes(e.target.value)}
                placeholder="Nome do cliente ou horário..." className={inputCls} autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={() => reserveTable(selectedTable!)}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors">Reservar</button>
            </div>
          </div>
        </div>
      ) : modal === "statusChange" && statusChangeTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="text-sm font-semibold">{statusChangeTarget.table.name} — alterar status</p>
            <div className="grid grid-cols-2 gap-2">
              {(["free", "reserved", "cleaning"] as const).map(s => {
                const cfg = STATUS_CFG[s];
                return (
                  <button key={s} onClick={() => setTableStatus(statusChangeTarget.table, s)}
                    className={`py-2.5 px-3 rounded-xl border text-sm font-semibold transition-colors ${cfg.badge}`}>
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setModal("none")} className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
          </div>
        </div>
      ) : modal === "itemNote" && noteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-semibold">Observação — {noteTarget.products?.name}</h2>
            <input value={noteText} onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveItemNote()}
              placeholder="Ex: sem cebola, bem passado..." className={inputCls} autoFocus />
            <div className="flex gap-3">
              <button onClick={() => { setNoteTarget(null); setNoteText(""); setModal("none"); }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveItemNote}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-colors">Salvar</button>
            </div>
          </div>
        </div>
      ) : modal === "manage" ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <h2 className="text-base font-semibold">Gerenciar Mesas</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => { setModal("none"); openManage(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-white rounded-xl text-xs font-semibold transition-colors"
                  style={{background:"#315DFB"}}>
                  <Plus className="w-3.5 h-3.5" /> Nova Mesa
                </button>
                <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800">
              {tables.map(t => {
                const cfg = STATUS_CFG[t.status] ?? fallbackCfg;
                return (
                  <div key={t.id} className="flex items-center gap-4 px-5 py-3">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{t.name}</p>
                      <p className="text-xs text-zinc-500">{t.area} · {t.capacity} lugares · <span className={cfg.badge.split(" ")[0]}>{cfg.label}</span></p>
                    </div>
                    <div className="flex items-center gap-1">
                      {t.status !== "occupied" && (
                        <button onClick={() => { setStatusChangeTarget({ table: t, status: "free" }); setModal("statusChange"); }}
                          className="p-1.5 text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors" title="Mudar status">
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => { setModal("none"); openManage(t); }}
                        className="p-1.5 text-zinc-500 hover:text-brand-600 hover:bg-brand-500/10 rounded-lg transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteTable(t)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title={t.status === "occupied" ? "Excluir (cancela o pedido em aberto)" : "Excluir mesa"}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {tables.length === 0 && (
                <div className="text-center py-10 text-xs text-zinc-600">Nenhuma mesa cadastrada</div>
              )}
            </div>
          </div>
        </div>
      ) : modal === "editTable" ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-base font-semibold">{editingTable ? "Editar Mesa" : "Adicionar Mesas"}</h2>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            {!editingTable && (
              <div className="flex gap-1 mx-6 mt-4 bg-zinc-950 rounded-xl p-1">
                {(["single", "bulk"] as const).map(key => (
                  <button key={key} onClick={() => { setTableFormTab(key); setSaveError(null); }}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${tableFormTab === key ? "text-white" : "text-zinc-400 hover:text-white"}`}
                    style={tableFormTab === key ? {background:"#315DFB"} : undefined}>
                    {key === "single" ? "Mesa Individual" : "Criar em Massa"}
                  </button>
                ))}
              </div>
            )}
            <div className="p-6 space-y-4">
              {tableFormTab === "single" || editingTable ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome *</label>
                    <input value={fName} onChange={e => setFName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveTable()}
                      placeholder="Mesa 1, Mesa VIP, Balcão..." className={inputCls} autoFocus />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Número</label>
                      <input value={fNumber} onChange={e => setFNumber(e.target.value)}
                        type="number" min="1" placeholder="Opcional" className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Capacidade</label>
                      <input value={fCapacity} onChange={e => setFCapacity(e.target.value)}
                        type="number" min="1" max="50" className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Área / Setor</label>
                    <input value={fArea} onChange={e => setFArea(e.target.value)}
                      placeholder="Salão, Varanda, Bar, Deck..." className={inputCls} />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-zinc-500">Cria várias mesas numeradas de uma só vez.</p>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">Quantidade de mesas</label>
                    <div className="flex gap-2 mb-2">
                      {[5, 10, 15, 20].map(n => (
                        <button key={n} onClick={() => setBulkCount(String(n))}
                          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${bulkCount === String(n) ? "text-white" : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white"}`}
                          style={bulkCount === String(n) ? {background:"#315DFB", borderColor:"#315DFB"} : undefined}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <input value={bulkCount} onChange={e => setBulkCount(e.target.value)}
                      type="number" min="1" max="50" placeholder="Ou digite a quantidade..." className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Prefixo do nome</label>
                      <input value={bulkPrefix} onChange={e => setBulkPrefix(e.target.value)} placeholder="Mesa " className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Numeração inicial</label>
                      <input value={bulkStart} onChange={e => setBulkStart(e.target.value)} type="number" min="1" className={inputCls} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Capacidade</label>
                      <input value={bulkCapacity} onChange={e => setBulkCapacity(e.target.value)} type="number" min="1" max="50" className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Área / Setor</label>
                      <input value={bulkArea} onChange={e => setBulkArea(e.target.value)} placeholder="Salão" className={inputCls} />
                    </div>
                  </div>
                  {parseInt(bulkCount) > 0 && bulkPrefix && (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-400">
                      Serão criadas: <span className="text-white font-semibold">{bulkPrefix}{bulkStart} → {bulkPrefix}{parseInt(bulkStart) + parseInt(bulkCount) - 1}</span>
                      {" "}({bulkCount} mesas · {bulkCapacity} lugares · {bulkArea || "Salão"})
                    </div>
                  )}
                </>
              )}
              {saveError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{saveError}</p>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              {tableFormTab === "single" || editingTable ? (
                <button onClick={saveTable} disabled={!fName.trim() || saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors"
                  style={{background:"#315DFB"}}>
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {editingTable ? "Salvar" : "Criar Mesa"}
                </button>
              ) : (
                <button onClick={bulkCreate} disabled={!(parseInt(bulkCount) > 0) || saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors"
                  style={{background:"#315DFB"}}>
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Criar {bulkCount || "?"} Mesas
                </button>
              )}
            </div>
          </div>
        </div>
      ) : modal === "cancelOrder" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="w-7 h-7 text-red-400" />
              </div>
              <p className="text-base font-bold">Cancelar e Liberar Mesa</p>
              <p className="text-sm text-zinc-500 mt-2">Os itens da comanda serão removidos e a mesa ficará livre. Nenhum lançamento será feito no caixa.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModal("none")}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Voltar</button>
              <button onClick={cancelOrder} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Cancelar e Liberar
              </button>
            </div>
          </div>
        </div>
      ) : modal === "pendingLeave" ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(49,93,251,0.12)" }}>
                <Send className="w-7 h-7" style={{ color: "#315DFB" }} />
              </div>
              <p className="text-base font-bold">{pendingQty} ite{pendingQty === 1 ? "m não enviado" : "ns não enviados"}</p>
              <p className="text-sm text-zinc-500 mt-1">A cozinha ainda não recebeu. Enviar agora?</p>
            </div>
            <button onClick={async () => { if (await sendOrder()) goBack(true); }} disabled={sending}
              className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#315DFB", color: "#fff" }}>
              {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar e sair
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setModal("none")}
                className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Continuar na mesa</button>
              <button onClick={() => goBack(true)}
                className="py-2.5 rounded-xl text-sm font-medium border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">Sair sem enviar</button>
            </div>
          </div>
        </div>
      ) : modal === "moveTable" && selectedTable ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Trocar mesa — {selectedTable.name}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Mesa livre: a comanda muda de mesa · Mesa ocupada: as comandas se juntam</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {(["free", "occupied"] as const).map(group => {
                const list = tables.filter(t => t.id !== selectedTable.id &&
                  (group === "occupied" ? t.status === "occupied" && !!t.current_sale_id : !(t.status === "occupied" && t.current_sale_id)));
                if (!list.length) return null;
                return (
                  <div key={group}>
                    <p className="text-xs font-semibold text-zinc-400 mb-2">
                      {group === "free" ? "Transferir para mesa livre" : "Juntar com mesa ocupada"}
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {list.map(t => {
                        const sel = moveTarget?.id === t.id;
                        const info = t.current_sale_id ? openInfo[t.current_sale_id] : undefined;
                        return (
                          <button key={t.id} onClick={() => setMoveTarget(t)}
                            className="flex flex-col items-center justify-center gap-0.5 min-h-[58px] px-2 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                            style={sel ? { background: "#315DFB", color: "#fff", border: "1px solid #315DFB" } : { background: card.bg, border: card.border }}>
                            <span className="truncate max-w-full">{t.name}</span>
                            {info && <span className="text-[10px] font-semibold opacity-80">{fmt(info.total)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {moveError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{moveError}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Voltar</button>
              <button onClick={moveTableOrder} disabled={!moveTarget || saving}
                className="flex-[2] flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 rounded-xl text-sm font-bold transition-colors"
                style={{ background: "#315DFB", color: "#fff" }}>
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
                <span className="truncate">{!moveTarget ? "Escolha a mesa"
                  : moveTarget.status === "occupied" && moveTarget.current_sale_id ? `Juntar com ${moveTarget.name}`
                  : `Transferir para ${moveTarget.name}`}</span>
              </button>
            </div>
          </div>
        </div>
      ) : showCheckout ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Fechar Conta — {selectedTable?.name}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{orderItems.reduce((s,i)=>s+i.quantity,0)} itens · consumo: {fmt(orderTotal)}</p>
              </div>
              <button onClick={() => setShowCheckout(false)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {pendingQty > 0 && (
                <div className="flex items-center gap-3 rounded-xl px-4 py-3 border" style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.06)" }}>
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span className="flex-1 text-xs text-zinc-400">{pendingQty} ite{pendingQty === 1 ? "m não foi enviado" : "ns não foram enviados"} para a cozinha</span>
                  <button onClick={() => sendOrder()} disabled={sending}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60" style={{ background: "#315DFB", color: "#fff" }}>Enviar</button>
                </div>
              )}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 max-h-36 overflow-y-auto">
                {orderItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs text-zinc-300">{item.quantity}x {item.products?.name}</span>
                    <span className="text-xs font-semibold text-white">{fmt(item.unit_price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Desconto (R$)</label>
                  <input value={checkoutDiscount} onChange={e => setCheckoutDiscount(e.target.value)}
                    type="number" min="0" step="0.01" placeholder="0,00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Vendedor</label>
                  <select value={checkoutSeller} onChange={e => setCheckoutSeller(e.target.value)} className={selectCls}>
                    <option value="">Nenhum</option>
                    {sellers.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Cliente (opcional)</label>
                <select value={checkoutCustomer?.id ?? ""} onChange={e => setCheckoutCustomer(customers.find(c => c.id === e.target.value) ?? null)} className={selectCls}>
                  <option value="">Sem cliente vinculado</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Observação geral do pedido (opcional)</label>
                <input value={checkoutNotes} onChange={e => setCheckoutNotes(e.target.value)}
                  placeholder="Ex: entregar rápido, mesa perto da janela..." className={inputCls} />
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-2">Forma de pagamento</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PAY_INFO) as PayMethod[]).map(m => {
                    const info = PAY_INFO[m];
                    return (
                      <button key={m} onClick={() => setCheckoutMethod(m)}
                        className={`flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border text-xs font-semibold transition-all ${checkoutMethod === m ? info.color + " border-current" : "border-zinc-700 text-zinc-500 hover:border-zinc-600"}`}>
                        {info.icon}<span>{info.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Dividir a conta */}
              <div className="rounded-xl border border-zinc-800 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400"><Users className="w-3.5 h-3.5" /> Dividir a conta</span>
                  <div className="flex gap-1">
                    {(["none", "equal", "items"] as const).map(m => (
                      <button key={m} onClick={() => setSplitMode(m)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${splitMode === m ? "bg-brand-600" : "text-zinc-400 hover:bg-zinc-800"}`}
                        style={splitMode === m ? { color: "#fff" } : undefined}>
                        {m === "none" ? "Não" : m === "equal" ? "Por pessoa" : "Por itens"}
                      </button>
                    ))}
                  </div>
                </div>
                {splitMode === "equal" && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSplitN(n => Math.max(Math.max(2, splitPaidParts + 1), n - 1))}
                          className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"><Minus className="w-4 h-4" /></button>
                        <span className="text-sm font-bold w-20 text-center">{splitN} pessoas</span>
                        <button onClick={() => setSplitN(n => Math.min(50, n + 1))}
                          className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"><Plus className="w-4 h-4" /></button>
                      </div>
                      <span className="text-xs text-zinc-500 text-right">
                        {remainingToPay > 0 ? <>Faltam {partsLeft} de {splitN}<br /><b className="text-white">{fmt(equalPart)}</b> cada</> : "Tudo pago"}
                      </span>
                    </div>
                    <button onClick={() => launchSplit(equalPart)} disabled={remainingToPay <= 0}
                      className="w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-colors"
                      style={{ background: "#315DFB", color: "#fff" }}>
                      Lançar parte {splitPaidParts + 1} · {fmt(equalPart)} em {PAY_INFO[checkoutMethod].label}
                    </button>
                  </div>
                )}
                {splitMode === "items" && (
                  <div className="space-y-2.5">
                    <p className="text-[11px] text-zinc-500">Marque o que a pessoa consumiu e lance na forma escolhida acima.</p>
                    <div className="max-h-44 overflow-y-auto divide-y divide-zinc-800/60 rounded-lg border border-zinc-800">
                      {orderItems.map(item => {
                        const paid = splitPaidItems.includes(item.id);
                        const sel = splitSel.includes(item.id);
                        return (
                          <label key={item.id} className={`flex items-center gap-2.5 px-3 py-2 text-xs ${paid ? "opacity-40" : "cursor-pointer"}`}>
                            <input type="checkbox" disabled={paid} checked={paid || sel}
                              onChange={() => setSplitSel(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id])}
                              className="w-4 h-4 accent-[#315DFB]" />
                            <span className={`flex-1 ${paid ? "line-through" : "text-zinc-300"}`}>{item.quantity}x {item.products?.name}</span>
                            <span className="font-semibold">{fmt(item.unit_price * item.quantity)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button onClick={() => launchSplit(Math.min(splitSelTotal, remainingToPay), splitSel)} disabled={splitSelTotal <= 0 || remainingToPay <= 0}
                      className="w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-colors"
                      style={{ background: "#315DFB", color: "#fff" }}>
                      {splitSel.length ? `Lançar ${fmt(Math.min(splitSelTotal, remainingToPay))} em ${PAY_INFO[checkoutMethod].label}` : "Marque os itens da pessoa"}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input value={checkoutInput} onChange={e => setCheckoutInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPayment()}
                  type="number" min="0.01" step="0.01"
                  placeholder={`Valor (restante: ${fmt(Math.max(0, finalTotal - totalPaid))})`}
                  className={inputCls + " flex-1"} />
                <button onClick={addPayment}
                  className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 rounded-xl text-sm font-semibold transition-colors flex-shrink-0"
                  style={{ color: "#fff" }}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {checkoutPayments.length > 0 && (
                <div className="space-y-1.5">
                  {checkoutPayments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5">
                      <span className="text-sm text-zinc-300">{PAY_INFO[p.method]?.label}{p.part ? " · parte" : p.items ? ` · ${p.items.length} ite${p.items.length === 1 ? "m" : "ns"}` : ""}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{fmt(p.amount)}</span>
                        <button onClick={() => removePayment(i)}
                          className="p-1 text-zinc-600 hover:text-red-400 rounded-md transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 rounded-xl">
                    <span className="text-sm font-medium">Total pago</span>
                    <span className="text-base font-bold text-emerald-400">{fmt(totalPaid)}</span>
                  </div>
                  {totalPaid > finalTotal && (
                    <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <span className="text-xs text-amber-400">Troco</span>
                      <span className="text-sm font-bold text-amber-400">{fmt(totalPaid - finalTotal)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 space-y-1">
                <div className="flex justify-between text-sm text-zinc-400">
                  <span>Subtotal</span><span>{fmt(orderTotal)}</span>
                </div>
                {discountVal > 0 && (
                  <div className="flex justify-between text-sm text-red-400">
                    <span>Desconto</span><span>-{fmt(discountVal)}</span>
                  </div>
                )}
                {servicePct > 0 && (
                  <label className="flex items-center justify-between gap-2 text-sm text-zinc-400 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={checkoutService} onChange={e => setCheckoutService(e.target.checked)} className="w-4 h-4 accent-[#315DFB]" />
                      Serviço ({servicePct}%)
                    </span>
                    <span className={checkoutService ? "" : "line-through opacity-50"}>{fmt(Math.round(orderTotal * servicePct) / 100)}</span>
                  </label>
                )}
                <div className="flex justify-between text-base font-black text-white border-t border-zinc-800 pt-1.5">
                  <span>Total</span><span>{fmt(finalTotal)}</span>
                </div>
              </div>
              {checkoutError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{checkoutError}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setShowCheckout(false)} className="sm:flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={confirmPayment} disabled={checkoutLoading || checkoutPayments.length === 0}
                className="sm:flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-colors"
                style={{ color: "#fff" }}>
                {checkoutLoading ? <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate">{checkoutLoading ? "Fechando…" : `Confirmar · ${fmt(finalTotal)}`}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null, document.body)}

      {showCurateManager && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <h2 className="text-base font-semibold">Itens do Dia por Categoria</h2>
              <button onClick={() => { setShowCurateManager(false); setCurateSearch(""); }} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Categorias */}
                <div className="w-full sm:w-56 flex-shrink-0 flex flex-col gap-2">
                  <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide mb-1">Categorias</p>
                  <div className="flex flex-col gap-1 overflow-y-auto max-h-56 sm:max-h-96">
                    {Object.keys(catNameMap).sort().map(name => (
                      <div key={name} className="flex items-center gap-1">
                        <button onClick={() => setCurateActiveCat(name)}
                          className={`flex-1 min-w-0 px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${curateActiveCat === name ? "bg-brand-600/20 border border-brand-500/40 text-brand-700" : "bg-zinc-800/50 border border-transparent text-zinc-300 hover:bg-zinc-800"}`}>
                          <span className="truncate">{name.charAt(0) + name.slice(1).toLowerCase()}</span>
                          <span className="text-xs text-zinc-500 flex-shrink-0">{curatedProducts[name]?.length ?? 0}</span>
                        </button>
                        <button onClick={() => renameCategory(name)} title="Renomear categoria"
                          className="p-1.5 text-zinc-600 hover:text-brand-600 hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteCategory(name)} title="Excluir categoria"
                          className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && createCategory()}
                      placeholder="Nova categoria..." className="flex-1 min-w-0 px-2.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500" />
                    <button onClick={createCategory} disabled={!newCatName.trim()}
                      className="flex-shrink-0 p-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 rounded-xl transition-colors"
                      style={{ color: "#fff" }}>
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Busca em todo o estoque + seleção */}
                <div className="flex-1 flex flex-col gap-3 min-w-0">
                  {!curateActiveCat ? (
                    <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm py-10">Selecione uma categoria</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{curateActiveCat.charAt(0) + curateActiveCat.slice(1).toLowerCase()}</p>
                        {(curatedProducts[curateActiveCat]?.length ?? 0) > 0 ? (
                          <button onClick={() => resetCuratedCategory(curateActiveCat)} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Restaurar automático</button>
                        ) : (
                          <span className="text-xs text-zinc-600">Mostrando automático (todos da categoria)</span>
                        )}
                      </div>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input placeholder="Buscar em todo o estoque..." value={curateSearch} onChange={e => setCurateSearch(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500" />
                      </div>
                      <div className="flex-1 space-y-1 overflow-y-auto max-h-80">
                        {products
                          .filter(p => matchesSearch(p.name, curateSearch))
                          .map(p => {
                            const inCat = (curatedProducts[curateActiveCat!] ?? []).includes(p.id);
                            return (
                              <button key={p.id} onClick={() => toggleCuratedProduct(curateActiveCat!, p.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors text-left ${inCat ? "bg-brand-600/15 border border-brand-500/30" : "hover:bg-zinc-800 border border-transparent"}`}>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-white truncate">{p.name}</p>
                                  <p className="text-xs text-brand-600">{fmt(p.sale_price)}</p>
                                </div>
                                {inCat ? <Star className="w-4 h-4 fill-amber-400 text-amber-400 flex-shrink-0" /> : <StarOff className="w-4 h-4 text-zinc-600 flex-shrink-0" />}
                              </button>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
