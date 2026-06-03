import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Search, Plus, Trash2, Edit2, X, User, Phone, MapPin, Mail,
  Printer, ChevronLeft, Banknote, CreditCard, Smartphone,
  TrendingUp, RefreshCw, Save, DollarSign, ShoppingCart,
  AlertTriangle, CheckCircle2, FileText, Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  fiado_balance: number;
  credit_limit: number;
  created_at: string;
}

interface CustomerMovement {
  id: string;
  customer_id: string;
  type: "debit" | "credit" | "payment" | "saldo";
  amount: number;
  description: string | null;
  sale_id: string | null;
  payment_methods: { method: string; amount: number }[];
  created_at: string;
}

interface SaleItemInfo {
  item_id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
  stock: number;
}

interface CustomerSale {
  id: string;
  created_at: string;
  total: number;
  discount: number;
  status: string;
  origin: string | null;
  seller_name: string | null;
  sale_items: SaleItemInfo[];
}

type PayMethod = "cash" | "credit" | "debit" | "pix" | "fiado";
type DateFilter = "today" | "week" | "month" | "year" | "custom";
type ModalType = "none" | "createEdit" | "addCredit" | "payDebt" | "delete" | "editMovement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const inputCls =
  "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";

const PAY_METHODS: { method: PayMethod; label: string; icon: React.ReactNode; color: string }[] = [
  { method: "cash",   label: "Dinheiro",  icon: <Banknote className="w-4 h-4" />,   color: "border-emerald-500 bg-emerald-500/10 text-emerald-300" },
  { method: "pix",    label: "PIX",       icon: <Smartphone className="w-4 h-4" />, color: "border-violet-500 bg-violet-500/10 text-violet-300" },
  { method: "credit", label: "Crédito",   icon: <CreditCard className="w-4 h-4" />, color: "border-blue-500 bg-blue-500/10 text-blue-300" },
  { method: "debit",  label: "Débito",    icon: <CreditCard className="w-4 h-4" />, color: "border-indigo-400 bg-indigo-500/10 text-indigo-300" },
];

const PAY_LABEL: Record<string, string> = {
  cash: "Dinheiro", pix: "PIX", credit: "Crédito", debit: "Débito", fiado: "Fiado",
};

// Métodos de pagamento para o modal de edição de fiado (inclui opção Fiado)
const EDIT_PAY_METHODS: { method: PayMethod; label: string; icon: React.ReactNode; color: string }[] = [
  { method: "cash",   label: "Dinheiro",  icon: <Banknote className="w-4 h-4" />,       color: "border-emerald-500 bg-emerald-500/10 text-emerald-300" },
  { method: "pix",    label: "PIX",       icon: <Smartphone className="w-4 h-4" />,     color: "border-violet-500 bg-violet-500/10 text-violet-300" },
  { method: "credit", label: "Crédito",   icon: <CreditCard className="w-4 h-4" />,     color: "border-blue-500 bg-blue-500/10 text-blue-300" },
  { method: "debit",  label: "Débito",    icon: <CreditCard className="w-4 h-4" />,     color: "border-indigo-400 bg-indigo-500/10 text-indigo-300" },
  { method: "fiado",  label: "Fiado",     icon: <AlertTriangle className="w-4 h-4" />,  color: "border-red-500 bg-red-500/10 text-red-300" },
];

