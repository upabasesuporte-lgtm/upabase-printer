import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  ShoppingCart, Plus, Minus, X, Search, Clock, CheckCircle2,
  ChefHat, MapPin, Phone, User, ChevronRight, AlertCircle,
  Truck, UtensilsCrossed, ArrowLeft, Send, MessageSquare,
  Banknote, CreditCard, QrCode, Package, ChevronDown,
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

interface Product {
  id: string; name: string; description: string | null;
  sale_price: number; promo_price: number | null; image_url: string | null;
  category_id: string | null; is_active: boolean;
  visible_digital_menu: boolean; is_configurable: boolean;
}

interface Category { id: string; name: string; }

interface MenuOption {
  id: string; group_id: string; name: string;
  additional_price: number; is_available: boolean; position: number;
  linked_product_id?: string | null;
}

interface OptionGroup {
  id: string; product_id: string; name: string;
  min_choices: number; max_choices: number; required: boolean; position: number;
  options: MenuOption[];
}

interface SelectedOption {
  group_id: string; group_name: string;
  option_id: string; option_name: string; additional_price: number;
  linked_product_id?: string | null;
}

interface CartItem {
  product: Product; quantity: number;
  options: SelectedOption[]; unit_extra: number; notes: string;
}

interface ChatMessage {
  id: string; order_id: string; sender: "store" | "customer";
  message: string; created_at: string;
}

interface TrackedOrder {
  id: string; order_number: string | null; status: string;
  customer_name: string | null; total_amount: number;
  items: { product_name: string; quantity: number; unit_price: number; options?: SelectedOption[] }[];
  delivery_address: string | null; order_type: string | null;
  payment_method: string | null; change_for: number | null;
  notes: string | null;
}

type Step = "menu" | "configure" | "cart" | "checkout" | "tracking";
type PayMethod = "cash" | "pix" | "credit" | "debit";

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtT = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function playMessageBeep() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    function ping(freq: number, t: number) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t); osc.stop(t + 0.35);
    }
    const t0 = ctx.currentTime;
    ping(880, t0);
    ping(1100, t0 + 0.16);
  } catch {}
}

const DEFAULT_SETTINGS: StoreSettings = {
  store_name: "", tagline: "", logo_url: "", banner_url: "",
  is_open: false, auto_hours: false,
  hours: Object.fromEntries(
    ["seg","ter","qua","qui","sex","sab","dom"].map(k => [k, { active: k !== "dom", open: "08:00", close: "22:00" }])
  ),
  payment_methods: ["cash","pix"],
  min_order_value: 0, delivery_fee: 0,
  estimated_time_min: 30, estimated_time_max: 50,
  whatsapp: "", address: "",
  category_order: [],
};

const PAY_LABELS: Record<string, string> = {
  cash: "Dinheiro", pix: "PIX", credit: "Cartão Crédito", debit: "Cartão Débito",
};

const PAY_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  cash: Banknote, pix: QrCode, credit: CreditCard, debit: CreditCard,
};
function PayIcon({ method, className = "w-4 h-4" }: { method: string; className?: string }) {
  const Icon = PAY_ICON_MAP[method] ?? Banknote;
  return <Icon className={className} />;
}

const STATUS_STEPS: { key: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "pending",    label: "Recebido",   Icon: Package },
  { key: "accepted",   label: "Em preparo", Icon: ChefHat },
  { key: "dispatched", label: "A caminho",  Icon: Truck   },
];
const STATUS_CANCELLED = { key: "cancelled", label: "Cancelado" };

function generateOrderNumber(): string {
  const now = new Date();
  const dm = `${String(now.getDate()).padStart(2,"0")}${String(now.getMonth()+1).padStart(2,"0")}`;
  return `${dm}${Math.random().toString(36).substring(2,5).toUpperCase()}`;
}

