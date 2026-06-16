import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { getStoreSettings, refreshStoreCache } from "../settings";
import { unlockAudio, playOrderAlarm } from "../../lib/audio";
import {
  Store, ClipboardList, RefreshCw, Bell,
  X, Copy, ExternalLink, UtensilsCrossed, Search, Plus, Trash2,
  ChevronRight, MessageSquare, Send, Printer, CheckCheck, Truck,
  Eye, EyeOff, Edit2, Globe, Phone, MapPin, Package, Save,
  CheckCircle2, Users, Upload, ImageIcon, GripVertical,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreSettings {
  store_name: string; tagline: string; logo_url: string; banner_url: string;
  is_open: boolean; auto_hours: boolean;
  hours: Record<string, { active: boolean; open: string; close: string }>;
  payment_methods: string[];
  min_order_value: number; delivery_fee: number;
  estimated_time_min: number; estimated_time_max: number;
  whatsapp: string; address: string;
  hidden_categories_digital_menu?: string[];
  category_order?: string[];
}

interface DigitalOrder {
  id: string; customer_name: string | null; customer_phone: string | null;
  delivery_address: string | null; order_type: string | null;
  items: OrderItem[]; total_amount: number; notes: string | null;
  status: string; order_number: string | null;
  payment_method: string | null; change_for: number | null;
  sale_id: string | null; created_at: string; updated_at: string | null;
}

interface OrderItem {
  product_id: string; product_name: string; quantity: number;
  unit_price: number; total_price: number; notes?: string;
  options?: { group_name: string; option_name: string; additional_price: number; linked_product_id?: string | null }[];
}

interface MenuMessage {
  id: string; order_id: string; sender: "store" | "customer";
  message: string; created_at: string;
}

interface Product {
  id: string; name: string; description: string | null;
  sale_price: number; image_url: string | null; category_id: string | null;
  is_active: boolean; visible_digital_menu: boolean; is_configurable: boolean;
}

interface Category { id: string; name: string; }

interface OptionGroup {
  id: string; product_id: string; name: string;
  min_choices: number; max_choices: number; required: boolean; position: number;
  options: MenuOption[];
}

interface MenuOption {
  id: string; group_id: string; name: string;
  additional_price: number; is_available: boolean; position: number;
  linked_product_id?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:   { label: "Novo",       color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)" },
  accepted:  { label: "Aceito",     color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   border: "rgba(6,182,212,0.35)"  },
  dispatched:{ label: "Despachado", color: "#10b981", bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.35)" },
  cancelled: { label: "Cancelado",  color: "#f43f5e", bg: "rgba(244,63,94,0.12)",   border: "rgba(244,63,94,0.35)"  },
};

const PAY_LABELS: Record<string, string> = {
  cash: "Dinheiro", pix: "PIX", credit: "Cartão Crédito", debit: "Cartão Débito",
};

const WEEKDAYS = [
  { key: "seg", label: "Segunda" }, { key: "ter", label: "Terça"   },
  { key: "qua", label: "Quarta"  }, { key: "qui", label: "Quinta"  },
  { key: "sex", label: "Sexta"   }, { key: "sab", label: "Sábado"  },
  { key: "dom", label: "Domingo" },
];

const DEFAULT_HOURS = Object.fromEntries(
  WEEKDAYS.map(d => [d.key, { active: d.key !== "dom", open: "08:00", close: "22:00" }])
);

const DEFAULT_SETTINGS: StoreSettings = {
  store_name: "", tagline: "", logo_url: "", banner_url: "",
  is_open: false, auto_hours: false, hours: DEFAULT_HOURS,
  payment_methods: ["cash", "pix"],
  min_order_value: 0, delivery_fee: 0, estimated_time_min: 30, estimated_time_max: 50,
  whatsapp: "", address: "",
  hidden_categories_digital_menu: [],
  category_order: [],
};

const fmt    = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtT   = (d: string) => new Date(d).toLocaleTimeString("pt-BR",  { hour: "2-digit", minute: "2-digit" });
const fmtDT  = (d: string) => new Date(d).toLocaleDateString("pt-BR",  { day: "2-digit", month: "2-digit" }) + " " + fmtT(d);

function isStoreOpenNow(s: StoreSettings): boolean {
  if (!s.auto_hours) return s.is_open;
  const now = new Date();
  const keys = ["dom","seg","ter","qua","qui","sex","sab"];
  const day = s.hours[keys[now.getDay()]];
  if (!day?.active) return false;
  const [oh, om] = day.open.split(":").map(Number);
  const [ch, cm] = day.close.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;

  // Se fecha depois da meia-noite (closeMin < openMin), valida para dias diferentes
  if (closeMin < openMin) {
    return cur >= openMin || cur < closeMin;
  }
  return cur >= openMin && cur < closeMin;
}

function startAlertLoop(ref: React.MutableRefObject<ReturnType<typeof setInterval> | null>) {
  if (ref.current) return;
  playOrderAlarm();
  ref.current = setInterval(playOrderAlarm, 4000);
}

function stopAlertLoop(ref: React.MutableRefObject<ReturnType<typeof setInterval> | null>) {
  if (ref.current) { clearInterval(ref.current); ref.current = null; }
}

function startMsgLoop(ref: React.MutableRefObject<ReturnType<typeof setInterval> | null>) {
  if (ref.current) return;
  playAlertBeep();
  ref.current = setInterval(playAlertBeep, 3500);
}

function stopMsgLoop(ref: React.MutableRefObject<ReturnType<typeof setInterval> | null>) {
  if (ref.current) { clearInterval(ref.current); ref.current = null; }
}

function printLabel(order: DigitalOrder) {
  const store = getStoreSettings();
  const items = Array.isArray(order.items) ? order.items : [];
  const dt = new Date(order.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
  const payLabel = PAY_LABELS[order.payment_method ?? ""] ?? order.payment_method ?? "—";

  const SEP = () => `<div style="border-top:1px dashed #000;margin:8px 0"></div>`;
  const ROW = (a: string, b: string, big = false) =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:${big?"16px":"13px"};font-weight:${big?"800":"600"};color:#000"><span>${a}</span><span>${b}</span></div>`;
  const LABEL = (t: string) =>
    `<div style="font-size:11px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 3px">--- ${t} ---</div>`;

  // Identificar bebidas e separar itens
  const isDrink = (name: string) => /bebida|coca|água|suco|refrigerante|vinho|cerveja|chopp|açaí|milkshake|café|leite/i.test(name);

  const mainItems: OrderItem[] = [];
  const drinkItems: OrderItem[] = [];

  items.forEach(it => {
    if (isDrink(it.product_name)) {
      drinkItems.push(it);
    } else {
      mainItems.push(it);
    }
  });

  // Renderizar itens principais com acompanhamentos organizados
  const mainItemsHtml = mainItems.length > 0 ? mainItems.map(it => {
    const unitLine = it.quantity > 1
      ? `<div style="font-size:11px;font-weight:600;color:#000;margin-top:2px">${it.quantity} un x ${fmt(it.unit_price)}</div>` : "";
    const optLines = (it.options ?? []).map(o =>
      `<div style="font-size:10px;font-weight:500;color:#333;margin-top:3px;padding-left:12px">→ ${o.option_name}${o.additional_price > 0 ? ` (+${fmt(o.additional_price)})` : ""}</div>`
    ).join("");
    const obsLine = it.notes
      ? `<div style="font-size:10px;font-weight:500;color:#555;margin-top:2px;font-style:italic">Obs: ${it.notes}</div>` : "";
    return `<div style="padding:8px 0;border-bottom:1px dashed #000">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1;padding-right:8px">
          <div style="font-size:14px;font-weight:700;color:#000">${it.quantity}x ${it.product_name}</div>
          ${unitLine}
        </div>
        <div style="font-size:12px;font-weight:700;color:#000;white-space:nowrap">${fmt(it.total_price ?? it.unit_price * it.quantity)}</div>
      </div>
      ${optLines}${obsLine}
    </div>`;
  }).join("") : "";

  // Renderizar bebidas em seção separada com quebra clara
  const drinksHtml = drinkItems.length > 0 ? `
    ${mainItems.length > 0 ? `<div style="margin:12px 0;padding:12px 0;border-top:2px solid #000;border-bottom:2px solid #000;text-align:center">
      <div style="font-size:12px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:1px">🍹 BEBIDAS 🍹</div>
    </div>` : ""}
    ${drinkItems.map(it => {
      const unitLine = it.quantity > 1
        ? `<div style="font-size:11px;font-weight:600;color:#000;margin-top:2px">${it.quantity} un x ${fmt(it.unit_price)}</div>` : "";
      const obsLine = it.notes
        ? `<div style="font-size:10px;font-weight:500;color:#555;margin-top:2px;font-style:italic">Obs: ${it.notes}</div>` : "";
      return `<div style="padding:6px 0;border-bottom:1px dashed #ccc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;padding-right:8px">
            <div style="font-size:13px;font-weight:600;color:#000">${it.quantity}x ${it.product_name}</div>
            ${unitLine}
          </div>
          <div style="font-size:12px;font-weight:700;color:#000;white-space:nowrap">${fmt(it.total_price ?? it.unit_price * it.quantity)}</div>
        </div>
        ${obsLine}
      </div>`;
    }).join("")}
  ` : "";

  const itemsHtml = mainItemsHtml + drinksHtml || `<div style="font-size:12px;font-weight:600;color:#000;padding:6px 0">Sem itens</div>`;

  const pixLine = order.payment_method === "pix" && store.pix
    ? `<div style="font-size:12px;font-weight:600;color:#000">Chave PIX: ${store.pix}</div>` : "";

  const win = window.open("", "_blank", "width=420,height=700");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Pedido #${order.order_number}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#000;background:#fff;padding:16px 14px;max-width:320px;margin:0 auto}
    @media print{body{padding:4px 2px;max-width:none}@page{margin:2mm}}
  </style></head><body>

  <div style="text-align:center;padding-bottom:8px">
    <div style="font-size:20px;font-weight:900;color:#000">${store.name || order.customer_name || "Cardápio Digital"}</div>
    ${store.show_cnpj && store.cnpj ? `<div style="font-size:12px;font-weight:600;color:#000">CNPJ: ${store.cnpj}</div>` : ""}
    ${store.address ? `<div style="font-size:12px;font-weight:600;color:#000">${store.address}</div>` : ""}
    ${store.phone ? `<div style="font-size:12px;font-weight:600;color:#000">Tel: ${store.phone}</div>` : ""}
  </div>

  <div style="border-top:2px solid #000;border-bottom:1px dashed #000;padding:6px 0;margin:4px 0;text-align:center">
    <div style="font-size:28px;font-weight:900;color:#000;letter-spacing:2px">#${order.order_number ?? "—"}</div>
    <div style="font-size:13px;font-weight:600;color:#000">${dt}</div>
  </div>

  <div style="padding:6px 0">
    ${order.customer_name ? `<div style="font-size:13px;font-weight:600;color:#000">Cliente: ${order.customer_name}</div>` : ""}
    ${order.customer_phone ? `<div style="font-size:13px;font-weight:600;color:#000">Tel: ${order.customer_phone}</div>` : ""}
    <div style="font-size:13px;font-weight:600;color:#000">${order.order_type === "delivery" ? `Entrega: ${order.delivery_address ?? "—"}` : "Retirada no balcão"}</div>
  </div>

  ${SEP()}
  ${LABEL("Itens do pedido")}
  ${itemsHtml}

  ${SEP()}
  ${ROW("TOTAL", fmt(order.total_amount), true)}

  ${SEP()}
  ${LABEL("Pagamento")}
  ${ROW(payLabel, fmt(order.total_amount))}
  ${pixLine}
  ${order.change_for ? ROW("Troco para", fmt(order.change_for)) : ""}

  ${order.notes ? `${SEP()}${LABEL("Observacoes")}<div style="font-size:13px;font-weight:600;color:#000">${order.notes}</div>` : ""}

  ${SEP()}
  <div style="text-align:center;font-size:13px;font-weight:600;color:#000;padding-top:4px">
    ${store.footer_message || "Obrigado pela preferência!"}
  </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DigitalMenuPage() {
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
  const [userId, setUserId]   = useState<string | null>(null);
  const [tab,    setTab]      = useState<"orders" | "products" | "appearance">("orders");
  const [loading, setLoading] = useState(true);

  // Orders
  const [orders,        setOrders]        = useState<DigitalOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<DigitalOrder | null>(null);
  const [orderMessages, setOrderMessages] = useState<MenuMessage[]>([]);
  const [newMsg,        setNewMsg]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [newOrderAlert,    setNewOrderAlert]    = useState<DigitalOrder | null>(null);
  const [unreadMsgOrders,  setUnreadMsgOrders]  = useState<Set<string>>(new Set());
  const [newMsgNotif,      setNewMsgNotif]      = useState<{ orderId: string; name: string; num: string } | null>(null);
  const msgEndRef       = useRef<HTMLDivElement>(null);
  const alertLoopRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgAlertLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ordersRef       = useRef<DigitalOrder[]>([]);
  const ordersDateRef   = useRef(new Date().toISOString().split("T")[0]);
  const acceptingRef    = useRef(false);
  const acceptBtnRef    = useRef<HTMLButtonElement>(null);

  // Products
  const [products,       setProducts]      = useState<Product[]>([]);
  const [categories,     setCategories]    = useState<Category[]>([]);
  const [catFilter,      setCatFilter]     = useState("all");
  const [productSearch,  setProductSearch] = useState("");
  const [editProduct,    setEditProduct]   = useState<Partial<Product> | null>(null);
  const [editGroups,     setEditGroups]    = useState<OptionGroup[]>([]);
  const [showModal,      setShowModal]     = useState(false);
  const [productSaving,  setProductSaving] = useState(false);
  const [dragCatId,      setDragCatId]     = useState<string | null>(null);

  // Appearance
  const [settings,      setSettings]      = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [settingsSaving,  setSettingsSaving]   = useState(false);
  const [settingsSaved,   setSettingsSaved]    = useState(false);
  const [copied,          setCopied]           = useState(false);
  const [logoUploading,      setLogoUploading]     = useState(false);
  const [bannerUploading,    setBannerUploading]   = useState(false);
  const [productImgUploading,setProductImgUploading] = useState(false);

  const menuUrl  = userId ? `${window.location.origin}/menu/${userId}` : "";
  const inputCls = "w-full px-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/60 transition-all";

  // ── Sync ordersRef so Realtime callbacks never have stale closures
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // ── Stop message loop when all unread are cleared
  useEffect(() => {
    if (unreadMsgOrders.size === 0) {
      stopMsgLoop(msgAlertLoopRef);
      setNewMsgNotif(null);
    }
  }, [unreadMsgOrders]);

  // ── Init
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        refreshStoreCache(data.user.id); // Garante cache de impressão atualizado
      }
    });
  }, []);

  // ── Load
  // Data exibida na aba de pedidos — padrão: hoje
  const todayStr = new Date().toISOString().split("T")[0];
  const [ordersDate, setOrdersDate] = useState(todayStr);

  const loadOrders = useCallback(async (uid: string, dateStr?: string) => {
    const d    = dateStr ?? ordersDateRef.current;
    const from = new Date(d + "T00:00:00");
    const to   = new Date(d + "T23:59:59.999");

    const { data } = await supabase.from("digital_orders")
      .select("*")
      .eq("user_id", uid)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);
    const loaded = (data ?? []) as DigitalOrder[];
    setOrders(loaded);
    ordersRef.current = loaded;
    if (loaded.some(o => o.status === "pending")) {
      startAlertLoop(alertLoopRef);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from("products").select("id,name,description,sale_price,image_url,category_id,is_active,visible_digital_menu,is_configurable").eq("is_active", true).order("name"),
      supabase.from("categories").select("id,name").order("name"),
    ]);
    setProducts((p.data ?? []) as Product[]);
    setCategories((c.data ?? []) as Category[]);
  }, []);

  // Mantém ref em sincronia e recarrega pedidos ao trocar de data
  useEffect(() => {
    ordersDateRef.current = ordersDate;
    if (userId) loadOrders(userId, ordersDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersDate, userId]);

  const loadSettings = useCallback(async (uid: string) => {
    const { data, error } = await supabase.from("menu_store_settings").select("settings").eq("user_id", uid).maybeSingle();
    if (error) { console.error("Erro ao carregar configurações:", error); return; }
    if (data?.settings) {
      const s = data.settings as Partial<StoreSettings>;
      setSettings({ ...DEFAULT_SETTINGS, ...s, hours: { ...DEFAULT_HOURS, ...(s.hours ?? {}) }, payment_methods: s.payment_methods ?? ["cash","pix"] });
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([loadOrders(userId), loadProducts(), loadSettings(userId)]).finally(() => setLoading(false));
  }, [userId, loadOrders, loadProducts, loadSettings]);

  // ── Realtime: orders
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel("dm-orders")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "digital_orders", filter: `user_id=eq.${userId}` }, (p) => {
        const o = p.new as DigitalOrder;
        // Só adiciona à lista se o pedido for do dia selecionado
        const orderDay = new Date(o.created_at).toISOString().split("T")[0];
        if (orderDay === ordersDateRef.current) {
          setOrders(prev => [o, ...prev]);
        }
        startAlertLoop(alertLoopRef); setNewOrderAlert(o); setTimeout(() => setNewOrderAlert(null), 10000);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "digital_orders", filter: `user_id=eq.${userId}` }, (p) => {
        const u = p.new as DigitalOrder;
        flushSync(() => {
          setOrders(prev => prev.map(o => o.id === u.id ? u : o));
          setSelectedOrder(prev => prev?.id === u.id ? u : prev);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // ── Realtime: all customer messages (global — tracks unread across all orders)
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel("dm-all-msgs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_order_messages" }, (p) => {
        const msg = p.new as MenuMessage;
        if (msg.sender !== "customer") return;
        // Only care about orders that belong to this store
        const order = ordersRef.current.find(o => o.id === msg.order_id);
        if (!order) return;
        setUnreadMsgOrders(prev => new Set([...prev, msg.order_id]));
        startMsgLoop(msgAlertLoopRef);
        setNewMsgNotif({ orderId: msg.order_id, name: order.customer_name ?? "Cliente", num: order.order_number ?? "—" });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // ── Realtime: messages
  useEffect(() => {
    if (!selectedOrder) { setOrderMessages([]); return; }
    supabase.from("menu_order_messages").select("*").eq("order_id", selectedOrder.id).order("created_at")
      .then(({ data }) => { setOrderMessages((data ?? []) as MenuMessage[]); setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100); });
    const ch = supabase.channel(`msgs-${selectedOrder.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_order_messages", filter: `order_id=eq.${selectedOrder.id}` }, (p) => {
        const msg = p.new as MenuMessage;
        setOrderMessages(prev => [...prev, msg]);
        setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedOrder?.id]);

  // ── Order actions
  async function acceptOrder(order: DigitalOrder) {
    if (!userId || acceptingRef.current) return;
    acceptingRef.current = true;
    // Disable button directly in DOM — no React state change to avoid concurrent render race
    if (acceptBtnRef.current) acceptBtnRef.current.disabled = true;
    stopAlertLoop(alertLoopRef);
    try {
      const items = Array.isArray(order.items) ? order.items : [];

      const { data: sale, error: saleErr } = await supabase.from("sales").insert({
        user_id: userId, total_amount: order.total_amount, discount: 0, status: "paid",
        origin: "cardapio_digital", seller_name: null, notes: order.notes,
        payments: [{ method: order.payment_method ?? "cash", amount: order.total_amount }],
      }).select("id").single();

      if (saleErr) {
        alert("Erro ao criar venda: " + saleErr.message);
        acceptingRef.current = false;
        if (acceptBtnRef.current) acceptBtnRef.current.disabled = false;
        return;
      }

      if (sale) {
        if (items.length > 0) {
          const { error: itemsErr } = await supabase.from("sale_items").insert(items.map(it => ({
            sale_id: sale.id,
            product_id: it.product_id,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total_price: it.total_price ?? (it.unit_price * it.quantity),
            notes: [...(it.options ?? []).map(o => `${o.group_name}: ${o.option_name}`), it.notes].filter(Boolean).join(" | ") || null,
          })));
          if (itemsErr) console.warn("sale_items insert:", itemsErr.message);

          // Produtos vinculados nas opções → geram itens de venda para métricas
          const linkedItems: { sale_id: string; product_id: string; quantity: number; unit_price: number; total_price: number; notes: string }[] = [];
          for (const it of items) {
            for (const opt of (it.options ?? [])) {
              if (opt.linked_product_id) {
                linkedItems.push({
                  sale_id: sale.id,
                  product_id: opt.linked_product_id,
                  quantity: it.quantity,
                  unit_price: 0,
                  total_price: 0,
                  notes: `${it.product_name} → ${opt.option_name}`,
                });
              }
            }
          }
          if (linkedItems.length > 0) {
            const { error: linkedErr } = await supabase.from("sale_items").insert(linkedItems);
            if (linkedErr) console.warn("linked sale_items:", linkedErr.message);
          }
        }

        const { data: reg } = await supabase.from("cash_registers").select("id").eq("user_id", userId).eq("status", "open").maybeSingle();
        if (reg) {
          await supabase.from("cash_movements").insert({
            register_id: reg.id, user_id: userId, movement_type: "sale",
            amount: order.total_amount, payment_method: order.payment_method ?? "cash",
            channel: "digital_menu", description: `Cardápio Digital — Pedido #${order.order_number}`,
          });
        }

        const { error: updErr } = await supabase.from("digital_orders")
          .update({ status: "accepted", sale_id: sale.id, updated_at: new Date().toISOString() })
          .eq("id", order.id);

        if (updErr) {
          alert("Erro ao aceitar pedido: " + updErr.message);
          acceptingRef.current = false;
          if (acceptBtnRef.current) acceptBtnRef.current.disabled = false;
          return;
        }

        setTimeout(() => printLabel({ ...order, status: "accepted" }), 150);
      }
    } finally {
      acceptingRef.current = false;
      // Button is deleted by the Realtime update (status → accepted); no need to re-enable
    }
  }

  async function dispatchOrder(order: DigitalOrder) {
    await supabase.from("digital_orders").update({ status: "dispatched", updated_at: new Date().toISOString() }).eq("id", order.id);
  }

  async function cancelOrder(order: DigitalOrder) {
    if (!confirm(`Cancelar pedido #${order.order_number}? A venda vinculada no PDV/caixa também será cancelada.`)) return;
    // Cancela o pedido digital
    await supabase.from("digital_orders").update({ status: "cancelled" }).eq("id", order.id);
    // Cancela a venda vinculada no PDV e caixa
    if (order.sale_id) {
      await supabase.from("sales").update({ status: "cancelled" }).eq("id", order.sale_id);
    }
  }

  async function sendStoreMessage() {
    if (!newMsg.trim() || !selectedOrder) return;
    await supabase.from("menu_order_messages").insert({ order_id: selectedOrder.id, sender: "store", message: newMsg.trim() });
    setNewMsg("");
    // Admin replied → clear unread badge for this order
    setUnreadMsgOrders(prev => { const n = new Set(prev); n.delete(selectedOrder.id); return n; });
  }

  // ── Product actions
  async function toggleVisible(product: Product) {
    const v = !product.visible_digital_menu;
    await supabase.from("products").update({ visible_digital_menu: v }).eq("id", product.id);
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, visible_digital_menu: v } : p));
  }

  async function openEditor(product?: Product) {
    setEditProduct(product ?? { name: "", description: "", sale_price: 0, image_url: "", category_id: null, is_active: true, visible_digital_menu: true, is_configurable: false });
    if (product?.id && product.is_configurable) {
      const { data: groups } = await supabase.from("menu_option_groups").select("*, menu_options(*)").eq("product_id", product.id).order("position");
      setEditGroups((groups ?? []).map((g: any) => ({ ...g, options: [...(g.menu_options ?? [])].sort((a: any, b: any) => a.position - b.position) })) as OptionGroup[]);
    } else { setEditGroups([]); }
    setShowModal(true);
  }

  const addGroup = () => setEditGroups(prev => [...prev, { id: `new-${Date.now()}`, product_id: editProduct?.id ?? "", name: "Novo Grupo", min_choices: 0, max_choices: 1, required: false, position: prev.length, options: [] }]);
  const removeGroup = (gid: string) => setEditGroups(prev => prev.filter(g => g.id !== gid));
  const updateGroup = (gid: string, field: keyof OptionGroup, val: any) => setEditGroups(prev => prev.map(g => g.id === gid ? { ...g, [field]: val } : g));
  const addOption = (gid: string) => setEditGroups(prev => prev.map(g => g.id === gid ? { ...g, options: [...g.options, { id: `new-${Date.now()}`, group_id: gid, name: "", additional_price: 0, is_available: true, position: g.options.length, linked_product_id: null }] } : g));
  const removeOption = (gid: string, oid: string) => setEditGroups(prev => prev.map(g => g.id === gid ? { ...g, options: g.options.filter(o => o.id !== oid) } : g));
  const updateOption = (gid: string, oid: string, field: keyof MenuOption, val: any) => setEditGroups(prev => prev.map(g => g.id === gid ? { ...g, options: g.options.map(o => o.id === oid ? { ...o, [field]: val } : o) } : g));

  async function toggleOptionAvail(opt: MenuOption) {
    if (!opt.id.startsWith("new-")) await supabase.from("menu_options").update({ is_available: !opt.is_available }).eq("id", opt.id);
    setEditGroups(prev => prev.map(g => ({ ...g, options: g.options.map(o => o.id === opt.id ? { ...o, is_available: !o.is_available } : o) })));
  }

  async function saveProduct() {
    if (!userId || !editProduct?.name) return;
    setProductSaving(true);
    const payload = {
      name: editProduct.name,
      description: editProduct.description || null,
      sale_price: Number(editProduct.sale_price) || 0,
      cost_price: 0,
      promo_price: null,
      image_url: editProduct.image_url || null,
      category_id: editProduct.category_id || null,
      is_active: editProduct.is_active ?? true,
      status: "active",
      visible_digital_menu: editProduct.visible_digital_menu ?? true,
      visible_pdv: true,
      visible_tables: true,
      is_configurable: editProduct.is_configurable ?? false,
      unit: "unidade",
      stock: 0,
      stock_type: "unlimited",
      stock_min: 0,
      printer_destination: "balcao",
    };
    let pid = editProduct.id ?? "";
    if (!pid) {
      const { data, error: insErr } = await supabase.from("products").insert(payload).select("id").single();
      if (insErr || !data) {
        alert("Erro ao criar produto: " + (insErr?.message ?? "resposta vazia"));
        setProductSaving(false);
        return;
      }
      pid = data.id;
    } else {
      const { error: updErr } = await supabase.from("products").update(payload).eq("id", pid);
      if (updErr) { alert("Erro ao atualizar produto: " + updErr.message); setProductSaving(false); return; }
    }

    if (pid && editProduct.is_configurable) {
      const { data: dbG } = await supabase.from("menu_option_groups").select("id").eq("product_id", pid);
      const localGIds = editGroups.filter(g => !g.id.startsWith("new-")).map(g => g.id);
      const toDelG = (dbG ?? []).filter((g: any) => !localGIds.includes(g.id)).map((g: any) => g.id);
      if (toDelG.length > 0) await supabase.from("menu_option_groups").delete().in("id", toDelG);

      for (let gi = 0; gi < editGroups.length; gi++) {
        const g = editGroups[gi];
        const gp = { user_id: userId, product_id: pid, name: g.name, min_choices: g.min_choices, max_choices: g.max_choices, required: g.required, position: gi };
        let gid: string | null = g.id.startsWith("new-") ? null : g.id;
        if (gid) { await supabase.from("menu_option_groups").update(gp).eq("id", gid); }
        else { const { data } = await supabase.from("menu_option_groups").insert(gp).select("id").single(); gid = data?.id ?? null; }
        if (!gid) continue;
        const { data: dbO } = await supabase.from("menu_options").select("id").eq("group_id", gid);
        const localOIds = g.options.filter(o => !o.id.startsWith("new-")).map(o => o.id);
        const toDelO = (dbO ?? []).filter((o: any) => !localOIds.includes(o.id)).map((o: any) => o.id);
        if (toDelO.length > 0) await supabase.from("menu_options").delete().in("id", toDelO);
        for (let oi = 0; oi < g.options.length; oi++) {
          const o = g.options[oi];
          const op = { group_id: gid, name: o.name, additional_price: Number(o.additional_price) || 0, is_available: o.is_available, position: oi, linked_product_id: o.linked_product_id ?? null };
          if (o.id.startsWith("new-")) { await supabase.from("menu_options").insert(op); }
          else { await supabase.from("menu_options").update(op).eq("id", o.id); }
        }
      }
    } else if (pid && !editProduct.is_configurable) {
      await supabase.from("menu_option_groups").delete().eq("product_id", pid);
    }
    await loadProducts(); setShowModal(false); setEditProduct(null); setEditGroups([]); setProductSaving(false);
  }

  async function saveSettings(overrides?: Partial<StoreSettings>) {
    if (!userId) return;
    setSettingsSaving(true);
    const toSave = overrides ? { ...settings, ...overrides } : settings;
    if (overrides) setSettings(s => ({ ...s, ...overrides }));
    const { error } = await supabase.from("menu_store_settings").upsert(
      { user_id: userId, settings: toSave, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) console.error("Erro ao salvar configurações:", error);
    setSettingsSaving(false); setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 2500);
  }

  async function toggleStoreOpen() {
    const next = !settings.is_open;
    await saveSettings({ is_open: next, auto_hours: false });
  }

  async function toggleCategoryInMenu(catId: string) {
    const hidden = settings.hidden_categories_digital_menu ?? [];
    const isHidden = hidden.includes(catId);
    const newHidden = isHidden ? hidden.filter(id => id !== catId) : [...hidden, catId];
    await saveSettings({ hidden_categories_digital_menu: newHidden });
  }

  async function uploadImage(file: File, type: "logo" | "banner"): Promise<string | null> {
    if (!userId) return null;

    // Validação de segurança de arquivo
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxSizeBytes = 5 * 1024 * 1024; // 5MB
    if (!allowedMimeTypes.includes(file.type) || file.size > maxSizeBytes) {
      alert("Apenas JPEG, PNG e WebP até 5MB permitidos");
      return null;
    }

    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${userId}/${type}.${ext}`;
    const { error } = await supabase.storage.from("menu-assets").upload(path, file, { upsert: true, contentType: file.type });
    if (error) { alert("Erro ao enviar imagem: " + error.message); return null; }
    const { data: pub } = supabase.storage.from("menu-assets").getPublicUrl(path);
    return pub.publicUrl;
  }

  async function handleUploadLogo(file: File) {
    setLogoUploading(true);
    const url = await uploadImage(file, "logo");
    if (url) setSettings(s => ({ ...s, logo_url: url }));
    setLogoUploading(false);
  }

  async function handleUploadBanner(file: File) {
    setBannerUploading(true);
    const url = await uploadImage(file, "banner");
    if (url) setSettings(s => ({ ...s, banner_url: url }));
    setBannerUploading(false);
  }

  async function handleUploadProductImage(file: File) {
    if (!userId) return;

    // Validação de segurança de arquivo
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxSizeBytes = 5 * 1024 * 1024; // 5MB
    if (!allowedMimeTypes.includes(file.type) || file.size > maxSizeBytes) {
      alert("Apenas JPEG, PNG e WebP até 5MB permitidos");
      return;
    }

    setProductImgUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${userId}/products/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("menu-assets").upload(path, file, { upsert: false, contentType: file.type });
    if (!error) {
      const { data: pub } = supabase.storage.from("menu-assets").getPublicUrl(path);
      setEditProduct(p => ({ ...p!, image_url: pub.publicUrl }));
    } else {
      alert("Erro ao enviar foto: " + error.message);
    }
    setProductImgUploading(false);
  }

  // ── Derived
  const pendingCount     = orders.filter(o => o.status === "pending").length;
  const today            = new Date().toDateString();
  const todayRevenue     = orders.filter(o => new Date(o.created_at).toDateString() === today && o.status !== "cancelled").reduce((s, o) => s + o.total_amount, 0);
  const filteredOrders   = orders.filter(o => statusFilter === "all" || o.status === statusFilter);
  const filteredProducts = products.filter(p => (catFilter === "all" || p.category_id === catFilter) && (!productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())));
  const orderedCategories = (() => {
    const order = settings.category_order ?? [];
    if (order.length === 0) return categories;
    return [...categories].sort((a, b) => {
      const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
  })();

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 96px)" }}>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden min-w-0">

        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl p-5 flex-shrink-0"
          style={{ background: card.bg, border: card.border, boxShadow: card.shadow, backgroundImage:"radial-gradient(rgba(123,47,190,0.08) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: isLight ? "linear-gradient(135deg,rgba(123,47,190,0.04) 0%,rgba(0,180,216,0.03) 100%)" : "linear-gradient(135deg,rgba(123,47,190,0.08) 0%,transparent 100%)" }} />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background:"#7B2FBE", boxShadow:"0 0 6px #7B2FBE" }} />
                <span className="text-[11px] font-semibold uppercase tracking-widest"
                  style={isLight ? { background:"linear-gradient(135deg,#7B2FBE,#00B4D8)", WebkitBackgroundClip:"text", display:"inline-block",WebkitTextFillColor:"transparent", backgroundClip:"text" } : { color:"#7B2FBE", WebkitTextFillColor:"#7B2FBE", backgroundClip:"unset", WebkitBackgroundClip:"unset", background:"none" }}>Cardápio Digital</span>
              </div>
              <h1 className="text-2xl font-black g-text g-text-purple">
                {settings.store_name || "Meu Cardápio"}
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                {isStoreOpenNow(settings) ? "🟢 Loja aberta agora" : "🔴 Loja fechada agora"} · {products.filter(p => p.visible_digital_menu).length} produtos visíveis
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { loadOrders(); loadProducts(); if (userId) loadSettings(userId); }} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-xl transition-all border border-zinc-700 whitespace-nowrap">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
              </button>
              {/* Toggle rápido abrir/fechar loja — salva imediatamente */}
              <button onClick={toggleStoreOpen} disabled={settingsSaving}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border font-bold transition-all whitespace-nowrap"
                style={isStoreOpenNow(settings)
                  ? { background:"rgba(16,185,129,0.12)", color:"#10b981", borderColor:"rgba(16,185,129,0.4)" }
                  : { background:"rgba(244,63,94,0.1)",  color:"#f43f5e", borderColor:"rgba(244,63,94,0.35)" }}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isStoreOpenNow(settings) ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                {settingsSaving ? "Salvando..." : isStoreOpenNow(settings) ? "Aberta" : "Fechada"}
              </button>
              {menuUrl && (
                <button onClick={() => window.open(menuUrl, "_blank")}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-xl border transition-all"
                  style={isLight ? { color:"#7B2FBE", background:"rgba(123,47,190,0.08)", borderColor:"rgba(123,47,190,0.3)" } : { color:"#f59e0b", background:"rgba(245,158,11,0.08)", borderColor:"rgba(245,158,11,0.3)" }}>
                  <ExternalLink className="w-3.5 h-3.5" /> Ver Cardápio
                </button>
              )}
            </div>
          </div>
        </div>

        {/* New order alert */}
        {newOrderAlert && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border flex-shrink-0"
            style={{ background:"rgba(16,185,129,0.08)", borderColor:"rgba(16,185,129,0.4)", boxShadow:"0 0 20px rgba(16,185,129,0.15)" }}>
            <Bell className="w-5 h-5 flex-shrink-0 animate-bounce" style={{ color:"#10b981" }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color:"#10b981" }}>🔔 NOVO PEDIDO #{newOrderAlert.order_number}</p>
              <p className="text-xs text-zinc-400">{newOrderAlert.customer_name} · {fmt(newOrderAlert.total_amount)}</p>
            </div>
            <button onClick={() => { setSelectedOrder(newOrderAlert); setNewOrderAlert(null); setTab("orders"); setStatusFilter("pending"); }}
              className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background:"rgba(16,185,129,0.2)", color:"#10b981" }}>
              Ver Pedido
            </button>
            <button onClick={() => setNewOrderAlert(null)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* New message alert */}
        {newMsgNotif && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border flex-shrink-0"
            style={isLight ? { background:"rgba(123,47,190,0.08)", borderColor:"rgba(123,47,190,0.4)", boxShadow:"0 0 20px rgba(123,47,190,0.15)" } : { background:"rgba(245,158,11,0.08)", borderColor:"rgba(245,158,11,0.4)", boxShadow:"0 0 20px rgba(245,158,11,0.15)" }}>
            <MessageSquare className="w-5 h-5 flex-shrink-0 animate-bounce" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }}>💬 NOVA MENSAGEM — #{newMsgNotif.num}</p>
              <p className="text-xs text-zinc-400">{newMsgNotif.name}</p>
            </div>
            <button onClick={() => { const o = orders.find(x => x.id === newMsgNotif.orderId); if (o) { setSelectedOrder(o); setTab("orders"); setUnreadMsgOrders(prev => { const n = new Set(prev); n.delete(o.id); return n; }); } setNewMsgNotif(null); }}
              className="text-xs font-bold px-3 py-1.5 rounded-lg" style={isLight ? { background:"rgba(123,47,190,0.2)", color:"#7B2FBE" } : { background:"rgba(245,158,11,0.2)", color:"#f59e0b" }}>
              Ver Mensagem
            </button>
            <button onClick={() => setNewMsgNotif(null)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 flex-shrink-0" style={{ borderBottom: `1px solid ${isLight ? "#e5e7eb" : "#27272a"}` }}>
          {([
            { key: "orders"     as const, label: "Pedidos",   icon: <ClipboardList className="w-3.5 h-3.5" />, badge: pendingCount },
            { key: "products"   as const, label: "Cardápio",  icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
            { key: "appearance" as const, label: "Aparência", icon: <Store className="w-3.5 h-3.5" /> },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="relative flex items-center gap-2 px-5 py-2.5 text-xs font-bold transition-all flex-1 justify-center overflow-hidden"
              style={tab === t.key
                ? { color: isLight ? "#7B2FBE" : "#c4b5fd", background: isLight ? "rgba(123,47,190,0.07)" : "rgba(123,47,190,0.10)" }
                : { color:"#71717a" }}>
              {/* Gradient underline on active tab */}
              {tab === t.key && (
                <span className="absolute bottom-0 left-0 right-0 pointer-events-none"
                  style={{ height: 2, background: "linear-gradient(90deg,#7B2FBE,#00B4D8)" }} />
              )}
              {t.icon} {t.label}
              {(t as any).badge > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black" style={{ background:"#f43f5e", color:"#fff" }}>
                  {(t as any).badge > 9 ? "9+" : (t as any).badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ═══ PEDIDOS ═══ */}
        {tab === "orders" && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label:"Novos",        value: pendingCount,                                         color: isLight ? "#7B2FBE" : "#f59e0b", glow: isLight ? "rgba(123,47,190,0.15)" : "rgba(245,158,11,0.15)"  },
                { label:"Aceitos",      value: orders.filter(o=>o.status==="accepted").length,        color:"#06b6d4", glow:"rgba(6,182,212,0.15)"   },
                { label:"Despachados",  value: orders.filter(o=>o.status==="dispatched").length,      color:"#10b981", glow:"rgba(16,185,129,0.15)"  },
                { label:"Faturado Hoje",value: fmt(todayRevenue),                                    color:"#d946ef", glow:"rgba(217,70,239,0.15)"   },
              ].map(s => (
                <div key={s.label} className="relative overflow-hidden rounded-2xl p-3.5"
                  style={{ background: card.bg, border: card.border, boxShadow: isLight ? card.shadow : `0 0 22px ${s.glow}` }}>
                  <div className="absolute -top-5 -right-5 w-16 h-16 rounded-full opacity-20 blur-2xl pointer-events-none" style={{ background: s.color }} />
                  <p className="text-[11px] text-zinc-500 mb-1 relative z-10">{s.label}</p>
                  <p className="text-xl font-black relative z-10" style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Seletor de data — padrão: hoje */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setOrdersDate(todayStr)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={ordersDate === todayStr
                  ? { background: isLight ? "linear-gradient(135deg,#7B2FBE,#00B4D8)" : "#27272a", color:"#fff", border:"1px solid transparent" }
                  : { background: isLight ? "#F3F4F6" : "#18181b", color:"#71717a", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
                Hoje
              </button>
              <input
                type="date"
                value={ordersDate}
                max={todayStr}
                onChange={e => setOrdersDate(e.target.value)}
                className="text-xs rounded-xl px-3 py-1.5 font-medium transition-all outline-none"
                style={{ background: isLight ? "#F3F4F6" : "#18181b", color: isLight ? "#374151" : "#a1a1aa", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}
              />
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {(["all","pending","accepted","dispatched","cancelled"] as const).map(s => {
                const sc = STATUS_CFG[s];
                return (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                    style={statusFilter === s
                      ? isLight
                        ? { background:"linear-gradient(135deg,#7B2FBE,#00B4D8)", color:"#fff", border:"1px solid transparent", boxShadow:"0 2px 10px rgba(123,47,190,0.35)" }
                        : (s === "all" ? { background:"#27272a", color:"#fff", border:"1px solid #3f3f46" } : { background: sc?.bg, color: sc?.color, border:`1px solid ${sc?.border}` })
                      : { background: isLight ? "#F3F4F6" : "#18181b", color:"#71717a", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
                    {s === "all" ? "Todos" : sc?.label}{s === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2">
              {filteredOrders.length === 0 ? (
                <div className="text-center py-12 text-zinc-600 text-sm">Nenhum pedido encontrado</div>
              ) : filteredOrders.map(order => {
                const sc = STATUS_CFG[order.status] ?? STATUS_CFG.pending;
                const items = Array.isArray(order.items) ? order.items : [];
                const isSelected = selectedOrder?.id === order.id;
                return (
                  <div key={order.id} onClick={() => { setSelectedOrder(order); setUnreadMsgOrders(prev => { const n = new Set(prev); n.delete(order.id); return n; }); }}
                    className="rounded-2xl border p-4 cursor-pointer transition-all"
                    style={{
                      background: isSelected
                        ? (isLight ? "#f0fdf4" : "#1c1917")
                        : (isLight ? "#ffffff" : "#18181b"),
                      borderColor: isSelected ? sc.border : (isLight ? "#e5e7eb" : "#27272a"),
                      boxShadow: isSelected ? `0 0 0 1px ${sc.border}` : undefined,
                    }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {order.status === "pending" && <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: sc.color, boxShadow:`0 0 6px ${sc.color}` }} />}
                        <span className="text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0" style={{ background: sc.bg, color: sc.color, border:`1px solid ${sc.border}` }}>{sc.label}</span>
                        <span className="font-bold text-sm flex-shrink-0">#{order.order_number}</span>
                        <span className="text-xs text-zinc-500 truncate">{order.customer_name}</span>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="text-[10px] text-zinc-600">{fmtT(order.created_at)}</span>
                        <span className="font-bold text-sm" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }}>{fmt(order.total_amount)}</span>
                        {unreadMsgOrders.has(order.id) && (
                          <MessageSquare className="w-3.5 h-3.5 animate-pulse flex-shrink-0" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }} />
                        )}
                        <ChevronRight className="w-4 h-4 text-zinc-600" />
                      </div>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1.5 ml-5">
                      {items.length} iten{items.length !== 1 ? "s" : ""} · {PAY_LABELS[order.payment_method ?? ""] ?? "—"} · {order.order_type === "delivery" ? "Entrega" : "Retirada"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ CARDÁPIO ═══ */}
        {tab === "products" && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">

            {/* Visibilidade das categorias no cardápio digital */}
            {categories.length > 0 && (
              <div className="rounded-xl p-3 flex-shrink-0" style={{ background: isLight ? "#ffffff" : "rgba(24,24,27,0.6)", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Categorias no cardápio</p>
                  <p className="text-[10px] text-zinc-600 flex items-center gap-1"><GripVertical className="w-3 h-3" /> arraste para reordenar</p>
                </div>
                <div className="flex flex-col gap-1">
                  {orderedCategories.map(cat => {
                    const isVisible = !(settings.hidden_categories_digital_menu ?? []).includes(cat.id);
                    return (
                      <div
                        key={cat.id}
                        draggable
                        onDragStart={() => setDragCatId(cat.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => {
                          if (!dragCatId || dragCatId === cat.id) return;
                          const order = orderedCategories.map(c => c.id);
                          const fromIdx = order.indexOf(dragCatId);
                          const toIdx   = order.indexOf(cat.id);
                          const newOrder = [...order];
                          newOrder.splice(fromIdx, 1);
                          newOrder.splice(toIdx, 0, dragCatId);
                          saveSettings({ category_order: newOrder });
                          setDragCatId(null);
                        }}
                        onDragEnd={() => setDragCatId(null)}
                        className={`flex items-center gap-2 transition-opacity ${dragCatId === cat.id ? "opacity-40" : "opacity-100"}`}
                      >
                        <GripVertical className="w-3.5 h-3.5 text-zinc-600 cursor-grab flex-shrink-0" />
                        <button
                          onClick={() => toggleCategoryInMenu(cat.id)}
                          disabled={settingsSaving}
                          title={isVisible ? "Clique para ocultar do cardápio" : "Clique para mostrar no cardápio"}
                          className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border disabled:opacity-50"
                          style={isVisible
                            ? { background:"rgba(16,185,129,0.1)", color:"#10b981", borderColor:"rgba(16,185,129,0.3)" }
                            : { background: isLight ? "#F3F4F6" : "#18181b", color:"#71717a", borderColor: isLight ? "#e5e7eb" : "#27272a" }}>
                          {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {cat.name}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">🟢 Visível · ⬜ Oculta · Arraste pela alça para reordenar</p>
              </div>
            )}

            <div className="flex gap-1.5 overflow-x-auto pb-1 flex-shrink-0">
              {[{ id: "all", name: "Todas" }, ...categories].map(c => (
                <button key={c.id} onClick={() => setCatFilter(c.id)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
                  style={catFilter === c.id ? { background:"rgba(123,47,190,0.12)", color:"#7B2FBE", border:"1px solid rgba(123,47,190,0.3)" } : { background: isLight ? "#F3F4F6" : "#18181b", color:"#71717a", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
                  {c.name}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Buscar produto..." className={inputCls + " pl-8"} />
              </div>
              <button onClick={() => openEditor()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
                style={isLight ? { background:"linear-gradient(135deg,#7B2FBE,#00B4D8)", color:"#fff", boxShadow:"0 0 12px rgba(123,47,190,0.3)" } : { background:"linear-gradient(135deg,#d97706,#f59e0b)", color:"#fff", boxShadow:"0 0 12px rgba(245,158,11,0.3)" }}>
                <Plus className="w-4 h-4" /> Novo Produto
              </button>
            </div>

            <div className="space-y-2">
              {filteredProducts.map(product => (
                <div key={product.id} className="rounded-2xl p-4 flex items-center gap-4 transition-all" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <Package className="w-6 h-6 text-zinc-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="font-semibold text-sm">{product.name}</p>
                      {product.is_configurable && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0" style={{ background:"rgba(139,92,246,0.15)", color:"#8b5cf6", border:"1px solid rgba(139,92,246,0.3)" }}>MONTÁVEL</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-600 truncate">{product.description || categories.find(c => c.id === product.category_id)?.name || "Sem categoria"}</p>
                    <p className="text-sm font-bold mt-0.5" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }}>{fmt(product.sale_price)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => toggleVisible(product)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border"
                      style={product.visible_digital_menu ? { background:"rgba(16,185,129,0.1)", color:"#10b981", borderColor:"rgba(16,185,129,0.3)" } : { background: isLight ? "#F3F4F6" : "#18181b", color:"#71717a", borderColor: isLight ? "#e5e7eb" : "#27272a" }}>
                      {product.visible_digital_menu ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {product.visible_digital_menu ? "Visível" : "Oculto"}
                    </button>
                    <button onClick={() => openEditor(product)} className="p-2 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all" style={{ background: isLight ? "#F3F4F6" : "#3f3f46" }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {filteredProducts.length === 0 && <p className="text-center text-zinc-600 text-sm py-10">Nenhum produto encontrado</p>}
            </div>
          </div>
        )}

        {/* ═══ APARÊNCIA ═══ */}
        {tab === "appearance" && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Link */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Link do Cardápio</p>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl min-w-0">
                  <Globe className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                  <span className="text-xs font-mono text-zinc-400 truncate">{menuUrl || "Carregando..."}</span>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(menuUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border flex-shrink-0"
                  style={copied ? { background:"rgba(16,185,129,0.1)", color:"#10b981", borderColor:"rgba(16,185,129,0.3)" } : { background:"#27272a", color:"#a1a1aa", borderColor:"#3f3f46" }}>
                  {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              {/* Aviso quando rodando localmente */}
              {menuUrl.includes("localhost") && (
                <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.25)" }}>
                  <span className="text-amber-400 text-base flex-shrink-0 mt-0.5">⚠️</span>
                  <p className="text-xs text-amber-300/80 leading-relaxed">
                    <span className="font-bold text-amber-400">Ambiente local — link não funciona no WhatsApp.</span>
                    {" "}URLs com <span className="font-mono">localhost</span> só funcionam no seu computador.
                    Após publicar o sistema em um domínio real (ex: Vercel, Netlify), o link ficará clicável e o WhatsApp gerará um preview com o nome e imagem do cardápio.
                  </p>
                </div>
              )}
            </div>

            {/* Status */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Status da Loja</p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Horário Automático</p>
                  <p className="text-xs text-zinc-600">
                    {settings.auto_hours ? "Abre/fecha pelos horários abaixo automaticamente" : "Controle manual — use o botão ao lado"}
                  </p>
                </div>
                <button onClick={() => saveSettings({ auto_hours: !settings.auto_hours })} disabled={settingsSaving} className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                  style={settings.auto_hours ? { background:"rgba(6,182,212,0.15)", color:"#06b6d4", border:"1px solid rgba(6,182,212,0.3)" } : { background:"#18181b", color:"#71717a", border:"1px solid #27272a" }}>
                  {settingsSaving ? "..." : settings.auto_hours ? "✓ Ativado" : "Desativado"}
                </button>
              </div>

              {!settings.auto_hours && (
                <div className="flex items-center justify-between p-3 rounded-xl" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #3f3f46" }}>
                  <div>
                    <p className="text-sm font-semibold">{settings.is_open ? "🟢 Loja Aberta" : "🔴 Loja Fechada"}</p>
                    <p className="text-xs text-zinc-600">Clique para abrir/fechar agora — salva automaticamente</p>
                  </div>
                  <button onClick={toggleStoreOpen} disabled={settingsSaving} className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                    style={settings.is_open ? { background:"rgba(16,185,129,0.15)", color:"#10b981", border:"1px solid rgba(16,185,129,0.3)" } : { background:"rgba(244,63,94,0.1)", color:"#f43f5e", border:"1px solid rgba(244,63,94,0.3)" }}>
                    {settingsSaving ? "..." : settings.is_open ? "✓ Aberta" : "✗ Fechada"}
                  </button>
                </div>
              )}
            </div>

            {/* Basic info */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Informações da Loja</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-zinc-500 mb-1 block">Nome da Loja</label><input value={settings.store_name} onChange={e => setSettings(s => ({ ...s, store_name: e.target.value }))} className={inputCls} placeholder="Ex: Restaurante da Maria" /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">Slogan</label><input value={settings.tagline} onChange={e => setSettings(s => ({ ...s, tagline: e.target.value }))} className={inputCls} placeholder="Ex: Comida caseira de verdade" /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">WhatsApp</label><input value={settings.whatsapp} onChange={e => setSettings(s => ({ ...s, whatsapp: e.target.value }))} className={inputCls} placeholder="(11) 99999-9999" /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">Endereço</label><input value={settings.address} onChange={e => setSettings(s => ({ ...s, address: e.target.value }))} className={inputCls} placeholder="Rua, número, bairro" /></div>
              </div>
              {/* Logo upload */}
              <div>
                <label className="text-xs text-zinc-500 mb-2 block">Foto de Perfil (Logo)</label>
                <div className="flex gap-3 items-start">
                  <div className="w-20 h-20 rounded-xl border border-zinc-700 overflow-hidden flex-shrink-0 bg-zinc-800 flex items-center justify-center">
                    {settings.logo_url
                      ? <img src={settings.logo_url} className="w-full h-full object-cover object-center" alt="logo" />
                      : <ImageIcon className="w-6 h-6 text-zinc-600" />}
                  </div>
                  <label className="flex-1 flex flex-col items-center gap-1.5 py-3 px-4 border border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-violet-500/50 hover:bg-zinc-800/40 transition-all">
                    <Upload className="w-5 h-5 text-zinc-500" />
                    <span className="text-xs text-zinc-400 font-medium">{logoUploading ? "Enviando..." : "Clique para enviar"}</span>
                    <span className="text-[10px] text-zinc-600">JPG, PNG, WEBP · máx 5MB</span>
                    <input type="file" accept="image/*" className="hidden" disabled={logoUploading} onChange={e => e.target.files?.[0] && handleUploadLogo(e.target.files[0])} />
                  </label>
                </div>
              </div>

              {/* Banner upload */}
              <div>
                <label className="text-xs text-zinc-500 mb-2 block">Foto de Banner</label>
                <div className="space-y-2">
                  {settings.banner_url && (
                    <img src={settings.banner_url} className="w-full h-24 rounded-xl object-cover border border-zinc-700" alt="banner" />
                  )}
                  <label className="flex items-center gap-3 py-3 px-4 border border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-violet-500/50 hover:bg-zinc-800/40 transition-all">
                    <Upload className="w-5 h-5 text-zinc-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-zinc-400 font-medium">{bannerUploading ? "Enviando..." : "Clique para enviar o banner"}</p>
                      <p className="text-[10px] text-zinc-600">Recomendado 1200×400px · JPG, PNG, WEBP</p>
                    </div>
                    <input type="file" accept="image/*" className="hidden" disabled={bannerUploading} onChange={e => e.target.files?.[0] && handleUploadBanner(e.target.files[0])} />
                  </label>
                </div>
              </div>
            </div>

            {/* Delivery & payment */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Entrega e Pagamento</p>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-zinc-500 mb-1 block">Pedido Mínimo (R$)</label><input type="number" value={settings.min_order_value} onChange={e => setSettings(s => ({ ...s, min_order_value: Number(e.target.value) }))} className={inputCls} /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">Taxa Entrega (R$)</label><input type="number" value={settings.delivery_fee} onChange={e => setSettings(s => ({ ...s, delivery_fee: Number(e.target.value) }))} className={inputCls} /></div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Tempo (min)</label>
                  <div className="flex gap-1 items-center">
                    <input type="number" value={settings.estimated_time_min} onChange={e => setSettings(s => ({ ...s, estimated_time_min: Number(e.target.value) }))} className={inputCls + " text-center"} />
                    <span className="text-zinc-600 text-xs flex-shrink-0">~</span>
                    <input type="number" value={settings.estimated_time_max} onChange={e => setSettings(s => ({ ...s, estimated_time_max: Number(e.target.value) }))} className={inputCls + " text-center"} />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-2 block">Formas de Pagamento</label>
                <div className="flex gap-2 flex-wrap">
                  {[["cash","Dinheiro"],["pix","PIX"],["credit","Crédito"],["debit","Débito"]].map(([key, label]) => {
                    const active = settings.payment_methods.includes(key);
                    return (
                      <button key={key} onClick={() => setSettings(s => ({ ...s, payment_methods: active ? s.payment_methods.filter(m => m !== key) : [...s.payment_methods, key] }))}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border"
                        style={active ? (isLight ? { background:"rgba(123,47,190,0.15)", color:"#7B2FBE", borderColor:"rgba(123,47,190,0.4)" } : { background:"rgba(245,158,11,0.15)", color:"#f59e0b", borderColor:"rgba(245,158,11,0.4)" }) : { background:"transparent", color:"#71717a", borderColor:"#27272a" }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Hours */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Horários de Funcionamento</p>
              {WEEKDAYS.map(day => {
                const h = settings.hours[day.key] ?? { active: true, open: "08:00", close: "22:00" };
                return (
                  <div key={day.key} className="flex items-center gap-3">
                    <button onClick={() => setSettings(s => ({ ...s, hours: { ...s.hours, [day.key]: { ...h, active: !h.active } } }))}
                      className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                      style={h.active ? (isLight ? { background:"rgba(123,47,190,0.2)", border:"1px solid rgba(123,47,190,0.5)" } : { background:"rgba(245,158,11,0.2)", border:"1px solid rgba(245,158,11,0.5)" }) : (isLight ? { background:"transparent", border:"1px solid #3f3f46" } : { background:"#27272a", border:"1px solid #3f3f46" })}>
                      {h.active && <span style={{ color: isLight ? "#7B2FBE" : "#f59e0b", fontSize:9, fontWeight:"bold" }}>✓</span>}
                    </button>
                    <span className="text-xs w-16 font-medium flex-shrink-0" style={{ color: h.active ? "#e4e4e7" : "#52525b" }}>{day.label}</span>
                    <input type="time" value={h.open} disabled={!h.active}
                      onChange={e => setSettings(s => ({ ...s, hours: { ...s.hours, [day.key]: { ...h, open: e.target.value } } }))}
                      className="flex-1 px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white disabled:opacity-30 focus:outline-none focus:border-violet-500/50" />
                    <span className="text-zinc-600 text-xs flex-shrink-0">até</span>
                    <input type="time" value={h.close} disabled={!h.active}
                      onChange={e => setSettings(s => ({ ...s, hours: { ...s.hours, [day.key]: { ...h, close: e.target.value } } }))}
                      className="flex-1 px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white disabled:opacity-30 focus:outline-none focus:border-violet-500/50" />
                  </div>
                );
              })}
            </div>

            <button onClick={() => saveSettings()} disabled={settingsSaving}
              className="w-full py-3 rounded-2xl text-sm font-bold transition-all flex-shrink-0"
              style={settingsSaved
                ? { background:"rgba(16,185,129,0.15)", color:"#10b981", border:"1px solid rgba(16,185,129,0.3)" }
                : (isLight ? { background:"linear-gradient(135deg,#7B2FBE,#00B4D8)", color:"#fff", boxShadow:"0 0 16px rgba(123,47,190,0.3)" } : { background:"linear-gradient(135deg,#d97706,#f59e0b)", color:"#fff", boxShadow:"0 0 16px rgba(245,158,11,0.3)" })}>
              {settingsSaving ? "Salvando..." : settingsSaved ? "✓ Salvo!" : <span className="flex items-center justify-center gap-2"><Save className="w-4 h-4" /> Salvar Configurações</span>}
            </button>
          </div>
        )}
      </div>

      {/* ── Order Detail Panel ── */}
      {selectedOrder && tab === "orders" && (
        <div key={selectedOrder.id} className="w-96 flex-shrink-0 flex flex-col rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
          <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
            <div>
              <p className="font-bold text-sm">Pedido #{selectedOrder.order_number}</p>
              <p className="text-xs text-zinc-500">{fmtDT(selectedOrder.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={{ background: STATUS_CFG[selectedOrder.status]?.bg, color: STATUS_CFG[selectedOrder.status]?.color, border:`1px solid ${STATUS_CFG[selectedOrder.status]?.border}` }}>
                {STATUS_CFG[selectedOrder.status]?.label}
              </span>
              <button onClick={() => setSelectedOrder(null)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all"><X className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Customer */}
            <div className="p-4 border-b border-zinc-800 space-y-1.5">
              <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Cliente</p>
              <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" /><span className="text-sm">{selectedOrder.customer_name ?? "—"}</span></div>
              {selectedOrder.customer_phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" /><span className="text-sm">{selectedOrder.customer_phone}</span></div>}
              <div className="flex items-start gap-2"><MapPin className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0 mt-0.5" /><span className="text-sm">{selectedOrder.order_type === "delivery" ? (selectedOrder.delivery_address ?? "—") : "Retirada no balcão"}</span></div>
            </div>

            {/* Items */}
            <div className="p-4 border-b border-zinc-800">
              <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Itens do Pedido</p>
              <div className="space-y-2">
                {(Array.isArray(selectedOrder.items) ? selectedOrder.items : []).map((item, i) => (
                  <div key={i} className="bg-zinc-950 rounded-xl p-3">
                    <div className="flex justify-between text-sm font-semibold">
                      <span>{item.quantity}x {item.product_name}</span>
                      <span style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }}>{fmt(item.total_price ?? item.unit_price * item.quantity)}</span>
                    </div>
                    {(item.options ?? []).map((o, j) => (
                      <p key={j} className="text-xs text-zinc-500 mt-0.5">↳ {o.group_name}: <span className="text-zinc-400">{o.option_name}</span>{o.additional_price > 0 ? <span className="text-zinc-600"> (+{fmt(o.additional_price)})</span> : ""}</p>
                    ))}
                    {item.notes && <p className="text-xs text-zinc-600 italic mt-1">{item.notes}</p>}
                  </div>
                ))}
              </div>
              {selectedOrder.notes && (
                <div className="mt-2 p-2.5 rounded-xl" style={isLight ? { background:"rgba(123,47,190,0.05)", border:"1px solid rgba(123,47,190,0.2)" } : { background:"rgba(245,158,11,0.05)", border:"1px solid rgba(245,158,11,0.2)" }}>
                  <p className="text-[11px] font-bold mb-0.5" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }}>Observação</p>
                  <p className="text-xs text-zinc-400">{selectedOrder.notes}</p>
                </div>
              )}
            </div>

            {/* Payment */}
            <div className="p-4 border-b border-zinc-800">
              <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Pagamento</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-zinc-400">Forma</span><span className="font-semibold">{PAY_LABELS[selectedOrder.payment_method ?? ""] ?? selectedOrder.payment_method ?? "—"}</span></div>
                {selectedOrder.change_for && <div className="flex justify-between text-sm"><span className="text-zinc-400">Troco para</span><span className="font-semibold">{fmt(selectedOrder.change_for)}</span></div>}
                <div className="flex justify-between text-sm border-t border-zinc-800 pt-2"><span className="font-bold">Total</span><span className="font-black text-base" style={{ color: isLight ? "#7B2FBE" : "#f59e0b" }}>{fmt(selectedOrder.total_amount)}</span></div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-b border-zinc-800 space-y-2">
              <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Ações</p>
              {selectedOrder.status === "pending" && (
                <button ref={acceptBtnRef} onClick={() => acceptOrder(selectedOrder)}
                  className="w-full py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background:"linear-gradient(135deg,#0891b2,#06b6d4)", color:"#fff", boxShadow:"0 0 14px rgba(6,182,212,0.3)" }}>
                  ✓ Aceitar Pedido (gera venda)
                </button>
              )}
              {selectedOrder.status === "accepted" && (
                <button onClick={() => dispatchOrder(selectedOrder)}
                  className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background:"linear-gradient(135deg,#059669,#10b981)", color:"#fff", boxShadow:"0 0 14px rgba(16,185,129,0.3)" }}>
                  <Truck className="w-4 h-4 inline mr-1.5" />Despachar Pedido
                </button>
              )}
              <div className="flex gap-2">
                <button onClick={() => printLabel(selectedOrder)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all">
                  <Printer className="w-3.5 h-3.5" /> {selectedOrder.status === "dispatched" || selectedOrder.status === "cancelled" ? "Reimprimir" : "Imprimir Etiqueta"}
                </button>
                {selectedOrder.status !== "cancelled" && selectedOrder.status !== "dispatched" ? (
                  <button onClick={() => cancelOrder(selectedOrder)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={{ background:"rgba(244,63,94,0.1)", color:"#f43f5e", border:"1px solid rgba(244,63,94,0.25)" }}>
                    <X className="w-3.5 h-3.5" /> Cancelar
                  </button>
                ) : selectedOrder.status === "cancelled" ? (
                  <div className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold"
                    style={{ background:"rgba(244,63,94,0.06)", color:"#f43f5e", border:"1px solid rgba(244,63,94,0.15)" }}>
                    <X className="w-3.5 h-3.5" /> Cancelado
                  </div>
                ) : null}
              </div>
            </div>

            {/* Messages */}
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Chat com o Cliente</p>
                {unreadMsgOrders.has(selectedOrder.id) && (
                  <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse"
                    style={isLight ? { background:"rgba(123,47,190,0.15)", color:"#7B2FBE", border:"1px solid rgba(123,47,190,0.4)" } : { background:"rgba(245,158,11,0.15)", color:"#f59e0b", border:"1px solid rgba(245,158,11,0.4)" }}>
                    <MessageSquare className="w-3 h-3" /> Nova mensagem!
                  </span>
                )}
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {orderMessages.length === 0 && <p className="text-xs text-zinc-600 text-center py-4">Nenhuma mensagem. Use para avisar o cliente sobre alterações no pedido.</p>}
                {orderMessages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.sender === "store" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%] px-3 py-2 text-xs"
                      style={msg.sender === "store"
                        ? (isLight ? { background:"rgba(123,47,190,0.2)", color:"#c4b5fd", borderRadius:"14px 14px 2px 14px" } : { background:"rgba(245,158,11,0.2)", color:"#fde68a", borderRadius:"14px 14px 2px 14px" })
                        : { background:"#27272a", color:"#e4e4e7", borderRadius:"14px 14px 14px 2px" }}>
                      <p>{msg.message}</p>
                      <p className="text-[10px] opacity-50 mt-0.5 text-right">{fmtT(msg.created_at)}</p>
                    </div>
                  </div>
                ))}
                <div ref={msgEndRef} />
              </div>
              <div className="flex gap-2">
                <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendStoreMessage()}
                  placeholder="Mensagem para o cliente..." className={inputCls + " flex-1"} />
                <button onClick={sendStoreMessage} disabled={!newMsg.trim()}
                  className="p-2.5 rounded-xl transition-all disabled:opacity-40"
                  style={isLight ? { background:"rgba(123,47,190,0.15)", color:"#7B2FBE", border:"1px solid rgba(123,47,190,0.3)" } : { background:"rgba(245,158,11,0.15)", color:"#f59e0b", border:"1px solid rgba(245,158,11,0.3)" }}>
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Product editor modal ── */}
      {showModal && editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight:"90vh" }}>
            <div className="flex items-center justify-between p-5 border-b border-zinc-800 flex-shrink-0">
              <h3 className="font-bold text-base">{editProduct.id ? "Editar Produto" : "Novo Produto"}</h3>
              <button onClick={() => { setShowModal(false); setEditProduct(null); setEditGroups([]); }} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-zinc-500 mb-1 block">Nome *</label><input value={editProduct.name ?? ""} onChange={e => setEditProduct(p => ({ ...p!, name: e.target.value }))} className={inputCls} placeholder="Nome do produto" /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">Preço Base (R$)</label><input type="number" step="0.01" value={editProduct.sale_price ?? 0} onChange={e => setEditProduct(p => ({ ...p!, sale_price: Number(e.target.value) }))} className={inputCls} /></div>
                <div className="col-span-2"><label className="text-xs text-zinc-500 mb-1 block">Descrição</label><textarea value={editProduct.description ?? ""} onChange={e => setEditProduct(p => ({ ...p!, description: e.target.value }))} className={inputCls + " resize-none"} rows={2} placeholder="Descrição do produto" /></div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Categoria</label>
                  <select value={editProduct.category_id ?? ""} onChange={e => setEditProduct(p => ({ ...p!, category_id: e.target.value || null }))} className={inputCls}>
                    <option value="">Sem categoria</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Foto do Produto</label>
                  <div className="flex gap-2 items-start">
                    <div className="w-14 h-14 rounded-xl border border-zinc-700 overflow-hidden flex-shrink-0 bg-zinc-800 flex items-center justify-center">
                      {editProduct.image_url
                        ? <img src={editProduct.image_url} className="w-full h-full object-cover" alt="" />
                        : <ImageIcon className="w-5 h-5 text-zinc-600" />}
                    </div>
                    <label className="flex-1 flex flex-col items-center gap-1 py-2.5 px-3 border border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-violet-500/50 hover:bg-zinc-800/40 transition-all">
                      <Upload className="w-4 h-4 text-zinc-500" />
                      <span className="text-[11px] text-zinc-400">{productImgUploading ? "Enviando..." : "Importar foto"}</span>
                      <input type="file" accept="image/*" className="hidden" disabled={productImgUploading} onChange={e => e.target.files?.[0] && handleUploadProductImage(e.target.files[0])} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setEditProduct(p => ({ ...p!, visible_digital_menu: !p?.visible_digital_menu }))}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all border"
                  style={editProduct.visible_digital_menu ? { background:"rgba(16,185,129,0.1)", color:"#10b981", borderColor:"rgba(16,185,129,0.3)" } : { background:"transparent", color:"#71717a", borderColor:"#3f3f46" }}>
                  {editProduct.visible_digital_menu ? "✓ Visível no Cardápio" : "Oculto no Cardápio"}
                </button>
                <button onClick={() => { setEditProduct(p => ({ ...p!, is_configurable: !p?.is_configurable })); if (!editProduct.is_configurable) setEditGroups([]); }}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all border"
                  style={editProduct.is_configurable ? (isLight ? { background:"rgba(123,47,190,0.1)", color:"#7B2FBE", borderColor:"rgba(123,47,190,0.3)" } : { background:"rgba(139,92,246,0.1)", color:"#8b5cf6", borderColor:"rgba(139,92,246,0.3)" }) : { background:"transparent", color:"#71717a", borderColor:"#3f3f46" }}>
                  {editProduct.is_configurable ? "✓ Produto Montável" : "Produto Fixo"}
                </button>
              </div>

              {editProduct.is_configurable && (
                <div className="space-y-3 border-t border-zinc-800 pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Grupos de Opções</p>
                      <p className="text-xs text-zinc-600 mt-0.5">Configure as escolhas do cliente (ex: Misturas, Acompanhamentos)</p>
                    </div>
                    <button onClick={addGroup} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all" style={{ background:"rgba(139,92,246,0.15)", color:"#8b5cf6", border:"1px solid rgba(139,92,246,0.3)" }}>
                      <Plus className="w-3.5 h-3.5" /> Adicionar Grupo
                    </button>
                  </div>

                  {editGroups.map(group => (
                    <div key={group.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <input value={group.name} onChange={e => updateGroup(group.id, "name", e.target.value)}
                          className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm font-bold text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                          placeholder="Nome do grupo (ex: Misturas, Acompanhamentos)" />
                        <button onClick={() => removeGroup(group.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>

                      <div className="flex gap-3 items-center flex-wrap">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">Mín:</label>
                          <input type="number" min={0} value={group.min_choices} onChange={e => updateGroup(group.id, "min_choices", Number(e.target.value))} className="w-14 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white text-center focus:outline-none focus:border-violet-500" />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">Máx:</label>
                          <input type="number" min={1} value={group.max_choices} onChange={e => updateGroup(group.id, "max_choices", Number(e.target.value))} className="w-14 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white text-center focus:outline-none focus:border-violet-500" />
                        </div>
                        <button onClick={() => updateGroup(group.id, "required", !group.required)}
                          className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all border"
                          style={group.required ? { background:"rgba(244,63,94,0.1)", color:"#f43f5e", borderColor:"rgba(244,63,94,0.3)" } : { background:"#18181b", color:"#71717a", borderColor:"#27272a" }}>
                          {group.required ? "Obrigatório" : "Opcional"}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {group.options.map(opt => (
                          <div key={opt.id} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <button onClick={() => toggleOptionAvail(opt)} title={opt.is_available ? "Disponível (clique para desativar)" : "Indisponível (clique para ativar)"}
                                className="w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center transition-all"
                                style={opt.is_available ? { background:"rgba(16,185,129,0.2)", border:"1px solid rgba(16,185,129,0.5)" } : { background:"#27272a", border:"1px solid #3f3f46" }}>
                                {opt.is_available && <span style={{ color:"#10b981", fontSize:9, fontWeight:"bold" }}>✓</span>}
                              </button>
                              <input value={opt.name} onChange={e => updateOption(group.id, opt.id, "name", e.target.value)}
                                placeholder="Nome da opção (ex: Bife, Frango)"
                                className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/50" />
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span className="text-xs text-zinc-600">+R$</span>
                                <input type="number" step="0.50" min={0} value={opt.additional_price} onChange={e => updateOption(group.id, opt.id, "additional_price", Number(e.target.value))}
                                  className="w-16 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white text-center focus:outline-none focus:border-violet-500/50" />
                              </div>
                              <button onClick={() => removeOption(group.id, opt.id)} className="text-zinc-700 hover:text-red-400 transition-all flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                            </div>
                            {/* Vínculo com produto para métricas */}
                            <div className="flex items-center gap-1.5 pl-7">
                              <Package className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                              <select
                                value={opt.linked_product_id ?? ""}
                                onChange={e => {
                                  const pid = e.target.value || null;
                                  updateOption(group.id, opt.id, "linked_product_id", pid);
                                  if (pid && !opt.name.trim()) {
                                    const found = products.find(x => x.id === pid);
                                    if (found) updateOption(group.id, opt.id, "name", found.name);
                                  }
                                }}
                                className="flex-1 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-[11px] text-zinc-500 focus:outline-none focus:border-violet-500/50"
                              >
                                <option value="">Sem vínculo — sem métricas</option>
                                {products.filter(p => p.id !== editProduct?.id).map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                              {opt.linked_product_id && (
                                <span className="text-[10px] font-bold text-violet-400 whitespace-nowrap flex-shrink-0">✓ métricas</span>
                              )}
                            </div>
                          </div>
                        ))}
                        <button onClick={() => addOption(group.id)}
                          className="w-full py-1.5 rounded-xl text-xs text-zinc-600 hover:text-zinc-400 border border-dashed border-zinc-800 hover:border-zinc-700 transition-all">
                          + Adicionar opção
                        </button>
                      </div>
                    </div>
                  ))}

                  {editGroups.length === 0 && (
                    <div className="text-center py-6 text-zinc-600 text-xs border border-dashed border-zinc-800 rounded-2xl">
                      Nenhum grupo ainda. Ex: crie "Misturas" com opções Bife, Frango, Toscana...
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-zinc-800 flex gap-3 flex-shrink-0">
              <button onClick={() => { setShowModal(false); setEditProduct(null); setEditGroups([]); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all">Cancelar</button>
              <button onClick={saveProduct} disabled={productSaving || !editProduct.name}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                style={isLight ? { background:"linear-gradient(135deg,#7B2FBE,#00B4D8)", color:"#fff", boxShadow:"0 0 12px rgba(123,47,190,0.3)" } : { background:"linear-gradient(135deg,#d97706,#f59e0b)", color:"#fff", boxShadow:"0 0 12px rgba(245,158,11,0.3)" }}>
                {productSaving ? "Salvando..." : "Salvar Produto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
