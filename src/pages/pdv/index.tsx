import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { getStoreSettings, getSellers, refreshStoreCache } from "../settings";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Search, ShoppingCart, Plus, Minus, Trash2, X, User, UserPlus,
  Clock, CheckCircle2, AlertCircle, Printer, CreditCard, Banknote,
  Smartphone, Ticket, Star, StarOff, ChevronRight, Edit2, History,
  Package, RefreshCw, Receipt,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  sale_price: number;
  stock: number;
  stock_type: string | null;
  unlimited_stock: boolean | null;
  image_url: string | null;
  barcode: string | null;
  category_id: string | null;
  is_active: boolean;
}

interface CartItem {
  cartId: string;
  product: Product;
  quantity: number;
  notes: string;
  customPrice?: number;
}

interface ShortcutGroup {
  id: string;
  name: string;
  productIds: string[];
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  balance: number;
  fiado_balance: number;
  credit_limit: number;
}

interface PaymentEntry {
  method: PayMethod;
  amount: number;
}

interface Sale {
  id: string;
  total: number;
  discount: number;
  status: string;
  customer_id: string | null;
  origin?: string;
  seller_name: string | null;
  notes: string | null;
  delivery_address?: string | null;
  payments: PaymentEntry[];
  created_at: string;
  customers?: { name: string } | null;
  sale_items?: SaleItem[];
}

interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  notes: string | null;
  products?: { name: string } | null;
}

type PayMethod = "cash" | "credit" | "debit" | "pix" | "fiado" | "house_credit" | "ifood_receivable";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PAYMENT_INFO: Record<PayMethod, { label: string; icon: React.ReactNode; color: string }> = {
  cash:         { label: "Dinheiro",   icon: <Banknote className="w-4 h-4" />,   color: "border-emerald-500 bg-emerald-500/10 text-emerald-300" },
  credit:       { label: "Crédito",    icon: <CreditCard className="w-4 h-4" />, color: "border-blue-500 bg-blue-500/10 text-blue-300" },
  debit:        { label: "Débito",     icon: <CreditCard className="w-4 h-4" />, color: "border-indigo-500 bg-indigo-500/10 text-indigo-300" },
  pix:          { label: "PIX",        icon: <Smartphone className="w-4 h-4" />, color: "border-violet-500 bg-violet-500/10 text-violet-300" },
  fiado:            { label: "Fiado",            icon: <Receipt className="w-4 h-4" />,     color: "border-amber-500 bg-amber-500/10 text-amber-300" },
  house_credit:     { label: "Saldo Casa",       icon: <Ticket className="w-4 h-4" />,      color: "border-pink-500 bg-pink-500/10 text-pink-300" },
  ifood_receivable: { label: "iFood (A Receber)",icon: <ShoppingCart className="w-4 h-4" />,color: "border-red-500 bg-red-500/10 text-red-300" },
};

const ORIGIN_INFO: Record<string, { label: string; color: string }> = {
  pdv:             { label: "PDV",             color: "bg-zinc-700/60 text-zinc-300" },
  pdv_balcao:      { label: "Balcão",          color: "bg-sky-500/15 text-sky-400" },
  delivery:        { label: "Delivery",        color: "bg-orange-500/15 text-orange-400" },
  mesa:            { label: "Mesa",            color: "bg-teal-500/15 text-teal-400" },
  whatsapp:        { label: "WhatsApp",        color: "bg-green-500/15 text-green-400" },
  cardapio_digital:{ label: "Cardápio Digital",color: "bg-violet-500/15 text-violet-400" },
  ifood:           { label: "iFood",           color: "bg-red-500/15 text-red-400" },
};