function getDateRange(filter: DateFilter, from?: string, to?: string) {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (filter === "today") { start.setHours(0, 0, 0, 0); }
  else if (filter === "week") { start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else if (filter === "month") { start.setDate(1); start.setHours(0, 0, 0, 0); }
  else if (filter === "year") { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); }
  else {
    return {
      from: from ? new Date(from + "T00:00:00").toISOString() : new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: to ? new Date(to + "T23:59:59").toISOString() : end.toISOString(),
    };
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustomersPage() {
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

  // Auth
  const [userId, setUserId] = useState<string | null>(null);
  const [cashRegisterId, setCashRegisterId] = useState<string | null>(null);

  // List
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Detail
  const [view, setView] = useState<"list" | "detail">("list");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [movements, setMovements] = useState<CustomerMovement[]>([]);
  const [movLoading, setMovLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Modals
  const [modal, setModal] = useState<ModalType>("none");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  // Form – create/edit
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fLimit, setFLimit] = useState("0");
  const [fBalance, setFBalance] = useState("0");

  // Operation – credit / debit
  const [opAmount, setOpAmount] = useState("");
  const [opDesc, setOpDesc] = useState("");

  // Pay debt checkout
  const [payEntries, setPayEntries] = useState<{ method: PayMethod; amount: number }[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethod>("cash");
  const [payInput, setPayInput] = useState("");

  // Edit movement
  const [editingMovement, setEditingMovement] = useState<CustomerMovement | null>(null);
  const [editPayEntries, setEditPayEntries] = useState<{ method: PayMethod; amount: number }[]>([]);
  const [editPayMethod, setEditPayMethod] = useState<PayMethod>("cash");
  const [editPayInput, setEditPayInput] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaleRecord, setEditSaleRecord] = useState<any | null>(null);
  const [editSaleItems, setEditSaleItems] = useState<any[]>([]);
  const [editItemPriceId, setEditItemPriceId] = useState<string | null>(null);
  const [editItemPriceVal, setEditItemPriceVal] = useState("");
  const [editProductSearch, setEditProductSearch] = useState("");

  // Edit movement – products
  const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail tabs & purchase history
  const [detailTab, setDetailTab] = useState<"movements" | "purchases">("movements");
  const [customerSales, setCustomerSales] = useState<CustomerSale[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [saleItemsMap, setSaleItemsMap] = useState<Record<string, SaleItemInfo[]>>({});

  // Ranking
  const [listView, setListView] = useState<"list" | "ranking">("list");
  const [rankingData, setRankingData] = useState<(Customer & { purchase_count: number; total_spent: number })[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data: reg } = await supabase
          .from("cash_registers")
          .select("id")
          .eq("status", "open")
          .eq("user_id", user.id)
          .maybeSingle();
        setCashRegisterId(reg?.id ?? null);
      }
      loadCustomers();
    }
    init();
  }, []);

  useEffect(() => {
    if (selected) {
      loadMovements(selected.id);
      loadCustomerSales(selected.id);
    }
  }, [selected?.id, dateFilter, customFrom, customTo]);

  async function loadCustomers() {
    setLoading(true);
    const { data, error } = await supabase.from("customers").select("*").order("name");
    if (error) console.error("loadCustomers error:", error);
    setCustomers((data ?? []) as Customer[]);
    setLoading(false);
  }

  async function loadMovements(customerId: string) {
    setMovLoading(true);
    const range = getDateRange(dateFilter, customFrom, customTo);
    const { data } = await supabase
      .from("customer_movements")
      .select("*")
      .eq("customer_id", customerId)
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false });
    const movs = (data ?? []) as CustomerMovement[];
    setMovements(movs);

    const saleIds = movs.map(m => m.sale_id).filter(Boolean) as string[];
    if (saleIds.length > 0) {
      const { data: items } = await supabase
        .from("sale_items")
        .select("id, sale_id, product_id, quantity, unit_price, notes, products(name)")
        .in("sale_id", saleIds);
      const map: Record<string, SaleItemInfo[]> = {};
      for (const item of items ?? []) {
        if (!map[(item as any).sale_id]) map[(item as any).sale_id] = [];
        map[(item as any).sale_id].push({
          item_id: (item as any).id,
          product_id: (item as any).product_id,
          name: (item as any).products?.name ?? "Produto",
          quantity: (item as any).quantity,
          unit_price: (item as any).unit_price,
          notes: (item as any).notes,
        });
      }
      setSaleItemsMap(map);
    } else {
      setSaleItemsMap({});
    }
    setMovLoading(false);
  }

  async function loadCustomerSales(customerId: string) {
    setSalesLoading(true);
    const range = getDateRange(dateFilter, customFrom, customTo);
    const { data } = await supabase
      .from("sales")
      .select("id, created_at, total, discount, status, origin, seller_name, sale_items(quantity, unit_price, notes, products(name))")
      .eq("customer_id", customerId)
      .eq("status", "paid")
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false });
    setCustomerSales(((data ?? []) as any[]).map(s => ({
      ...s,
      sale_items: (s.sale_items ?? []).map((i: any) => ({
        name: i.products?.name ?? "Produto",
        quantity: i.quantity,
        unit_price: i.unit_price,
        notes: i.notes,
      })),
    })));
    setSalesLoading(false);
  }

  async function loadRanking() {
    setRankingLoading(true);
    const { data: sales } = await supabase
      .from("sales")
      .select("customer_id, total")
      .eq("status", "paid")
      .not("customer_id", "is", null);
    const map: Record<string, { count: number; total: number }> = {};
    for (const s of sales ?? []) {
      if (!map[s.customer_id]) map[s.customer_id] = { count: 0, total: 0 };
      map[s.customer_id].count++;
      map[s.customer_id].total += Number(s.total) || 0;
    }
    const ranked = customers
      .map(c => ({ ...c, purchase_count: map[c.id]?.count ?? 0, total_spent: map[c.id]?.total ?? 0 }))
      .sort((a, b) => b.total_spent - a.total_spent);
    setRankingData(ranked);
    setRankingLoading(false);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function openDetail(c: Customer) {
    setSelected(c);
    setView("detail");
  }

  function closeDetail() {
    setView("list");
    setSelected(null);
    setMovements([]);
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setFName(""); setFPhone(""); setFEmail(""); setFAddress(""); setFNotes(""); setFLimit("0"); setFBalance("0");
    setModal("createEdit");
  }

  function openEdit(c: Customer, e?: React.MouseEvent) {
    e?.stopPropagation();
    setEditing(c);
    setFormError(null);
    setFName(c.name); setFPhone(c.phone ?? ""); setFEmail(c.email ?? "");
    setFAddress(c.address ?? ""); setFNotes(c.notes ?? ""); setFLimit(String(c.credit_limit ?? 0));
    setFBalance("0");
    setModal("createEdit");
  }

  async function saveCustomer() {
    if (!fName.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    const initialBalance = parseFloat(fBalance.replace(",", ".")) || 0;
    const payload = {
      name: fName.trim(), phone: fPhone || null, email: fEmail || null,
      address: fAddress || null, notes: fNotes || null,
      credit_limit: parseFloat(fLimit.replace(",", ".")) || 0,
    };
    if (editing) {
      const { error } = await supabase.from("customers").update(payload).eq("id", editing.id);
      if (error) { setFormError("Erro ao salvar: " + error.message); setSaving(false); return; }
    } else {
      const { data: created, error } = await supabase
        .from("customers")
        .insert({ ...payload, balance: initialBalance })
        .select("id")
        .single();
      if (error || !created) {
        setFormError("Erro ao cadastrar: " + (error?.message ?? "desconhecido"));
        setSaving(false);
        return;
      }
      // Registrar saldo inicial como movimento se > 0
      if (initialBalance !== 0) {
        await supabase.from("customer_movements").insert({
          customer_id: created.id, user_id: userId,
          type: initialBalance > 0 ? "credit" : "debit",
          amount: Math.abs(initialBalance),
          description: "Saldo inicial",
          payment_methods: [],
        });
      }
    }
    await loadCustomers();
    if (selected && editing?.id === selected.id) {
      const { data } = await supabase.from("customers").select("*").eq("id", editing.id).single();
      if (data) setSelected(data as Customer);
    }
    setSaving(false);
    setModal("none");
  }

  async function confirmDelete() {
    if (!deleteTarget || saving) return;
    setSaving(true);
    await supabase.from("customers").delete().eq("id", deleteTarget.id);
    if (selected?.id === deleteTarget.id) closeDetail();
    await loadCustomers();
    setDeleteTarget(null);
    setSaving(false);
    setModal("none");
  }

  // ── Balance ops ─────────────────────────────────────────────────────────────

  async function refreshSelected(id: string) {
    const { data } = await supabase.from("customers").select("*").eq("id", id).single();
    if (data) {
      setSelected(data as Customer);
      setCustomers(prev => prev.map(c => c.id === id ? data as Customer : c));
    }
  }

  async function addCredit() {
    if (!selected || saving) return;
    const amount = parseFloat(opAmount.replace(",", "."));
    if (isNaN(amount) || amount <= 0) return;
    setSaving(true);

    const { data: curr } = await supabase.from("customers").select("balance").eq("id", selected.id).single();
    const newBalance = (curr?.balance ?? 0) + amount;

    await supabase.from("customer_movements").insert({
      customer_id: selected.id, user_id: userId, type: "credit", amount,
      description: opDesc || "Saldo adicionado", payment_methods: [],
    });
    await supabase.from("customers").update({ balance: newBalance }).eq("id", selected.id);

    if (cashRegisterId && userId) {
      await supabase.from("cash_movements").insert({
        register_id: cashRegisterId, user_id: userId,
        movement_type: "sale", amount, payment_method: "cash", channel: "pdv",
        description: `Saldo: ${selected.name}`,
      });
    }

    await refreshSelected(selected.id);
    await loadMovements(selected.id);
    setOpAmount(""); setOpDesc("");
    setSaving(false);
    setModal("none");
  }

  function addPayEntry() {
    const amt = parseFloat(payInput.replace(",", "."));
    if (isNaN(amt) || amt <= 0) return;
    if (payEntries.some(e => e.method === payMethod)) {
      setPayEntries(prev => prev.map(e => e.method === payMethod ? { ...e, amount: amt } : e));
    } else {
      setPayEntries(prev => [...prev, { method: payMethod, amount: amt }]);
    }
    setPayInput("");
  }

  async function payDebt() {
    if (!selected || payEntries.length === 0 || saving || selected.fiado_balance <= 0) return;
    setSaving(true);
    try {
      const totalPaid = payEntries.reduce((s, e) => s + e.amount, 0);

      const { data: curr } = await supabase.from("customers").select("fiado_balance").eq("id", selected.id).single();
      const newFiado = Math.max(0, (curr?.fiado_balance ?? 0) - totalPaid);

      const { error: movErr } = await supabase.from("customer_movements").insert({
        customer_id: selected.id, user_id: userId, type: "payment", amount: totalPaid,
        description: "Pagamento de fiado", payment_methods: payEntries,
      });
      if (movErr) throw movErr;

      await supabase.from("customers").update({ fiado_balance: newFiado }).eq("id", selected.id);

      if (cashRegisterId && userId) {
        for (const p of payEntries) {
          await supabase.from("cash_movements").insert({
            register_id: cashRegisterId, user_id: userId,
            movement_type: "sale", amount: p.amount,
            payment_method: p.method, channel: "pdv",
            description: `Pgto fiado - ${selected.name}`,
          });
        }
      }

      await refreshSelected(selected.id);
      await loadMovements(selected.id);
      setPayEntries([]);
      setPayInput("");
      setModal("none");
    } catch (e: any) {
      console.error("payDebt error:", e);
      alert("Erro ao registrar pagamento: " + (e?.message ?? String(e)));
    } finally {
      setSaving(false);
    }
  }

  // ── Edit movement ───────────────────────────────────────────────────────────

  async function openEditMovement(m: CustomerMovement) {
    setEditingMovement(m);
    setEditDesc(m.description ?? "");
    setEditPayEntries((m.payment_methods ?? []).map(p => ({ method: p.method as PayMethod, amount: p.amount })));
    setEditPayMethod("cash");
    setEditPayInput("");
    setEditSaleRecord(null);
    setEditSaleItems([]);
    setEditItemPriceId(null);
    setEditItemPriceVal("");
    setEditProductSearch("");
    setShowProductPicker(false);

    if (m.type === "debit" && m.sale_id) {
      // Busca o sale completo
      const { data: sale } = await supabase.from("sales").select("*").eq("id", m.sale_id).single();
      if (sale) {
        setEditSaleRecord(sale);
        const { data: items } = await supabase
          .from("sale_items").select("*, products(name)").eq("sale_id", m.sale_id);
        setEditSaleItems(items ?? []);
        // Preenche payments do sale (não do customer_movement)
        setEditPayEntries((sale.payments ?? []).map((p: any) => ({ method: p.method as PayMethod, amount: p.amount })));
      }
      // Sempre recarrega produtos frescos (igual ao PDV)
      const { data: prods } = await supabase.from("products").select("*").neq("is_active", false).order("name");
      setAllProducts((prods ?? []) as any[]);
    }

    setModal("editMovement");
  }

  function addEditPayEntry() {
    const amt = parseFloat(editPayInput.replace(",", "."));
    if (isNaN(amt) || amt <= 0) return;
    setEditPayEntries(prev => {
      // Ao adicionar método não-fiado, remove fiado automaticamente (fiado = crédito, não pagamento)
      const base = editPayMethod !== "fiado" ? prev.filter(e => e.method !== "fiado") : prev;
      if (base.some(e => e.method === editPayMethod)) {
        return base.map(e => e.method === editPayMethod ? { ...e, amount: amt } : e);
      }
      return [...base, { method: editPayMethod, amount: amt }];
    });
    setEditPayInput("");
  }

  async function editAddItemToSale(product: ProductOption) {
    if (!editSaleRecord) return;
    const existing = editSaleItems.find((i: any) => i.product_id === product.id);
    if (existing) {
      const newQty = existing.quantity + 1;
      await supabase.from("sale_items").update({ quantity: newQty, total_price: existing.unit_price * newQty }).eq("id", existing.id);
      setEditSaleItems(prev => prev.map((i: any) => i.id === existing.id ? { ...i, quantity: newQty, total_price: existing.unit_price * newQty } : i));
    } else {
      const price = (product as any).sale_price ?? product.price;
      const { data } = await supabase.from("sale_items").insert({
        sale_id: editSaleRecord.id, product_id: product.id,
        quantity: 1, unit_price: price, total_price: price, notes: null,
      }).select("*, products(name)").single();
      if (data) setEditSaleItems(prev => [...prev, data]);
    }
    setEditProductSearch("");
    setShowProductPicker(false);
  }

  async function editUpdateItemQty(item: any, delta: number) {
    const newQty = Math.max(1, item.quantity + delta);
    await supabase.from("sale_items").update({ quantity: newQty, total_price: item.unit_price * newQty }).eq("id", item.id);
    setEditSaleItems(prev => prev.map((i: any) => i.id === item.id ? { ...i, quantity: newQty, total_price: item.unit_price * newQty } : i));
  }

  async function editConfirmItemPrice(item: any) {
    const newPrice = parseFloat(editItemPriceVal.replace(",", ".")) || 0;
    await supabase.from("sale_items").update({ unit_price: newPrice, total_price: newPrice * item.quantity }).eq("id", item.id);
    setEditSaleItems(prev => prev.map((i: any) => i.id === item.id ? { ...i, unit_price: newPrice, total_price: newPrice * item.quantity } : i));
    setEditItemPriceId(null);
    setEditItemPriceVal("");
  }

  async function editDeleteItem(itemId: string) {
    await supabase.from("sale_items").delete().eq("id", itemId);
    setEditSaleItems(prev => prev.filter((i: any) => i.id !== itemId));
  }

  async function saveMovementEdit() {
    if (!editingMovement || !selected || saving) return;
    setSaving(true);
    try {
      if (editingMovement.type === "payment") {
        // ── Modo simples: só atualiza forma de pagamento ──
        if (editPayEntries.length === 0) throw new Error("Adicione pelo menos uma forma de pagamento.");
        const { error, data: rows } = await supabase
          .from("customer_movements")
          .update({ payment_methods: editPayEntries, description: editDesc.trim() || null })
          .eq("id", editingMovement.id).select();
        if (error) throw error;
        if (!rows || rows.length === 0)
          throw new Error("Sem permissão UPDATE. Execute no Supabase SQL Editor:\nCREATE POLICY \"edit own movements\" ON customer_movements FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());");

        // Atualiza cash_movements
        const movDate = new Date(editingMovement.created_at);
        const fromDate = new Date(movDate.getTime() - 120000).toISOString();
        const toDate   = new Date(movDate.getTime() + 120000).toISOString();
        const cashDesc = `Pgto fiado - ${selected.name}`;
        const { data: existingCash } = await supabase.from("cash_movements")
          .select("register_id, user_id").eq("description", cashDesc).eq("user_id", userId)
          .gte("created_at", fromDate).lte("created_at", toDate).limit(1);
        if (existingCash && existingCash.length > 0) {
          const { register_id: regId, user_id: uId } = existingCash[0] as any;
          await supabase.from("cash_movements").delete().eq("description", cashDesc).eq("user_id", userId)
            .gte("created_at", fromDate).lte("created_at", toDate);
          for (const p of editPayEntries) {
            await supabase.from("cash_movements").insert({
              register_id: regId, user_id: uId, movement_type: "sale",
              amount: p.amount, payment_method: p.method, channel: "pdv", description: cashDesc,
            });
          }
        }

      } else if (editingMovement.type === "debit" && editSaleRecord) {
        // ── Modo completo: atualiza venda + itens + estoque + caixa ──
        const saleId = editSaleRecord.id;
        const orderNum = saleId.slice(-6).toUpperCase();
        const newTotal = editSaleItems.reduce((s: number, i: any) => s + i.unit_price * i.quantity, 0);

        // Usa os payments exatamente como o usuário definiu (sem auto-ajuste que zeraria entradas)
        const paymentsSnapshot = editPayEntries.filter(p => p.amount > 0);
        const { error: saleErr, data: saleRows } = await supabase
          .from("sales")
          .update({ payments: paymentsSnapshot, total: newTotal, total_amount: newTotal })
          .eq("id", saleId)
          .select("id");
        if (saleErr) throw saleErr;
        if (!saleRows || saleRows.length === 0)
          throw new Error("Sem permissão para atualizar a venda. Verifique as políticas RLS da tabela 'sales' no Supabase.");

        // Re-busca caixa aberto no momento do save (cashRegisterId pode estar desatualizado)
        const { data: freshReg } = await supabase.from("cash_registers")
          .select("id").eq("user_id", userId).eq("status", "open").maybeSingle();
        const freshRegId = (freshReg as any)?.id ?? cashRegisterId;

        // Busca register_id original da venda para manter no caixa correto
        const { data: origCash } = await supabase
          .from("cash_movements").select("register_id, user_id")
          .eq("movement_type", "sale").eq("user_id", userId)
          .like("description", `%#${orderNum}%`).limit(1);
        const regId = (origCash?.[0] as any)?.register_id ?? freshRegId;

        // Delete antigos e reinsere com a forma de pagamento atualizada
        await supabase.from("cash_movements").delete()
          .eq("movement_type", "sale").eq("user_id", userId)
          .like("description", `%#${orderNum}%`);
        if (regId && userId) {
          for (const p of paymentsSnapshot.filter(p => p.amount > 0)) {
            const cashDescription =
              p.method === "fiado"       ? `Fiado - Venda #${orderNum} · ${selected.name}` :
              p.method === "house_credit"? `Saldo Cliente - Venda #${orderNum} · ${selected.name}` :
                                          `Venda #${orderNum}`;
            await supabase.from("cash_movements").insert({
              register_id: regId, user_id: userId,
              movement_type: "sale", amount: p.amount, payment_method: p.method,
              channel: "pdv", description: cashDescription,
            });
          }
        }

        // ── Sincroniza customer_movements (igual ao PDV saveEditPayments) ──
        const newFiadoAmt = paymentsSnapshot
          .filter(p => p.method === "fiado" && p.amount > 0)
          .reduce((s, p) => s + p.amount, 0);

        // Pega o valor antigo de fiado nesta venda
        const { data: oldMov } = await supabase.from("customer_movements")
          .select("amount, type").eq("sale_id", saleId);
        const oldFiadoAmt = (oldMov ?? [])
          .filter((m: any) => m.type === "debit")
          .reduce((s: number, m: any) => s + m.amount, 0);

        // Apaga todos os movimentos desta venda e recria só se ainda for fiado
        await supabase.from("customer_movements").delete().eq("sale_id", saleId);

        // Ajusta fiado_balance pelo delta
        if (oldFiadoAmt !== newFiadoAmt) {
          const { data: curr } = await supabase.from("customers").select("fiado_balance").eq("id", selected.id).single();
          const newBal = Math.max(0, (curr as any)?.fiado_balance - oldFiadoAmt + newFiadoAmt);
          await supabase.from("customers").update({ fiado_balance: newBal }).eq("id", selected.id);
        }

        // Reinsere movimento de débito somente se ainda for fiado
        if (newFiadoAmt > 0) {
          await supabase.from("customer_movements").insert({
            customer_id: selected.id, user_id: userId,
            type: "debit", amount: newFiadoAmt,
            description: editDesc.trim() || `Fiado - Venda #${orderNum}`,
            sale_id: saleId, payment_methods: [],
          });
        }
      }

      await refreshSelected(selected.id);
      await loadMovements(selected.id);
      setModal("none");
      setEditingMovement(null);
    } catch (e: any) {
      alert("Erro ao editar: " + (e?.message ?? String(e)));
    } finally {
      setSaving(false);
    }
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function printHistory() {
    if (!selected) return;
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    const isSaldoMovPrint = (m: CustomerMovement) =>
      m.type === "saldo" || (m.type === "debit" && (m.description ?? "").toLowerCase().startsWith("saldo usado"));
    const totalDebit = movements.filter(m => m.type === "debit" && !isSaldoMovPrint(m)).reduce((s, m) => s + m.amount, 0);
    const totalPos = movements.filter(m => m.type === "credit" || m.type === "payment").reduce((s, m) => s + m.amount, 0);
    const filterLabel: Record<DateFilter, string> = {
      today: "Hoje", week: "Últimos 7 dias", month: "Este mês", year: "Este ano",
      custom: `${customFrom || "?"} a ${customTo || "?"}`,
    };
    const rows = movements.map(m => {
      const isSaldoPrint = m.type === "saldo" || (m.type === "debit" && (m.description ?? "").toLowerCase().startsWith("saldo usado"));
      const effType = isSaldoPrint ? "saldo" : m.type;
      const isPos = effType === "credit" || effType === "payment";
      const tl = { debit: "Fiado / Débito", credit: "Crédito / Saldo", payment: "Pagamento", saldo: "Saldo Usado" }[effType] ?? effType;
      const amtColor = effType === "saldo" ? "#0d9488" : isPos ? "#059669" : "#dc2626";
      const methods = (m.payment_methods ?? []).map(p => PAY_LABEL[p.method] ?? p.method).join(", ") || "—";
      const items = m.sale_id ? (saleItemsMap[m.sale_id] ?? []) : [];
      const itemsRow = items.length > 0
        ? `<tr><td colspan="5" style="padding:2px 10px 8px;background:#f9fafb;border-bottom:1px solid #e5e7eb">
            <div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Itens consumidos</div>
            ${items.map(item =>
              `<div style="display:flex;justify-content:space-between;font-size:11px;padding:1.5px 0">
                <span style="color:#374151">${item.quantity}x ${item.name}${item.notes ? ` <span style="color:#9ca3af">(${item.notes})</span>` : ""}</span>
                <span style="color:#374151;font-weight:600">${fmt(item.unit_price * item.quantity)}</span>
              </div>`
            ).join("")}
          </td></tr>`
        : "";
      return `<tr style="border-bottom:${items.length === 0 ? "1px solid #e5e7eb" : "none"}">
        <td style="padding:8px 10px;font-size:11px;color:#6b7280">${new Date(m.created_at).toLocaleString("pt-BR")}</td>
        <td style="padding:8px 10px;font-size:11px;font-weight:700;color:${amtColor}">${tl}</td>
        <td style="padding:8px 10px;font-size:11px">${m.description || "—"}</td>
        <td style="padding:8px 10px;font-size:11px;color:#6b7280">${methods}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:700;text-align:right;color:${amtColor}">${isPos ? "+" : "-"}${fmt(m.amount)}</td>
      </tr>${itemsRow}`;
    }).join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Extrato - ${selected.name}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:24px;max-width:780px;margin:0 auto}
    table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#f3f4f6;padding:8px 10px;font-size:10px;text-align:left;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;border-bottom:2px solid #d1d5db}
    .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0}.card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px}
    .cl{font-size:10px;text-transform:uppercase;color:#6b7280;margin-bottom:4px}.cv{font-size:18px;font-weight:900}
    @media print{button{display:none!important}}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:20px">
      <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:4px">Extrato do Cliente</div>
        <div style="font-size:22px;font-weight:900">${selected.name}</div>
        ${selected.phone ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">${selected.phone}</div>` : ""}
        ${selected.address ? `<div style="font-size:12px;color:#6b7280">${selected.address}</div>` : ""}
      </div>
      <div style="text-align:right"><div style="font-size:11px;color:#6b7280">Período: ${filterLabel[dateFilter]}</div>
        <div style="font-size:11px;color:#6b7280">Emitido: ${new Date().toLocaleString("pt-BR")}</div>
        <div style="font-size:14px;font-weight:700;margin-top:8px">Saldo: <span style="color:${selected.balance > 0 ? "#059669" : "#6b7280"}">${fmt(selected.balance)}</span>${(selected.fiado_balance ?? 0) > 0 ? ` · Fiado: <span style="color:#dc2626">${fmt(selected.fiado_balance)}</span>` : ""}</div>
      </div>
    </div>
    <div class="grid">
      <div class="card"><div class="cl">Débitos / Fiado</div><div class="cv" style="color:#dc2626">-${fmt(totalDebit)}</div></div>
      <div class="card"><div class="cl">Pagamentos / Créditos</div><div class="cv" style="color:#059669">+${fmt(totalPos)}</div></div>
      <div class="card"><div class="cl">Saldo do período</div><div class="cv" style="color:${totalPos - totalDebit >= 0 ? "#7c3aed" : "#dc2626"}">${totalPos - totalDebit >= 0 ? "+" : ""}${fmt(totalPos - totalDebit)}</div></div>
    </div>
    ${movements.length === 0 ? '<p style="text-align:center;color:#9ca3af;padding:40px 0">Nenhuma movimentação no período selecionado</p>' : `
    <table><thead><tr><th>Data/Hora</th><th>Tipo</th><th>Descrição</th><th>Formas de Pag.</th><th style="text-align:right">Valor</th></tr></thead>
    <tbody>${rows}</tbody></table>`}
    <div style="margin-top:24px;text-align:center">
      <button onclick="window.print()" style="background:#7c3aed;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">Imprimir</button>
    </div></body></html>`);
    win.document.close();
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filtered = customers.filter(c =>
    search === "" ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  );

  const totalPaid = payEntries.reduce((s, e) => s + e.amount, 0);
  const debtAmt = selected ? (selected.fiado_balance ?? 0) : 0;
  const remaining = Math.max(0, debtAmt - totalPaid);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const DATE_TABS: { key: DateFilter; label: string }[] = [
    { key: "today", label: "Hoje" },
    { key: "week", label: "7 dias" },
    { key: "month", label: "Mês" },
    { key: "year", label: "Ano" },
    { key: "custom", label: "Personalizado" },
  ];

  const isSaldoMov = (m: CustomerMovement) =>
    m.type === "saldo" || (m.type === "debit" && (m.description ?? "").toLowerCase().startsWith("saldo usado"));
  const totalDebits = movements.filter(m => m.type === "debit" && !isSaldoMov(m)).reduce((s, m) => s + m.amount, 0);
  const totalPositive = movements.filter(m => m.type === "credit" || m.type === "payment").reduce((s, m) => s + m.amount, 0);

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <>
      {/* ── LIST VIEW ── */}
      {view === "list" && (
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-2xl p-5"
            style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
              backgroundImage:"radial-gradient(rgba(217,70,239,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
            <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-900/10 to-transparent pointer-events-none" />
            <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{background:"#d946ef",boxShadow:"0 0 6px #d946ef"}} />
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#d946ef"}}>CRM</span>
              </div>
              <h1 className="text-2xl font-black g-text g-text-pink">
                Clientes
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">{customers.length} clientes cadastrados</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-xl p-1 gap-1" style={{ background: card.bg, border: card.border }}>
                <button onClick={() => setListView("list")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${listView === "list" ? (isLight ? "bg-pink-600" : "bg-violet-600 text-white") : (isLight ? "text-gray-500 hover:text-gray-900" : "text-zinc-400 hover:text-white")}`}
                  style={listView === "list" && isLight ? { color: "#ffffff" } : undefined}>
                  Lista
                </button>
                <button onClick={() => { setListView("ranking"); loadRanking(); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${listView === "ranking" ? (isLight ? "bg-pink-600" : "bg-violet-600 text-white") : (isLight ? "text-gray-500 hover:text-gray-900" : "text-zinc-400 hover:text-white")}`}
                  style={listView === "ranking" && isLight ? { color: "#ffffff" } : undefined}>
                  Ranking
                </button>
              </div>
              <button onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{background:"linear-gradient(135deg,#a21caf,#d946ef)",color:"#fff",boxShadow:"0 0 16px rgba(217,70,239,0.35)"}}>
                <Plus className="w-4 h-4" /> Novo Cliente
              </button>
            </div>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou e-mail..."
              style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-all" />
          </div>

          {listView === "ranking" && (
            <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold">Ranking por Total Gasto</h2>
              </div>
              {rankingLoading ? (
                <div className="flex justify-center py-10"><RefreshCw className="w-4 h-4 animate-spin text-violet-400" /></div>
              ) : rankingData.length === 0 ? (
                <div className="text-center py-10 text-xs text-zinc-600">Nenhuma venda vinculada a clientes ainda.</div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {rankingData.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 cursor-pointer transition-colors" onClick={() => openDetail(c)}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${i === 0 ? "bg-amber-400 text-black" : i === 1 ? "bg-zinc-400 text-black" : i === 2 ? "bg-amber-700 text-white" : "bg-zinc-800 text-zinc-400"}`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                        <p className="text-xs text-zinc-500">{c.purchase_count} compra{c.purchase_count !== 1 ? "s" : ""}{c.phone ? ` · ${c.phone}` : ""}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-violet-400">{fmt(c.total_spent)}</p>
                        <p className="text-xs text-zinc-500">total gasto</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {listView === "list" && loading && (
            <div className="flex justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-violet-400" /></div>
          )}
          {listView === "list" && !loading && filtered.length === 0 && (
            <div className="text-center py-16 border border-dashed border-zinc-800 rounded-2xl">
              <User className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">{search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado ainda"}</p>
              {!search && (
                <button onClick={openCreate} className="mt-4 text-violet-400 text-sm hover:underline">
                  Cadastrar primeiro cliente
                </button>
              )}
            </div>
          )}
          {listView === "list" && !loading && filtered.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <div className={`hidden sm:grid grid-cols-[1fr_150px_180px_80px] gap-x-3 px-4 py-2.5 border-b text-xs font-medium ${isLight ? "border-gray-100 text-gray-400" : "border-zinc-800 text-zinc-500"}`}>
                <span>Cliente</span>
                <span>Telefone</span>
                <span className="text-right">Situação Financeira</span>
                <span />
              </div>
              <div className={isLight ? "p-2 flex flex-col gap-1" : "divide-y divide-zinc-800"}>
                {filtered.map(c => {
                  const hasDebt = (c.fiado_balance ?? 0) > 0;
                  const hasCredit = c.balance > 0;
                  return (
                    <div key={c.id}
                      className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_150px_180px_80px] gap-x-3 px-4 py-3 items-center cursor-pointer transition-colors ${isLight ? "rounded-xl hover:bg-gray-50" : "hover:bg-zinc-800/40"}`}
                      onClick={() => openDetail(c)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${hasDebt ? "bg-red-500/20 border border-red-500/30 text-red-400" : "bg-violet-600/20 border border-violet-500/20 text-violet-400"}`}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium truncate ${isLight ? "text-gray-900" : "text-white"}`}>{c.name}</p>
                            {hasDebt && <span className="text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-md flex-shrink-0">DEVENDO</span>}
                          </div>
                          {c.phone && <p className="text-xs text-zinc-500 sm:hidden">{c.phone}</p>}
                          {c.email && !c.phone && <p className="text-xs text-zinc-500 truncate">{c.email}</p>}
                        </div>
                      </div>
                      <span className="hidden sm:block text-sm text-zinc-400 truncate">{c.phone ?? "—"}</span>
                      <div className="hidden sm:flex flex-col items-end">
                        {hasDebt && (
                          <>
                            <span className="text-sm font-bold text-red-400">Fiado: {fmt(c.fiado_balance)}</span>
                            {hasCredit && <span className="text-xs text-emerald-400">Saldo: +{fmt(c.balance)}</span>}
                            {c.credit_limit > 0 && <span className="text-xs text-zinc-600">Limite: {fmt(c.credit_limit)}</span>}
                          </>
                        )}
                        {!hasDebt && hasCredit && (
                          <>
                            <span className="text-sm font-bold text-emerald-400">+{fmt(c.balance)}</span>
                            <span className="text-xs text-zinc-500">saldo disponível</span>
                          </>
                        )}
                        {!hasDebt && !hasCredit && <span className="text-sm text-zinc-600">—</span>}
                      </div>
                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        {hasDebt && <span className="sm:hidden text-xs font-bold text-red-400 mr-1">{fmt(c.fiado_balance)}</span>}
                        {!hasDebt && hasCredit && <span className="sm:hidden text-xs font-bold text-emerald-400 mr-1">+{fmt(c.balance)}</span>}
                        <button onClick={e => openEdit(c, e)}
                          className="p-1.5 text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setDeleteTarget(c); setModal("delete"); }}
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL VIEW ── */}
      {view === "detail" && selected && (
        <div className="space-y-5 max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button onClick={closeDetail}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate">{selected.name}</h1>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {selected.phone && <span className="flex items-center gap-1 text-xs text-zinc-400"><Phone className="w-3 h-3" />{selected.phone}</span>}
                {selected.email && <span className="flex items-center gap-1 text-xs text-zinc-400"><Mail className="w-3 h-3" />{selected.email}</span>}
                {selected.address && <span className="flex items-center gap-1 text-xs text-zinc-400"><MapPin className="w-3 h-3" />{selected.address}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => openEdit(selected)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 rounded-xl text-xs transition-colors">
                <Edit2 className="w-3.5 h-3.5" /> Editar
              </button>
              <button onClick={() => { setDeleteTarget(selected); setModal("delete"); }}
                className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Balance + actions row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Balance cards */}
            <div className="sm:col-span-1 space-y-3">
              {/* Saldo pré-pago */}
              <div className={`rounded-2xl p-4 border ${selected.balance > 0 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-zinc-900 border-zinc-800"}`}>
                <p className="text-xs font-medium text-zinc-400 mb-1">Saldo pré-pago</p>
                <p className={`text-2xl font-black ${selected.balance > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                  {selected.balance > 0 ? "+" : ""}{fmt(selected.balance)}
                </p>
                {selected.balance > 0 && <p className="text-xs text-emerald-400 mt-0.5">Disponível para abater</p>}
              </div>
              {/* Dívida fiado */}
              <div className={`rounded-2xl p-4 border ${(selected.fiado_balance ?? 0) > 0 ? "bg-red-500/10 border-red-500/20" : "bg-zinc-900 border-zinc-800"}`}>
                <p className="text-xs font-medium text-zinc-400 mb-1">Fiado em aberto</p>
                <p className={`text-2xl font-black ${(selected.fiado_balance ?? 0) > 0 ? "text-red-400" : "text-zinc-500"}`}>
                  {fmt(selected.fiado_balance ?? 0)}
                </p>
                {(selected.fiado_balance ?? 0) > 0 && <p className="text-xs text-red-400 mt-0.5">Aguardando pagamento</p>}
                {selected.credit_limit > 0 && <p className="text-xs text-zinc-500 mt-0.5">Limite: {fmt(selected.credit_limit)}</p>}
              </div>
            </div>

            {/* Action buttons */}
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => { setOpAmount(""); setOpDesc(""); setModal("addCredit"); }}
                className="flex flex-col items-center justify-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 rounded-2xl transition-colors text-emerald-400">
                <TrendingUp className="w-6 h-6" />
                <div className="text-center">
                  <p className="text-sm font-semibold">Adicionar Saldo</p>
                  <p className="text-xs text-emerald-400/60">Pré-pago / crédito</p>
                </div>
              </button>
              <button onClick={() => { setPayEntries([]); const d = selected.fiado_balance ?? 0; setPayInput(d > 0 ? d.toFixed(2) : ""); setModal("payDebt"); }}
                className="flex flex-col items-center justify-center gap-2 p-4 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 rounded-2xl transition-colors text-violet-400">
                <DollarSign className="w-6 h-6" />
                <div className="text-center">
                  <p className="text-sm font-semibold">Pagar Fiado</p>
                  <p className="text-xs text-violet-400/60">Quitar fiado</p>
                </div>
              </button>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-2">
            <button onClick={() => setDetailTab("movements")}
              style={detailTab !== "movements" ? { background: card.bg, border: card.border } : undefined}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${detailTab === "movements" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
              <FileText className="w-3.5 h-3.5" /> Movimentações
            </button>
            <button onClick={() => setDetailTab("purchases")}
              style={detailTab !== "purchases" ? { background: card.bg, border: card.border } : undefined}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${detailTab === "purchases" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
              <ShoppingCart className="w-3.5 h-3.5" /> Compras
            </button>
          </div>

          {/* Movement history */}
          {detailTab === "movements" && (
          <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold">Histórico de Movimentações</h2>
              </div>
              <button onClick={printHistory}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-medium transition-colors">
                <Printer className="w-3.5 h-3.5" /> Imprimir
              </button>
            </div>

            {/* Date filter tabs */}
            <div className="flex items-center gap-1.5 px-5 py-3 border-b border-zinc-800 flex-wrap">
              {DATE_TABS.map(t => (
                <button key={t.key} onClick={() => setDateFilter(t.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${dateFilter === t.key ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {dateFilter === "custom" && (
              <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span>De</span>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500" />
                  <span>até</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500" />
                </div>
              </div>
            )}

            {/* Summary row */}
            {!movLoading && movements.length > 0 && (
              <div className="grid grid-cols-3 border-b border-zinc-800">
                <div className="px-5 py-3 border-r border-zinc-800">
                  <p className="text-xs text-zinc-500">Débitos</p>
                  <p className="text-sm font-bold text-red-400">-{fmt(totalDebits)}</p>
                </div>
                <div className="px-5 py-3 border-r border-zinc-800">
                  <p className="text-xs text-zinc-500">Créditos/Pgtos</p>
                  <p className="text-sm font-bold text-emerald-400">+{fmt(totalPositive)}</p>
                </div>
                <div className="px-5 py-3">
                  <p className="text-xs text-zinc-500">Saldo período</p>
                  <p className={`text-sm font-bold ${totalPositive - totalDebits >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {totalPositive - totalDebits >= 0 ? "+" : ""}{fmt(totalPositive - totalDebits)}
                  </p>
                </div>
              </div>
            )}

            {/* Movement list */}
            {movLoading ? (
              <div className="flex justify-center py-10"><RefreshCw className="w-4 h-4 animate-spin text-violet-400" /></div>
            ) : movements.length === 0 ? (
              <div className="text-center py-10 text-xs text-zinc-600">Nenhuma movimentação no período selecionado</div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {movements.map(m => {
                  const isSaldo = m.type === "saldo" || (m.type === "debit" && (m.description ?? "").toLowerCase().startsWith("saldo usado"));
                  const effectiveType = isSaldo ? "saldo" : m.type;
                  const isPos = effectiveType === "credit" || effectiveType === "payment";
                  const typeInfo = {
                    debit:   { label: "Fiado / Débito",  color: "bg-red-500/10 text-red-400 border-red-500/20" },
                    credit:  { label: "Crédito / Saldo", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
                    payment: { label: "Pagamento",        color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
                    saldo:   { label: "Saldo Usado",      color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
                  }[effectiveType];
                  const methods = (m.payment_methods ?? []).map(p => PAY_LABEL[p.method] ?? p.method).join(" + ");
                  const items = m.sale_id ? (saleItemsMap[m.sale_id] ?? []) : [];
                  return (
                    <div key={m.id} className="px-5 py-3">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${typeInfo.color}`}>{typeInfo.label}</span>
                            {methods && <span className="text-xs text-zinc-500">{methods}</span>}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">{m.description || "—"}</p>
                          <p className="text-xs text-zinc-600">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
                          {items.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {items.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs bg-zinc-950/60 rounded-lg px-2.5 py-1">
                                  <span className="text-zinc-300">{item.quantity}x {item.name}{item.notes ? ` (${item.notes})` : ""}</span>
                                  <span className="text-zinc-500 ml-3 flex-shrink-0">{fmt(item.unit_price * item.quantity)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-sm font-bold ${effectiveType === "saldo" ? "text-teal-400" : isPos ? "text-emerald-400" : "text-red-400"}`}>
                            {isPos ? "+" : "-"}{fmt(m.amount)}
                          </span>
                          {(m.type === "payment" || (m.type === "debit" && m.sale_id)) && (
                            <button
                              onClick={() => openEditMovement(m)}
                              className="p-1.5 bg-zinc-800 hover:bg-violet-600 text-zinc-300 hover:text-white rounded-lg transition-all border border-zinc-700 hover:border-violet-500"
                              title="Editar movimentação">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Purchases tab */}
          {detailTab === "purchases" && (
          <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold">Histórico de Compras</h2>
              </div>
            </div>

            {/* Date filter tabs */}
            <div className="flex items-center gap-1.5 px-5 py-3 border-b border-zinc-800 flex-wrap">
              {DATE_TABS.map(t => (
                <button key={t.key} onClick={() => setDateFilter(t.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${dateFilter === t.key ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {dateFilter === "custom" && (
              <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span>De</span>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500" />
                  <span>até</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500" />
                </div>
              </div>
            )}

            {salesLoading ? (
              <div className="flex justify-center py-10"><RefreshCw className="w-4 h-4 animate-spin text-violet-400" /></div>
            ) : customerSales.length === 0 ? (
              <div className="text-center py-10 text-xs text-zinc-600">Nenhuma compra no período selecionado</div>
            ) : (() => {
              const getSaleTotal = (sale: CustomerSale) => {
                const t = Number(sale.total);
                if (t > 0) return t;
                const itemsSum = sale.sale_items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
                return Math.max(0, itemsSum - Number(sale.discount ?? 0));
              };
              const periodTotal = customerSales.reduce((s, sale) => s + getSaleTotal(sale), 0);
              const ticketMedio = periodTotal / customerSales.length;

              // Group by day (YYYY-MM-DD, descending)
              const byDay: Record<string, CustomerSale[]> = {};
              for (const sale of customerSales) {
                const key = sale.created_at.slice(0, 10);
                if (!byDay[key]) byDay[key] = [];
                byDay[key].push(sale);
              }
              const sortedDays = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

              return (
                <>
                  {/* Period summary */}
                  <div className="grid grid-cols-3 border-b border-zinc-800">
                    <div className="px-5 py-3 border-r border-zinc-800">
                      <p className="text-xs text-zinc-500">Compras</p>
                      <p className="text-sm font-bold text-white">{customerSales.length}</p>
                    </div>
                    <div className="px-5 py-3 border-r border-zinc-800">
                      <p className="text-xs text-zinc-500">Total gasto</p>
                      <p className="text-sm font-bold text-violet-400">{fmt(periodTotal)}</p>
                    </div>
                    <div className="px-5 py-3">
                      <p className="text-xs text-zinc-500">Ticket médio</p>
                      <p className="text-sm font-bold text-zinc-300">{fmt(ticketMedio)}</p>
                    </div>
                  </div>

                  {/* Sales grouped by day */}
                  {sortedDays.map(day => {
                    const daySales = byDay[day];
                    const dayTotal = daySales.reduce((s, sale) => s + getSaleTotal(sale), 0);
                    const dayLabel = new Date(day + "T12:00:00").toLocaleDateString("pt-BR", {
                      weekday: "long", day: "2-digit", month: "long", year: "numeric",
                    });
                    return (
                      <div key={day}>
                        {/* Day header */}
                        <div className="flex items-center justify-between px-5 py-2 bg-zinc-950 border-b border-zinc-800 sticky top-0">
                          <span className="text-xs font-semibold text-zinc-300 capitalize">{dayLabel}</span>
                          <span className="text-xs font-bold text-violet-400">{fmt(dayTotal)}</span>
                        </div>

                        {/* Sales of that day */}
                        <div className="divide-y divide-zinc-800/40">
                          {daySales.map(sale => {
                            const saleTotal = getSaleTotal(sale);
                            const orderNum = sale.id.slice(-6).toUpperCase();
                            const time = new Date(sale.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                            return (
                              <div key={sale.id} className="px-5 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-bold text-white font-mono">#{orderNum}</span>
                                      <span className="text-xs text-zinc-500">{time}</span>
                                      {sale.seller_name && <span className="text-xs text-zinc-600">· {sale.seller_name}</span>}
                                    </div>
                                    {sale.sale_items.length > 0 && (
                                      <div className="mt-1.5 space-y-0.5">
                                        {sale.sale_items.map((item, idx) => (
                                          <div key={idx} className="flex items-center justify-between text-xs bg-zinc-950/60 rounded-lg px-2.5 py-1">
                                            <span className="text-zinc-300">{item.quantity}x {item.name}{item.notes ? ` (${item.notes})` : ""}</span>
                                            <span className="text-zinc-500 ml-3 flex-shrink-0">{fmt(item.unit_price * item.quantity)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-bold text-violet-400">{fmt(saleTotal)}</p>
                                    {Number(sale.discount ?? 0) > 0 && (
                                      <p className="text-xs text-red-400">desc. -{fmt(Number(sale.discount))}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Create / Edit */}
      {modal === "createEdit" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-base font-semibold">{editing ? "Editar Cliente" : "Novo Cliente"}</h2>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome *</label>
                <input value={fName} onChange={e => setFName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveCustomer()}
                  placeholder="Nome completo" className={inputCls} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Telefone / WhatsApp</label>
                  <input value={fPhone} onChange={e => setFPhone(e.target.value)} placeholder="(99) 99999-9999" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">E-mail</label>
                  <input value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="email@exemplo.com" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Endereço</label>
                <input value={fAddress} onChange={e => setFAddress(e.target.value)} placeholder="Rua, número, bairro, cidade" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Limite de Crédito (fiado)</label>
                  <input value={fLimit} onChange={e => setFLimit(e.target.value)} placeholder="0,00" type="number" min="0" step="0.01" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    {editing ? "Situação financeira" : "Aporte inicial (saldo)"}
                  </label>
                  {editing ? (
                    <div className={`${inputCls} flex flex-col gap-0.5 h-auto py-2`}>
                      <span className={editing.balance > 0 ? "text-emerald-400" : "text-zinc-500"}>Saldo: {editing.balance > 0 ? "+" : ""}{fmt(editing.balance)}</span>
                      {(editing.fiado_balance ?? 0) > 0 && <span className="text-red-400 text-xs">Fiado: {fmt(editing.fiado_balance)}</span>}
                    </div>
                  ) : (
                    <input value={fBalance} onChange={e => setFBalance(e.target.value)}
                      placeholder="0,00 (saldo pré-pago)"
                      type="number" step="0.01" className={inputCls} />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Observações</label>
                <input value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="Opcional" className={inputCls} />
              </div>
            </div>
            <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveCustomer} disabled={!fName.trim() || saving}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors ${isLight ? "bg-pink-600 hover:bg-pink-700" : "bg-violet-600 hover:bg-violet-500 text-white"}`}
                style={isLight ? { color: "#ffffff" } : undefined}>
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? "Salvar" : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {modal === "delete" && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">Excluir cliente?</p>
                <p className="text-xs text-zinc-500 mt-0.5">Isso apagará também todo o histórico de movimentações de <span className="text-white font-medium">{deleteTarget.name}</span>.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setModal("none"); }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={confirmDelete} disabled={saving}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Credit */}
      {modal === "addCredit" && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <h2 className="text-base font-semibold">Adicionar Saldo</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Pré-pagamento para {selected.name}</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                <p className="text-xs text-emerald-400">Saldo atual: <span className="font-bold">{fmt(selected.balance)}</span></p>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Valor *</label>
                <input value={opAmount} onChange={e => setOpAmount(e.target.value)} onKeyDown={e => e.key === "Enter" && addCredit()}
                  placeholder="0,00" type="number" min="0.01" step="0.01" className={inputCls} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Descrição</label>
                <input value={opDesc} onChange={e => setOpDesc(e.target.value)} onKeyDown={e => e.key === "Enter" && addCredit()}
                  placeholder="Ex: Mensalidade março" className={inputCls} />
              </div>
              {opAmount && parseFloat(opAmount) > 0 && (
                <div className="text-xs text-zinc-500">
                  Novo saldo: <span className="text-emerald-400 font-semibold">{fmt(selected.balance + parseFloat(opAmount))}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={addCredit} disabled={!opAmount || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Debt – full checkout */}
      {modal === "payDebt" && selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Pagar Dívida</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{selected.name}</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Debt summary */}
              {(selected.fiado_balance ?? 0) <= 0 ? (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-4 text-center">
                  <p className="text-emerald-400 font-semibold text-sm">Cliente sem fiado em aberto</p>
                  {selected.balance > 0 && <p className="text-xs text-zinc-400 mt-1">Saldo pré-pago: <span className="text-emerald-400 font-bold">{fmt(selected.balance)}</span></p>}
                  <p className="text-xs text-zinc-500 mt-1">Use "Registrar Fiado" para lançar um débito antes de pagar.</p>
                </div>
              ) : (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Fiado em aberto</span>
                    <span className="text-2xl font-black text-red-400">{fmt(selected.fiado_balance)}</span>
                  </div>
                  {totalPaid > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">Pagando agora</span>
                        <span className="text-sm font-bold text-emerald-400">+{fmt(totalPaid)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-red-500/20 pt-1.5">
                        <span className="text-xs text-zinc-400">Fiado restante</span>
                        <span className={`text-sm font-bold ${selected.fiado_balance - totalPaid <= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                          {selected.fiado_balance - totalPaid <= 0 ? "Quitado!" : fmt(selected.fiado_balance - totalPaid)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Payment methods */}
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-2">Forma de pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  {PAY_METHODS.map(pm => (
                    <button key={pm.method}
                      onClick={() => setPayMethod(pm.method)}
                      className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm font-medium transition-all ${payMethod === pm.method ? pm.color + " border-opacity-100" : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                      {pm.icon} {pm.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount input */}
              <div className="flex gap-2">
                <input value={payInput} onChange={e => setPayInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPayEntry()}
                  placeholder={remaining > 0 ? `Saldo: ${fmt(remaining)}` : "Valor"}
                  type="number" min="0.01" step="0.01" className={inputCls + " flex-1"} />
                <button onClick={addPayEntry} disabled={!payInput}
                  className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Payment entries */}
              {payEntries.length > 0 && (
                <div className="space-y-1.5">
                  {payEntries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5">
                      <span className="text-sm text-zinc-300">{PAY_LABEL[e.method]}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{fmt(e.amount)}</span>
                        <button onClick={() => setPayEntries(prev => prev.filter((_, j) => j !== i))}
                          className="p-1 text-zinc-600 hover:text-red-400 rounded-md transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 rounded-xl">
                    <span className="text-sm font-medium">Total</span>
                    <span className="text-base font-bold text-emerald-400">{fmt(totalPaid)}</span>
                  </div>
                  {totalPaid > debtAmt && debtAmt > 0 && (
                    <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <span className="text-xs text-amber-400">Troco</span>
                      <span className="text-sm font-bold text-amber-400">{fmt(totalPaid - debtAmt)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={payDebt} disabled={payEntries.length === 0 || saving || (selected.fiado_balance ?? 0) <= 0}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {(selected.fiado_balance ?? 0) <= 0 ? "Sem fiado" : `Confirmar ${totalPaid > 0 ? fmt(totalPaid) : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Movement */}
      {modal === "editMovement" && editingMovement && selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                {editingMovement.type === "payment" ? (
                  <h2 className="text-base font-semibold">Editar Pagamento</h2>
                ) : (
                  <h2 className="text-base font-semibold">
                    Editar Venda{editSaleRecord ? ` · #${editSaleRecord.id.slice(-6).toUpperCase()}` : ""}
                  </h2>
                )}
                <p className="text-xs text-zinc-500 mt-0.5">{new Date(editingMovement.created_at).toLocaleString("pt-BR")}</p>
              </div>
              <button onClick={() => { setModal("none"); setEditingMovement(null); }} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* ══════════════════════════════════════════════════════════
                  MODO PAGAMENTO — simples
              ══════════════════════════════════════════════════════════ */}
              {editingMovement.type === "payment" && (
                <>
                  {/* Entradas de pagamento existentes */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Formas de pagamento</p>
                    {editPayEntries.length === 0 && (
                      <p className="text-xs text-zinc-600">Nenhuma forma de pagamento adicionada.</p>
                    )}
                    {editPayEntries.map((entry, i) => (
                      <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-500">Entrada {i + 1}</span>
                          <button onClick={() => setEditPayEntries(prev => prev.filter((_, j) => j !== i))}
                            className="p-1 text-zinc-600 hover:text-red-400 rounded transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {PAY_METHODS.map(pm => (
                            <button key={pm.method}
                              onClick={() => setEditPayEntries(prev => prev.map((e, j) => j === i ? { ...e, method: pm.method as PayMethod } : e))}
                              className={`flex items-center gap-1.5 px-2.5 py-2 border rounded-lg text-xs font-medium transition-all ${entry.method === pm.method ? pm.color : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                              {pm.icon} {pm.label}
                            </button>
                          ))}
                        </div>
                        <input type="number" min="0.01" step="0.01" value={entry.amount}
                          onChange={e => { const v = parseFloat(e.target.value) || 0; setEditPayEntries(prev => prev.map((en, j) => j === i ? { ...en, amount: v } : en)); }}
                          className={inputCls} />
                      </div>
                    ))}
                  </div>

                  {/* Adicionar nova entrada */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500">Adicionar forma de pagamento</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {PAY_METHODS.map(pm => (
                        <button key={pm.method} onClick={() => setEditPayMethod(pm.method)}
                          className={`flex items-center gap-1.5 px-2.5 py-2 border rounded-lg text-xs font-medium transition-all ${editPayMethod === pm.method ? pm.color : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                          {pm.icon} {pm.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={editPayInput} onChange={e => setEditPayInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addEditPayEntry()}
                        placeholder="Valor" type="number" min="0.01" step="0.01" className={inputCls + " flex-1"} />
                      <button onClick={addEditPayEntry} disabled={!editPayInput}
                        className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {editPayEntries.length > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 rounded-xl border border-zinc-700">
                      <span className="text-sm font-semibold">Total</span>
                      <span className="text-base font-black text-emerald-400">{fmt(editPayEntries.reduce((s, e) => s + e.amount, 0))}</span>
                    </div>
                  )}

                  <div className="border-t border-zinc-800" />

                  {/* Descrição */}
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Descrição</label>
                    <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Descrição" className={inputCls} />
                  </div>
                </>
              )}

              {/* ══════════════════════════════════════════════════════════
                  MODO DÉBITO (VENDA) — completo
              ══════════════════════════════════════════════════════════ */}
              {editingMovement.type === "debit" && editSaleRecord && (
                <>
                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-zinc-500">Total atual</p>
                      <p className="text-sm font-bold text-red-400">{fmt(editSaleItems.reduce((s: number, i: any) => s + i.unit_price * i.quantity, 0))}</p>
                    </div>
                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-zinc-500">Status</p>
                      <p className="text-sm font-bold text-zinc-300">{editSaleRecord.status ?? "—"}</p>
                    </div>
                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-zinc-500">Itens</p>
                      <p className="text-sm font-bold text-zinc-300">{editSaleItems.length}</p>
                    </div>
                  </div>

                  {/* Itens da venda */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Itens da venda</p>
                    {editSaleItems.map((item: any) => (
                      <div key={item.id} className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{item.products?.name ?? "Produto"}</p>
                            {/* Preço editável */}
                            {editItemPriceId === item.id ? (
                              <div className="flex items-center gap-1.5 mt-1">
                                <input
                                  autoFocus
                                  type="number" min="0" step="0.01"
                                  value={editItemPriceVal}
                                  onChange={e => setEditItemPriceVal(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") editConfirmItemPrice(item); if (e.key === "Escape") { setEditItemPriceId(null); setEditItemPriceVal(""); } }}
                                  className="w-24 px-2 py-1 bg-zinc-900 border border-violet-500 rounded-lg text-xs text-white focus:outline-none" />
                                <button onClick={() => editConfirmItemPrice(item)}
                                  className="px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold">OK</button>
                                <button onClick={() => { setEditItemPriceId(null); setEditItemPriceVal(""); }}
                                  className="p-1 text-zinc-500 hover:text-white rounded-lg text-xs"><X className="w-3 h-3" /></button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditItemPriceId(item.id); setEditItemPriceVal(String(item.unit_price)); }}
                                className="text-xs text-zinc-500 hover:text-violet-400 transition-colors mt-0.5">
                                {fmt(item.unit_price)} / un · subtotal {fmt(item.unit_price * item.quantity)}
                              </button>
                            )}
                          </div>
                          {/* Controles de quantidade */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => editUpdateItemQty(item, -1)}
                              className="w-7 h-7 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-bold text-white">{item.quantity}</span>
                            <button onClick={() => editUpdateItemQty(item, +1)}
                              className="w-7 h-7 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => editDeleteItem(item.id)}
                              className="w-7 h-7 flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ml-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Adicionar produto – igual ao PDV */}
                  <div>
                    <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Adicionar produto</p>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        value={editProductSearch}
                        onChange={e => setEditProductSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const filtered = allProducts.filter(p => p.name.toLowerCase().includes(editProductSearch.toLowerCase()));
                            if (filtered.length > 0) editAddItemToSale(filtered[0] as any);
                          }
                        }}
                        placeholder="Digite o nome e pressione Enter para adicionar..."
                        className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
                      />
                    </div>
                    {editProductSearch.length >= 1 && (
                      <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                        {allProducts
                          .filter(p => p.name.toLowerCase().includes(editProductSearch.toLowerCase()))
                          .slice(0, 6)
                          .map((p: any) => (
                            <button key={p.id} onClick={() => editAddItemToSale(p)}
                              className="w-full flex items-center justify-between px-3 py-2 bg-zinc-950 hover:bg-violet-600/10 border border-zinc-800 hover:border-violet-500/30 rounded-xl transition-colors text-left">
                              <div>
                                <p className="text-sm font-medium text-white">{p.name}</p>
                                <p className="text-xs text-zinc-500">{fmt(p.sale_price ?? p.price)}</p>
                              </div>
                              <Plus className="w-4 h-4 text-violet-400 flex-shrink-0" />
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-zinc-800" />

                  {/* Formas de pagamento — clique no método para trocar direto */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Formas de pagamento</p>

                    {/* Cada entrada: botões de método + valor editável diretamente */}
                    {editPayEntries.map((entry, i) => (
                      <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-500">Clique para trocar o método</span>
                          <button onClick={() => setEditPayEntries(prev => prev.filter((_, j) => j !== i))}
                            className="p-1 text-zinc-600 hover:text-red-400 rounded transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {EDIT_PAY_METHODS.map(pm => (
                            <button key={pm.method}
                              onClick={() => setEditPayEntries(prev => prev.map((e, j) => j === i ? { ...e, method: pm.method } : e))}
                              className={`flex items-center gap-1 px-2 py-1.5 border rounded-lg text-xs font-medium transition-all ${entry.method === pm.method ? pm.color : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                              {pm.icon} {pm.label}
                            </button>
                          ))}
                        </div>
                        <input type="number" min="0.01" step="0.01"
                          value={entry.amount}
                          onChange={e => { const v = parseFloat(e.target.value) || 0; setEditPayEntries(prev => prev.map((en, j) => j === i ? { ...en, amount: v } : en)); }}
                          className={inputCls} />
                      </div>
                    ))}

                    {/* Adicionar nova forma (para pagamento dividido) */}
                    {editPayEntries.length === 0 && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-1">
                          {EDIT_PAY_METHODS.map(pm => (
                            <button key={pm.method} onClick={() => setEditPayMethod(pm.method)}
                              className={`flex items-center gap-1 px-2 py-1.5 border rounded-lg text-xs font-medium transition-all ${editPayMethod === pm.method ? pm.color : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                              {pm.icon} {pm.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input value={editPayInput} onChange={e => setEditPayInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && addEditPayEntry()}
                            placeholder="Valor" type="number" min="0.01" step="0.01" className={inputCls + " flex-1"} />
                          <button onClick={addEditPayEntry} disabled={!editPayInput}
                            className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {editPayEntries.length > 0 && (
                      <button onClick={() => { setEditPayMethod("cash"); setEditPayInput(""); }}
                        className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors">
                        <Plus className="w-3 h-3" /> Adicionar outra forma (pagamento dividido)
                      </button>
                    )}

                    {editPayEntries.length > 1 && (
                      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 rounded-xl border border-zinc-700">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="text-base font-black text-emerald-400">{fmt(editPayEntries.reduce((s, e) => s + e.amount, 0))}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-zinc-800" />

                  {/* Descrição */}
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Descrição</label>
                    <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Descrição" className={inputCls} />
                  </div>
                </>
              )}

              {/* Caso debit sem sale vinculado */}
              {editingMovement.type === "debit" && !editSaleRecord && (
                <div className="text-center py-8 text-xs text-zinc-600">
                  Esta movimentação não possui venda vinculada e não pode ser editada aqui.
                </div>
              )}

            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => { setModal("none"); setEditingMovement(null); }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">
                Cancelar
              </button>
              <button
                onClick={saveMovementEdit}
                disabled={
                  saving ||
                  (editingMovement.type === "payment" && editPayEntries.length === 0) ||
                  (editingMovement.type === "debit" && !editSaleRecord)
                }
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
