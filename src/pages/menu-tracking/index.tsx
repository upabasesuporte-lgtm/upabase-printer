import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  UtensilsCrossed, Package, ChefHat, Truck, MapPin,
  MessageSquare, Send, X, Banknote, CreditCard, QrCode, ArrowLeft,
} from "lucide-react";

interface StoreSettings {
  store_name: string; estimated_time_min: number; estimated_time_max: number;
}

interface OrderItem {
  product_name: string; quantity: number; unit_price: number;
  options?: { option_name: string }[];
}

interface TrackedOrder {
  id: string; order_number: string | null; status: string;
  customer_name: string | null; total_amount: number;
  items: OrderItem[];
  delivery_address: string | null; order_type: string | null;
  payment_method: string | null; change_for: number | null;
  notes: string | null;
}

interface ChatMessage {
  id: string; order_id: string; sender: "store" | "customer";
  message: string; created_at: string;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtT = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const PAY_LABELS: Record<string, string> = {
  cash: "Dinheiro", pix: "PIX", credit: "Cartão Crédito", debit: "Cartão Débito",
};

const STATUS_STEPS: { key: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "pending",    label: "Recebido",   Icon: Package },
  { key: "accepted",   label: "Em preparo", Icon: ChefHat },
  { key: "dispatched", label: "A caminho",  Icon: Truck   },
];

function PayIcon({ method, className = "w-4 h-4" }: { method: string; className?: string }) {
  if (method === "pix") return <QrCode className={className} />;
  if (method === "credit" || method === "debit") return <CreditCard className={className} />;
  return <Banknote className={className} />;
}