function isStoreOpenNow(settings: StoreSettings): boolean {
  if (!settings.auto_hours) return settings.is_open;
  const now = new Date();
  const dayKeys = ["dom","seg","ter","qua","qui","sex","sab"];
  const key = dayKeys[now.getDay()];
  const day = settings.hours[key];
  if (!day?.active) return false;
  const [oh, om] = day.open.split(":").map(Number);
  const [ch, cm] = day.close.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= oh * 60 + om && cur < ch * 60 + cm;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PublicMenuPage() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();

  const [settings, setSettings]     = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [storeFound, setStoreFound] = useState<boolean | null>(null);
  const [products, setProducts]     = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups]         = useState<Record<string, OptionGroup[]>>({});
  const [loading, setLoading]       = useState(true);

  const [step, setStep]             = useState<Step>("menu");
  const [activeCat, setActiveCat]   = useState("all");
  const [search, setSearch]         = useState("");
  const [cart, setCart]             = useState<CartItem[]>([]);

  // configure step
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [selOptions, setSelOptions]       = useState<SelectedOption[]>([]);
  const [configNotes, setConfigNotes]     = useState("");
  const [configQty, setConfigQty]         = useState(1);
  const [configError, setConfigError]     = useState("");

  // checkout
  const [orderType, setOrderType]     = useState<"delivery"|"takeaway">("takeaway");
  const [custName, setCustName]       = useState("");
  const [custPhone, setCustPhone]     = useState("");
  const [address, setAddress]         = useState("");
  const [payMethod, setPayMethod]     = useState<PayMethod>("pix");
  const [changeFor, setChangeFor]     = useState("");
  const [obsGeral, setObsGeral]       = useState("");
  const [formError, setFormError]     = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // tracking
  const [trackedOrder, setTrackedOrder]   = useState<TrackedOrder | null>(null);
  const [chatMessages, setChatMessages]   = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]         = useState("");
  const [sendingMsg, setSendingMsg]       = useState(false);
  const [storeMsgAlert, setStoreMsgAlert] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load store ────────────────────────────────────────────────────────────

  const loadStore = useCallback(async () => {
    if (!uid) { setStoreFound(false); setLoading(false); return; }

    const { data: settingsRow } = await supabase
      .from("menu_store_settings")
      .select("settings")
      .eq("user_id", uid)
      .maybeSingle();

    if (!settingsRow) { setStoreFound(false); setLoading(false); return; }

    const merged: StoreSettings = { ...DEFAULT_SETTINGS, ...(settingsRow.settings ?? {}) };
    setSettings(merged);
    setStoreFound(true);

    const pms = merged.payment_methods ?? ["pix"];
    if (pms.length > 0) setPayMethod(pms[0] as PayMethod);

    const [prodRes, catRes] = await Promise.all([
      supabase.from("products")
        .select("id,name,description,sale_price,promo_price,image_url,category_id,is_active,visible_digital_menu,is_configurable")
        .eq("user_id", uid)
        .eq("is_active", true)
        .eq("visible_digital_menu", true)
        .order("name"),
      supabase.from("categories")
        .select("id,name")
        .eq("user_id", uid)
        .order("name"),
    ]);

    const prods: Product[] = (prodRes.data ?? []) as Product[];
    setProducts(prods);
    setCategories((catRes.data ?? []) as Category[]);

    const configurableIds = prods.filter(p => p.is_configurable).map(p => p.id);
    if (configurableIds.length > 0) {
      const { data: grpData } = await supabase
        .from("menu_option_groups")
        .select("id,product_id,name,min_choices,max_choices,required,position")
        .in("product_id", configurableIds)
        .eq("user_id", uid)
        .order("position");

      const grpList = (grpData ?? []) as Omit<OptionGroup, "options">[];

      if (grpList.length > 0) {
        const { data: optData } = await supabase
          .from("menu_options")
          .select("id,group_id,name,additional_price,is_available,position,linked_product_id")
          .in("group_id", grpList.map(g => g.id))
          .eq("is_available", true)
          .order("position");

        const optsByGroup: Record<string, MenuOption[]> = {};
        for (const opt of (optData ?? []) as MenuOption[]) {
          if (!optsByGroup[opt.group_id]) optsByGroup[opt.group_id] = [];
          optsByGroup[opt.group_id].push(opt);
        }

        const byProduct: Record<string, OptionGroup[]> = {};
        for (const g of grpList) {
          if (!byProduct[g.product_id]) byProduct[g.product_id] = [];
          byProduct[g.product_id].push({ ...g, options: optsByGroup[g.id] ?? [] });
        }
        setGroups(byProduct);
      }
    }

    setLoading(false);
  }, [uid]);

  useEffect(() => { loadStore(); }, [loadStore]);

  // ── Realtime: tracking ────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== "tracking" || !trackedOrder) return;

    let cancelled = false;
    const orderId = trackedOrder.id;

    const orderCh = supabase.channel(`order-status-${orderId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "digital_orders",
        filter: `id=eq.${orderId}`,
      }, payload => {
        if (!cancelled) setTrackedOrder(prev => prev ? { ...prev, status: (payload.new as any).status } : prev);
      })
      .subscribe();

    const msgCh = supabase.channel(`order-msgs-${orderId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "menu_order_messages",
        filter: `order_id=eq.${orderId}`,
      }, payload => {
        if (!cancelled) {
          const msg = payload.new as ChatMessage;
          setChatMessages(prev => [...prev, msg]);
          setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          // Alerta quando a loja manda mensagem pro cliente
          if (msg.sender === "store") {
            playMessageBeep();
            setStoreMsgAlert(true);
            setTimeout(() => setStoreMsgAlert(false), 5000);
          }
        }
      })
      .subscribe();

    supabase.from("menu_order_messages")
      .select("id,order_id,sender,message,created_at")
      .eq("order_id", orderId)
      .order("created_at")
      .then(({ data }) => { if (!cancelled) setChatMessages((data ?? []) as ChatMessage[]); });

    return () => {
      cancelled = true;
      supabase.removeChannel(orderCh);
      supabase.removeChannel(msgCh);
    };
  }, [step, trackedOrder?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Cart helpers ──────────────────────────────────────────────────────────

  function openConfigure(product: Product) {
    setConfigProduct(product);
    setSelOptions([]);
    setConfigNotes("");
    setConfigQty(1);
    setConfigError("");
    setStep("configure");
  }

  function toggleOption(group: OptionGroup, opt: MenuOption) {
    setSelOptions(prev => {
      const inGroup = prev.filter(o => o.group_id === group.id);
      const alreadySel = inGroup.some(o => o.option_id === opt.id);

      if (alreadySel) {
        return prev.filter(o => !(o.group_id === group.id && o.option_id === opt.id));
      }

      if (group.max_choices === 1) {
        const others = prev.filter(o => o.group_id !== group.id);
        return [...others, { group_id: group.id, group_name: group.name, option_id: opt.id, option_name: opt.name, additional_price: opt.additional_price, linked_product_id: opt.linked_product_id }];
      }

      if (inGroup.length >= group.max_choices) return prev;

      return [...prev, { group_id: group.id, group_name: group.name, option_id: opt.id, option_name: opt.name, additional_price: opt.additional_price, linked_product_id: opt.linked_product_id }];
    });
  }

  function addConfiguredToCart() {
    if (!configProduct) return;
    const productGroups = groups[configProduct.id] ?? [];

    for (const grp of productGroups) {
      const chosen = selOptions.filter(o => o.group_id === grp.id).length;
      if (grp.required && chosen < grp.min_choices) {
        setConfigError(`Escolha pelo menos ${grp.min_choices} opção em "${grp.name}".`);
        return;
      }
    }

    const extra = selOptions.reduce((s, o) => s + o.additional_price, 0);
    const existIdx = cart.findIndex(i =>
      i.product.id === configProduct.id &&
      JSON.stringify(i.options.map(o => o.option_id).sort()) ===
      JSON.stringify(selOptions.map(o => o.option_id).sort())
    );

    if (existIdx >= 0) {
      setCart(prev => prev.map((item, idx) =>
        idx === existIdx ? { ...item, quantity: item.quantity + configQty } : item
      ));
    } else {
      setCart(prev => [...prev, {
        product: configProduct, quantity: configQty,
        options: [...selOptions], unit_extra: extra, notes: configNotes,
      }]);
    }

    setStep("menu");
    setConfigProduct(null);
  }

  function addFixed(product: Product) {
    setCart(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id && i.options.length === 0);
      if (idx >= 0) return prev.map((item, i) => i === idx ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { product, quantity: 1, options: [], unit_extra: 0, notes: "" }];
    });
  }

  function changeQty(cartIdx: number, delta: number) {
    setCart(prev => prev.map((item, i) => i === cartIdx ? { ...item, quantity: item.quantity + delta } : item).filter(i => i.quantity > 0));
  }

  function removeItem(cartIdx: number) {
    setCart(prev => prev.filter((_, i) => i !== cartIdx));
  }

  function itemPrice(item: CartItem) {
    return (item.product.promo_price ?? item.product.sale_price) + item.unit_extra;
  }

  const subtotal    = cart.reduce((s, i) => s + itemPrice(i) * i.quantity, 0);
  const deliveryFee = orderType === "delivery" ? (settings.delivery_fee ?? 0) : 0;
  const total       = subtotal + deliveryFee;
  const totalItems  = cart.reduce((s, i) => s + i.quantity, 0);

  function getFixedQty(productId: string): number {
    return cart.filter(i => i.product.id === productId && i.options.length === 0).reduce((s, i) => s + i.quantity, 0);
  }

  // ── Submit order ──────────────────────────────────────────────────────────

  async function submitOrder() {
    setFormError("");

    if (!custName.trim()) { setFormError("Informe seu nome para continuar."); return; }
    if (!custPhone.trim()) { setFormError("Informe seu telefone para continuar."); return; }
    if (orderType === "delivery" && !address.trim()) { setFormError("Informe o endereço de entrega."); return; }
    if (subtotal < (settings.min_order_value ?? 0)) {
      setFormError(`Pedido mínimo de ${fmt(settings.min_order_value)}.`); return;
    }
    if (cart.length === 0) { setFormError("O carrinho está vazio."); return; }

    setSubmitting(true);

    const num = generateOrderNumber();
    const items = cart.map(i => ({
      product_id:   i.product.id,
      product_name: i.product.name,
      quantity:     i.quantity,
      unit_price:   itemPrice(i),
      total_price:  itemPrice(i) * i.quantity,
      notes:        i.notes || undefined,
      options:      i.options.length > 0 ? i.options.map(o => ({
        group_name: o.group_name, option_name: o.option_name, additional_price: o.additional_price,
        ...(o.linked_product_id ? { linked_product_id: o.linked_product_id } : {}),
      })) : undefined,
    }));

    const changeForVal = payMethod === "cash" && changeFor.trim()
      ? parseFloat(changeFor.replace(",", ".")) || null
      : null;

    const { data: orderRow, error } = await supabase.from("digital_orders").insert({
      user_id:          uid,
      customer_name:    custName.trim(),
      customer_phone:   custPhone.trim(),
      delivery_address: orderType === "delivery" ? address.trim() : null,
      order_type:       orderType,
      items,
      total_amount:     total,
      notes:            obsGeral.trim() || null,
      status:           "pending",
      order_number:     num,
      payment_method:   payMethod,
      change_for:       changeForVal,
    }).select("id,order_number,status,customer_name,total_amount,items,delivery_address,order_type,payment_method,change_for,notes").single();

    if (error || !orderRow) {
      setSubmitting(false);
      setFormError("Erro ao enviar pedido. Tente novamente.");
      return;
    }

    // Navigate before any state change — component unmounts cleanly, no DOM reconciliation
    navigate(`/menu/${uid}/pedido/${orderRow.id}`);
  }

  // ── Send chat message ─────────────────────────────────────────────────────

  async function sendMessage() {
    if (!chatInput.trim() || !trackedOrder || sendingMsg) return;
    setSendingMsg(true);
    await supabase.from("menu_order_messages").insert({
      order_id: trackedOrder.id,
      sender:   "customer",
      message:  chatInput.trim(),
    });
    setChatInput("");
    setSendingMsg(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const hiddenCatIds = settings.hidden_categories_digital_menu ?? [];
  const catIds      = [...new Set(products.map(p => p.category_id).filter(Boolean))] as string[];
  const orderedCatList = (() => {
    const order = settings.category_order ?? [];
    if (order.length === 0) return categories;
    return [...categories].sort((a, b) => {
      const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
  })();
  const visibleCats = orderedCatList.filter(c => catIds.includes(c.id) && !hiddenCatIds.includes(c.id));
  const isOpen      = isStoreOpenNow(settings);

  const filteredProducts = products.filter(p =>
    !hiddenCatIds.includes(p.category_id ?? "") &&
    (activeCat === "all" || p.category_id === activeCat) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const availableTypes: ("delivery"|"takeaway")[] = [];
  if (settings.payment_methods && (settings as any).allow_delivery !== false) {
    availableTypes.push("delivery");
  }
  availableTypes.push("takeaway");

  const payMethods = (settings.payment_methods ?? ["pix"]).filter(Boolean);

  // ── Loading ───────────────────────────────────────────────────────────────

  // Helper: renderiza o card de produto (usado tanto na lista plana quanto na agrupada)
  const renderCard = (product: Product) => {
    const price    = product.promo_price ?? product.sale_price;
    const hasPromo = product.promo_price !== null && product.promo_price < product.sale_price;
    const fixedQty = product.is_configurable ? 0 : getFixedQty(product.id);
    const productGroups = groups[product.id] ?? [];
    return (
      <div key={product.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex items-stretch">
        {product.image_url && (
          <img src={product.image_url} className="w-28 h-28 object-cover flex-shrink-0" alt={product.name} />
        )}
        <div className="flex-1 p-3.5 flex flex-col justify-between min-w-0">
          <div>
            <p className="font-semibold text-sm leading-snug">{product.name}</p>
            {product.description && (
              <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{product.description}</p>
            )}
            {product.is_configurable && productGroups.length > 0 && (
              <p className="text-xs text-zinc-600 mt-1 flex items-center gap-1">
                <ChevronDown className="w-3 h-3" />
                {productGroups.map(g => g.name).join(" · ")}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <div>
              {hasPromo && (
                <span className="text-xs text-zinc-600 line-through mr-1.5">{fmt(product.sale_price)}</span>
              )}
              <span className={`font-bold text-sm ${hasPromo ? "text-emerald-400" : "text-teal-400"}`}>
                {fmt(price)}
              </span>
            </div>
            {product.is_configurable ? (
              <button onClick={() => isOpen && openConfigure(product)} disabled={!isOpen}
                className="px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all flex items-center gap-1.5"
                style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 4px 14px rgba(13,148,136,0.45)" }}>
                <ShoppingCart className="w-3.5 h-3.5" /> Montar
              </button>
            ) : fixedQty === 0 ? (
              <button onClick={() => isOpen && addFixed(product)} disabled={!isOpen}
                className="w-10 h-10 rounded-full disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all"
                style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 4px 12px rgba(13,148,136,0.45)" }}>
                <Plus className="w-4 h-4 text-white" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button onClick={() => { const idx = cart.findLastIndex(i => i.product.id === product.id && i.options.length === 0); if (idx >= 0) changeQty(idx, -1); }}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors">
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-5 text-center font-bold text-sm">{fixedQty}</span>
                <button onClick={() => addFixed(product)}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                  style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 3px 10px rgba(13,148,136,0.4)" }}>
                  <Plus className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">Carregando cardápio...</p>
        </div>
      </div>
    );
  }

  // ── Store not found ───────────────────────────────────────────────────────

  if (storeFound === false) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <UtensilsCrossed className="w-14 h-14 text-zinc-700 mb-4" />
        <h1 className="text-xl font-bold mb-2">Cardápio não encontrado</h1>
        <p className="text-zinc-500 text-sm">Este link não corresponde a nenhuma loja cadastrada.</p>
      </div>
    );
  }

  // ── Tracking ──────────────────────────────────────────────────────────────

  if (step === "tracking" && trackedOrder) {
    const isCancelled = trackedOrder.status === "cancelled";
    const currentStepIdx = STATUS_STEPS.findIndex(s => s.key === trackedOrder.status);

    return (
      <div key="step-tracking" className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-lg mx-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center">
            <UtensilsCrossed className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm">{settings.store_name || "Cardápio Digital"}</p>
            <p className="text-xs text-zinc-500">Pedido #{trackedOrder.order_number}</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4 pb-6">
          {/* Status */}
          {isCancelled ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 text-center">
              <X className="w-10 h-10 text-red-400 mx-auto mb-2" />
              <p className="font-bold text-red-400 text-lg">Pedido Cancelado</p>
              <p className="text-sm text-zinc-500 mt-1">Entre em contato com a loja se tiver dúvidas.</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <p className="text-sm font-semibold mb-4 text-zinc-300">Acompanhe seu pedido</p>
              <div className="flex items-center gap-0">
                {STATUS_STEPS.map((s, idx) => {
                  const done    = idx <= currentStepIdx;
                  const current = idx === currentStepIdx;
                  const StepIcon = s.Icon;
                  return (
                    <div key={s.key} className="flex items-center flex-1">
                      <div className="flex flex-col items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                          done
                            ? "bg-teal-500 border-teal-500 text-white"
                            : "border-zinc-700 text-zinc-600"
                        } ${current ? "shadow-lg shadow-teal-500/30" : ""}`}>
                          <StepIcon className="w-4 h-4" />
                        </div>
                        <p className={`text-[10px] mt-1.5 font-medium text-center leading-tight ${done ? "text-teal-400" : "text-zinc-600"}`}>
                          {s.label}
                        </p>
                      </div>
                      {idx < STATUS_STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-1 mb-5 transition-all ${idx < currentStepIdx ? "bg-teal-500" : "bg-zinc-800"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-zinc-500 text-center mt-3">
                Tempo estimado: {settings.estimated_time_min}–{settings.estimated_time_max} min
              </p>
            </div>
          )}

          {/* Order summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold mb-2">Resumo do Pedido</p>
            {trackedOrder.items.map((item, i) => (
              <div key={i} className="text-sm">
                <div className="flex justify-between text-zinc-300">
                  <span>{item.quantity}× {item.product_name}</span>
                  <span>{fmt(item.unit_price * item.quantity)}</span>
                </div>
                {Array.isArray(item.options) && item.options.length > 0 && (
                  <div className="pl-4 text-xs text-zinc-500 mt-0.5 space-y-0.5">
                    {(item.options as any[]).map((o, oi) => (
                      <p key={oi}>• {o.option_name}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-sm text-zinc-400 pt-1">
                <span>Entrega</span><span>{fmt(deliveryFee)}</span>
              </div>
            )}
            <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold">
              <span>Total</span>
              <span className="text-teal-400">{fmt(trackedOrder.total_amount)}</span>
            </div>
            <div className="text-xs text-zinc-500 flex items-center gap-1.5 pt-1">
              <PayIcon method={trackedOrder.payment_method ?? ""} className="w-3.5 h-3.5" />
              {PAY_LABELS[trackedOrder.payment_method ?? ""] ?? trackedOrder.payment_method}
              {trackedOrder.change_for && ` · Troco para ${fmt(trackedOrder.change_for)}`}
            </div>
            {trackedOrder.delivery_address && (
              <div className="text-xs text-zinc-500 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                {trackedOrder.delivery_address}
              </div>
            )}
            {trackedOrder.notes && (
              <p className="text-xs text-zinc-500 italic">Obs: {trackedOrder.notes}</p>
            )}
          </div>

          {/* Chat */}
          <div className={`bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${storeMsgAlert ? "border-teal-500 shadow-lg shadow-teal-900/30" : "border-zinc-800"}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <MessageSquare className={`w-4 h-4 ${storeMsgAlert ? "text-teal-400 animate-bounce" : "text-teal-400"}`} />
                <p className="text-sm font-semibold">Mensagens</p>
              </div>
              {storeMsgAlert && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full animate-pulse"
                  style={{ background:"rgba(20,184,166,0.15)", color:"#14b8a6", border:"1px solid rgba(20,184,166,0.4)" }}>
                  💬 Nova mensagem da loja!
                </span>
              )}
            </div>
            <div className="p-4 min-h-[120px] max-h-64 overflow-y-auto space-y-2">
              {chatMessages.length === 0 && (
                <p className="text-xs text-zinc-600 text-center py-4">
                  Nenhuma mensagem. Entre em contato com a loja se precisar de algo.
                </p>
              )}
              {chatMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender === "customer" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                    msg.sender === "customer"
                      ? "bg-teal-500 text-white rounded-br-sm"
                      : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
                  }`}>
                    <p>{msg.message}</p>
                    <p className={`text-[10px] mt-0.5 ${msg.sender === "customer" ? "text-teal-200" : "text-zinc-500"}`}>
                      {fmtT(msg.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-zinc-800 flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Escreva uma mensagem..."
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-teal-500"
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim() || sendingMsg}
                className="w-9 h-9 rounded-xl disabled:opacity-40 flex items-center justify-center transition-all flex-shrink-0"
                style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 3px 10px rgba(13,148,136,0.4)" }}
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          <button
            onClick={() => { setStep("menu"); setTrackedOrder(null); setChatMessages([]); }}
            className="w-full py-3 border border-zinc-700 text-zinc-400 hover:text-white rounded-xl text-sm font-medium transition-colors"
          >
            Fazer novo pedido
          </button>
        </div>
      </div>
    );
  }

  // ── Checkout ──────────────────────────────────────────────────────────────

  if (step === "checkout") {
    return (
      <div key="step-checkout" className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-lg mx-auto">
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setStep("cart")} className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-bold text-lg flex-1">Finalizar Pedido</h2>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4 pb-32">
          {/* Tipo de entrega */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-sm font-semibold mb-3">Como deseja receber?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOrderType("takeaway")}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all text-sm font-medium ${
                  orderType === "takeaway"
                    ? "bg-teal-500/15 border-teal-500 text-teal-400"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <ChefHat className="w-5 h-5" /> Retirada
              </button>
              <button
                onClick={() => setOrderType("delivery")}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all text-sm font-medium ${
                  orderType === "delivery"
                    ? "bg-teal-500/15 border-teal-500 text-teal-400"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <Truck className="w-5 h-5" /> Delivery
              </button>
            </div>
          </div>

          {/* Dados do cliente */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold">Seus dados</p>
            <div className="relative">
              <User className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={custName} onChange={e => setCustName(e.target.value)}
                placeholder="Nome completo *"
                className="w-full pl-9 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-all"
              />
            </div>
            <div className="relative">
              <Phone className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={custPhone} onChange={e => setCustPhone(e.target.value)}
                placeholder="Telefone / WhatsApp *" inputMode="tel"
                className="w-full pl-9 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-all"
              />
            </div>
          </div>

          {/* Endereço (delivery) */}
          {orderType === "delivery" && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <p className="text-sm font-semibold mb-3">Endereço de Entrega</p>
              <div className="relative">
                <MapPin className="w-4 h-4 text-teal-400 absolute left-3 top-3" />
                <textarea
                  value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="Rua, número, bairro, complemento..." rows={3}
                  className="w-full pl-9 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>
              {settings.delivery_fee > 0 && (
                <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
                  <Truck className="w-3 h-3" /> Taxa de entrega: {fmt(settings.delivery_fee)}
                </p>
              )}
            </div>
          )}

          {/* Forma de pagamento */}
          {payMethods.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold">Forma de Pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {payMethods.map(pm => (
                  <button
                    key={pm}
                    onClick={() => setPayMethod(pm as PayMethod)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      payMethod === pm
                        ? "bg-teal-500/15 border-teal-500 text-teal-400"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <PayIcon method={pm} /> {PAY_LABELS[pm] ?? pm}
                  </button>
                ))}
              </div>

              {payMethod === "cash" && (
                <div>
                  <label className="text-xs text-zinc-400 mb-1.5 block">Troco para quanto? (opcional)</label>
                  <div className="relative">
                    <Banknote className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={changeFor} onChange={e => setChangeFor(e.target.value)}
                      placeholder="Ex: 50,00" inputMode="decimal"
                      className="w-full pl-9 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-all"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Observações */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-sm font-semibold mb-3">Observações</p>
            <textarea
              value={obsGeral} onChange={e => setObsGeral(e.target.value)}
              placeholder="Alguma observação para o pedido?" rows={2}
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none"
            />
          </div>

          {/* Resumo */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold mb-1">Resumo</p>
            {cart.map((item, i) => (
              <div key={i} className="text-sm">
                <div className="flex justify-between text-zinc-300">
                  <span>{item.quantity}× {item.product.name}</span>
                  <span>{fmt(itemPrice(item) * item.quantity)}</span>
                </div>
                {item.options.length > 0 && (
                  <p className="text-xs text-zinc-500 pl-3 mt-0.5">
                    {item.options.map(o => o.option_name).join(", ")}
                  </p>
                )}
              </div>
            ))}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-sm text-zinc-400 pt-1">
                <span>Taxa de entrega</span><span>{fmt(deliveryFee)}</span>
              </div>
            )}
            <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold">
              <span>Total</span>
              <span className="text-teal-400">{fmt(total)}</span>
            </div>
          </div>

          {formError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {formError}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 p-4">
          <button
            onClick={submitOrder}
            disabled={submitting || cart.length === 0}
            className="w-full py-3.5 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 4px 18px rgba(13,148,136,0.45)" }}
          >
            <CheckCircle2 className="w-5 h-5" /> Confirmar Pedido · {fmt(total)}
          </button>
        </div>
      </div>
    );
  }

  // ── Cart ──────────────────────────────────────────────────────────────────

  if (step === "cart") {
    return (
      <div key="step-cart" className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-lg mx-auto">
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setStep("menu")} className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-bold text-lg flex-1">Meu Pedido</h2>
          <span className="text-sm text-zinc-500">{totalItems} {totalItems === 1 ? "item" : "itens"}</span>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <ShoppingCart className="w-14 h-14 text-zinc-700 mb-4" />
            <p className="text-zinc-500">Seu carrinho está vazio</p>
            <button onClick={() => setStep("menu")}
              className="mt-4 px-5 py-2.5 text-white rounded-xl text-sm font-semibold transition-all"
              style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 4px 14px rgba(13,148,136,0.4)" }}>
              Ver Cardápio
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto p-4 space-y-3 pb-32">
              {cart.map((item, idx) => (
                <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    {item.product.image_url && (
                      <img src={item.product.image_url} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" alt={item.product.name} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{item.product.name}</p>
                      {item.options.length > 0 && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
                          {item.options.map(o => o.option_name).join(", ")}
                        </p>
                      )}
                      {item.notes && <p className="text-xs text-zinc-600 italic mt-0.5">{item.notes}</p>}
                      <p className="text-teal-400 text-sm font-semibold mt-1">{fmt(itemPrice(item) * item.quantity)}</p>
                    </div>
                    <button
                      onClick={() => removeItem(idx)}
                      className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-end mt-3 pt-3 border-t border-zinc-800">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => changeQty(idx, -1)}
                        className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                      <button
                        onClick={() => changeQty(idx, 1)}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                        style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 3px 10px rgba(13,148,136,0.4)" }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Subtotal</span>
                <span className="font-bold text-lg text-teal-400">{fmt(subtotal)}</span>
              </div>
              {settings.min_order_value > 0 && subtotal < settings.min_order_value && (
                <p className="text-xs text-amber-400">Pedido mínimo: {fmt(settings.min_order_value)}</p>
              )}
              <button
                onClick={() => setStep("checkout")}
                disabled={subtotal < settings.min_order_value}
                className="w-full py-3.5 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 4px 18px rgba(13,148,136,0.45)" }}
              >
                Continuar <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Configure (option group selector) ────────────────────────────────────

  if (step === "configure" && configProduct) {
    const productGroups = groups[configProduct.id] ?? [];
    const basePrice = configProduct.promo_price ?? configProduct.sale_price;
    const extraPrice = selOptions.reduce((s, o) => s + o.additional_price, 0);
    const unitTotal = (basePrice + extraPrice) * configQty;

    return (
      <div key="step-configure" className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-lg mx-auto">
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setStep("menu")} className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-bold text-base flex-1 truncate">{configProduct.name}</h2>
        </div>

        <div className="flex-1 overflow-auto pb-36">
          {/* Product image/header */}
          {configProduct.image_url ? (
            <img src={configProduct.image_url} className="w-full h-48 object-cover" alt={configProduct.name} />
          ) : (
            <div className="w-full h-24 bg-gradient-to-br from-teal-900/20 to-zinc-900 flex items-center justify-center">
              <UtensilsCrossed className="w-10 h-10 text-zinc-700" />
            </div>
          )}

          <div className="p-4 space-y-1">
            <h3 className="text-lg font-bold">{configProduct.name}</h3>
            {configProduct.description && <p className="text-sm text-zinc-400">{configProduct.description}</p>}
            <p className="text-teal-400 font-bold">{fmt(basePrice)}</p>
          </div>

          {/* Option groups */}
          {productGroups.map(grp => {
            const chosen = selOptions.filter(o => o.group_id === grp.id);
            const availableOpts = grp.options.filter(o => o.is_available);
            return (
              <div key={grp.id} className="border-t border-zinc-800">
                <div className="px-4 py-3 bg-zinc-900/50">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">{grp.name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${grp.required ? "bg-teal-500/20 text-teal-400" : "bg-zinc-800 text-zinc-400"}`}>
                      {grp.required ? "Obrigatório" : "Opcional"}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {grp.max_choices === 1
                      ? "Escolha 1 opção"
                      : `Escolha até ${grp.max_choices} · selecionado: ${chosen.length}`}
                  </p>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {availableOpts.map(opt => {
                    const isSel = chosen.some(o => o.option_id === opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(grp, opt)}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                          isSel ? "bg-teal-500/10" : "hover:bg-zinc-900/60"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          isSel ? "border-teal-500 bg-teal-500" : "border-zinc-600"
                        }`}>
                          {isSel && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <span className="flex-1 text-sm">{opt.name}</span>
                        {opt.additional_price > 0 && (
                          <span className="text-xs text-teal-400 font-medium">+{fmt(opt.additional_price)}</span>
                        )}
                      </button>
                    );
                  })}
                  {availableOpts.length === 0 && (
                    <p className="px-4 py-3 text-sm text-zinc-600 italic">Nenhuma opção disponível hoje.</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Item notes */}
          <div className="px-4 py-4 border-t border-zinc-800">
            <p className="text-sm font-semibold mb-2">Observação do item</p>
            <textarea
              value={configNotes} onChange={e => setConfigNotes(e.target.value)}
              placeholder="Ex: sem cebola, bem passado..."
              rows={2}
              className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none"
            />
          </div>

          {configError && (
            <div className="mx-4 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {configError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-zinc-950/95 backdrop-blur border-t border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-1">
              <button onClick={() => setConfigQty(q => Math.max(1, q - 1))} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white">
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-6 text-center font-bold text-sm">{configQty}</span>
              <button onClick={() => setConfigQty(q => q + 1)} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={addConfiguredToCart}
              className="flex-1 py-3 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
              style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 4px 16px rgba(13,148,136,0.45)" }}
            >
              <ShoppingCart className="w-4 h-4" /> Adicionar · {fmt(unitTotal)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Menu (main) ───────────────────────────────────────────────────────────

  return (
    <div key="step-menu" className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-2xl mx-auto">
      {/* Banner */}
      <div className="relative">
        {settings.banner_url ? (
          <div className="h-40 sm:h-52 overflow-hidden">
            <img src={settings.banner_url} className="w-full h-full object-cover" alt="banner" />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-transparent" />
          </div>
        ) : (
          <div className="h-24 bg-gradient-to-br from-teal-900/40 to-zinc-900" />
        )}

        {/* Logo */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
          {settings.logo_url ? (
            <div className="w-20 h-20 rounded-2xl border-4 border-zinc-950 overflow-hidden shadow-xl">
              <img src={settings.logo_url} className="w-full h-full object-cover object-center" alt="logo" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-2xl border-4 border-zinc-950 bg-teal-500/20 flex items-center justify-center shadow-xl">
              <UtensilsCrossed className="w-8 h-8 text-teal-400" />
            </div>
          )}
        </div>
      </div>

      {/* Store info */}
      <div className="pt-14 pb-4 px-4 text-center">
        <h1 className="text-xl font-black">{settings.store_name || "Cardápio Digital"}</h1>
        {settings.tagline && <p className="text-sm text-zinc-400 mt-0.5">{settings.tagline}</p>}
        <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            isOpen ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            {isOpen ? "Aberto" : "Fechado"}
          </span>
          {(settings.estimated_time_min > 0 || settings.estimated_time_max > 0) && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background:"rgba(249,115,22,0.12)", color:"#f97316", border:"1px solid rgba(249,115,22,0.2)" }}>
              <Clock className="w-3.5 h-3.5" />
              {settings.estimated_time_min}–{settings.estimated_time_max} min
            </span>
          )}
          {settings.delivery_fee > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background:"rgba(20,184,166,0.12)", color:"#2dd4bf", border:"1px solid rgba(20,184,166,0.2)" }}>
              <Truck className="w-3.5 h-3.5" /> Entrega {fmt(settings.delivery_fee)}
            </span>
          )}
        </div>
        {settings.address && (
          <p className="text-xs mt-2 flex items-center justify-center gap-1.5" style={{ color:"#94a3b8" }}>
            <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-teal-400" /> {settings.address}
          </p>
        )}
      </div>

      {/* Search + Category tabs — sticky */}
      <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur pt-2 pb-2 border-b border-zinc-800/60">
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 text-teal-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar no cardápio..."
              className="w-full px-4 py-2.5 pl-10 bg-zinc-900 border border-zinc-800 rounded-2xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500 transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {visibleCats.length > 0 && (
          <div className="px-4 overflow-x-auto scrollbar-none">
            <div className="flex gap-2 min-w-max">
              <button
                onClick={() => setActiveCat("all")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  activeCat === "all" ? "text-white" : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
                }`}
                style={activeCat === "all" ? { background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 3px 12px rgba(13,148,136,0.4)" } : {}}
              >
                Todos
              </button>
              {visibleCats.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCat(cat.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    activeCat === cat.id ? "text-white" : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
                  }`}
                  style={activeCat === cat.id ? { background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 3px 12px rgba(13,148,136,0.4)" } : {}}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Closed banner */}
      {!isOpen && (
        <div className="mx-4 mb-3 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>A loja está fechada no momento. Você pode visualizar o cardápio mas não finalizar pedidos.</span>
        </div>
      )}

      {/* Products */}
      <div className="flex-1 px-4 pb-32">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-16">
            <UtensilsCrossed className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Nenhum item encontrado</p>
          </div>
        ) : activeCat === "all" && !search ? (
          // ── Aba "Todos": agrupado por categoria ──
          <>
            {visibleCats.filter(cat => filteredProducts.some(p => p.category_id === cat.id)).map(cat => (
              <div key={cat.id} className="mb-6">
                <div className="flex items-center gap-3 py-2.5">
                  <span className="text-sm font-bold text-teal-400 whitespace-nowrap">{cat.name}</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>
                <div className="space-y-3">
                  {filteredProducts.filter(p => p.category_id === cat.id).map(renderCard)}
                </div>
              </div>
            ))}
            {/* Produtos sem categoria visível */}
            {filteredProducts.filter(p => !p.category_id || !visibleCats.some(c => c.id === p.category_id)).length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-3 py-2.5">
                  <span className="text-sm font-bold text-zinc-500 whitespace-nowrap">Outros</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>
                <div className="space-y-3">
                  {filteredProducts.filter(p => !p.category_id || !visibleCats.some(c => c.id === p.category_id)).map(renderCard)}
                </div>
              </div>
            )}
          </>
        ) : (
          // ── Categoria específica ou busca: lista plana ──
          <div className="space-y-3">
            {filteredProducts.map(renderCard)}
          </div>
        )}
      </div>

      {/* Floating cart */}
      {totalItems > 0 && isOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-sm px-4 z-40">
          <button
            onClick={() => setStep("cart")}
            className="w-full py-4 text-white font-bold rounded-2xl flex items-center justify-between px-5 transition-all"
            style={{ background:"linear-gradient(135deg,#14b8a6,#0d9488)", boxShadow:"0 8px 28px rgba(13,148,136,0.55)" }}
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                <span className="absolute -top-2 -right-2 w-4 h-4 bg-white text-teal-700 rounded-full text-[10px] font-black flex items-center justify-center">
                  {totalItems}
                </span>
              </div>
              <span>Ver Pedido</span>
            </div>
            <span className="font-bold">{fmt(subtotal)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
