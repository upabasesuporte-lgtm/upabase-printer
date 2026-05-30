import { useState, useEffect, useCallback } from "react";
import { createPortal, flushSync } from "react-dom";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  UtensilsCrossed, Plus, Search, X, ChevronLeft, RefreshCw,
  Clock, Users, CheckCircle2, Settings, Edit2, Trash2,
  Banknote, CreditCard, Smartphone, Receipt, AlertTriangle, ChevronUp, ChevronDown, ListOrdered,
  ShoppingCart, Minus, Save, Tag, Coffee,
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
  products?: { name: string } | null;
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
interface PaymentEntry { method: PayMethod; amount: number; }

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";
const selectCls = inputCls + " cursor-pointer";

const STATUS_CFG: Record<string, { label: string; hex: string; glow: string; badge: string; dot: string }> = {
  free:     { label: "Livre",     hex: "#10b981", glow: "rgba(16,185,129,0.18)",   badge: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-500" },
  occupied: { label: "Ocupada",   hex: "#f59e0b", glow: "rgba(245,158,11,0.18)",   badge: "text-amber-400 bg-amber-500/10 border-amber-500/20",       dot: "bg-amber-500"   },
  reserved: { label: "Reservada", hex: "#3b82f6", glow: "rgba(59,130,246,0.18)",   badge: "text-blue-400 bg-blue-500/10 border-blue-500/20",           dot: "bg-blue-500"    },
  cleaning: { label: "Limpeza",   hex: "#71717a", glow: "rgba(113,113,122,0.12)", badge: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",           dot: "bg-zinc-500"    },
};
const fallbackCfg = STATUS_CFG.free;

const PAY_INFO: Record<PayMethod, { label: string; icon: React.ReactNode; color: string }> = {
  cash:         { label: "Dinheiro",   icon: <Banknote className="w-4 h-4" />,   color: "border-emerald-500 bg-emerald-500/10 text-emerald-300" },
  pix:          { label: "PIX",        icon: <Smartphone className="w-4 h-4" />, color: "border-violet-500 bg-violet-500/10 text-violet-300"   },
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

  // Modals
  type Modal = "none" | "manage" | "editTable" | "reserve" | "openConfirm" | "statusChange" | "itemNote" | "cancelOrder";
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
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      refreshStoreCache(user.id);
      const { data: reg } = await supabase.from("cash_registers")
        .select("id").eq("user_id", user.id).eq("status", "open")
        .order("opened_at", { ascending: false }).limit(1).maybeSingle();
      setCashRegisterId(reg?.id ?? null);
    }
    const [{ data: t }, { data: p }, { data: c }, { data: custs }] = await Promise.all([
      supabase.from("tables").select("*").eq("is_active", true).order("number").order("name"),
      supabase.from("products").select("*").neq("is_active", false).order("name"),
      supabase.from("categories").select("*").order("name"),
      supabase.from("customers").select("id,name,phone,balance,fiado_balance,credit_limit").order("name"),
    ]);
    setTables((t ?? []) as TableRecord[]);
    setProducts((p ?? []) as Product[]);
    setCategories((c ?? []) as Category[]);
    setCustomers((custs ?? []) as Customer[]);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function loadOrderItems(saleId: string) {
    setOrderLoading(true);
    const { data } = await supabase
      .from("sale_items").select("*")
      .eq("sale_id", saleId).order("id");
    const enriched = (data ?? []).map(i => ({
      ...i,
      products: { name: products.find(p => p.id === i.product_id)?.name ?? "Produto" },
    }));
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

  async function goBack() {
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
    const existing = orderItems.find(i => i.product_id === product.id && !i.notes);
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
      }).select("*").single();
      if (insertErr) { alert("Erro ao adicionar item: " + insertErr.message); return; }
      if (data) setOrderItems(prev => [...prev, { ...data, products: { name: product.name } } as OrderItem]);
    }
    setComandaTab("order");
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

  // ── Checkout ────────────────────────────────────────────────────────────────

  const orderTotal = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const discountVal = parseFloat(checkoutDiscount) || 0;
  const finalTotal = Math.max(0, orderTotal - discountVal);
  const totalPaid = checkoutPayments.reduce((s, p) => s + p.amount, 0);

  function addPayment() {
    const amt = parseFloat(checkoutInput);
    if (isNaN(amt) || amt <= 0) return;
    if (checkoutPayments.some(p => p.method === checkoutMethod)) {
      setCheckoutPayments(prev => prev.map(p => p.method === checkoutMethod ? { ...p, amount: amt } : p));
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
      // Update sale to paid
      const { error } = await supabase.from("sales").update({
        status: "paid", payments: checkoutPayments, discount: discountVal,
        total_amount: finalTotal,
        customer_id: checkoutCustomer?.id ?? null,
        seller_name: checkoutSeller || null,
        notes: checkoutNotes || null,
      }).eq("id", currentSaleId);
      if (error) { setCheckoutError("Erro ao fechar conta: " + error.message); setCheckoutLoading(false); return; }

      const orderNum = currentSaleId.slice(-6).toUpperCase();
      const saleId   = currentSaleId;
      const tableName = selectedTable?.name ?? "";
      const tableId   = selectedTable?.id ?? "";

      // Stock deduction for limited products
      for (const item of orderItems) {
        const prod = products.find(p => p.id === item.product_id);
        if (prod && !isUnlimited(prod)) {
          const newStock = Math.max(0, prod.stock - item.quantity);
          await supabase.from("products").update({
            stock: newStock, ...(newStock === 0 ? { is_active: false } : {}),
          }).eq("id", prod.id);
        }
      }

      // Ficha técnica deduction
      const productIds = [...new Set(orderItems.map(i => i.product_id))];
      if (productIds.length > 0) {
        const { data: recipes } = await supabase.from("product_recipes")
          .select("product_id, stock_item_id, quantity").in("product_id", productIds);
        if (recipes && recipes.length > 0) {
          const deductions: Record<string, number> = {};
          for (const oi of orderItems) {
            for (const r of recipes.filter(r => r.product_id === oi.product_id)) {
              deductions[r.stock_item_id] = (deductions[r.stock_item_id] ?? 0) + r.quantity * oi.quantity;
            }
          }
          const { data: sis } = await supabase.from("stock_items").select("id, current_qty").in("id", Object.keys(deductions));
          for (const si of sis ?? []) {
            const qty = deductions[si.id] ?? 0;
            if (qty > 0) {
              await supabase.from("stock_items").update({ current_qty: Math.max(0, si.current_qty - qty) }).eq("id", si.id);
              await supabase.from("stock_movements").insert({
                stock_item_id: si.id, user_id: userId, type: "sale", quantity: qty,
                reference_type: "sale", reference_id: saleId,
                notes: `Mesa - Venda #${orderNum}`,
              });
            }
          }
        }
      }

      // Cash movements
      if (cashRegisterId) {
        for (const p of checkoutPayments) {
          await supabase.from("cash_movements").insert({
            register_id: cashRegisterId, user_id: userId,
            movement_type: "sale", amount: p.amount,
            payment_method: p.method as any, channel: "tables",
            description: `Mesa ${tableName} - #${orderNum}`,
          });
        }
      }

      // Customer movements
      if (checkoutCustomer) {
        const fiadoAmt = checkoutPayments.find(p => p.method === "fiado")?.amount ?? 0;
        const houseAmt = checkoutPayments.find(p => p.method === "house_credit")?.amount ?? 0;
        if (fiadoAmt > 0 || houseAmt > 0) {
          const { data: curr } = await supabase.from("customers").select("balance, fiado_balance").eq("id", checkoutCustomer.id).single();
          const updates: Record<string, number> = {};
          if (fiadoAmt > 0) {
            updates.fiado_balance = (curr?.fiado_balance ?? 0) + fiadoAmt;
            await supabase.from("customer_movements").insert({
              customer_id: checkoutCustomer.id, user_id: userId, type: "debit",
              amount: fiadoAmt, description: `Fiado - Mesa ${tableName} #${orderNum}`,
              sale_id: saleId, payment_methods: [],
            });
          }
          if (houseAmt > 0) {
            updates.balance = Math.max(0, (curr?.balance ?? 0) - houseAmt);
            await supabase.from("customer_movements").insert({
              customer_id: checkoutCustomer.id, user_id: userId, type: "saldo",
              amount: houseAmt, description: `Saldo usado - Mesa ${tableName} #${orderNum}`,
              sale_id: saleId, payment_methods: [],
            });
          }
          await supabase.from("customers").update(updates).eq("id", checkoutCustomer.id);
        }
      }

      // Free the table
      if (tableId) {
        await supabase.from("tables").update({ status: "free", current_sale_id: null }).eq("id", tableId);
      }

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
    const win = window.open("", "_blank", "width=420,height=700");
    if (!win) return;
    const dt = new Date().toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const subtotal = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const paid = checkoutPayments.reduce((s, p) => s + p.amount, 0);
    const chg = Math.max(0, paid - finalTotal);

    const SEP = () => `<div style="border-top:1px dashed #000;margin:8px 0"></div>`;
    const ROW = (a: string, b: string, big = false) =>
      `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:${big?"16px":"13px"};font-weight:${big?"800":"600"};color:#000"><span>${a}</span><span>${b}</span></div>`;
    const LABEL = (t: string) =>
      `<div style="font-size:11px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 3px">--- ${t} ---</div>`;

    const itemsHtml = orderItems.length > 0 ? orderItems.map(i => {
      const name = i.products?.name ?? "Produto";
      const unitLine = i.quantity > 1
        ? `<div style="font-size:12px;font-weight:600;color:#000;margin-top:1px">${i.quantity} un x ${fmt(i.unit_price)}</div>` : "";
      const obsLine = i.notes
        ? `<div style="font-size:12px;font-weight:600;color:#000;margin-top:1px">Obs: ${i.notes}</div>` : "";
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px dashed #000">
        <div style="flex:1;padding-right:8px">
          <div style="font-size:13px;font-weight:600;color:#000">${i.quantity}x ${name}</div>
          ${unitLine}${obsLine}
        </div>
        <div style="font-size:13px;font-weight:700;color:#000;white-space:nowrap">${fmt(i.unit_price * i.quantity)}</div>
      </div>`;
    }).join("") : `<div style="font-size:12px;font-weight:600;color:#000;padding:6px 0">Sem itens</div>`;

    const paymentsHtml = checkoutPayments.map(p =>
      ROW(PAY_INFO[p.method]?.label ?? p.method, fmt(p.amount))
    ).join("");

    const pixLine = checkoutPayments.some(p => p.method === "pix") && store.pix
      ? `<div style="font-size:12px;font-weight:600;color:#000">Chave PIX: ${store.pix}</div>` : "";

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Comanda #${orderNum}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#000;background:#fff;padding:16px 14px;max-width:320px;margin:0 auto}
      @media print{body{padding:4px 2px;max-width:none}@page{margin:2mm}}
    </style></head><body>

    <div style="text-align:center;padding-bottom:8px">
      <div style="font-size:20px;font-weight:900;color:#000">${store.name}</div>
      ${store.show_cnpj && store.cnpj ? `<div style="font-size:12px;font-weight:600;color:#000">CNPJ: ${store.cnpj}</div>` : ""}
      ${store.address ? `<div style="font-size:12px;font-weight:600;color:#000">${store.address}</div>` : ""}
      ${store.phone ? `<div style="font-size:12px;font-weight:600;color:#000">Tel: ${store.phone}</div>` : ""}
    </div>

    <div style="border-top:2px solid #000;border-bottom:1px dashed #000;padding:6px 0;margin:4px 0;text-align:center">
      <div style="font-size:28px;font-weight:900;color:#000;letter-spacing:2px">#${orderNum}</div>
      <div style="font-size:13px;font-weight:600;color:#000">${dt}</div>
      <div style="font-size:13px;font-weight:700;color:#000">Mesa: ${selectedTable?.name ?? "—"}</div>
    </div>

    ${(checkoutCustomer?.name || checkoutSeller) ? `
    <div style="padding:6px 0">
      ${checkoutCustomer?.name ? `<div style="font-size:13px;font-weight:600;color:#000">Cliente: ${checkoutCustomer.name}</div>` : ""}
      ${checkoutSeller ? `<div style="font-size:13px;font-weight:600;color:#000">Vendedor: ${checkoutSeller}</div>` : ""}
    </div>
    ` : ""}

    ${SEP()}
    ${LABEL("Itens do pedido")}
    ${itemsHtml}

    ${SEP()}
    ${subtotal !== finalTotal ? ROW("Subtotal", fmt(subtotal)) : ""}
    ${discountVal > 0 ? ROW("Desconto", "- " + fmt(discountVal)) : ""}
    ${ROW("TOTAL", fmt(finalTotal), true)}

    ${SEP()}
    ${LABEL("Pagamento")}
    ${paymentsHtml}
    ${pixLine}
    ${chg > 0.01 ? ROW("Troco", fmt(chg)) : ""}

    ${checkoutNotes ? `${SEP()}${LABEL("Observacoes")}<div style="font-size:13px;font-weight:600;color:#000">${checkoutNotes}</div>` : ""}

    ${SEP()}
    <div style="text-align:center;font-size:13px;font-weight:600;color:#000;padding-top:4px">
      ${store.footer_message || "Obrigado pela preferencia!"}
    </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
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
    setSaving(true);
    await supabase.from("sale_items").delete().eq("sale_id", currentSaleId);
    // Delete the sale entirely (no items = nothing to keep for history)
    await supabase.from("sales").delete().eq("id", currentSaleId);
    await supabase.from("tables").update({ status: "free", current_sale_id: null }).eq("id", selectedTable.id);
    setSaving(false);
    goBack();
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
    const matchSearch = search === "" || p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat    = catFilter === null ||
      (p.category_id !== null && catNameMap[catFilter]?.includes(p.category_id));
    return matchSearch && matchCat;
  });

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
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl p-5"
            style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
              backgroundImage:"radial-gradient(rgba(244,63,94,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
            <div className="absolute inset-0 bg-gradient-to-r from-rose-900/10 to-transparent pointer-events-none" />
            <div className="relative flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{background:"#f43f5e",boxShadow:"0 0 6px #f43f5e"}} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#f43f5e"}}>Salão</span>
                </div>
                <h1 className="text-2xl font-black g-text g-text-red">
                  Mesas
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  <span style={{color:"#10b981"}}>{stats.free} livre{stats.free !== 1 ? "s" : ""}</span>
                  {stats.occupied > 0 && <span style={{color:"#f59e0b"}} className="ml-2">· {stats.occupied} ocupada{stats.occupied !== 1 ? "s" : ""}</span>}
                  {stats.reserved > 0 && <span style={{color:"#3b82f6"}} className="ml-2">· {stats.reserved} reservada{stats.reserved !== 1 ? "s" : ""}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadAll}
                  className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors border border-zinc-800">
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button onClick={() => setModal("manage")}
                  className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-xl text-sm font-medium transition-all">
                  <Settings className="w-4 h-4" /> Gerenciar
                </button>
                <button onClick={() => openManage()}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{background:"linear-gradient(135deg,#be123c,#f43f5e)",color:"#fff",boxShadow:"0 0 16px rgba(244,63,94,0.35)"}}>
                  <Plus className="w-4 h-4" /> Nova Mesa
                </button>
              </div>
            </div>
          </div>

          {/* Area filter */}
          {areas.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setAreaFilter(null)}
                style={areaFilter !== null ? { background: card.bg, border: card.border } : undefined}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${areaFilter === null ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                Todas
              </button>
              {areas.map(area => (
                <button key={area} onClick={() => setAreaFilter(area)}
                  style={areaFilter !== area ? { background: card.bg, border: card.border } : undefined}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${areaFilter === area ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                  {area}
                </button>
              ))}
            </div>
          )}

          {/* KPI Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total de Mesas", value: tables.length,    color: "#8b5cf6", glow: "rgba(139,92,246,0.15)" },
              { label: "Livres",         value: stats.free,        color: "#10b981", glow: "rgba(16,185,129,0.15)" },
              { label: "Ocupadas",       value: stats.occupied,    color: "#f59e0b", glow: "rgba(245,158,11,0.15)" },
              { label: "Reservadas",     value: stats.reserved,    color: "#3b82f6", glow: "rgba(59,130,246,0.13)" },
            ].map(s => (
              <div key={s.label} className="relative overflow-hidden rounded-2xl p-4"
                style={isLight ? {
                  background: `linear-gradient(135deg,#ffffff,${s.color}08)`,
                  border: `1px solid ${s.color}28`,
                  boxShadow: `0 2px 8px rgba(0,0,0,0.05), 0 4px 20px ${s.color}14, inset 0 1px 0 rgba(255,255,255,0.9)`,
                  borderTop: `3px solid ${s.color}`,
                } : {
                  background: card.bg, border: card.border,
                  boxShadow: `0 0 28px ${s.glow}`,
                }}>
                {isLight && (
                  <div className="absolute -bottom-6 -right-6 w-20 h-20 rounded-full opacity-10 blur-2xl pointer-events-none"
                    style={{ background: s.color }} />
                )}
                {!isLight && (
                  <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-20 blur-2xl pointer-events-none"
                    style={{ background: s.color }} />
                )}
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2 relative z-10"
                  style={{ color: isLight ? s.color : "#71717a" }}>{s.label}</p>
                <p className="text-3xl font-black relative z-10" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Table grid */}
          {filteredTables.length === 0 ? (
            <div className="text-center py-24 border border-dashed border-zinc-800 rounded-2xl">
              <UtensilsCrossed className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-400 font-semibold">Nenhuma mesa cadastrada</p>
              <p className="text-zinc-600 text-sm mt-1">Crie mesas clicando em "Nova Mesa"</p>
              <button onClick={() => openManage()}
                className="mt-5 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold transition-colors">
                Criar primeira mesa
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredTables.map(table => {
                const cfg = STATUS_CFG[table.status] ?? fallbackCfg;
                return (
                  <button key={table.id} onClick={() => enterTable(table)}
                    className="relative overflow-hidden flex flex-col items-center gap-2.5 rounded-2xl transition-all hover:scale-[1.03] active:scale-95 cursor-pointer"
                    style={isLight ? {
                      padding: "16px 12px",
                      minHeight: 130,
                      background: `linear-gradient(160deg,#ffffff,${cfg.hex}10)`,
                      border: `1px solid ${cfg.hex}30`,
                      boxShadow: `0 2px 8px rgba(0,0,0,0.05), 0 6px 20px ${cfg.hex}18, inset 0 1px 0 rgba(255,255,255,1)`,
                      borderTop: `3px solid ${cfg.hex}`,
                    } : {
                      padding: "20px",
                      minHeight: 160,
                      background: table.status === "free"
                        ? "linear-gradient(135deg,#059669,#10b981)"
                        : "linear-gradient(135deg,#18181b 0%,#09090b 100%)",
                      boxShadow: table.status === "free"
                        ? "0 8px 32px rgba(16,185,129,0.45), inset 0 1px 0 rgba(255,255,255,0.15)"
                        : `0 0 24px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
                      border: "1px solid rgba(63,63,70,0.8)",
                    }}>
                    {/* Glow orb — dark only */}
                    {!isLight && (
                      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-32 h-16 rounded-full opacity-25 blur-2xl pointer-events-none"
                        style={{ background: table.status === "free" ? "rgba(255,255,255,0.4)" : cfg.hex }} />
                    )}
                    {/* Status dot */}
                    <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full"
                      style={{
                        background: isLight ? cfg.hex : (table.status === "free" ? "rgba(255,255,255,0.8)" : cfg.hex),
                        boxShadow: isLight ? `0 0 6px ${cfg.hex}` : (table.status === "free" ? "0 0 8px rgba(255,255,255,0.6)" : `0 0 8px ${cfg.hex}`),
                      }} />
                    {/* Icon */}
                    <div className="flex items-center justify-center relative z-10 mt-1"
                      style={isLight ? {
                        width: 44, height: 44, borderRadius: 12,
                        background: `${cfg.hex}12`,
                        border: `1px solid ${cfg.hex}25`,
                      } : {
                        width: 56, height: 56, borderRadius: 16,
                        background: table.status === "free" ? "rgba(255,255,255,0.2)" : `${cfg.hex}14`,
                        border: table.status === "free" ? "1px solid rgba(255,255,255,0.35)" : `1px solid ${cfg.hex}30`,
                        boxShadow: table.status === "free" ? "0 0 20px rgba(255,255,255,0.15)" : `0 0 20px ${cfg.hex}20`,
                      }}>
                      <UtensilsCrossed style={isLight ? { width: 18, height: 18, color: cfg.hex } : {
                        width: 24, height: 24,
                        color: table.status === "free" ? "#fff" : cfg.hex,
                        filter: table.status === "free" ? "drop-shadow(0 0 5px rgba(255,255,255,0.6))" : `drop-shadow(0 0 5px ${cfg.hex})`,
                      }} />
                    </div>
                    {/* Table info */}
                    <div className="text-center relative z-10 flex-1 flex flex-col justify-center gap-0.5">
                      <p className="font-bold leading-tight"
                        style={{ fontSize: isLight ? 13 : 14, color: isLight ? "#0f172a" : "#fff" }}>{table.name}</p>
                      <p style={{ fontSize: 10, color: isLight ? `${cfg.hex}99` : (table.status === "free" ? "rgba(255,255,255,0.65)" : "#52525b") }}>
                        {table.capacity} lug · {table.area}
                      </p>
                    </div>
                    {/* Status badge */}
                    <span className="font-bold px-2.5 py-0.5 rounded-full relative z-10"
                      style={isLight ? {
                        fontSize: 10, color: cfg.hex,
                        background: `${cfg.hex}12`,
                        border: `1px solid ${cfg.hex}30`,
                      } : {
                        fontSize: 10,
                        color: table.status === "free" ? "#fff" : cfg.hex,
                        background: table.status === "free" ? "rgba(255,255,255,0.2)" : `${cfg.hex}12`,
                        border: table.status === "free" ? "1px solid rgba(255,255,255,0.35)" : `1px solid ${cfg.hex}35`,
                      }}>
                      {cfg.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
      </div>
      <div className={view === "table" ? "flex flex-col h-[calc(100vh-80px)] max-h-[900px]" : "hidden"}>
        {selectedTable && <>
          {/* Header */}
          <div className="flex items-center gap-3 mb-4 flex-shrink-0">
            <button onClick={goBack}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors">
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
            <button onClick={() => setModal("cancelOrder")}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-sm font-bold transition-colors">
              <X className="w-4 h-4" /> Cancelar Mesa
            </button>
            {orderItems.length > 0 && (
              <button onClick={() => { setSellers(getSellers()); setShowCheckout(true); setCheckoutPayments([]); setCheckoutInput(""); setCheckoutDiscount("0"); setCheckoutCustomer(null); setCheckoutSeller(""); setCheckoutNotes(""); setCheckoutError(null); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-emerald-900/30">
                <CheckCircle2 className="w-4 h-4" /> Fechar Conta · {fmt(orderTotal)}
              </button>
            )}
          </div>

          {/* Mobile tab switcher */}
          <div className="flex sm:hidden gap-2 mb-4 flex-shrink-0">
            {(["catalog", "order"] as const).map(t => (
              <button key={t} onClick={() => setComandaTab(t)}
                style={comandaTab !== t ? { background: card.bg, border: card.border } : undefined}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-colors ${comandaTab === t ? "bg-violet-600 text-white" : "text-zinc-400"}`}>
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
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-all" />
              </div>

              {/* Category tabs + botão ordenar */}
              {visibleCatNames.length > 0 && (
                <>
                  <div className="flex gap-1.5 mb-1 overflow-x-auto pb-1 flex-shrink-0 scrollbar-none items-center">
                    <button onClick={() => setCatFilter(null)}
                      style={catFilter !== null ? { background: card.bg, border: card.border } : undefined}
                      className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${catFilter === null ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                      Todos
                    </button>
                    {visibleCatNames.map(name => (
                      <button key={name} onClick={() => setCatFilter(name)}
                        style={catFilter !== name ? { background: card.bg, border: card.border } : undefined}
                        className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${catFilter === name ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                        {name.charAt(0) + name.slice(1).toLowerCase()}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowCatOrder(v => !v)}
                      title="Ordenar categorias"
                      className="ml-auto flex-shrink-0 p-1.5 rounded-lg transition-colors"
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
                              className="p-0.5 rounded disabled:opacity-30 text-zinc-500 hover:text-violet-400 transition-colors">
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => moveCat(idx, 1)} disabled={idx === visibleCatNames.length - 1}
                              className="p-0.5 rounded disabled:opacity-30 text-zinc-500 hover:text-violet-400 transition-colors">
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
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-10 text-xs text-zinc-600">Nenhum produto encontrado</div>
                ) : catFilter === null && !search ? (
                  // ── Todos: agrupado por categoria ──
                  <>
                    {visibleCatNames.map(name => {
                      const catProds = products.filter(p =>
                        p.category_id && catNameMap[name].includes(p.category_id)
                      );
                      if (catProds.length === 0) return null;
                      return (
                        <div key={name} className="mb-4">
                          <div className="flex items-center gap-2 py-1.5 mb-2">
                            <span className="text-[11px] font-bold text-violet-400 uppercase tracking-wider whitespace-nowrap">
                              {name.charAt(0) + name.slice(1).toLowerCase()}
                            </span>
                            <div className="flex-1 h-px bg-zinc-800/60" />
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {catProds.map(p => (
                              <button key={p.id} onClick={() => addProduct(p)}
                                style={{ background: card.bg, border: card.border }}
                                className="flex flex-col items-start gap-1.5 p-3 hover:border-violet-500/50 rounded-xl text-left transition-all active:scale-95">
                                <span className="text-sm font-semibold leading-tight line-clamp-2" style={{ color: isLight ? "#111" : "#fff" }}>{p.name}</span>
                                <span className="text-sm font-bold text-violet-400">{fmt(p.sale_price)}</span>
                                {!isUnlimited(p) && p.stock <= 5 && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.stock === 0 ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
                                    {p.stock === 0 ? "Esgotado" : `${p.stock} rest.`}
                                  </span>
                                )}
                              </button>
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
                              <button key={p.id} onClick={() => addProduct(p)}
                                style={{ background: card.bg, border: card.border }}
                                className="flex flex-col items-start gap-1.5 p-3 hover:border-violet-500/50 rounded-xl text-left transition-all active:scale-95">
                                <span className="text-sm font-semibold leading-tight line-clamp-2" style={{ color: isLight ? "#111" : "#fff" }}>{p.name}</span>
                                <span className="text-sm font-bold text-violet-400">{fmt(p.sale_price)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  // ── Categoria específica ou busca: lista plana ──
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {filteredProducts.map(p => (
                      <button key={p.id} onClick={() => addProduct(p)}
                        style={{ background: card.bg, border: card.border }}
                        className="flex flex-col items-start gap-1.5 p-3 hover:border-violet-500/50 rounded-xl text-left transition-all active:scale-95">
                        <span className="text-sm font-semibold leading-tight line-clamp-2" style={{ color: isLight ? "#111" : "#fff" }}>{p.name}</span>
                        <span className="text-sm font-bold text-violet-400">{fmt(p.sale_price)}</span>
                        {!isUnlimited(p) && p.stock <= 5 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.stock === 0 ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
                            {p.stock === 0 ? "Esgotado" : `${p.stock} rest.`}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — Order / Comanda */}
            <div className={`flex flex-col w-full sm:w-80 flex-shrink-0 rounded-2xl overflow-hidden ${comandaTab === "catalog" ? "hidden sm:flex" : "flex"}`}
              style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
                <ShoppingCart className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold">Comanda</h2>
                {orderItems.length > 0 && (
                  <span className="ml-auto text-xs text-zinc-500">{orderItems.reduce((s,i)=>s+i.quantity,0)} item{orderItems.reduce((s,i)=>s+i.quantity,0)!==1?"s":""}</span>
                )}
              </div>

              {/* Items */}
              {orderLoading ? (
                <div className="flex justify-center py-8"><RefreshCw className="w-4 h-4 animate-spin text-violet-400" /></div>
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
                        <p className="text-xs text-zinc-500">{fmt(item.unit_price)} /un</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => changeQty(item, -1)}
                          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-bold text-white w-6 text-center">{item.quantity}</span>
                        <button onClick={() => changeQty(item, 1)}
                          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={async () => {
                          await supabase.from("sale_items").delete().eq("id", item.id);
                          setOrderItems(prev => prev.filter(i => i.id !== item.id));
                        }}
                          className="w-6 h-6 flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-white">{fmt(item.unit_price * item.quantity)}</p>
                        <button onClick={() => { setNoteTarget(item); setNoteText(item.notes ?? ""); setModal("itemNote"); }}
                          className="text-[10px] text-zinc-600 hover:text-violet-400 transition-colors">obs</button>
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
                  <button onClick={() => { setSellers(getSellers()); setShowCheckout(true); setCheckoutPayments([]); setCheckoutInput(""); setCheckoutDiscount("0"); setCheckoutCustomer(null); setCheckoutSeller(""); setCheckoutNotes(""); setCheckoutError(null); }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition-colors">
                    Fechar Conta
                  </button>
                </div>
              )}
            </div>
          </div>
        </>}
      </div>

      {/* ═══ MODAL — portal ao document.body, totalmente fora da árvore DOM do componente ═══ */}
      {createPortal(modal === "openConfirm" && selectedTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 bg-violet-500/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <UtensilsCrossed className="w-7 h-7 text-violet-400" />
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
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-colors"
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
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-bold transition-colors">Salvar</button>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold transition-colors">
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
                        className="p-1.5 text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors">
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
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${tableFormTab === key ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
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
                          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${bulkCount === String(n) ? "bg-violet-600 border-violet-500 text-white" : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white"}`}>
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
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {editingTable ? "Salvar" : "Criar Mesa"}
                </button>
              ) : (
                <button onClick={bulkCreate} disabled={!(parseInt(bulkCount) > 0) || saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors">
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
              <div className="flex gap-2">
                <input value={checkoutInput} onChange={e => setCheckoutInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPayment()}
                  type="number" min="0.01" step="0.01"
                  placeholder={`Valor (restante: ${fmt(Math.max(0, finalTotal - totalPaid))})`}
                  className={inputCls + " flex-1"} />
                <button onClick={addPayment}
                  className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {checkoutPayments.length > 0 && (
                <div className="space-y-1.5">
                  {checkoutPayments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5">
                      <span className="text-sm text-zinc-300">{PAY_INFO[p.method]?.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{fmt(p.amount)}</span>
                        <button onClick={() => setCheckoutPayments(prev => prev.filter((_, j) => j !== i))}
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
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setShowCheckout(false)} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={confirmPayment} disabled={checkoutLoading || checkoutPayments.length === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors">
                {checkoutLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {checkoutLoading ? "Fechando…" : `Confirmar · ${fmt(finalTotal)}`}
              </button>
            </div>
          </div>
        </div>
      ) : null, document.body)}
    </div>
  );
}