export default function MenuTrackingPage() {
  const { uid, orderId } = useParams<{ uid: string; orderId: string }>();
  const navigate = useNavigate();

  const [order,    setOrder]    = useState<TrackedOrder | null>(null);
  const [settings, setSettings] = useState<StoreSettings>({ store_name: "", estimated_time_min: 30, estimated_time_max: 50 });
  const [msgs,     setMsgs]     = useState<ChatMessage[]>([]);
  const [input,    setInput]    = useState("");
  const [sending,  setSending]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const chatEnd = useRef<HTMLDivElement>(null);

  // Load order + settings once
  useEffect(() => {
    if (!orderId || !uid) return;
    let cancelled = false;
    async function load() {
      const [orderRes, settingsRes, msgsRes] = await Promise.all([
        supabase.from("digital_orders").select("id,order_number,status,customer_name,total_amount,items,delivery_address,order_type,payment_method,change_for,notes").eq("id", orderId).single(),
        supabase.from("menu_store_settings").select("settings").eq("user_id", uid).maybeSingle(),
        supabase.from("menu_order_messages").select("*").eq("order_id", orderId).order("created_at"),
      ]);
      if (cancelled) return;
      if (orderRes.data) setOrder(orderRes.data as TrackedOrder);
      if (settingsRes.data?.settings) {
        const s = settingsRes.data.settings as any;
        setSettings({ store_name: s.store_name ?? "", estimated_time_min: s.estimated_time_min ?? 30, estimated_time_max: s.estimated_time_max ?? 50 });
      }
      setMsgs((msgsRes.data ?? []) as ChatMessage[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [orderId, uid]);

  // Scroll to bottom when messages arrive
  useEffect(() => {
    setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [msgs]);

  // Realtime
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    const orderCh = supabase.channel(`trak-order-${orderId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "digital_orders", filter: `id=eq.${orderId}` }, p => {
        if (!cancelled) setOrder(prev => prev ? { ...prev, status: (p.new as any).status } : prev);
      }).subscribe();

    const msgCh = supabase.channel(`trak-msgs-${orderId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_order_messages", filter: `order_id=eq.${orderId}` }, p => {
        if (!cancelled) setMsgs(prev => [...prev, p.new as ChatMessage]);
      }).subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(orderCh);
      supabase.removeChannel(msgCh);
    };
  }, [orderId]);

  async function sendMessage() {
    if (!input.trim() || !orderId || sending) return;
    setSending(true);
    await supabase.from("menu_order_messages").insert({ order_id: orderId, sender: "customer", message: input.trim() });
    setInput("");
    setSending(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">Carregando pedido...</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <UtensilsCrossed className="w-14 h-14 text-zinc-700 mb-4" />
        <h1 className="text-xl font-bold mb-2">Pedido não encontrado</h1>
        <button onClick={() => navigate(`/menu/${uid}`)} className="mt-4 px-5 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold">Voltar ao cardápio</button>
      </div>
    );
  }

  const isCancelled  = order.status === "cancelled";
  const currentIdx   = STATUS_STEPS.findIndex(s => s.key === order.status);
  const deliveryFee  = 0; // included in total_amount already

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(`/menu/${uid}`)} className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
          <UtensilsCrossed className="w-4 h-4 text-orange-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">{settings.store_name || "Cardápio Digital"}</p>
          <p className="text-xs text-zinc-500">Pedido #{order.order_number}</p>
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
            <div className="flex items-center">
              {STATUS_STEPS.map((s, idx) => {
                const done    = idx <= currentIdx;
                const current = idx === currentIdx;
                const StepIcon = s.Icon;
                return (
                  <div key={s.key} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${done ? "bg-orange-500 border-orange-500 text-white" : "border-zinc-700 text-zinc-600"} ${current ? "shadow-lg shadow-orange-500/30" : ""}`}>
                        <StepIcon className="w-4 h-4" />
                      </div>
                      <p className={`text-[10px] mt-1.5 font-medium text-center leading-tight ${done ? "text-orange-400" : "text-zinc-600"}`}>{s.label}</p>
                    </div>
                    {idx < STATUS_STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-1 mb-5 transition-all ${idx < currentIdx ? "bg-orange-500" : "bg-zinc-800"}`} />
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
          {(Array.isArray(order.items) ? order.items : []).map((item, i) => (
            <div key={i} className="text-sm">
              <div className="flex justify-between text-zinc-300">
                <span>{item.quantity}× {item.product_name}</span>
                <span>{fmt(item.unit_price * item.quantity)}</span>
              </div>
              {Array.isArray(item.options) && item.options.length > 0 && (
                <div className="pl-4 text-xs text-zinc-500 mt-0.5 space-y-0.5">
                  {item.options.map((o, oi) => <p key={oi}>• {(o as any).option_name ?? o}</p>)}
                </div>
              )}
            </div>
          ))}
          <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span className="text-orange-400">{fmt(order.total_amount)}</span>
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-1.5 pt-1">
            <PayIcon method={order.payment_method ?? ""} className="w-3.5 h-3.5" />
            {PAY_LABELS[order.payment_method ?? ""] ?? order.payment_method}
            {order.change_for ? ` · Troco para ${fmt(order.change_for)}` : ""}
          </div>
          {order.delivery_address && (
            <div className="text-xs text-zinc-500 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              {order.delivery_address}
            </div>
          )}
          {order.notes && <p className="text-xs text-zinc-500 italic">Obs: {order.notes}</p>}
        </div>

        {/* Chat */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <MessageSquare className="w-4 h-4 text-orange-400" />
            <p className="text-sm font-semibold">Mensagens</p>
          </div>
          <div className="p-4 min-h-[120px] max-h-64 overflow-y-auto space-y-2">
            {msgs.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-4">Nenhuma mensagem. Entre em contato com a loja se precisar de algo.</p>
            )}
            {msgs.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === "customer" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${msg.sender === "customer" ? "bg-orange-500 text-white rounded-br-sm" : "bg-zinc-800 text-zinc-200 rounded-bl-sm"}`}>
                  <p>{msg.message}</p>
                  <p className={`text-[10px] mt-0.5 ${msg.sender === "customer" ? "text-orange-200" : "text-zinc-500"}`}>{fmtT(msg.created_at)}</p>
                </div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <div className="p-3 border-t border-zinc-800 flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Escreva uma mensagem..."
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500" />
            <button onClick={sendMessage} disabled={!input.trim() || sending}
              className="w-9 h-9 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-40 flex items-center justify-center transition-colors flex-shrink-0">
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        <button onClick={() => navigate(`/menu/${uid}`)}
          className="w-full py-3 border border-zinc-700 text-zinc-400 hover:text-white rounded-xl text-sm font-medium transition-colors">
          Fazer novo pedido
        </button>
      </div>
    </div>
  );
}