const SHORTCUTS_KEY = "pdv_shortcuts";
const SHORTCUT_GROUPS_KEY = "pdv_shortcut_groups";
const getShortcutGroups = (): ShortcutGroup[] => {
  try {
    const saved = localStorage.getItem(SHORTCUT_GROUPS_KEY);
    if (saved) return JSON.parse(saved);
    // Migração: se tiver atalhos antigos no formato plano, converte para um grupo "Geral"
    const old: string[] = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || "[]");
    if (old.length > 0) return [{ id: "geral", name: "Geral", productIds: old }];
    return [];
  } catch { return []; }
};
const saveShortcutGroups = (groups: ShortcutGroup[]) => localStorage.setItem(SHORTCUT_GROUPS_KEY, JSON.stringify(groups));

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 flex-shrink-0">
          <h3 className="font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PdvPage() {
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
  const [tab, setTab] = useState<"venda" | "historico">("venda");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Canal de venda (PDV ou iFood)
  const [saleChannel, setSaleChannel] = useState<"pdv" | "ifood">("pdv");

  // Busca e atalhos
  const [search, setSearch] = useState("");
  const [shortcutGroups, setShortcutGroups] = useState<ShortcutGroup[]>(getShortcutGroups());
  const [custSearch, setCustSearch] = useState("");
  const [checkoutCustSearch, setCheckoutCustSearch] = useState("");
  const [showCheckoutCustSearch, setShowCheckoutCustSearch] = useState(false);

  // Modais
  const [showCheckout, setShowCheckout] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showEditSale, setShowEditSale] = useState<Sale | null>(null);
  const [showEditItems, setShowEditItems] = useState<SaleItem[]>([]);
  const [pendingSales, setPendingSales] = useState<Sale[]>([]);

  // Novo cliente
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustAddress, setNewCustAddress] = useState("");

  // Checkout
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<"value" | "percent">("value");
  const [discountPctRaw, setDiscountPctRaw] = useState("");

  // Histórico
  const [historySearch, setHistorySearch] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Sellers
  const [sellers] = useState<string[]>(getSellers());

  // Caixa
  const [cashRegisterId, setCashRegisterId] = useState<string | null>(null);

  // Atalhos manager
  const [showShortcutManager, setShowShortcutManager] = useState(false);
  const [shortcutSearch, setShortcutSearch] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // Histórico expandido
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  // Pagamentos na edição
  const [editSalePayments, setEditSalePayments] = useState<PaymentEntry[]>([]);

  // Busca de produto dentro do modal de edição
  const [editProductSearch, setEditProductSearch] = useState("");

  // Edição de cliente, endereço e preço de item
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editCustSearch, setEditCustSearch] = useState("");
  const [editDeliveryAddress, setEditDeliveryAddress] = useState("");
  const [editingItemPriceId, setEditingItemPriceId] = useState<string | null>(null);
  const [editingItemPriceVal, setEditingItemPriceVal] = useState("");

  // Toast de erro
  const [toastError, setToastError] = useState<string | null>(null);

  function showError(msg: string) {
    setToastError(msg);
    setTimeout(() => setToastError(null), 5000);
  }

  const searchRef = useRef<HTMLInputElement>(null);

  // ── Totais ──
  const subtotal = cart.reduce((s, i) => s + (i.customPrice ?? i.product.sale_price) * i.quantity, 0);
  const discountVal = parseFloat(discount.replace(",", ".")) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, total - totalPaid);
  const cashPaid = payments.filter(p => p.method === "cash").reduce((s, p) => s + p.amount, 0);
  const otherPaid = payments.filter(p => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
  const change = Math.max(0, cashPaid - (total - otherPaid));

  // ── Produtos filtrados ──
  const filtered = products.filter(p =>
    p.is_active &&
    (search === "" || p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search)))
  );
  const allShortcutIds = shortcutGroups.flatMap(g => g.productIds);
  const filteredCustomers = customers.filter(c =>
    custSearch === "" || c.name.toLowerCase().includes(custSearch.toLowerCase()) || (c.phone && c.phone.includes(custSearch))
  );

  useEffect(() => { loadAll(); loadPending(); }, []);

  const loadAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { setUserId(user.id); refreshStoreCache(user.id); }
    const { data: prods } = await supabase.from("products").select("*").neq("is_active", false).order("name");
    setProducts(prods ?? []);
    setLoadingProducts(false);
    const { data: custs } = await supabase.from("customers").select("id,name,phone,address,balance,fiado_balance,credit_limit").order("name");
    setCustomers(custs ?? []);
    // Carrega caixa aberto
    if (user) {
      const { data: reg } = await supabase.from("cash_registers")
        .select("id").eq("user_id", user.id).eq("status", "open")
        .order("opened_at", { ascending: false }).limit(1).maybeSingle();
      setCashRegisterId(reg?.id ?? null);

      // Carrega atalhos rápidos do banco (fonte autoritativa)
      const { data: settings } = await supabase
        .from("user_settings")
        .select("pdv_shortcut_groups")
        .eq("user_id", user.id)
        .maybeSingle();
      if (settings?.pdv_shortcut_groups && Array.isArray(settings.pdv_shortcut_groups)) {
        setShortcutGroups(settings.pdv_shortcut_groups as ShortcutGroup[]);
        localStorage.setItem(SHORTCUT_GROUPS_KEY, JSON.stringify(settings.pdv_shortcut_groups));
      }
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    // Filtra pelo turno do caixa atual — ao abrir novo caixa o histórico recomeça
    const { data: { user } } = await supabase.auth.getUser();
    let fromDate: string | null = null;
    if (user) {
      const { data: reg } = await supabase.from("cash_registers")
        .select("opened_at")
        .eq("user_id", user.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      fromDate = reg?.opened_at ?? null;
    }
    // Se não há caixa aberto, histórico fica vazio (caixa fechado = turno encerrado)
    if (!fromDate) {
      setSales([]);
      setLoadingHistory(false);
      return;
    }
    const { data } = await supabase.from("sales")
      .select("*, customers(name), sale_items(*, products(name))")
      .eq("status", "paid")
      .gte("created_at", fromDate)
      .order("created_at", { ascending: false })
      .limit(200);
    setSales((data ?? []) as Sale[]);
    setLoadingHistory(false);
  }, []);

  const loadPending = useCallback(async () => {
    const { data } = await supabase.from("sales")
      .select("*, customers(name), sale_items(*, products(name))")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    setPendingSales((data ?? []) as Sale[]);
  }, []);

  useEffect(() => { if (tab === "historico") loadHistory(); }, [tab]);

  // ── Atalhos de teclado globais ──
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Enter no checkout finaliza a venda (funciona mesmo com input focado)
      if (e.key === "Enter" && showCheckout && payments.length > 0 && !checkoutLoading) {
        e.preventDefault();
        confirmSale();
        return;
      }

      // Enter no modal de edição salva os pagamentos
      if (e.key === "Enter" && showEditSale && !typing && editSalePayments.length > 0) {
        e.preventDefault();
        saveEditPayments();
        return;
      }

      if (typing) return;
      if (e.key === "F1") { e.preventDefault(); if (cart.length > 0 && cashRegisterId) { setPayments([]); setCheckoutError(null); setShowCheckout(true); } }
      if (e.key === "F2") { e.preventDefault(); savePending(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cart, showEditSale, editSalePayments, showCheckout, payments, checkoutLoading]);

  // ── Carrinho ──
  function isUnlimited(p: Product) {
    return p.stock_type === "unlimited" || p.unlimited_stock === true;
  }

  function addToCart(product: Product) {
    if (!isUnlimited(product) && product.stock === 0) return;
    // Sempre cria nova linha — permite lançar o mesmo produto múltiplas vezes
    const cartId = `${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setCart(prev => [...prev, { cartId, product, quantity: 1, notes: "" }]);
  }

  function updateQty(cartId: string, delta: number) {
    setCart(prev => prev.map(i => {
      if (i.cartId !== cartId) return i;
      const maxQty = isUnlimited(i.product) ? 9999 : i.product.stock;
      const newQty = Math.max(1, Math.min(i.quantity + delta, maxQty));
      return { ...i, quantity: newQty };
    }));
  }

  function removeFromCart(cartId: string) { setCart(prev => prev.filter(i => i.cartId !== cartId)); }
  function updateItemNotes(cartId: string, notes: string) { setCart(prev => prev.map(i => i.cartId === cartId ? { ...i, notes } : i)); }
  function updateItemPrice(cartId: string, price: number) { setCart(prev => prev.map(i => i.cartId === cartId ? { ...i, customPrice: price } : i)); }
  function clearCart() { setCart([]); setDiscount(""); setOrderNotes(""); setSellerName(""); setDeliveryAddress(""); setSelectedCustomer(null); setDiscountType("value"); }

  // ── Atalhos ──
  async function persistShortcuts(groups: ShortcutGroup[]) {
    localStorage.setItem(SHORTCUT_GROUPS_KEY, JSON.stringify(groups));
    if (userId) {
      await supabase.from("user_settings").upsert(
        { user_id: userId, pdv_shortcut_groups: groups, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    }
  }

  function toggleShortcut(productId: string) {
    let updated: ShortcutGroup[];
    if (allShortcutIds.includes(productId)) {
      // Remove do grupo que contém esse produto
      updated = shortcutGroups.map(g => ({ ...g, productIds: g.productIds.filter(id => id !== productId) }));
    } else {
      // Adiciona ao primeiro grupo existente, ou cria "Geral"
      if (shortcutGroups.length === 0) {
        updated = [{ id: Date.now().toString(), name: "Geral", productIds: [productId] }];
      } else {
        updated = shortcutGroups.map((g, i) => i === 0 ? { ...g, productIds: [...g.productIds, productId] } : g);
      }
    }
    setShortcutGroups(updated);
    persistShortcuts(updated);
  }

  function updateShortcutGroups(groups: ShortcutGroup[]) {
    setShortcutGroups(groups);
    persistShortcuts(groups);
  }

  // ── Salvar como pendente ──
  async function savePending() {
    if (!userId || cart.length === 0) return;
    const { data: sale, error: saleErr } = await supabase.from("sales").insert({
      user_id: userId, discount: discountVal, status: "open",
      customer_id: selectedCustomer?.id ?? null, origin: "pdv",
      seller_name: sellerName || null, notes: orderNotes || null,
      delivery_address: deliveryAddress || null, payments: [],
    }).select().single();
    if (saleErr || !sale) { showError("Erro ao salvar pedido pendente: " + (saleErr?.message ?? "desconhecido")); return; }
    const { error: itemsErr } = await supabase.from("sale_items").insert(cart.map(i => ({
      sale_id: sale.id, product_id: i.product.id,
      quantity: i.quantity, unit_price: i.customPrice ?? i.product.sale_price,
      total_price: (i.customPrice ?? i.product.sale_price) * i.quantity, notes: i.notes || null,
    })));
    if (itemsErr) { showError("Venda salva mas itens falharam: " + itemsErr.message); return; }
    clearCart();
    loadPending();
  }

  async function loadPendingIntoCart(sale: Sale) {
    const { data: items, error } = await supabase.from("sale_items").select("*, products(*)").eq("sale_id", sale.id);
    if (error) { showError("Erro ao carregar itens: " + error.message); return; }

    const validItems = (items ?? []).filter((i: any) => i.products);
    if (validItems.length === 0 && (items ?? []).length > 0) {
      showError("Itens encontrados mas produtos não carregaram. Tente novamente.");
      return;
    }

    const newCart: CartItem[] = validItems.map((i: any) => ({
      product: { ...i.products, stock: i.products.stock ?? 9999 },
      quantity: i.quantity,
      notes: i.notes || "",
      customPrice: i.unit_price !== i.products?.sale_price ? i.unit_price : undefined,
    }));

    setCart(newCart);
    setDiscount(sale.discount ? String(sale.discount) : "");
    setOrderNotes(sale.notes || "");
    setSellerName(sale.seller_name || "");
    if (sale.customer_id) setSelectedCustomer(customers.find(c => c.id === sale.customer_id) ?? null);
    setTab("venda");
    await supabase.from("sales").delete().eq("id", sale.id);
    setPendingSales(prev => prev.filter(s => s.id !== sale.id));
    setShowPending(false);
  }

  // ── Checkout ──
  async function openCheckout() {
    if (cart.length === 0) return;
    if (!cashRegisterId) return;
    setPayments([]);
    setCheckoutError(null);
    // Atualiza dados do cliente selecionado para pegar credit_limit e fiado_balance mais recentes
    if (selectedCustomer) {
      const { data: freshCustomer } = await supabase
        .from("customers")
        .select("id,name,phone,address,balance,fiado_balance,credit_limit")
        .eq("id", selectedCustomer.id)
        .single();
      if (freshCustomer) {
        const c = freshCustomer as Customer;
        setSelectedCustomer(c);
        setCustomers(prev => prev.map(x => x.id === c.id ? c : x));
      }
    }
    setShowCheckout(true);
  }

  function addPayment(method: PayMethod) {
    if (payments.some(p => p.method === method)) return;
    setPayments(prev => [...prev, { method, amount: remaining > 0 ? parseFloat(remaining.toFixed(2)) : 0 }]);
  }

  function updatePaymentAmount(method: PayMethod, value: string) {
    const amount = parseFloat(value.replace(",", ".")) || 0;
    setPayments(prev => prev.map(p => p.method === method ? { ...p, amount } : p));
  }

  function removePayment(method: PayMethod) { setPayments(prev => prev.filter(p => p.method !== method)); }

  async function confirmSale() {
    if (!userId) return;
    if (payments.length === 0) { setCheckoutError("Selecione pelo menos uma forma de pagamento."); return; }
    if (totalPaid < total - 0.01 && !payments.some(p => p.method === "fiado" || p.method === "ifood_receivable")) { setCheckoutError("Valor pago insuficiente."); return; }

    // Fiado exige cliente selecionado
    if (payments.some(p => p.method === "fiado") && !selectedCustomer) {
      setCheckoutError("Fiado requer um cliente selecionado. Selecione o cliente no checkout antes de confirmar.");
      return;
    }

    // Validate fiado credit limit
    if (selectedCustomer && payments.some(p => p.method === "fiado")) {
      const fiadoAmt = payments.find(p => p.method === "fiado")?.amount ?? 0;
      const limit = selectedCustomer.credit_limit ?? 0;
      const currentFiado = selectedCustomer.fiado_balance ?? 0;
      if (limit > 0 && currentFiado + fiadoAmt > limit) {
        const available = Math.max(0, limit - currentFiado);
        setCheckoutError(`Limite de fiado excedido! Fiado atual: ${fmt(currentFiado)} · Limite: ${fmt(limit)} · Disponível: ${fmt(available)}`);
        return;
      }
    }

    setCheckoutLoading(true);
    setCheckoutError(null);

    // Normaliza pagamentos: dinheiro é capado ao valor exato da venda (troco não é gravado)
    const nonCashSum = payments.filter(p => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
    const normalizedPayments = payments
      .map(p => p.method === "cash"
        ? { ...p, amount: parseFloat(Math.max(0, total - nonCashSum).toFixed(2)) }
        : p
      )
      .filter(p => p.amount > 0);

    const { data: sale, error } = await supabase.from("sales").insert({
      user_id: userId, discount: discountVal, status: "paid",
      total_amount: total,
      customer_id: selectedCustomer?.id ?? null, origin: saleChannel,
      seller_name: sellerName || null, notes: orderNotes || null,
      delivery_address: deliveryAddress || null, payments: normalizedPayments,
    }).select().single();

    if (error || !sale) { setCheckoutError("Erro ao salvar venda."); setCheckoutLoading(false); return; }

    const { error: itemsInsertErr } = await supabase.from("sale_items").insert(cart.map(i => ({
      sale_id: sale.id, product_id: i.product.id,
      quantity: i.quantity, unit_price: i.customPrice ?? i.product.sale_price,
      total_price: (i.customPrice ?? i.product.sale_price) * i.quantity,
      notes: i.notes || null,
    })));
    if (itemsInsertErr) showError("Venda salva mas itens falharam: " + itemsInsertErr.message);

    // Agrupa por produto para somar quantidades antes de atualizar estoque
    const stockMap: Record<string, { product: Product; totalQty: number }> = {};
    for (const item of cart) {
      if (!isUnlimited(item.product)) {
        if (!stockMap[item.product.id]) stockMap[item.product.id] = { product: item.product, totalQty: 0 };
        stockMap[item.product.id].totalQty += item.quantity;
      }
    }
    for (const { product, totalQty } of Object.values(stockMap)) {
      const newStock = Math.max(0, product.stock - totalQty);
      await supabase.from("products").update({
        stock: newStock,
        ...(newStock === 0 ? { is_active: false } : {}),
      }).eq("id", product.id);
    }

    // Baixa automática de estoque via ficha técnica
    const productIds = cart.map(i => i.product.id);
    const { data: recipes } = await supabase
      .from("product_recipes")
      .select("product_id, stock_item_id, quantity")
      .in("product_id", productIds);
    if (recipes && recipes.length > 0) {
      const deductions: Record<string, number> = {};
      for (const cartItem of cart) {
        for (const r of recipes.filter(r => r.product_id === cartItem.product.id)) {
          deductions[r.stock_item_id] = (deductions[r.stock_item_id] ?? 0) + r.quantity * cartItem.quantity;
        }
      }
      const { data: stockItems } = await supabase
        .from("stock_items").select("id, current_qty").in("id", Object.keys(deductions));
      const orderNum = sale.id.slice(-6).toUpperCase();
      for (const si of stockItems ?? []) {
        const qty = deductions[si.id] ?? 0;
        if (qty > 0) {
          await supabase.from("stock_items").update({ current_qty: Math.max(0, si.current_qty - qty) }).eq("id", si.id);
          await supabase.from("stock_movements").insert({
            stock_item_id: si.id, user_id: userId,
            type: "sale", quantity: qty,
            reference_type: "sale", reference_id: sale.id,
            notes: `Venda #${orderNum}`,
          });
        }
      }
    }

    // Registrar no caixa (se houver caixa aberto)
    if (cashRegisterId && userId) {
      const orderNum = sale.id.slice(-6).toUpperCase();
      const validMethods = ["cash", "credit", "debit", "pix", "voucher", "fiado", "house_credit", "ifood_receivable"] as const;
      for (const p of normalizedPayments) {
        if (validMethods.includes(p.method as any)) {
          await supabase.from("cash_movements").insert({
            register_id: cashRegisterId, user_id: userId,
            movement_type: "sale", amount: p.method === "ifood_receivable" ? subtotal : p.amount,
            payment_method: p.method as any, channel: saleChannel,
            description: p.method === "fiado"
              ? `Fiado - Venda #${orderNum}${selectedCustomer ? ` · ${selectedCustomer.name}` : ""}`
              : p.method === "house_credit"
              ? `Saldo Cliente - Venda #${orderNum}${selectedCustomer ? ` · ${selectedCustomer.name}` : ""}`
              : p.method === "ifood_receivable"
              ? `iFood - Venda #${orderNum}`
              : `Venda #${orderNum}`,
          });
        }
      }
    }

    // Sincronizar movimentos do cliente (fiado e house_credit)
    if (selectedCustomer) {
      const orderNum = sale.id.slice(-6).toUpperCase();
      const fiadoAmt = payments.find(p => p.method === "fiado")?.amount ?? 0;
      const houseAmt = payments.find(p => p.method === "house_credit")?.amount ?? 0;

      if (fiadoAmt > 0 || houseAmt > 0) {
        const { data: curr } = await supabase.from("customers")
          .select("balance, fiado_balance").eq("id", selectedCustomer.id).single();

        const updates: Record<string, number> = {};
        if (fiadoAmt > 0) {
          updates.fiado_balance = (curr?.fiado_balance ?? 0) + fiadoAmt;
          await supabase.from("customer_movements").insert({
            customer_id: selectedCustomer.id, user_id: userId,
            type: "debit", amount: fiadoAmt,
            description: `Fiado - Venda #${orderNum}`,
            sale_id: sale.id, payment_methods: [],
          });
        }
        if (houseAmt > 0) {
          updates.balance = Math.max(0, (curr?.balance ?? 0) - houseAmt);
          await supabase.from("customer_movements").insert({
            customer_id: selectedCustomer.id, user_id: userId,
            type: "saldo", amount: houseAmt,
            description: `Saldo usado - Venda #${orderNum}`,
            sale_id: sale.id, payment_methods: [],
          });
        }
        await supabase.from("customers").update(updates).eq("id", selectedCustomer.id);
      }
    }

    // Captura cart antes de limpar para impressão
    const cartSnapshot = [...cart];
    const customerSnapshot = selectedCustomer;
    const addressSnapshot = deliveryAddress;
    const notesSnapshot = orderNotes;
    const sellerSnapshot = sellerName;

    setShowCheckout(false);
    clearCart();
    setCheckoutLoading(false);
    if (tab === "historico") loadHistory();

    // Monta itens a partir do carrinho (sem depender do fetch do DB)
    const receiptItems: SaleItem[] = cartSnapshot.map(i => ({
      id: i.product.id,
      sale_id: sale.id,
      product_id: i.product.id,
      quantity: i.quantity,
      unit_price: i.customPrice ?? i.product.sale_price,
      total_price: (i.customPrice ?? i.product.sale_price) * i.quantity,
      notes: i.notes || null,
      products: { name: i.product.name },
    }));
    printSale(
      { ...sale, total, payments, customers: customerSnapshot ? { name: customerSnapshot.name } : null, seller_name: sellerSnapshot || null, notes: notesSnapshot || null, delivery_address: addressSnapshot || null },
      receiptItems
    );
  }

  // ── Novo cliente ──
  async function createCustomer() {
    if (!newCustName.trim()) return;
    const { data } = await supabase.from("customers").insert({
      name: newCustName.trim(), phone: newCustPhone || null, address: newCustAddress || null, balance: 0,
    }).select().single();
    if (data) {
      setCustomers(prev => [...prev, data as Customer]);
      setSelectedCustomer(data as Customer);
      setNewCustName(""); setNewCustPhone(""); setNewCustAddress("");
      setShowNewCustomer(false); setShowCustomer(false);
    }
  }

  // ── Imprimir ──
  function printSale(sale: Sale, items: SaleItem[]) {
    const store = getStoreSettings();
    const win = window.open("", "_blank", "width=420,height=700");
    if (!win) return;
    const orderNum = sale.id.slice(-6).toUpperCase();
    const dt = new Date(sale.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const disc = Number(sale.discount ?? 0);
    const rawSaleTotal = Number((sale as any).total_amount ?? sale.total);
    const totalVal = rawSaleTotal > 0 ? rawSaleTotal : Math.max(0, subtotal - disc);
    const paid = (sale.payments ?? []).reduce((s: number, p: PaymentEntry) => s + p.amount, 0);
    const chg = Math.max(0, paid - totalVal);

    const SEP = () => `<div style="border-top:1px dashed #000;margin:8px 0"></div>`;
    const ROW = (a: string, b: string, big = false) =>
      `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:${big?"16px":"13px"};font-weight:${big?"800":"600"};color:#000"><span>${a}</span><span>${b}</span></div>`;
    const LABEL = (t: string) =>
      `<div style="font-size:11px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 3px">--- ${t} ---</div>`;

    // Identificar bebidas e separar itens
    const isDrink = (name: string) => /bebida|coca|água|suco|refrigerante|vinho|cerveja|chopp|açaí|milkshake|café|leite/i.test(name);
    const mainItems = items.filter(i => !isDrink(i.products?.name ?? ""));
    const drinkItems = items.filter(i => isDrink(i.products?.name ?? ""));

    const mainItemsHtml = mainItems.length > 0 ? mainItems.map(i => {
      const name = i.products?.name ?? "Produto";
      const unitLine = i.quantity > 1
        ? `<div style="font-size:11px;font-weight:500;color:#333;margin-top:1px">${i.quantity} un x ${fmt(i.unit_price)}</div>` : "";
      const obsLine = i.notes
        ? `<div style="font-size:9px;font-weight:400;color:#666;margin-top:1px;font-style:italic">Obs: ${i.notes}</div>` : "";
      return `<div style="padding:6px 0;border-bottom:1px dashed #ccc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;padding-right:8px">
            <div style="font-size:13px;font-weight:600;color:#000">${i.quantity}x ${name}</div>
            ${unitLine}
          </div>
          <div style="font-size:11px;font-weight:600;color:#000;white-space:nowrap">${fmt(i.unit_price * i.quantity)}</div>
        </div>
        ${obsLine}
      </div>`;
    }).join("") : "";

    const drinksHtml = drinkItems.length > 0 ? `
      ${mainItems.length > 0 ? `<div style="margin:10px 0;padding:8px 0;border-top:2px solid #000;border-bottom:2px solid #000;text-align:center">
        <div style="font-size:11px;font-weight:600;color:#000;text-transform:uppercase;letter-spacing:0.5px">🍹 BEBIDAS 🍹</div>
      </div>` : ""}
      ${drinkItems.map(i => {
        const name = i.products?.name ?? "Produto";
        const unitLine = i.quantity > 1
          ? `<div style="font-size:10px;font-weight:500;color:#333;margin-top:1px">${i.quantity} un x ${fmt(i.unit_price)}</div>` : "";
        const obsLine = i.notes
          ? `<div style="font-size:9px;font-weight:400;color:#666;margin-top:1px;font-style:italic">Obs: ${i.notes}</div>` : "";
        return `<div style="padding:5px 0;border-bottom:1px dashed #ccc">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1;padding-right:8px">
              <div style="font-size:12px;font-weight:600;color:#000">${i.quantity}x ${name}</div>
              ${unitLine}
            </div>
            <div style="font-size:11px;font-weight:600;color:#000;white-space:nowrap">${fmt(i.unit_price * i.quantity)}</div>
          </div>
          ${obsLine}
        </div>`;
      }).join("")}
    ` : "";

    const itemsHtml = mainItemsHtml + drinksHtml || `<div style="font-size:12px;font-weight:600;color:#000;padding:6px 0">Sem itens</div>`;

    const paymentsHtml = (sale.payments ?? []).map((p: PaymentEntry) =>
      ROW(PAYMENT_INFO[p.method]?.label ?? p.method, fmt(p.amount))
    ).join("");

    const pixLine = sale.payments?.some((p: PaymentEntry) => p.method === "pix") && store.pix
      ? `<div style="font-size:12px;font-weight:600;color:#000">Chave PIX: ${store.pix}</div>` : "";

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Pedido #${orderNum}</title>
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
    </div>

    ${(sale.customers?.name || sale.delivery_address || sale.seller_name) ? `
    <div style="padding:6px 0">
      ${sale.customers?.name ? `<div style="font-size:13px;font-weight:600;color:#000">Cliente: ${sale.customers.name}</div>` : ""}
      ${sale.delivery_address ? `<div style="font-size:13px;font-weight:600;color:#000">Endereco: ${sale.delivery_address}</div>` : ""}
      ${sale.seller_name ? `<div style="font-size:13px;font-weight:600;color:#000">Vendedor: ${sale.seller_name}</div>` : ""}
    </div>
    ` : ""}

    ${SEP()}
    ${LABEL("Itens do pedido")}
    ${itemsHtml}

    ${SEP()}
    ${subtotal !== totalVal ? ROW("Subtotal", fmt(subtotal)) : ""}
    ${disc > 0 ? ROW("Desconto", "- " + fmt(disc)) : ""}
    ${ROW("TOTAL", fmt(totalVal), true)}

    ${SEP()}
    ${LABEL("Pagamento")}
    ${paymentsHtml}
    ${pixLine}
    ${chg > 0.01 ? ROW("Troco", fmt(chg)) : ""}

    ${sale.notes ? `${SEP()}${LABEL("Observacoes")}<div style="font-size:13px;font-weight:600;color:#000">${sale.notes}</div>` : ""}

    ${SEP()}
    <div style="text-align:center;font-size:13px;font-weight:600;color:#000;padding-top:4px">
      ${store.footer_message || "Obrigado pela preferencia!"}
    </div>
    </body></html>`);
    win.document.close();
    win.onafterprint = () => win.close();
    setTimeout(() => win.print(), 400);
  }

  // ── Editar venda ──
  async function openEditSale(sale: Sale) {
    // Re-busca dados frescos do banco (evita cache desatualizado quando editado em outra aba)
    const { data: freshSale } = await supabase.from("sales").select("*").eq("id", sale.id).single();
    const saleToUse = (freshSale ?? sale) as Sale;

    const { data } = await supabase.from("sale_items").select("*, products(name)").eq("sale_id", sale.id);
    setShowEditItems(data ?? []);
    setEditSalePayments((saleToUse as any).payments ?? []);
    setEditCustomer(customers.find(c => c.id === saleToUse.customer_id) ?? null);
    setEditCustSearch("");
    setEditDeliveryAddress((saleToUse as any).delivery_address ?? "");
    setEditingItemPriceId(null);
    setEditingItemPriceVal("");
    setShowEditSale(saleToUse);
  }

  async function deleteFromSale(itemId: string) {
    await supabase.from("sale_items").delete().eq("id", itemId);
    setShowEditItems(prev => prev.filter(i => i.id !== itemId));
  }

  async function addItemToSale(product: Product) {
    if (!showEditSale) return;
    const existing = showEditItems.find(i => i.product_id === product.id);
    if (existing) {
      const newQty = existing.quantity + 1;
      await supabase.from("sale_items").update({ quantity: newQty, total_price: existing.unit_price * newQty }).eq("id", existing.id);
      setShowEditItems(prev => prev.map(i => i.id === existing.id ? { ...i, quantity: newQty, total_price: existing.unit_price * newQty } : i));
    } else {
      const { data } = await supabase.from("sale_items").insert({
        sale_id: showEditSale.id, product_id: product.id,
        quantity: 1, unit_price: product.sale_price, total_price: product.sale_price, notes: null,
      }).select("*, products(name)").single();
      if (data) setShowEditItems(prev => [...prev, data as SaleItem]);
    }
    setEditProductSearch("");
  }

  async function updateEditItemQty(item: SaleItem, delta: number) {
    const newQty = Math.max(1, item.quantity + delta);
    await supabase.from("sale_items")
      .update({ quantity: newQty, total_price: item.unit_price * newQty })
      .eq("id", item.id);
    setShowEditItems(prev => prev.map(i => i.id === item.id
      ? { ...i, quantity: newQty, total_price: item.unit_price * newQty }
      : i
    ));
  }

  async function confirmEditItemPrice(item: SaleItem) {
    const newPrice = parseFloat(editingItemPriceVal.replace(",", ".")) || 0;
    if (newPrice < 0) return;
    await supabase.from("sale_items")
      .update({ unit_price: newPrice, total_price: newPrice * item.quantity })
      .eq("id", item.id);
    setShowEditItems(prev => prev.map(i => i.id === item.id
      ? { ...i, unit_price: newPrice, total_price: newPrice * item.quantity }
      : i
    ));
    setEditingItemPriceId(null);
    setEditingItemPriceVal("");
  }

  async function deletePendingSale(saleId: string) {
    if (!confirm("Excluir esta venda pausada?")) return;
    await supabase.from("sale_items").delete().eq("sale_id", saleId);
    await supabase.from("sales").delete().eq("id", saleId);
    setPendingSales(prev => prev.filter(s => s.id !== saleId));
  }

  async function saveEditPayments() {
    if (!showEditSale) return;
    const saleId = showEditSale.id;
    const orderNum = saleId.slice(-6).toUpperCase();
    const customerName = editCustomer?.name ?? showEditSale.customers?.name ?? null;

    // Recalcula o total a partir dos itens atuais (salvos individualmente no DB)
    const newTotal = Math.max(
      0,
      showEditItems.reduce((s, i) => s + i.unit_price * i.quantity, 0) - Number(showEditSale.discount ?? 0)
    );

    // Auto-ajusta os pagamentos para cobrir exatamente o novo total
    // (evita que o caixa fique com valor antigo quando o usuário edita itens sem atualizar pagamentos)
    let paymentsSnapshot = [...editSalePayments];
    if (paymentsSnapshot.length > 0) {
      const currentPaid = paymentsSnapshot.reduce((s, p) => s + p.amount, 0);
      if (Math.abs(currentPaid - newTotal) > 0.001) {
        const diff = newTotal - currentPaid;
        const lastIdx = paymentsSnapshot.length - 1;
        paymentsSnapshot = paymentsSnapshot.map((p, i) =>
          i === lastIdx ? { ...p, amount: Math.max(0, p.amount + diff) } : p
        );
      }
    }

    // 1. Salva payments + cliente + endereço + total
    const { error } = await supabase.from("sales")
      .update({
        payments: paymentsSnapshot,
        total_amount: newTotal,
        customer_id: editCustomer?.id ?? null,
        delivery_address: editDeliveryAddress.trim() || null,
      })
      .eq("id", saleId);
    if (error) { showError("Erro ao salvar venda: " + error.message); return; }

    // 3. Sincroniza movimentos de caixa
    // Deleta os movimentos antigos desta venda sem filtrar por cashRegisterId
    await supabase.from("cash_movements")
      .delete()
      .eq("movement_type", "sale")
      .like("description", `%#${orderNum}%`);
    // Reinsere com os novos valores
    if (cashRegisterId && userId) {
      for (const p of paymentsSnapshot.filter(p => p.amount > 0)) {
        const description =
          p.method === "fiado"
            ? `Fiado - Venda #${orderNum}${customerName ? ` · ${customerName}` : ""}`
            : p.method === "house_credit"
            ? `Saldo Cliente - Venda #${orderNum}${customerName ? ` · ${customerName}` : ""}`
            : `Venda #${orderNum}`;
        await supabase.from("cash_movements").insert({
          register_id: cashRegisterId,
          user_id: userId,
          movement_type: "sale",
          amount: p.amount,
          payment_method: p.method as any,
          channel: "pdv",
          description,
        });
      }
    }

    // 4. Sincroniza movimentos do cliente (fiado)
    if (showEditSale.customer_id && userId) {
      const newFiadoAmt = paymentsSnapshot
        .filter(p => p.method === "fiado" && p.amount > 0)
        .reduce((s, p) => s + p.amount, 0);

      // Busca movimentos antigos desta venda para calcular o delta do fiado_balance
      const { data: oldMov } = await supabase.from("customer_movements")
        .select("amount, type")
        .eq("sale_id", saleId);
      const oldFiadoAmt = (oldMov ?? [])
        .filter((m: any) => m.type === "debit")
        .reduce((s: number, m: any) => s + m.amount, 0);

      // Apaga todos os movimentos desta venda
      await supabase.from("customer_movements").delete().eq("sale_id", saleId);

      // Atualiza fiado_balance do cliente com o delta
      if (oldFiadoAmt !== newFiadoAmt) {
        const { data: currCust } = await supabase.from("customers")
          .select("fiado_balance")
          .eq("id", showEditSale.customer_id)
          .single();
        const newBalance = Math.max(0, (currCust?.fiado_balance ?? 0) - oldFiadoAmt + newFiadoAmt);
        await supabase.from("customers").update({ fiado_balance: newBalance }).eq("id", showEditSale.customer_id);
      }

      // Reinsere o movimento com o valor atualizado
      if (newFiadoAmt > 0) {
        await supabase.from("customer_movements").insert({
          customer_id: showEditSale.customer_id,
          user_id: userId,
          type: "debit",
          amount: newFiadoAmt,
          description: `Fiado - Venda #${orderNum}`,
          sale_id: saleId,
          payment_methods: [],
        });
      }
    }

    // 5. Atualiza estado local e recarrega histórico
    setSales(prev => prev.map(s => s.id === saleId
      ? { ...s, payments: paymentsSnapshot, total: newTotal }
      : s
    ));
    setShowEditSale(null);
    setEditProductSearch("");
    if (tab === "historico") loadHistory();
  }

  function addEditPayment(method: PayMethod) {
    if (editSalePayments.some(p => p.method === method)) return;
    setEditSalePayments(prev => [...prev, { method, amount: 0 }]);
  }

  function updateEditPaymentAmount(method: PayMethod, value: string) {
    const amount = parseFloat(value.replace(",", ".")) || 0;
    setEditSalePayments(prev => prev.map(p => p.method === method ? { ...p, amount } : p));
  }

  function removeEditPayment(method: PayMethod) {
    setEditSalePayments(prev => prev.filter(p => p.method !== method));
  }

  async function deleteSale(saleId: string) {
    if (!confirm("Excluir esta venda definitivamente?")) return;
    const orderNum = saleId.slice(-6).toUpperCase();
    const sale = sales.find(s => s.id === saleId) ?? showEditSale;

    // Remove movimentos de caixa (sem filtro user_id para garantir que funciona)
    await supabase.from("cash_movements")
      .delete()
      .eq("movement_type", "sale")
      .like("description", `%#${orderNum}%`);

    // Remove movimentos do cliente e ajusta fiado_balance
    if (sale?.customer_id && userId) {
      const fiadoAmt = (sale.payments ?? [])
        .filter(p => p.method === "fiado")
        .reduce((s, p) => s + p.amount, 0);
      if (fiadoAmt > 0) {
        const { data: currCust } = await supabase.from("customers")
          .select("fiado_balance").eq("id", sale.customer_id).single();
        const newBalance = Math.max(0, (currCust?.fiado_balance ?? 0) - fiadoAmt);
        await supabase.from("customers").update({ fiado_balance: newBalance }).eq("id", sale.customer_id);
      }
      await supabase.from("customer_movements").delete().eq("sale_id", saleId);
    }

    await supabase.from("sales").delete().eq("id", saleId);
    setSales(prev => prev.filter(s => s.id !== saleId));
    setShowEditSale(null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col overflow-hidden -m-6" style={{ height: "calc(100vh - 64px)" }}>

      {/* Toast de erro global */}
      {toastError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-red-900 border border-red-500/50 text-red-200 text-sm px-5 py-3 rounded-2xl shadow-2xl max-w-lg flex items-center gap-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{toastError}</span>
          <button onClick={() => setToastError(null)} className="ml-2 text-red-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-zinc-800/80 flex-shrink-0"
        style={{ background: isLight ? "#f9fafb" : "linear-gradient(135deg,#0f0f13 0%,#09090b 100%)" }}>
        {(["venda", "historico"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all overflow-hidden"
            style={tab===t
              ? { color: isLight ? "#2563eb" : "#c4b5fd", background: "transparent" }
              : { color:"#9ca3af" }}>
            {/* Linha azul sólida no fundo — só aparece na aba ativa */}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 pointer-events-none"
                style={{ height: 2, background: isLight ? "#2563eb" : "linear-gradient(90deg,#7B2FBE,#00B4D8)" }} />
            )}
            {t === "venda" ? <><ShoppingCart className="w-4 h-4" />Nova Venda</> : <><History className="w-4 h-4" />Histórico</>}
          </button>
        ))}
        <button onClick={() => { loadPending(); setShowPending(true); }}
          className="ml-auto flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-xl mb-1 transition-all"
          style={isLight ? { color:"#fff", background:"#2563eb", border:"1px solid #2563eb", boxShadow:"0 0 12px rgba(37,99,235,0.3)" } : { color:"#10b981", background:"rgba(16,185,129,0.12)", border:"1px solid rgba(16,185,129,0.3)", boxShadow:"0 0 12px rgba(16,185,129,0.15)" }}>
          <Clock className="w-4 h-4" />
          <span>Venda em Pausa</span>
          {pendingSales.length > 0 && (
            <span className="min-w-[20px] h-5 px-1 text-xs font-black rounded-full flex items-center justify-center"
              style={{background:"#10b981",color:"#fff",boxShadow:"0 0 8px rgba(16,185,129,0.5)"}}>
              {pendingSales.length}
            </span>
          )}
        </button>
      </div>

      {/* ── ABA VENDA ── */}
      {tab === "venda" && (
        <div className="flex flex-1 overflow-hidden">

          {/* ESQUERDA — Produtos */}
          <div className="flex flex-col flex-1 overflow-hidden border-r border-zinc-800">

            {/* Busca */}
            <div style={{ padding: "16px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
                <Search style={{ width: "24px", height: "24px", color: "#10b981", flexShrink: 0, minWidth: "24px" }} />
                <input
                  ref={searchRef}
                  placeholder="Buscar produto..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && filtered.length > 0) {
                      e.preventDefault();
                      addToCart(filtered[0]);
                      setSearch("");
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: "8px",
                    fontSize: "14px",
                    border: card.border,
                    background: card.bg,
                    color: isLight ? "#111" : "#fff",
                    outline: "none"
                  }}
                />
                {search && <button onClick={() => setSearch("")} style={{ flexShrink: 0, minWidth: "24px", cursor: "pointer", background: "none", border: "none", color: "#71717a" }}><X style={{ width: "20px", height: "20px" }} /></button>}
              </div>
            </div>

            {/* Atalhos por categoria — preenche espaço restante e rola verticalmente */}
            {search === "" && (
              <div className="px-4 py-3 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-zinc-500 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Atalhos rápidos
                  </p>
                  <button onClick={() => { setShowShortcutManager(true); setActiveGroupId(shortcutGroups[0]?.id ?? null); }}
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    + Gerenciar
                  </button>
                </div>
                {shortcutGroups.length === 0 ? (
                  <button onClick={() => setShowShortcutManager(true)}
                    className="w-full py-4 border border-dashed border-zinc-800 rounded-xl text-xs text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition-colors">
                    Clique em "Gerenciar" para criar categorias de atalhos
                  </button>
                ) : (
                  <div className="space-y-5">
                    {shortcutGroups.map(group => {
                      const groupProds = products.filter(p => group.productIds.includes(p.id));
                      if (groupProds.length === 0) return null;
                      return (
                        <div key={group.id}>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <span className="h-px flex-1 bg-zinc-800" />
                            {group.name}
                            <span className="h-px flex-1 bg-zinc-800" />
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {groupProds.map(p => (
                              <button key={p.id} onClick={() => addToCart(p)}
                                className="flex flex-col items-center gap-1 hover:border-violet-500/50 rounded-xl p-2.5 w-20 transition-all"
                                style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                                {p.image_url
                                  ? <img src={p.image_url} alt={p.name} className="w-10 h-10 min-w-[40px] rounded-md object-cover" style={{aspectRatio:"1/1"}} />
                                  : <div className="w-10 h-10 rounded-md bg-zinc-800 flex items-center justify-center"><Package className="w-5 h-5 text-zinc-600" /></div>}
                                <span className="text-xs text-center text-zinc-300 leading-tight line-clamp-2">{p.name}</span>
                                <span className="text-xs font-semibold text-violet-400">{fmt(p.sale_price)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Resultados de busca — só aparece quando o usuário digita algo */}
            {search !== "" && (
              <div className="flex-1 overflow-y-auto p-4">
                {loadingProducts ? (
                  <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-violet-400" /></div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-12 text-zinc-500 text-sm">Nenhum produto encontrado.</div>
                ) : (
                  <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                    {filtered.map(p => {
                      const sem = !isUnlimited(p) && p.stock === 0;
                      return (
                        <div key={p.id}
                          onClick={() => addToCart(p)}
                          className={`group rounded-xl overflow-hidden transition-all hover:border-violet-500/50 ${sem ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                          style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                          <div className="relative">
                            {p.image_url
                              ? <img src={p.image_url} alt={p.name} className="w-full h-28 object-cover" />
                              : <div className="w-full h-28 bg-zinc-800 flex items-center justify-center"><Package className="w-8 h-8 text-zinc-600" /></div>}
                            {!isUnlimited(p) && p.stock <= 5 && (
                              <span className={`absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-md font-medium ${p.stock === 0 ? "bg-red-600 text-white" : "bg-amber-500/90 text-black"}`}>
                                {p.stock === 0 ? "Esgotado" : `Rest. ${p.stock}`}
                              </span>
                            )}
                          </div>
                          <div className="p-2.5">
                            <p className="text-sm font-medium text-white leading-tight line-clamp-2 mb-1.5">{p.name}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold text-violet-400">{fmt(p.sale_price)}</span>
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <button onClick={() => toggleShortcut(p.id)} title={allShortcutIds.includes(p.id) ? "Remover atalho" : "Adicionar atalho"}
                                  className="p-1 text-zinc-600 hover:text-amber-400 transition-colors">
                                  {allShortcutIds.includes(p.id) ? <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> : <StarOff className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => addToCart(p)} disabled={sem}
                                  className="p-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg transition-colors"
                                  style={{ color: "#fff" }}>
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* DIREITA — Carrinho */}
          <div className="w-[380px] flex flex-col flex-shrink-0 overflow-hidden" style={{ background: isLight ? "#f9fafb" : "#09090b" }}>

            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-semibold">Carrinho</span>
                {cart.length > 0 && <span className="text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold" style={{ background: isLight ? "#10b981" : "linear-gradient(135deg,#7B2FBE,#00B4D8)", color: "#fff" }}>{cart.reduce((s, i) => s + i.quantity, 0)}</span>}
              </div>
              {cart.length > 0 && <button onClick={clearCart} className="text-xs text-red-400 hover:text-red-300 transition-colors">Limpar tudo</button>}
            </div>

            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-zinc-600 text-sm gap-3 p-6">
                  <ShoppingCart className="w-10 h-10" />
                  <p className="font-medium">Carrinho vazio</p>
                  <p className="text-xs text-center">Clique em um produto ou use a busca para adicionar itens</p>
                </div>
              )}
              {cart.length > 0 && (
                <div className="p-3 space-y-2">
                  {cart.map(item => (
                    <div key={item.cartId} className="rounded-lg px-2.5 py-2" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                      {/* Linha 1: nome + qty +/- + total + lixo */}
                      <div className="flex items-center gap-1.5">
                        <p className="flex-1 text-xs font-semibold text-white truncate">{item.product.name}</p>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button onClick={() => updateQty(item.cartId, -1)} className="w-5 h-5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center transition-colors"><Minus className="w-2.5 h-2.5" /></button>
                          <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                          <button onClick={() => updateQty(item.cartId, 1)} disabled={!isUnlimited(item.product) && item.quantity >= item.product.stock}
                            className="w-5 h-5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded flex items-center justify-center transition-colors"><Plus className="w-2.5 h-2.5" /></button>
                        </div>
                        <span className="text-xs font-bold flex-shrink-0 w-16 text-right" style={{ color: "#7B2FBE" }}>{fmt((item.customPrice ?? item.product.sale_price) * item.quantity)}</span>
                        <button onClick={() => removeFromCart(item.cartId)} className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0 p-0.5"><Trash2 className="w-3 h-3" /></button>
                      </div>
                      {/* Linha 2: preço por unidade + observação */}
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-zinc-600 flex-shrink-0">R$/un</span>
                        <input
                          key={`price-${item.cartId}-${item.customPrice ?? item.product.sale_price}`}
                          type="text" inputMode="decimal"
                          defaultValue={String(item.customPrice ?? item.product.sale_price).replace(".", ",")}
                          onBlur={e => { const val = parseFloat(e.target.value.replace(",", ".")); if (!isNaN(val) && val >= 0) updateItemPrice(item.cartId, val); }}
                          className={`w-16 text-[10px] px-1.5 py-0.5 bg-zinc-950 border rounded font-semibold focus:outline-none transition-colors ${item.customPrice !== undefined && item.customPrice !== item.product.sale_price ? "border-amber-500/60 text-amber-400" : "border-zinc-800 text-zinc-400"}`}
                        />
                        <input placeholder="Obs..." value={item.notes} onChange={e => updateItemNotes(item.cartId, e.target.value)}
                          className="flex-1 text-[10px] px-1.5 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-400 placeholder-zinc-600 focus:outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Bloco inferior: desconto, totais, cliente, botões — rola junto com os itens */}
              <div className="border-t border-zinc-800 p-3 space-y-2.5">

              {/* Totais — só mostra quando tem itens */}
              {cart.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 w-20 flex-shrink-0">Desconto R$</span>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={discount} onChange={e => setDiscount(e.target.value)}
                      className="flex-1 text-xs px-2.5 py-1.5 rounded-lg placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                      style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }} />
                  </div>
                  <div className="rounded-xl p-3 space-y-1" style={{ background: card.bg, border: card.border }}>
                    <div className="flex justify-between text-xs text-zinc-400"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
                    {discountVal > 0 && <div className="flex justify-between text-xs text-red-400"><span>Desconto</span><span>-{fmt(discountVal)}</span></div>}
                    <div className="flex justify-between text-sm font-bold border-t border-zinc-800 pt-1.5"><span>Total</span><span style={{ color: "#7B2FBE" }}>{fmt(total)}</span></div>
                  </div>
                </>
              )}

              {/* Cliente — sempre visível */}
              <button onClick={() => setShowCustomer(true)}
                className="w-full flex items-center gap-2 hover:border-zinc-700 rounded-xl px-3 py-2.5 transition-colors text-left"
                style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                <User className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {selectedCustomer
                    ? <><p className="text-xs font-medium text-white truncate">{selectedCustomer.name}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {selectedCustomer.balance > 0 && <span className="text-xs text-emerald-400">Saldo: {fmt(selectedCustomer.balance)}</span>}
                          {(selectedCustomer.fiado_balance ?? 0) > 0 && <span className="text-xs text-red-400">Fiado: {fmt(selectedCustomer.fiado_balance)}</span>}
                        </div></>
                    : <p className="text-xs text-zinc-500">Selecionar cliente (opcional)</p>}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
              </button>

              {/* Endereço + Obs + Vendedor — sempre visíveis */}
              <input placeholder="Endereço de entrega (opcional)..." value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                style={{ background: card.bg, border: card.border, color: isLight ? "#374151" : "#d4d4d8" }} />
              <input placeholder="Observações do pedido..." value={orderNotes} onChange={e => setOrderNotes(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                style={{ background: card.bg, border: card.border, color: isLight ? "#374151" : "#d4d4d8" }} />
              {sellers.length > 0 ? (
                <select value={sellerName} onChange={e => setSellerName(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-violet-500 appearance-none"
                  style={{ background: card.bg, border: card.border, color: isLight ? "#374151" : "#d4d4d8" }}>
                  <option value="">— Vendedor / Garçom —</option>
                  {sellers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input placeholder="Vendedor / Garçom responsável..." value={sellerName} onChange={e => setSellerName(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                  style={{ background: card.bg, border: card.border, color: isLight ? "#374151" : "#d4d4d8" }} />
              )}

              {/* Botões — sempre visíveis, Finalizar desabilitado sem itens */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={savePending} disabled={cart.length === 0}
                  className="flex items-center justify-center gap-1.5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold rounded-xl transition-all"
                  style={isLight ? { border:"1px solid #2563eb", color:"#fff", background:"#2563eb" } : { border:"1px solid rgba(16,185,129,0.4)", color:"#10b981", background:"rgba(16,185,129,0.07)" }}>
                  <Clock className="w-3.5 h-3.5" />
                  Pausar
                  <kbd className="text-[10px] px-1 py-0.5 rounded font-bold" style={isLight ? { background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff" } : { background:"rgba(16,185,129,0.15)", border:"1px solid rgba(16,185,129,0.3)", color:"#10b981" }}>F2</kbd>
                </button>
                <button onClick={openCheckout} disabled={cart.length === 0 || !cashRegisterId}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold rounded-xl transition-colors shadow-lg shadow-violet-900/30"
                  style={{ color: "#fff" }}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Finalizar
                  <kbd className="text-[10px] bg-white/10 border border-white/20 px-1 py-0.5 rounded font-bold" style={{ color: "#fff" }}>F1</kbd>
                </button>
                {!cashRegisterId && !loadingProducts && (
                  <p className="text-[10px] text-amber-400 text-center flex items-center justify-center gap-1 mt-0.5">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" /> Caixa fechado — abra o caixa para vender
                  </p>
                )}
              </div>
            </div>
            {/* fecha flex-1 overflow-y-auto (scroll do carrinho) */}
            </div>
          </div>
        </div>
      )}

      {/* ── ABA HISTÓRICO ── */}
      {tab === "historico" && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input placeholder="Buscar cliente, ID ou endereço..." value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }} />
            </div>
            <button onClick={loadHistory} className="p-2.5 rounded-xl text-zinc-400 hover:text-white transition-colors" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <RefreshCw className={`w-4 h-4 ${loadingHistory ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loadingHistory ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-violet-400" /></div>
          ) : (
            <div className="space-y-2">
              {sales.filter(s => historySearch === "" || s.customers?.name?.toLowerCase().includes(historySearch.toLowerCase()) || s.id.includes(historySearch) || (s as any).delivery_address?.toLowerCase().includes(historySearch.toLowerCase())).map(sale => {
                const isExpanded = expandedSaleId === sale.id;
                const saleItems = sale.sale_items ?? [];
                const discountAmt = Number(sale.discount ?? 0);
                const itemsTotal = saleItems.reduce((s, i) => s + (i.unit_price * i.quantity), 0);
                const rawTotal = Number((sale as any).total_amount ?? sale.total ?? 0);
                const isIfood = (sale as any).origin === "ifood";
                // iFood: valor bruto (= itens sem descontar comissão) para bater com recibo
                // Outros: valor líquido (itens − desconto)
                const displayTotal = itemsTotal > 0
                  ? (isIfood ? itemsTotal : Math.max(0, itemsTotal - discountAmt))
                  : (rawTotal > 0 ? (isIfood ? rawTotal + discountAmt : rawTotal) : 0);
                const orderNum = sale.id.slice(-6).toUpperCase();
                return (
                  <div key={sale.id} className="rounded-xl transition-colors overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}>
                          {/* Linha 1: status + número (destaque) + hora */}
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span style={isLight ? { background:"#10b981", color:"#fff" } : { background:"bg-emerald-500/15", color:"text-emerald-400" }} className="text-xs font-medium px-2 py-0.5 rounded-full">
                              {sale.status === "paid" ? "Concluída" : sale.status === "open" ? "Pendente" : "Cancelada"}
                            </span>
                            {sale.origin && ORIGIN_INFO[sale.origin] && (
                              <span style={isLight ? { background:"#2563eb", color:"#fff" } : {}} className={`text-xs font-medium px-2 py-0.5 rounded-full ${!isLight ? ORIGIN_INFO[sale.origin].color : ""}`}>
                                {ORIGIN_INFO[sale.origin].label}
                              </span>
                            )}
                            <span className="text-sm font-bold font-mono px-2.5 py-0.5 rounded-lg" style={{background: isLight ? "rgba(239,68,68,0.15)" : "#7B2FBE", color: isLight ? "#000" : "#fff"}}>#{orderNum}</span>
                            <span className="text-xs text-zinc-500">{new Date(sale.created_at).toLocaleString("pt-BR")}</span>
                            {sale.seller_name && <span className="text-xs text-zinc-500">· {sale.seller_name}</span>}
                          </div>
                          {/* Linha 2: cliente + endereço (secundário) */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs text-zinc-400">{sale.customers?.name ?? "Sem cliente"}</p>
                            {(sale as any).delivery_address && <p className="text-xs text-zinc-500">· {(sale as any).delivery_address}</p>}
                          </div>
                          {/* Linha 3: pagamentos + itens */}
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <p className="text-xs text-zinc-500">{(sale.payments ?? []).map((p: PaymentEntry) => PAYMENT_INFO[p.method]?.label).join(" + ") || "—"}</p>
                            {saleItems.length > 0 && (
                              <p className="text-xs text-zinc-600">· {saleItems.length} {saleItems.length === 1 ? "item" : "itens"}: {saleItems.map(i => i.products?.name ?? "Produto").join(", ").slice(0, 50)}{saleItems.map(i => i.products?.name ?? "").join(", ").length > 50 ? "…" : ""}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-base font-bold mr-1" style={{color: isLight ? "#10b981" : "#fbbf24"}}>{fmt(displayTotal)}</span>
                          <button onClick={() => openEditSale(sale)}
                            className="p-1.5 hover:bg-opacity-20 border rounded-lg transition-colors"
                            style={isLight ? { background:"rgba(37,99,235,0.1)", border:"1px solid rgba(37,99,235,0.3)", color:"#2563eb" } : { background:"rgba(123,47,190,0.1)", border:"1px solid rgba(123,47,190,0.3)", color:"#b49bff" }}
                            title="Editar">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => printSale(sale, saleItems)}
                            className="p-1.5 hover:bg-opacity-20 border rounded-lg transition-colors"
                            style={isLight ? { background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.3)", color:"#10b981" } : { background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.3)", color:"#6ee7b7" }}
                            title="Reimprimir">
                            <Printer className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteSale(sale.id)}
                            className="p-1.5 hover:bg-opacity-20 border rounded-lg transition-colors"
                            style={isLight ? { background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#ef4444" } : { background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#fca5a5" }}
                            title="Excluir venda">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {isExpanded && saleItems.length > 0 && (
                      <div className="border-t border-zinc-800 px-4 py-3 space-y-1.5">
                        {saleItems.map(item => (
                          <div key={item.id} className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300">{item.quantity}x {item.products?.name ?? "Produto"}</span>
                            <span className="text-zinc-400">{fmt(item.unit_price * item.quantity)}</span>
                          </div>
                        ))}
                        {(sale.discount ?? 0) > 0 && (
                          <div className="flex justify-between text-xs text-red-400 border-t border-zinc-800 pt-1">
                            <span>{isIfood ? "Comissão iFood" : "Desconto"}</span>
                            <span>-{fmt(sale.discount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs font-bold border-t border-zinc-800 pt-1">
                          <span>{isIfood ? "Total bruto (recibo)" : "Total"}</span>
                          <span style={{color: isLight ? "#10b981" : "#fbbf24"}}>{fmt(displayTotal)}</span>
                        </div>
                        {isIfood && (sale.discount ?? 0) > 0 && (
                          <div className="flex justify-between text-xs text-zinc-500 pt-0.5">
                            <span>Líquido (você recebe)</span>
                            <span>{fmt(Math.max(0, itemsTotal - discountAmt))}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {sales.length === 0 && <div className="text-center py-12 text-zinc-500 text-sm">Nenhuma venda encontrada.</div>}
            </div>
          )}
        </div>
      )}

      {/* ══ MODAIS ══════════════════════════════════════════════════════════════ */}


      {showCustomer && (
        <Modal title="Selecionar Cliente" onClose={() => setShowCustomer(false)}>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input placeholder="Buscar por nome ou telefone..." value={custSearch} onChange={e => setCustSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500" />
            </div>
            <button onClick={() => { setShowCustomer(false); setShowNewCustomer(true); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-zinc-700 hover:border-violet-500 rounded-xl text-sm text-zinc-400 hover:text-violet-400 transition-colors">
              <UserPlus className="w-4 h-4" /> Cadastrar novo cliente
            </button>
            {selectedCustomer && (
              <button onClick={() => { setSelectedCustomer(null); setShowCustomer(false); }}
                className="w-full text-center py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                Remover cliente selecionado
              </button>
            )}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filteredCustomers.map(c => (
                <button key={c.id} onClick={async () => {
                    // Busca dados frescos do cliente (garantindo credit_limit e fiado_balance atualizados)
                    const { data: fresh } = await supabase.from("customers").select("id,name,phone,address,balance,fiado_balance,credit_limit").eq("id", c.id).single();
                    const customer = (fresh as Customer) ?? c;
                    setSelectedCustomer(customer);
                    setCustomers(prev => prev.map(x => x.id === customer.id ? customer : x));
                    setShowCustomer(false); setCustSearch(""); if (customer.address) setDeliveryAddress(customer.address);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${selectedCustomer?.id === c.id ? "bg-violet-600/20 border border-violet-500/30" : "hover:bg-zinc-800"}`}>
                  <p className="text-sm font-medium text-white">{c.name}</p>
                  <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
                    {c.phone && <span>{c.phone}</span>}
                    {c.balance > 0 && <span className="text-emerald-400">Saldo: {fmt(c.balance)}</span>}
                    {(c.fiado_balance ?? 0) > 0 && <span className="text-red-400">Fiado: {fmt(c.fiado_balance)}</span>}
                    {c.address && <span className="truncate max-w-[120px]">{c.address}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {showNewCustomer && (
        <Modal title="Novo Cliente" onClose={() => setShowNewCustomer(false)}>
          <div className="space-y-3">
            {[
              { label: "Nome completo *", value: newCustName, setter: setNewCustName, placeholder: "Ex: João Silva" },
              { label: "Telefone", value: newCustPhone, setter: setNewCustPhone, placeholder: "(99) 99999-9999" },
              { label: "Endereço", value: newCustAddress, setter: setNewCustAddress, placeholder: "Rua, número, bairro..." },
            ].map(({ label, value, setter, placeholder }) => (
              <div key={label}>
                <label className="block text-xs text-zinc-400 mb-1.5">{label}</label>
                <input placeholder={placeholder} value={value} onChange={e => setter(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500" />
              </div>
            ))}
            <button onClick={createCustomer} disabled={!newCustName.trim()}
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors">
              Cadastrar Cliente
            </button>
          </div>
        </Modal>
      )}

      {showPending && (
        <Modal title="Vendas em Pausa" onClose={() => setShowPending(false)} wide>
          <div className="space-y-3">
            {pendingSales.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <Clock className="w-10 h-10 text-zinc-700 mx-auto" />
                <p className="text-sm text-zinc-500">Nenhuma venda pausada no momento.</p>
                <p className="text-xs text-zinc-600">Clique em "Pausar Venda" para salvar um pedido e retomar depois.</p>
              </div>
            ) : pendingSales.map(sale => {
              const saleItems = sale.sale_items ?? [];
              const itemsTotal = saleItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
              const discountAmt = Number(sale.discount ?? 0);
              const rawSaleTotal = Number((sale as any).total_amount ?? sale.total);
              const saleTotal = rawSaleTotal > 0 ? rawSaleTotal : Math.max(0, itemsTotal - discountAmt);
              const orderNum = sale.id.slice(-6).toUpperCase();
              return (
                <div key={sale.id} className="bg-zinc-950 border border-amber-500/20 rounded-2xl overflow-hidden">
                  {/* Cabeçalho do pedido pausado */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">PAUSADO · #{orderNum}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">{new Date(sale.created_at).toLocaleString("pt-BR")}</span>
                      <button onClick={() => deletePendingSale(sale.id)}
                        className="p-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-colors" title="Excluir venda pausada">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Info do cliente/entrega */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-white">{sale.customers?.name ?? "Sem cliente"}</p>
                        {sale.seller_name && <p className="text-xs text-zinc-400">Vendedor: {sale.seller_name}</p>}
                        {(sale as any).delivery_address && <p className="text-xs text-zinc-400">Entrega: {(sale as any).delivery_address}</p>}
                        {sale.notes && <p className="text-xs text-zinc-500 italic">"{sale.notes}"</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xl font-black text-violet-400">{fmt(saleTotal)}</p>
                        <p className="text-xs text-zinc-500">{saleItems.length} {saleItems.length === 1 ? "item" : "itens"}</p>
                      </div>
                    </div>

                    {/* Lista de itens */}
                    {saleItems.length > 0 ? (
                      <div className="bg-zinc-900 rounded-xl divide-y divide-zinc-800 overflow-hidden">
                        {saleItems.map(item => (
                          <div key={item.id} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <span className="text-xs font-semibold text-white">{item.quantity}x</span>
                              <span className="text-xs text-zinc-300 ml-1.5">{item.products?.name ?? "Produto"}</span>
                              {item.notes && <p className="text-xs text-zinc-500 mt-0.5 ml-5">↳ {item.notes}</p>}
                            </div>
                            <span className="text-xs font-semibold text-zinc-300">{fmt(item.unit_price * item.quantity)}</span>
                          </div>
                        ))}
                        {discountAmt > 0 && (
                          <div className="flex justify-between px-3 py-2 text-xs text-red-400">
                            <span>Desconto</span><span>-{fmt(discountAmt)}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600 text-center py-2">Itens não carregados (venda criada antes da atualização)</p>
                    )}

                    {/* Botão de retomar */}
                    <button onClick={() => loadPendingIntoCart(sale)}
                      className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-black rounded-xl transition-colors flex items-center justify-center gap-2">
                      <ShoppingCart className="w-4 h-4" />
                      Retomar Venda
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {showEditSale && (() => {
        const editTotal = Math.max(0, showEditItems.reduce((s, i) => s + i.unit_price * i.quantity, 0) - Number(showEditSale.discount ?? 0));
        const editCashPaid = editSalePayments.filter(p => p.method === "cash").reduce((s, p) => s + p.amount, 0);
        const editOtherPaid = editSalePayments.filter(p => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
        const editTotalPaid = editCashPaid + editOtherPaid;
        const editChange = Math.max(0, editCashPaid - (editTotal - editOtherPaid));
        const editRemaining = Math.max(0, editTotal - editTotalPaid);
        const editOrderNum = showEditSale.id.slice(-6).toUpperCase();
        const filteredForAdd = products.filter(p =>
          p.is_active && editProductSearch.length >= 1 &&
          p.name.toLowerCase().includes(editProductSearch.toLowerCase())
        );
        return (
          <Modal title={`Editar Venda · #${editOrderNum}`} onClose={() => { setShowEditSale(null); setEditProductSearch(""); setEditCustSearch(""); setEditingItemPriceId(null); }} wide>
            <div className="space-y-4">

              {/* Cabeçalho info */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-violet-600/10 border border-violet-500/20 rounded-xl p-3">
                  <p className="text-xs text-zinc-500 mb-0.5">Total atual</p>
                  <p className="text-sm font-black text-violet-400">{fmt(Math.max(0, editTotal))}</p>
                </div>
                <div className="bg-zinc-950 rounded-xl p-3">
                  <p className="text-xs text-zinc-500 mb-0.5">Status</p>
                  <p className={`text-xs font-semibold ${showEditSale.status === "paid" ? "text-emerald-400" : showEditSale.status === "open" ? "text-amber-400" : "text-red-400"}`}>
                    {showEditSale.status === "paid" ? "Concluída" : showEditSale.status === "open" ? "Pausada" : "Cancelada"}
                  </p>
                </div>
                <div className="bg-zinc-950 rounded-xl p-3">
                  <p className="text-xs text-zinc-500 mb-0.5">Itens</p>
                  <p className="text-sm font-semibold">{showEditItems.length}</p>
                </div>
              </div>

              {/* Cliente editável */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-1.5">Cliente</p>
                <div className="relative">
                  <input
                    placeholder="Buscar cliente..."
                    value={editCustSearch !== "" ? editCustSearch : (editCustomer?.name ?? "")}
                    onChange={e => { setEditCustSearch(e.target.value); }}
                    onFocus={e => setEditCustSearch(e.target.value === (editCustomer?.name ?? "") ? "" : e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                  {editCustSearch.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl max-h-40 overflow-y-auto">
                      {customers.filter(c => c.name.toLowerCase().includes(editCustSearch.toLowerCase())).slice(0, 5).map(c => (
                        <button key={c.id} onClick={() => { setEditCustomer(c); setEditCustSearch(""); }}
                          className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-sm transition-colors border-b border-zinc-800 last:border-0">
                          <span className="font-medium">{c.name}</span>
                          {c.phone && <span className="text-xs text-zinc-500 ml-2">{c.phone}</span>}
                        </button>
                      ))}
                      <button onClick={() => { setEditCustomer(null); setEditCustSearch(""); }}
                        className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-xs text-zinc-500 transition-colors">
                        Sem cliente
                      </button>
                    </div>
                  )}
                </div>
                {editCustomer && (
                  <div className="flex items-center gap-2 mt-1 px-2 py-1 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                    <span className="text-xs text-violet-400 font-medium flex-1">{editCustomer.name}</span>
                    <button onClick={() => setEditCustomer(null)} className="text-zinc-500 hover:text-red-400 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Endereço de entrega editável */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-1.5">Endereço de Entrega</p>
                <input
                  placeholder="Ex: Rua das Flores, 123 — Apto 5"
                  value={editDeliveryAddress}
                  onChange={e => setEditDeliveryAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>

              {/* Itens da venda */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Itens da venda</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {showEditItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.products?.name ?? "Produto"}</p>
                        {editingItemPriceId === item.id ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-zinc-500">R$</span>
                            <input
                              autoFocus
                              type="text" inputMode="decimal"
                              value={editingItemPriceVal}
                              onChange={e => setEditingItemPriceVal(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") confirmEditItemPrice(item); if (e.key === "Escape") { setEditingItemPriceId(null); setEditingItemPriceVal(""); } }}
                              onBlur={() => confirmEditItemPrice(item)}
                              className="w-20 text-xs px-1.5 py-0.5 bg-zinc-800 border border-violet-500 rounded text-white focus:outline-none"
                            />
                            <span className="text-xs text-zinc-500">/ un.</span>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingItemPriceId(item.id); setEditingItemPriceVal(String(item.unit_price)); }}
                            className="text-xs text-zinc-500 hover:text-violet-400 transition-colors text-left mt-0.5">
                            {fmt(item.unit_price)} / un. · <span className="text-white font-semibold">{fmt(item.unit_price * item.quantity)}</span>
                            <span className="ml-1 text-violet-500 opacity-60 text-[10px]">(editar)</span>
                          </button>
                        )}
                      </div>
                      {/* Controles de quantidade */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => updateEditItemQty(item, -1)}
                          className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center justify-center transition-colors">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <button onClick={() => updateEditItemQty(item, 1)}
                          className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center justify-center transition-colors">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <button onClick={() => deleteFromSale(item.id)}
                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-colors flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {showEditItems.length === 0 && (
                    <div className="text-center py-6 text-zinc-600 text-xs">Nenhum item. Adicione produtos abaixo.</div>
                  )}
                </div>
              </div>

              {/* Adicionar produto */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Adicionar produto</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    placeholder="Digite o nome e pressione Enter para adicionar..."
                    value={editProductSearch}
                    onChange={e => setEditProductSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && filteredForAdd.length > 0) {
                        e.preventDefault();
                        addItemToSale(filteredForAdd[0]);
                      }
                    }}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
                {filteredForAdd.length > 0 && (
                  <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                    {filteredForAdd.slice(0, 6).map(p => (
                      <button key={p.id} onClick={() => addItemToSale(p)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-950 hover:bg-violet-600/10 border border-zinc-800 hover:border-violet-500/30 rounded-xl transition-colors text-left">
                        <div>
                          <p className="text-sm font-medium text-white">{p.name}</p>
                          <p className="text-xs text-zinc-500">{fmt(p.sale_price)}</p>
                        </div>
                        <Plus className="w-4 h-4 text-violet-400 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagamentos */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Formas de pagamento</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {(Object.keys(PAYMENT_INFO) as PayMethod[]).map(method => (
                    <button key={method} onClick={() => addEditPayment(method)} disabled={editSalePayments.some(p => p.method === method)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${editSalePayments.some(p => p.method === method) ? PAYMENT_INFO[method].color : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white"}`}>
                      {PAYMENT_INFO[method].icon} {PAYMENT_INFO[method].label}
                    </button>
                  ))}
                </div>
                {editSalePayments.length > 0 && (
                  <div className="space-y-2">
                    {editSalePayments.map(p => (
                      <div key={p.method} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${PAYMENT_INFO[p.method].color}`}>
                        <span className="flex-shrink-0">{PAYMENT_INFO[p.method].icon}</span>
                        <span className="text-xs font-medium flex-1">{PAYMENT_INFO[p.method].label}</span>
                        <input type="text" inputMode="decimal" value={p.amount === 0 ? "" : String(p.amount).replace(".", ",")}
                          onChange={e => updateEditPaymentAmount(p.method, e.target.value)}
                          placeholder="0,00"
                          className="w-24 text-xs px-2 py-1 bg-black/30 border border-white/10 rounded-lg text-right focus:outline-none" />
                        <button onClick={() => removeEditPayment(p.method)} className="text-current opacity-60 hover:opacity-100 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {/* Resumo de pagamento */}
                  <div className="bg-zinc-950 rounded-xl p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-zinc-400"><span>Total da venda</span><span className="font-semibold text-white">{fmt(editTotal)}</span></div>
                    <div className="flex justify-between text-zinc-400"><span>Total pago</span><span className="font-semibold text-white">{fmt(editTotalPaid)}</span></div>
                    {editChange > 0.01 && (
                      <div className="flex justify-between text-emerald-400 font-bold border-t border-zinc-800 pt-1.5">
                        <span>Troco</span><span>{fmt(editChange)}</span>
                      </div>
                    )}
                    {editRemaining > 0.01 && editChange === 0 && (
                      <div className="flex justify-between text-red-400 font-bold border-t border-zinc-800 pt-1.5">
                        <span>Falta pagar</span><span>{fmt(editRemaining)}</span>
                      </div>
                    )}
                  </div>
                  <button onClick={saveEditPayments}
                      className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold rounded-xl transition-colors">
                      Salvar Pagamentos
                    </button>
                  </div>
                )}
              </div>

              {/* Ações */}
              <div className="flex gap-3 pt-1 border-t border-zinc-800">
                <button onClick={() => printSale(showEditSale, showEditItems)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-400 rounded-xl text-sm font-medium transition-colors">
                  <Printer className="w-4 h-4" /> Reimprimir
                </button>
                <button onClick={() => deleteSale(showEditSale.id)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600/10 border border-red-500/20 hover:bg-red-600/20 text-red-400 rounded-xl text-sm font-medium transition-colors">
                  <Trash2 className="w-4 h-4" /> Excluir Venda
                </button>
              </div>

            </div>
          </Modal>
        );
      })()}

      {/* GERENCIADOR DE ATALHOS */}
      {showShortcutManager && (
        <Modal title="Gerenciar Atalhos por Categoria" onClose={() => { setShowShortcutManager(false); setShortcutSearch(""); }} wide>
          <div className="flex gap-4 min-h-[420px]">

            {/* Painel esquerdo — lista de grupos */}
            <div className="w-48 flex-shrink-0 flex flex-col gap-2">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide mb-1">Categorias</p>
              <div className="flex-1 space-y-1 overflow-y-auto">
                {shortcutGroups.map(g => (
                  <button key={g.id} onClick={() => setActiveGroupId(g.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${activeGroupId === g.id ? "bg-violet-600/20 border border-violet-500/40 text-violet-300" : "bg-zinc-800/50 border border-transparent text-zinc-300 hover:bg-zinc-800"}`}>
                    <span className="truncate">{g.name}</span>
                    <span className="text-xs text-zinc-500 flex-shrink-0">{g.productIds.length}</span>
                  </button>
                ))}
                {shortcutGroups.length === 0 && (
                  <p className="text-xs text-zinc-600 px-2 py-3 text-center">Nenhuma categoria ainda</p>
                )}
              </div>
              <button
                onClick={() => {
                  const newGroup: ShortcutGroup = { id: Date.now().toString(), name: "Nova Categoria", productIds: [] };
                  const updated = [...shortcutGroups, newGroup];
                  updateShortcutGroups(updated);
                  setActiveGroupId(newGroup.id);
                }}
                className="w-full py-2 border border-dashed border-zinc-700 rounded-xl text-xs text-violet-400 hover:border-violet-500 hover:text-violet-300 transition-colors">
                + Nova Categoria
              </button>
            </div>

            {/* Painel direito — detalhe do grupo selecionado */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              {!activeGroupId || !shortcutGroups.find(g => g.id === activeGroupId) ? (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
                  Selecione uma categoria à esquerda
                </div>
              ) : (() => {
                const group = shortcutGroups.find(g => g.id === activeGroupId)!;
                return (
                  <>
                    {/* Nome do grupo + deletar */}
                    <div className="flex items-center gap-2">
                      <input
                        value={group.name}
                        onChange={e => {
                          const updated = shortcutGroups.map(g => g.id === activeGroupId ? { ...g, name: e.target.value } : g);
                          updateShortcutGroups(updated);
                        }}
                        className="flex-1 text-sm font-semibold px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-colors"
                      />
                      <button
                        onClick={() => {
                          const updated = shortcutGroups.filter(g => g.id !== activeGroupId);
                          updateShortcutGroups(updated);
                          setActiveGroupId(updated[0]?.id ?? null);
                        }}
                        className="p-2 text-zinc-600 hover:text-red-400 transition-colors border border-zinc-800 rounded-xl">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Busca de produtos */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input placeholder="Buscar produto..." value={shortcutSearch} onChange={e => setShortcutSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500" />
                    </div>

                    {/* Lista de produtos */}
                    <div className="flex-1 space-y-1 overflow-y-auto max-h-64">
                      {products
                        .filter(p => shortcutSearch === "" || p.name.toLowerCase().includes(shortcutSearch.toLowerCase()))
                        .map(p => {
                          const inGroup = group.productIds.includes(p.id);
                          return (
                            <button key={p.id}
                              onClick={() => {
                                const newIds = inGroup
                                  ? group.productIds.filter(id => id !== p.id)
                                  : [...group.productIds, p.id];
                                const updated = shortcutGroups.map(g => g.id === activeGroupId ? { ...g, productIds: newIds } : g);
                                updateShortcutGroups(updated);
                              }}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors text-left ${inGroup ? "bg-violet-600/15 border border-violet-500/30" : "hover:bg-zinc-800 border border-transparent"}`}>
                              {p.image_url
                                ? <img src={p.image_url} alt="" className="w-8 h-8 min-w-[32px] rounded-md object-cover" style={{aspectRatio:"1/1"}} />
                                : <div className="w-8 h-8 min-w-[32px] rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0"><Package className="w-3.5 h-3.5 text-zinc-600" /></div>}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">{p.name}</p>
                                <p className="text-xs text-violet-400">{fmt(p.sale_price)}</p>
                              </div>
                              {inGroup
                                ? <Star className="w-4 h-4 fill-amber-400 text-amber-400 flex-shrink-0" />
                                : <StarOff className="w-4 h-4 text-zinc-600 flex-shrink-0" />}
                            </button>
                          );
                        })}
                    </div>

                    <p className="text-xs text-zinc-600">
                      {group.productIds.length} produto{group.productIds.length !== 1 ? "s" : ""} nesta categoria
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        </Modal>
      )}

      {/* CHECKOUT */}
      {showCheckout && (
        <Modal title="Finalizar Venda" onClose={() => setShowCheckout(false)} wide>
          <div className="space-y-4">

            {/* Canal de origem */}
            <div className="flex items-center gap-3">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide flex-1">Canal</p>
              <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5">
                <button onClick={() => setSaleChannel("pdv")}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${saleChannel === "pdv" ? "" : "text-zinc-400 hover:text-white"}`}
                  style={saleChannel === "pdv" ? { background: "#7B2FBE", color: "#fff" } : {}}>
                  PDV
                </button>
                <button onClick={() => setSaleChannel("ifood")}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${saleChannel === "ifood" ? "bg-red-600" : "text-zinc-400 hover:text-white"}`}
                  style={saleChannel === "ifood" ? { color: "#fff" } : {}}>
                  🛵 iFood
                </button>
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-1.5">
              {cart.map(i => (
                <div key={i.product.id} className="flex justify-between text-sm">
                  <span className="text-zinc-300 truncate mr-2">{i.quantity}x {i.product.name}</span>
                  <span className="text-white flex-shrink-0">{fmt((i.customPrice ?? i.product.sale_price) * i.quantity)}</span>
                </div>
              ))}
              {discountVal > 0 && (
                <div className="flex justify-between text-sm text-red-400 border-t border-zinc-800 pt-1.5"><span>Desconto</span><span>-{fmt(discountVal)}</span></div>
              )}
              <div className="flex justify-between font-bold border-t border-zinc-800 pt-1.5">
                <span className="text-white">Total</span><span className="text-violet-400 text-lg">{fmt(total)}</span>
              </div>
            </div>

            {/* Desconto */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Desconto</p>
                <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5">
                  <button onClick={() => setDiscountType("value")}
                    className={`px-2.5 py-0.5 rounded-md text-xs font-semibold transition-all ${discountType === "value" ? "" : "text-zinc-400 hover:text-white"}`}
                    style={discountType === "value" ? { background: "#7B2FBE", color: "#fff" } : {}}>
                    R$
                  </button>
                  <button onClick={() => {
                    setDiscountType("percent");
                    const pct = discountVal > 0 && subtotal > 0 ? String(Math.round((discountVal / subtotal) * 100)) : "";
                    setDiscountPctRaw(pct);
                  }}
                    className={`px-2.5 py-0.5 rounded-md text-xs font-semibold transition-all ${discountType === "percent" ? "" : "text-zinc-400 hover:text-white"}`}
                    style={discountType === "percent" ? { background: "#7B2FBE", color: "#fff" } : {}}>
                    %
                  </button>
                </div>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">
                  {discountType === "value" ? "R$" : "%"}
                </span>
                <input
                  type="number" min="0"
                  max={discountType === "percent" ? 100 : undefined}
                  step={discountType === "percent" ? 1 : 0.01}
                  value={
                    discountType === "value"
                      ? (discount || "")
                      : discountPctRaw
                  }
                  onChange={e => {
                    if (discountType === "value") {
                      setDiscount(e.target.value);
                    } else {
                      setDiscountPctRaw(e.target.value);
                      const v = parseFloat(e.target.value) || 0;
                      const computed = subtotal * Math.min(v, 100) / 100;
                      setDiscount(computed > 0 ? computed.toFixed(2) : "");
                    }
                  }}
                  placeholder={discountType === "percent" ? "Ex: 10" : "0,00"}
                  className="w-full pl-9 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              {discountType === "percent" && (
                <div className="flex gap-1.5 mt-1.5">
                  {[5, 10, 15, 20].map(pct => (
                    <button key={pct}
                      onClick={() => { setDiscountPctRaw(String(pct)); setDiscount(String((subtotal * pct / 100).toFixed(2))); }}
                      className="flex-1 py-1 text-xs border border-zinc-700 hover:border-violet-500/50 hover:text-violet-400 rounded-lg transition-colors text-zinc-400">
                      {pct}%
                    </button>
                  ))}
                </div>
              )}
              {discountVal > 0 && (
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-zinc-500">Desconto aplicado</span>
                  <span className="text-xs font-bold text-red-400">
                    -{fmt(discountVal)}{subtotal > 0 ? ` (${((discountVal / subtotal) * 100).toFixed(1)}%)` : ""}
                  </span>
                </div>
              )}
            </div>

            {/* Seletor de cliente inline no checkout */}
            <div className="relative">
              <p className="text-xs text-zinc-500 mb-1.5 font-medium uppercase tracking-wide">Cliente</p>

              {/* Botão de seleção / cliente atual */}
              {!showCheckoutCustSearch && (
                <button
                  onClick={() => { setCheckoutCustSearch(""); setShowCheckoutCustSearch(true); }}
                  className="w-full flex items-center gap-2 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-xl px-3 py-2.5 transition-colors text-left">
                  <User className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {selectedCustomer ? (
                      <>
                        <p className="text-xs font-medium text-white truncate">{selectedCustomer.name}</p>
                        <div className="flex items-center gap-3 flex-wrap">
                          {selectedCustomer.balance > 0 && <span className="text-xs text-emerald-400">Saldo: +{fmt(selectedCustomer.balance)}</span>}
                          {(selectedCustomer.fiado_balance ?? 0) > 0 && <span className="text-xs text-red-400">Fiado: {fmt(selectedCustomer.fiado_balance)}</span>}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-zinc-500">Selecionar cliente <span className="text-amber-400">(obrigatório para Fiado)</span></p>
                    )}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                </button>
              )}
              {selectedCustomer && !showCheckoutCustSearch && (
                <button onClick={() => setSelectedCustomer(null)} className="mt-1 text-[10px] text-zinc-600 hover:text-red-400 transition-colors">
                  Remover cliente
                </button>
              )}

              {/* Busca inline de cliente — sobrepõe o checkout sem fechar */}
              {showCheckoutCustSearch && (
                <div className="bg-zinc-900 border border-violet-500/40 rounded-xl overflow-hidden shadow-xl">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
                    <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                    <input
                      autoFocus
                      placeholder="Buscar cliente por nome ou telefone..."
                      value={checkoutCustSearch}
                      onChange={e => setCheckoutCustSearch(e.target.value)}
                      className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
                    />
                    <button onClick={() => setShowCheckoutCustSearch(false)} className="text-zinc-500 hover:text-white transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {customers
                      .filter(c => checkoutCustSearch === "" || c.name.toLowerCase().includes(checkoutCustSearch.toLowerCase()) || (c.phone && c.phone.includes(checkoutCustSearch)))
                      .slice(0, 10)
                      .map(c => (
                        <button key={c.id}
                          onClick={async () => {
                            const { data: fresh } = await supabase.from("customers").select("id,name,phone,address,balance,fiado_balance,credit_limit").eq("id", c.id).single();
                            const customer = (fresh as Customer) ?? c;
                            setSelectedCustomer(customer);
                            setCustomers(prev => prev.map(x => x.id === customer.id ? customer : x));
                            if (customer.address) setDeliveryAddress(customer.address);
                            // Se há saldo restante e fiado ainda não foi adicionado, adiciona automaticamente
                            if (remaining > 0 && !payments.some(p => p.method === "fiado")) {
                              setPayments(prev => [...prev, { method: "fiado", amount: parseFloat(remaining.toFixed(2)) }]);
                            }
                            setShowCheckoutCustSearch(false);
                            setCheckoutCustSearch("");
                          }}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800 transition-colors text-left border-b border-zinc-800/50 last:border-0">
                          <div>
                            <p className="text-sm font-medium text-white">{c.name}</p>
                            {c.phone && <p className="text-xs text-zinc-500">{c.phone}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {(c.fiado_balance ?? 0) > 0 && <p className="text-xs text-red-400">Fiado: {fmt(c.fiado_balance)}</p>}
                            {c.balance > 0 && <p className="text-xs text-emerald-400">Saldo: {fmt(c.balance)}</p>}
                          </div>
                        </button>
                      ))}
                    {customers.filter(c => checkoutCustSearch === "" || c.name.toLowerCase().includes(checkoutCustSearch.toLowerCase()) || (c.phone && c.phone.includes(checkoutCustSearch))).length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-4">Nenhum cliente encontrado</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {checkoutError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl flex gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {checkoutError}
              </div>
            )}

            {/* Fiado limit warning */}
            {selectedCustomer && (selectedCustomer.credit_limit ?? 0) > 0 && payments.some(p => p.method === "fiado") && (() => {
              const fiadoAmt = payments.find(p => p.method === "fiado")?.amount ?? 0;
              const currentFiado = selectedCustomer.fiado_balance ?? 0;
              const limit = selectedCustomer.credit_limit;
              if (currentFiado + fiadoAmt > limit) {
                return (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-red-400">Limite de fiado excedido!</p>
                      <p className="text-xs text-red-400/80 mt-0.5">Em aberto: {fmt(currentFiado)} · Limite: {fmt(limit)} · Disponível: {fmt(Math.max(0, limit - currentFiado))}</p>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            <div>
              <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">Formas de pagamento</p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PAYMENT_INFO) as PayMethod[]).map(method => {
                  const needsCustomer = method === "fiado" || method === "house_credit";
                  const blockedNoCustomer = needsCustomer && !selectedCustomer;
                  const alreadyAdded = payments.some(p => p.method === method);
                  return (
                    <button key={method}
                      onClick={() => addPayment(method)}
                      disabled={alreadyAdded || blockedNoCustomer}
                      title={blockedNoCustomer ? "Selecione um cliente primeiro" : undefined}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${alreadyAdded ? PAYMENT_INFO[method].color : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white"}`}>
                      {PAYMENT_INFO[method].icon} {PAYMENT_INFO[method].label}
                    </button>
                  );
                })}
              </div>
              {!selectedCustomer && (
                <p className="text-[10px] text-zinc-600 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-500/70" />
                  Fiado e Saldo Casa requerem cliente selecionado
                </p>
              )}
            </div>

            {payments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Valores informados</p>
                {payments.map(p => (
                  <div key={p.method} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-2 rounded-xl border flex-shrink-0 w-32 ${PAYMENT_INFO[p.method].color}`}>
                        {PAYMENT_INFO[p.method].icon} {PAYMENT_INFO[p.method].label}
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">R$</span>
                        <input type="text" inputMode="decimal" value={p.amount || ""} onChange={e => updatePaymentAmount(p.method, e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500" />
                      </div>
                      <button onClick={() => removePayment(p.method)} className="text-zinc-600 hover:text-red-400 transition-colors flex-shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                    {/* Botões rápidos só para dinheiro */}
                    {p.method === "cash" && (
                      <div className="flex gap-1.5 pl-34">
                        {[10, 20, 50, 100].map(v => (
                          <button key={v} onClick={() => updatePaymentAmount("cash", String(v))}
                            className="flex-1 py-1 text-xs border border-zinc-700 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg transition-colors text-zinc-400">
                            R${v}
                          </button>
                        ))}
                        <button onClick={() => updatePaymentAmount("cash", remaining.toFixed(2))}
                          className="flex-1 py-1 text-xs border border-zinc-700 hover:border-violet-500/50 hover:text-violet-400 rounded-lg transition-colors text-zinc-400">
                          Exato
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {payments.length > 0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-1.5 text-sm">
                {saleChannel === "ifood" && payments.some(p => p.method === "ifood_receivable") ? (
                  // Resumo iFood: bruto → comissão → líquido
                  <>
                    <div className="flex justify-between text-zinc-400"><span>Valor bruto (pedido)</span><span className="text-white">{fmt(subtotal)}</span></div>
                    {discountVal > 0 && <div className="flex justify-between text-red-400"><span>Comissão iFood</span><span>-{fmt(discountVal)}</span></div>}
                    <div className="flex justify-between font-bold border-t border-zinc-800 pt-1.5"><span className="text-zinc-300">Valor líquido (você recebe)</span><span className="text-emerald-400">{fmt(total)}</span></div>
                  </>
                ) : (
                  // Resumo normal
                  <>
                    <div className="flex justify-between text-zinc-400"><span>Total a pagar</span><span>{fmt(total)}</span></div>
                    <div className="flex justify-between text-zinc-400"><span>Total informado</span><span className={totalPaid >= total ? "text-emerald-400" : "text-amber-400"}>{fmt(totalPaid)}</span></div>
                    {remaining > 0.01 && <div className="flex justify-between text-amber-400 font-semibold border-t border-zinc-800 pt-1.5"><span>Faltam</span><span>{fmt(remaining)}</span></div>}
                    {change > 0.01 && <div className="flex justify-between text-emerald-400 font-bold border-t border-zinc-800 pt-1.5 text-base"><span>Troco</span><span>{fmt(change)}</span></div>}
                  </>
                )}
              </div>
            )}

            <button onClick={confirmSale} disabled={checkoutLoading || payments.length === 0}
              className="w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed font-bold rounded-xl transition-all text-sm"
              style={{ background: "#7B2FBE", color: "#fff", boxShadow: "0 4px 20px rgba(123,47,190,0.45)" }}>
              {checkoutLoading ? "Processando..." : `Confirmar Venda · ${fmt(total)}`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
