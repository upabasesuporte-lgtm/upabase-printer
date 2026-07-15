import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, ComposedChart, Line,
} from "recharts";
import {
  BarChart3, Package, Users, Wallet, Boxes,
  TrendingUp, TrendingDown, Calendar, RefreshCw,
  ShoppingCart, Banknote, AlertTriangle,
  CheckCircle2, Award, Zap, Activity, Clock, Trophy,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Sale {
  id: string;
  total_amount: number;
  discount: number | null;
  origin: string | null;
  created_at: string;
  status: string;
  seller_name: string | null;
  payments: { method: string; amount: number }[] | null;
}

interface SaleItem {
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  products: { name: string; category_id: string | null } | null;
  sales: { created_at: string; status: string } | null;
}

interface CashMovement {
  id: string;
  movement_type: string; // campo correto: movement_type
  amount: number;
  payment_method: string | null;
  description: string | null;
  created_at: string;
}

interface CustomerMovement {
  id: string;
  type: string;
  amount: number;
  created_at: string;
  customers: { name: string } | null;
}

interface StockItem {
  id: string;
  name: string;
  current_qty: number;
  min_qty: number;
  unit: string;
}

interface Product {
  id: string;
  name: string;
  stock: number;
  stock_min: number;
  sale_price: number;
  unlimited_stock: boolean | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt  = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtN = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

const PIE_COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#d946ef","#f43f5e","#3b82f6","#f97316"];

const PAY_LABELS: Record<string, string> = {
  cash: "Dinheiro", pix: "PIX", credit: "Cartão Crédito",
  debit: "Cartão Débito", fiado: "Fiado", house_credit: "Saldo Cliente",
  voucher: "Vale Refeição", ifood_receivable: "iFood (A Receber)",
};

const WEEKDAYS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

type Preset = "today"|"yesterday"|"week"|"month"|"last_month"|"custom";
type Tab = "overview"|"sales"|"products"|"payments"|"sellers"|"customers"|"stock";

const PRESETS: { key: Preset; label: string }[] = [
  { key:"today", label:"Hoje" }, { key:"yesterday", label:"Ontem" },
  { key:"week", label:"7 dias" }, { key:"month", label:"Este mês" },
  { key:"last_month", label:"Mês passado" }, { key:"custom", label:"Personalizado" },
];

const TABS: { key: Tab; label: string; icon: React.ReactNode; color: string }[] = [
  { key:"overview",  label:"Visão Geral", icon:<Activity className="w-3.5 h-3.5" />,    color:"#8b5cf6" },
  { key:"sales",     label:"Vendas",      icon:<BarChart3 className="w-3.5 h-3.5" />,   color:"#06b6d4" },
  { key:"products",  label:"Produtos",    icon:<Package className="w-3.5 h-3.5" />,     color:"#10b981" },
  { key:"payments",  label:"Pagamentos",  icon:<Wallet className="w-3.5 h-3.5" />,      color:"#f59e0b" },
  { key:"sellers",   label:"Vendedores",  icon:<Award className="w-3.5 h-3.5" />,       color:"#d946ef" },
  { key:"customers", label:"Clientes",    icon:<Users className="w-3.5 h-3.5" />,       color:"#f43f5e" },
  { key:"stock",     label:"Estoque",     icon:<Boxes className="w-3.5 h-3.5" />,       color:"#3b82f6" },
];

function presetToRange(p: Preset): { from: Date; to: Date } {
  const now = new Date();
  const s = (d: Date) => { d.setHours(0,0,0,0); return d; };
  const e = (d: Date) => { d.setHours(23,59,59,999); return d; };
  switch (p) {
    case "today":      return { from: s(new Date()), to: e(new Date()) };
    case "yesterday":  { const d=new Date(now); d.setDate(d.getDate()-1); return { from:s(d), to:e(new Date(d)) }; }
    case "week":       { const f=new Date(now); f.setDate(f.getDate()-6); return { from:s(f), to:e(new Date()) }; }
    case "month":      return { from:s(new Date(now.getFullYear(),now.getMonth(),1)), to:e(new Date()) };
    case "last_month": { const f=new Date(now.getFullYear(),now.getMonth()-1,1); const t=new Date(now.getFullYear(),now.getMonth(),0); return { from:s(f), to:e(t) }; }
    default:           return { from:s(new Date()), to:e(new Date()) };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900/95 border border-zinc-700/60 rounded-xl px-4 py-3 shadow-2xl text-xs"
      style={{ boxShadow:"0 8px 32px rgba(0,0,0,0.6),0 0 0 1px rgba(139,92,246,0.25)" }}>
      <p className="text-zinc-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-bold" style={{ color: p.color ?? p.fill }}>
          {p.name==="revenue"||p.name==="value" ? fmt(p.value)
           : p.name==="orders" ? `${p.value} pedidos`
           : p.value}
        </p>
      ))}
    </div>
  );
}

function KPICard({ label, value, sub, icon, from: gFrom, to: gTo, glow }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  from: string; to: string; glow: string;
}) {
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
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 cursor-default"
      style={{ background: card.bg, border: card.border, boxShadow: isLight ? card.shadow : `0 0 30px ${glow}` }}>
      {isLight
        ? <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${gFrom},${gTo})`, borderRadius:"12px 12px 0 0" }} />
        : <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full opacity-15 blur-3xl" style={{ background:`linear-gradient(135deg,${gFrom},${gTo})` }} />
      }
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>{label}</span>
          <div className="p-2 rounded-xl" style={{ background:`${gFrom}18`, border:`1px solid ${isLight ? gFrom + "30" : "#3f3f46"}` }}>{icon}</div>
        </div>
        <div className="text-2xl font-black tabular-nums">
          <span style={{ background:`linear-gradient(135deg,${gFrom},${gTo})`, WebkitBackgroundClip:"text", display:"inline-block", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
            {value}
          </span>
        </div>
        {sub && <p className="text-[11px] mt-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>{sub}</p>}
      </div>
    </div>
  );
}

function Card({ children, className="" }: { children: React.ReactNode; className?: string }) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const cardStyle = isLight ? {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    background: "#18181b",
    border: "1px solid rgba(39,39,42,0.8)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
  return (
    <div className={`rounded-2xl ${className}`} style={cardStyle}>
      {children}
    </div>
  );
}

function CardTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-bold text-white">{children}</h2>
      {sub && <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border"
      style={{ color, background:`${color}15`, borderColor:`${color}30` }}>
      {children}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-center text-xs text-zinc-600 py-10">{text}</p>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
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

  const [tab, setTab]         = useState<Tab>("overview");
  const [preset, setPreset]   = useState<Preset>("month");
  const [customFrom, setFrom] = useState(new Date().toISOString().slice(0,10));
  const [customTo,   setTo]   = useState(new Date().toISOString().slice(0,10));
  const [loading, setLoading] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const [sales,      setSales]      = useState<Sale[]>([]);
  const [saleItems,  setSaleItems]  = useState<SaleItem[]>([]);
  const [cashMovs,   setCashMovs]   = useState<CashMovement[]>([]);
  const [custMovs,   setCustMovs]   = useState<CustomerMovement[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [products,   setProducts]   = useState<Product[]>([]);

  const { from, to } = preset === "custom"
    ? { from: new Date(customFrom+"T00:00:00"), to: new Date(customTo+"T23:59:59") }
    : presetToRange(preset);

  const fromISO = from.toISOString();
  const toISO   = to.toISOString();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    const errs: string[] = [];

    try {
      // 1. Vendas finalizadas — colunas que sabemos que existem (sem "seller")
      const { data: salesRaw, error: salesErr } = await supabase
        .from("sales")
        .select("id,total_amount,discount,origin,created_at,status,seller_name,payments")
        .eq("status","paid")
        .neq("origin","fiado_payment")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at",{ascending:false});

      if (salesErr) errs.push(`Vendas: ${salesErr.message}`);
      const salesData: Sale[] = (salesRaw ?? []).map((r: any) => ({
        ...r,
        total_amount: Number(r.total_amount ?? 0),
        discount:     Number(r.discount ?? 0),
      }));
      setSales(salesData);

      // 2. Itens de venda — busca pelos IDs das vendas encontradas, em lotes
      //    (uma lista IN muito grande pode estourar/falhar a requisição).
      const saleIds = salesData.map(s => s.id);
      if (saleIds.length > 0) {
        const CHUNK = 100;
        const allItems: any[] = [];
        for (let i = 0; i < saleIds.length; i += CHUNK) {
          const ids = saleIds.slice(i, i + CHUNK);
          const { data: itemsRaw, error: itemsErr } = await supabase
            .from("sale_items")
            .select("sale_id,product_id,quantity,unit_price,products(name,category_id)")
            .in("sale_id", ids);
          if (itemsErr) { errs.push(`Itens: ${itemsErr.message}`); break; }
          if (itemsRaw) allItems.push(...itemsRaw);
        }
        setSaleItems(allItems as unknown as SaleItem[]);
      } else {
        setSaleItems([]);
      }

      // 3. Restante em paralelo
      const [cm, cu, st, pr] = await Promise.all([
        supabase.from("cash_movements")
          .select("id,movement_type,amount,payment_method,description,created_at")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at",{ascending:false}),

        supabase.from("customer_movements")
          .select("id,type,amount,created_at,customers(name)")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at",{ascending:false}),

        supabase.from("stock_items")
          .select("id,name,current_qty,min_qty,unit")
          .order("current_qty"),

        supabase.from("products")
          .select("id,name,stock,stock_min,sale_price,unlimited_stock")
          .eq("is_active",true)
          .order("stock"),
      ]);

      if (cm.error) errs.push(`Caixa: ${cm.error.message}`);
      if (cu.error) errs.push(`Clientes: ${cu.error.message}`);
      if (st.error) errs.push(`Estoque: ${st.error.message}`);
      if (pr.error) errs.push(`Produtos: ${pr.error.message}`);

      setCashMovs((cm.data ?? []) as CashMovement[]);
      setCustMovs((cu.data ?? []) as unknown as CustomerMovement[]);
      setStockItems((st.data ?? []) as StockItem[]);
      setProducts((pr.data ?? []) as Product[]);
    } catch (e: any) {
      // Sem try/catch, um erro em qualquer await deixava a tela travada em
      // "Carregando..." pra sempre. Agora o erro aparece e o loading encerra.
      errs.push(`Falha ao carregar: ${e?.message ?? String(e)}`);
      console.error("reports load error:", e);
    } finally {
      setLoadErrors(errs);
      setLoading(false);
    }
  }, [fromISO, toISO]);

  useEffect(() => { load(); }, [load]);

  const sellerOf = (s: Sale) => s.seller_name || null;

  // ── Derived: sales ────────────────────────────────────────────────────────

  const totalRevenue  = sales.reduce((a,s)=>a+s.total_amount, 0);
  const totalDiscount = sales.reduce((a,s)=>a+(s.discount??0), 0);
  const orderCount    = sales.length;
  const avgTicket     = orderCount>0 ? totalRevenue/orderCount : 0;

  const dayMap: Record<string,{revenue:number;orders:number}> = {};
  sales.forEach(s => {
    const d = new Date(s.created_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    if (!dayMap[d]) dayMap[d]={revenue:0,orders:0};
    dayMap[d].revenue+=s.total_amount; dayMap[d].orders+=1;
  });
  const chartData = Object.entries(dayMap).map(([date,v])=>({date,...v})).sort((a,b)=>{
    const [da,ma]=a.date.split("/").map(Number);
    const [db,mb]=b.date.split("/").map(Number);
    return ma!==mb ? ma-mb : da-db;
  });

  const channelMap: Record<string,number> = {};
  sales.forEach(s=>{
    const k = !s.origin||s.origin==="pdv"?"PDV":s.origin==="mesa"?"Mesas":"Cardápio";
    channelMap[k]=(channelMap[k]??0)+s.total_amount;
  });
  const channelData = Object.entries(channelMap).map(([name,value])=>({name,value}));

  // Heatmap por hora
  const hourMap: number[] = Array(24).fill(0);
  const hourOrders: number[] = Array(24).fill(0);
  sales.forEach(s => {
    const h = new Date(s.created_at).getHours();
    hourMap[h]+=s.total_amount; hourOrders[h]+=1;
  });
  const maxHour = Math.max(...hourMap, 1);

  // Por dia da semana
  const weekMap: {revenue:number;orders:number}[] = Array(7).fill(null).map(()=>({revenue:0,orders:0}));
  sales.forEach(s=>{ const d=new Date(s.created_at).getDay(); weekMap[d].revenue+=s.total_amount; weekMap[d].orders+=1; });
  const weekdayData = WEEKDAYS.map((name,i)=>({name,...weekMap[i]}));

  // ── Derived: products ──────────────────────────────────────────────────────

  const itemMap: Record<string,{name:string;qty:number;revenue:number}> = {};
  saleItems.forEach(item=>{
    const name=item.products?.name??"Desconhecido";
    if(!itemMap[item.product_id]) itemMap[item.product_id]={name,qty:0,revenue:0};
    itemMap[item.product_id].qty+=item.quantity;
    itemMap[item.product_id].revenue+=item.quantity*item.unit_price;
  });
  const topProducts = Object.values(itemMap).sort((a,b)=>b.revenue-a.revenue);
  const maxItemRev  = topProducts[0]?.revenue??1;

  // Curva ABC
  const totalProdRev = topProducts.reduce((a,p)=>a+p.revenue,0);
  let cumulative = 0;
  const abcProducts = topProducts.slice(0,20).map(p=>{
    cumulative+=p.revenue;
    const pct = totalProdRev>0 ? cumulative/totalProdRev : 0;
    return { ...p, abc: pct<=0.8?"A":pct<=0.95?"B":"C" };
  });

  // ── Derived: payments ──────────────────────────────────────────────────────
  // Fonte primária: campo payments (JSON) de cada venda
  // Fonte secundária: cash_movements com movement_type === "sale"

  const payMethodMap: Record<string,number> = {};

  // 1. Pega de sales.payments (JSON array [{method, amount}])
  sales.forEach(s => {
    if (s.payments && Array.isArray(s.payments)) {
      s.payments.forEach((p: {method:string;amount:number}) => {
        if (p.method && typeof p.amount === "number") {
          payMethodMap[p.method] = (payMethodMap[p.method]??0) + p.amount;
        }
      });
    }
  });

  // 2. Fallback: cash_movements com movement_type === "sale"
  if (Object.keys(payMethodMap).length === 0) {
    cashMovs.filter(m=>m.movement_type==="sale"&&m.payment_method).forEach(m=>{
      payMethodMap[m.payment_method!]=(payMethodMap[m.payment_method!]??0)+m.amount;
    });
  }

  const payData = Object.entries(payMethodMap)
    .map(([key,value])=>({name:PAY_LABELS[key]??key,value,key}))
    .sort((a,b)=>b.value-a.value);

  // Entradas e saídas de caixa (usando movement_type correto)
  const cashIn  = cashMovs.filter(m=>m.movement_type==="sale"||m.movement_type==="aporte").reduce((a,m)=>a+m.amount,0);
  const cashOut = cashMovs.filter(m=>m.movement_type==="sangria").reduce((a,m)=>a+m.amount,0);
  const dreResult = totalRevenue - cashOut;

  // ── Derived: sellers ──────────────────────────────────────────────────────

  const sellerMap: Record<string,{name:string;revenue:number;orders:number}> = {};
  sales.forEach(s=>{
    const name = sellerOf(s) || "Sem vendedor";
    if(!sellerMap[name]) sellerMap[name]={name,revenue:0,orders:0};
    sellerMap[name].revenue+=s.total_amount; sellerMap[name].orders+=1;
  });
  const sellerRanking = Object.values(sellerMap)
    .map(s=>({...s, avgTicket:s.orders>0?s.revenue/s.orders:0}))
    .sort((a,b)=>b.revenue-a.revenue);
  const maxSellerRev = sellerRanking[0]?.revenue??1;

  // ── Derived: customers ────────────────────────────────────────────────────

  const custMap: Record<string,{name:string;total:number;count:number}> = {};
  custMovs.filter(m=>m.type==="debit"||m.type==="saldo").forEach(m=>{
    const name=m.customers?.name??"Cliente";
    if(!custMap[name]) custMap[name]={name,total:0,count:0};
    custMap[name].total+=m.amount; custMap[name].count+=1;
  });
  const topCustomers = Object.values(custMap).sort((a,b)=>b.total-a.total).slice(0,8);
  const totalCred  = custMovs.filter(m=>m.type==="credit"||m.type==="payment").reduce((a,m)=>a+m.amount,0);
  const totalDebit = custMovs.filter(m=>m.type==="debit").reduce((a,m)=>a+m.amount,0);
  const totalSaldo = custMovs.filter(m=>m.type==="saldo").reduce((a,m)=>a+m.amount,0);

  // ── Derived: stock ─────────────────────────────────────────────────────────

  const limitedProds = products.filter(p=>!p.unlimited_stock);
  const lowStockItems   = stockItems.filter(i=>i.current_qty<=i.min_qty&&i.min_qty>0);
  const outOfStockItems = stockItems.filter(i=>i.current_qty<=0);
  const lowStockProds   = limitedProds.filter(p=>p.stock<=(p.stock_min??0)&&p.stock_min>0);

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputCls = "px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-all";

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl p-6"
        style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
          backgroundImage: isLight ? "radial-gradient(rgba(123,47,190,0.12) 1px,transparent 1px)" : "radial-gradient(rgba(139,92,246,0.08) 1px,transparent 1px)",
          backgroundSize:"24px 24px" }}>
        <div className="absolute inset-0 pointer-events-none" style={isLight ? { background: "linear-gradient(135deg, rgba(123,47,190,0.04) 0%, rgba(0,180,216,0.03) 100%)" } : undefined}>{!isLight && <div className="absolute inset-0 bg-gradient-to-r from-violet-900/10 to-cyan-900/5" />}</div>
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: isLight ? "#3B82F6" : "#8b5cf6" }} />
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: isLight ? "#3B82F6" : "#a78bfa" }}>Analytics</span>
            </div>
            <h1 className={`text-2xl font-black ${isLight ? "" : "g-text g-text-purple"}`} style={isLight ? { color:"#3B82F6" } : undefined}>
              Central de Relatórios
            </h1>
            <p className="text-xs text-zinc-500 mt-1">
              {from.toLocaleDateString("pt-BR")} — {to.toLocaleDateString("pt-BR")}
              {!loading && sales.length>0 && <span className="text-violet-400 ml-2">· {sales.length} vendas · {fmt(totalRevenue)}</span>}
            </p>
          </div>
          <button onClick={load} disabled={loading}
            style={{ background: card.bg, border: card.border, boxShadow: loading?"none":"0 0 12px rgba(139,92,246,0.2)" }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80">
            <RefreshCw className={`w-4 h-4 ${loading?"animate-spin text-violet-400":"text-zinc-400"}`} />
            {loading?"Carregando...":"Atualizar"}
          </button>
        </div>
      </div>

      {/* ── Period selector ── */}
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Calendar className="w-3.5 h-3.5" /> Período:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p=>(
              <button key={p.key} onClick={()=>setPreset(p.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={preset===p.key
                  ? { background:"linear-gradient(135deg,#7c3aed,#4f46e5)", color:"#fff", boxShadow:"0 0 12px rgba(124,58,237,0.4)" }
                  : { background: isLight ? "#f3f4f6" : "#27272a", color: isLight ? "#374151" : "#a1a1aa", border: isLight ? "1px solid #e5e7eb" : "none" }}>
                {p.label}
              </button>
            ))}
          </div>
          {preset==="custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e=>setFrom(e.target.value)} className={inputCls} />
              <span className="text-zinc-600 text-xs">até</span>
              <input type="date" value={customTo} onChange={e=>setTo(e.target.value)} className={inputCls} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Erros de carregamento ── */}
      {loadErrors.length > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 space-y-1">
          <p className="text-xs font-bold text-red-400 mb-1">Erro ao carregar dados — verifique as colunas/tabelas:</p>
          {loadErrors.map((e,i) => <p key={i} className="text-xs text-red-300 font-mono">{e}</p>)}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 rounded-2xl p-1.5 overflow-x-auto" style={{ background: card.bg, border: card.border }}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex-1 justify-center whitespace-nowrap min-w-fit"
            style={tab===t.key
              ? { background:`${t.color}20`, color:t.color, boxShadow:`0 0 14px ${t.color}30, inset 0 0 0 1px ${t.color}40` }
              : { color:"#71717a" }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-zinc-600">Carregando dados...</p>
          </div>
        </div>
      )}

      {!loading && (
        <>

        {/* ════ VISÃO GERAL ════ */}
        {tab==="overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Faturamento" value={fmt(totalRevenue)} sub={`${orderCount} pedidos no período`}
                from="#8b5cf6" to="#06b6d4" glow="rgba(139,92,246,0.15)"
                icon={<TrendingUp className="w-4 h-4" style={{color:"#8b5cf6"}} />} />
              <KPICard label="Ticket Médio" value={fmt(avgTicket)} sub="por pedido"
                from="#f59e0b" to="#f97316" glow="rgba(245,158,11,0.15)"
                icon={<ShoppingCart className="w-4 h-4" style={{color:"#f59e0b"}} />} />
              <KPICard label="Receita Líquida" value={fmt(totalRevenue-totalDiscount)} sub={`${fmt(totalDiscount)} em descontos`}
                from="#3b82f6" to="#60a5fa" glow="rgba(59,130,246,0.15)"
                icon={<Zap className="w-4 h-4" style={{color:"#3b82f6"}} />} />
              <KPICard label="Resultado Estimado" value={fmt(dreResult)}
                sub={cashOut>0?`${fmt(cashOut)} em sangrias`:"sem sangrias no período"}
                from={dreResult>=0?"#10b981":"#f43f5e"} to={dreResult>=0?"#34d399":"#fb7185"} glow={dreResult>=0?"rgba(16,185,129,0.15)":"rgba(244,63,94,0.15)"}
                icon={<Banknote className="w-4 h-4" style={{color: dreResult>=0?"#10b981":"#f43f5e"}} />} />
            </div>

            <Card className="p-6">
              <CardTitle sub="Evolução diária do faturamento">Faturamento no Período</CardTitle>
              {chartData.length===0 ? <Empty text="Sem vendas no período selecionado" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{top:5,right:5,bottom:0,left:10}}>
                    <defs>
                      <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="date" tick={{fill:"#52525b",fontSize:11}} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v=>`R$${(v/1000).toFixed(0)}k`} tick={{fill:"#52525b",fontSize:11}} axisLine={false} tickLine={false} width={55} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#gRevenue)"
                      dot={{fill:"#8b5cf6",strokeWidth:0,r:3}} activeDot={{r:5,fill:"#c4b5fd",stroke:"#8b5cf6",strokeWidth:2}} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-5">
                <CardTitle>Por Canal</CardTitle>
                {channelData.length===0 ? <Empty text="Sem dados" /> : (
                  <>
                    <ResponsiveContainer width="100%" height={130}>
                      <PieChart>
                        <Pie data={channelData} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={4} dataKey="value">
                          {channelData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip content={<ChartTip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 mt-2">
                      {channelData.map((c,i)=>(
                        <div key={c.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{background:PIE_COLORS[i%PIE_COLORS.length]}} />
                            <span className="text-zinc-400">{c.name}</span>
                          </div>
                          <span className="font-bold">{fmt(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>

              <Card className="p-5">
                <CardTitle>Formas de Pagamento</CardTitle>
                {payData.length===0 ? <Empty text="Sem dados de pagamento" /> : (
                  <div className="space-y-2.5">
                    {payData.map((p,i)=>(
                      <div key={p.key}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-zinc-400">{p.name}</span>
                          <span className="font-bold" style={{color:PIE_COLORS[i%PIE_COLORS.length]}}>{fmt(p.value)}</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width:`${totalRevenue>0?(p.value/totalRevenue)*100:0}%`,
                            background:PIE_COLORS[i%PIE_COLORS.length],
                            boxShadow:`0 0 6px ${PIE_COLORS[i%PIE_COLORS.length]}80`
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <CardTitle>Top Vendedores</CardTitle>
                {sellerRanking.filter(s=>s.name!=="Sem vendedor").length===0 ? <Empty text="Sem vendas com vendedor" /> : (
                  <div className="space-y-3">
                    {sellerRanking.filter(s=>s.name!=="Sem vendedor").slice(0,5).map((s,i)=>(
                      <div key={s.name} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                          style={{ background: i===0?"linear-gradient(135deg,#f59e0b,#d97706)":i===1?"linear-gradient(135deg,#a1a1aa,#71717a)":"#27272a", color:"#fff" }}>
                          {i+1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{s.name}</p>
                          <div className="h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${(s.revenue/maxSellerRev)*100}%`, background:"linear-gradient(90deg,#d946ef,#8b5cf6)" }} />
                          </div>
                        </div>
                        <span className="text-xs font-bold flex-shrink-0" style={{color:"#d946ef"}}>{fmt(s.revenue)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ════ VENDAS ════ */}
        {tab==="sales" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Faturamento" value={fmt(totalRevenue)} sub={`${orderCount} pedidos`}
                from="#06b6d4" to="#3b82f6" glow="rgba(6,182,212,0.15)"
                icon={<TrendingUp className="w-4 h-4" style={{color:"#06b6d4"}} />} />
              <KPICard label="Ticket Médio" value={fmt(avgTicket)} sub="por pedido"
                from="#06b6d4" to="#06b6d4" glow="rgba(6,182,212,0.1)"
                icon={<ShoppingCart className="w-4 h-4" style={{color:"#06b6d4"}} />} />
              <KPICard label="Total Descontos" value={fmt(totalDiscount)}
                sub={`${totalRevenue>0?fmtN((totalDiscount/(totalRevenue+totalDiscount))*100,1):"0,0"}% das vendas`}
                from="#f59e0b" to="#f97316" glow="rgba(245,158,11,0.1)"
                icon={<TrendingDown className="w-4 h-4" style={{color:"#f59e0b"}} />} />
              <KPICard label="Receita Líquida" value={fmt(totalRevenue-totalDiscount)} sub="após descontos"
                from="#10b981" to="#059669" glow="rgba(16,185,129,0.1)"
                icon={<Banknote className="w-4 h-4" style={{color:"#10b981"}} />} />
            </div>

            <Card className="p-6">
              <CardTitle sub="Faturamento e pedidos por dia">Evolução de Vendas</CardTitle>
              {chartData.length===0 ? <Empty text="Sem vendas no período" /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{top:5,right:20,bottom:0,left:10}}>
                    <defs>
                      <linearGradient id="gCyan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="date" tick={{fill:"#52525b",fontSize:11}} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tickFormatter={v=>`R$${(v/1000).toFixed(0)}k`} tick={{fill:"#52525b",fontSize:11}} axisLine={false} tickLine={false} width={55} />
                    <YAxis yAxisId="right" orientation="right" tick={{fill:"#52525b",fontSize:11}} axisLine={false} tickLine={false} width={35} />
                    <Tooltip content={<ChartTip />} />
                    <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#06b6d4" strokeWidth={2.5} fill="url(#gCyan)"
                      dot={{fill:"#06b6d4",strokeWidth:0,r:2.5}} activeDot={{r:5,fill:"#67e8f9"}} />
                    <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2"
                      dot={{fill:"#f59e0b",strokeWidth:0,r:2}} activeDot={{r:4}} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <CardTitle sub="Total de pedidos por dia da semana">Por Dia da Semana</CardTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={weekdayData} margin={{top:0,right:0,bottom:0,left:-10}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" tick={{fill:"#71717a",fontSize:11}} axisLine={false} tickLine={false} />
                    <YAxis tick={{fill:"#71717a",fontSize:11}} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="orders" radius={[4,4,0,0]}>
                      {weekdayData.map((_,i)=><Cell key={i} fill={`hsl(${190+i*15},70%,55%)`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-5">
                <CardTitle sub="Intensidade de vendas por hora">Heatmap por Hora</CardTitle>
                <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 mt-2">
                  {hourMap.map((rev,h)=>{
                    const intensity = rev/maxHour;
                    return (
                      <div key={h} className="group relative">
                        <div className="h-8 rounded-md"
                          style={{ background:`rgba(6,182,212,${0.06+intensity*0.94})`, boxShadow: intensity>0.5?`0 0 8px rgba(6,182,212,${intensity*0.5})`:undefined }} />
                        <div className="text-center text-[8px] text-zinc-700 mt-0.5">{h}</div>
                        {rev>0 && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-800 border border-zinc-700 text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap pointer-events-none z-20">
                            {h}h: {fmt(rev)} · {hourOrders[h]} pedidos
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <CardTitle sub={`${sales.length} vendas no período`}>Últimas Vendas</CardTitle>
              {sales.length===0 ? <Empty text="Nenhuma venda no período" /> : (
                <div className="divide-y divide-zinc-800/60">
                  {sales.slice(0,15).map(sale=>{
                    const orig=!sale.origin||sale.origin==="pdv"?"PDV":sale.origin==="mesa"?"Mesa":"Digital";
                    const origColor=orig==="PDV"?"#8b5cf6":orig==="Mesa"?"#06b6d4":"#10b981";
                    const vendedor = sellerOf(sale);
                    return (
                      <div key={sale.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-[10px] text-zinc-600">#{sale.id.slice(-6).toUpperCase()}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                            style={{color:origColor,background:`${origColor}18`,border:`1px solid ${origColor}30`}}>{orig}</span>
                          {vendedor && <span className="text-xs text-zinc-500 truncate">{vendedor}</span>}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(sale.created_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}{" "}
                            {new Date(sale.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
                          </span>
                          {(sale.discount??0)>0 && <span className="text-[10px] text-amber-400">-{fmt(sale.discount??0)}</span>}
                          <span className="font-bold text-sm text-white">{fmt(sale.total_amount)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ════ PRODUTOS ════ */}
        {tab==="products" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard label="Produtos Vendidos" value={String(Object.keys(itemMap).length)} sub="itens distintos"
                from="#10b981" to="#059669" glow="rgba(16,185,129,0.15)"
                icon={<Package className="w-4 h-4" style={{color:"#10b981"}} />} />
              <KPICard label="Total de Unidades" value={String(saleItems.reduce((a,i)=>a+i.quantity,0))} sub="unidades vendidas"
                from="#10b981" to="#06b6d4" glow="rgba(16,185,129,0.1)"
                icon={<ShoppingCart className="w-4 h-4" style={{color:"#10b981"}} />} />
              <KPICard label="Receita de Produtos" value={fmt(totalRevenue)} sub="total do período"
                from="#10b981" to="#10b981" glow="rgba(16,185,129,0.1)"
                icon={<TrendingUp className="w-4 h-4" style={{color:"#10b981"}} />} />
            </div>

            <Card className="p-6">
              <CardTitle sub="Receita gerada por produto (top 15)">Ranking de Produtos</CardTitle>
              {topProducts.length===0 ? <Empty text="Sem vendas no período" /> : (
                <div className="space-y-3">
                  {topProducts.slice(0,15).map((p,i)=>{
                    const abc = abcProducts.find(a=>a.name===p.name);
                    const abcColor = abc?.abc==="A"?"#10b981":abc?.abc==="B"?"#f59e0b":"#f43f5e";
                    return (
                      <div key={p.name}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-5 text-[10px] text-zinc-600 font-mono text-right flex-shrink-0">{i+1}</span>
                            {abc && <Badge color={abcColor}>{abc.abc}</Badge>}
                            <span className="text-sm font-medium truncate">{p.name}</span>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <span className="text-xs text-zinc-600">{p.qty} un.</span>
                            <span className="text-sm font-bold w-28 text-right" style={{color:"#10b981"}}>{fmt(p.revenue)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden ml-7">
                          <div className="h-full rounded-full" style={{
                            width:`${(p.revenue/maxItemRev)*100}%`,
                            background:`linear-gradient(90deg,${abcColor},${abcColor}aa)`,
                            boxShadow:`0 0 6px ${abcColor}60`
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label:"Classe A", desc:"80% do faturamento", color:"#10b981", items:abcProducts.filter(p=>p.abc==="A") },
                { label:"Classe B", desc:"15% do faturamento", color:"#f59e0b", items:abcProducts.filter(p=>p.abc==="B") },
                { label:"Classe C", desc:"5% do faturamento",  color:"#f43f5e", items:abcProducts.filter(p=>p.abc==="C") },
              ].map(cls=>(
                <Card key={cls.label} className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{background:cls.color,boxShadow:`0 0 8px ${cls.color}`}} />
                    <span className="text-sm font-bold" style={{color:cls.color}}>{cls.label}</span>
                    <span className="text-xs text-zinc-600">{cls.desc}</span>
                  </div>
                  <div className="text-2xl font-black mb-1" style={{color:cls.color}}>{cls.items.length}</div>
                  <p className="text-xs text-zinc-600 mb-3">produtos</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {cls.items.map(p=>(
                      <div key={p.name} className="flex justify-between text-xs py-1 border-b border-zinc-800/50">
                        <span className="text-zinc-400 truncate flex-1 mr-2">{p.name}</span>
                        <span className="font-semibold flex-shrink-0" style={{color:cls.color}}>{fmt(p.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ════ PAGAMENTOS ════ */}
        {tab==="payments" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard label="Total de Vendas" value={fmt(totalRevenue)} sub={`${orderCount} pedidos`}
                from="#10b981" to="#059669" glow="rgba(16,185,129,0.15)"
                icon={<TrendingUp className="w-4 h-4" style={{color:"#10b981"}} />} />
              <KPICard label="Sangrias" value={fmt(cashOut)} sub="retiradas do caixa"
                from="#f43f5e" to="#dc2626" glow="rgba(244,63,94,0.12)"
                icon={<TrendingDown className="w-4 h-4" style={{color:"#f43f5e"}} />} />
              <KPICard label="Saldo Estimado" value={fmt(totalRevenue-cashOut)} sub="vendas menos sangrias"
                from={totalRevenue-cashOut>=0?"#f59e0b":"#f43f5e"} to={totalRevenue-cashOut>=0?"#f97316":"#dc2626"} glow="rgba(245,158,11,0.1)"
                icon={<Wallet className="w-4 h-4" style={{color:"#f59e0b"}} />} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <CardTitle sub="Distribuição por forma de pagamento">Por Método</CardTitle>
                {payData.length===0 ? <Empty text="Sem dados de pagamento" /> : (
                  <>
                    <ResponsiveContainer width="100%" height={170}>
                      <PieChart>
                        <Pie data={payData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3} dataKey="value">
                          {payData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip content={<ChartTip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2.5 mt-3">
                      {payData.map((p,i)=>(
                        <div key={p.key} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{background:PIE_COLORS[i%PIE_COLORS.length],boxShadow:`0 0 6px ${PIE_COLORS[i%PIE_COLORS.length]}`}} />
                            <span className="text-zinc-300 text-xs">{p.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-xs" style={{color:PIE_COLORS[i%PIE_COLORS.length]}}>{fmt(p.value)}</span>
                            <span className="text-[10px] text-zinc-600 ml-1.5">{totalRevenue>0?`${fmtN((p.value/totalRevenue)*100,1)}%`:""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>

              <Card className="p-5">
                <CardTitle sub="Comparativo entre métodos">Volume por Método</CardTitle>
                {payData.length===0 ? <Empty text="Sem dados" /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={payData} layout="vertical" margin={{top:0,right:20,bottom:0,left:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                      <XAxis type="number" tickFormatter={v=>`R$${(v/1000).toFixed(0)}k`} tick={{fill:"#52525b",fontSize:11}} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{fill:"#a1a1aa",fontSize:11}} axisLine={false} tickLine={false} width={110} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="value" radius={[0,6,6,0]}>
                        {payData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            {/* DRE */}
            <Card className="p-6">
              <CardTitle sub="Demonstrativo de resultado simplificado">DRE do Período</CardTitle>
              <div className="space-y-0 divide-y divide-zinc-800/60">
                {[
                  { label:"Receita Bruta",      value: totalRevenue+totalDiscount, color:"#a1a1aa", indent:false, bold:false },
                  { label:"(–) Descontos",       value:-totalDiscount,              color:"#f59e0b", indent:true,  bold:false },
                  { label:"Receita Líquida",     value: totalRevenue,               color:"#06b6d4", indent:false, bold:true  },
                  { label:"(–) Sangrias/Saídas", value:-cashOut,                    color:"#f43f5e", indent:true,  bold:false },
                  { label:"Resultado do Período",value:dreResult,                   color:dreResult>=0?"#10b981":"#f43f5e", indent:false, bold:true },
                ].map((row,i)=>(
                  <div key={i} className={`flex items-center justify-between py-3.5 ${row.bold?"":"opacity-80"}`}>
                    <span className={`text-sm ${row.indent?"pl-6 text-zinc-500":"font-semibold text-zinc-300"}`}>{row.label}</span>
                    <span className={`font-bold text-sm tabular-nums ${row.bold?"text-base":""}`} style={{color:row.color}}>
                      {row.value<0 ? `–${fmt(Math.abs(row.value))}` : fmt(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ════ VENDEDORES ════ */}
        {tab==="sellers" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard label="Vendedores Ativos" value={String(sellerRanking.filter(s=>s.name!=="Sem vendedor").length)} sub="no período"
                from="#d946ef" to="#8b5cf6" glow="rgba(217,70,239,0.15)"
                icon={<Award className="w-4 h-4" style={{color:"#d946ef"}} />} />
              <KPICard label="Maior Faturamento" value={sellerRanking.filter(s=>s.name!=="Sem vendedor")[0]?fmt(sellerRanking.filter(s=>s.name!=="Sem vendedor")[0].revenue):"—"}
                sub={sellerRanking.filter(s=>s.name!=="Sem vendedor")[0]?.name??""}
                from="#d946ef" to="#d946ef" glow="rgba(217,70,239,0.1)"
                icon={<Trophy className="w-4 h-4" style={{color:"#d946ef"}} />} />
              <KPICard label="Maior Ticket Médio"
                value={sellerRanking.filter(s=>s.name!=="Sem vendedor").length>0?fmt(Math.max(...sellerRanking.filter(s=>s.name!=="Sem vendedor").map(s=>s.avgTicket))):"—"}
                sub="por pedido"
                from="#f59e0b" to="#d946ef" glow="rgba(245,158,11,0.1)"
                icon={<Zap className="w-4 h-4" style={{color:"#f59e0b"}} />} />
            </div>

            <Card className="p-6">
              <CardTitle sub="Ranking completo por faturamento">Performance por Vendedor</CardTitle>
              {sellerRanking.filter(s=>s.name!=="Sem vendedor").length===0 ? (
                <Empty text="Nenhuma venda com vendedor identificado no período — cadastre vendedores em Configurações" />
              ) : (
                <div className="space-y-4">
                  {sellerRanking.filter(s=>s.name!=="Sem vendedor").map((s,i)=>(
                    <div key={s.name} className="rounded-xl border border-zinc-800/80 p-4"
                      style={i===0?{background:"linear-gradient(135deg,rgba(217,70,239,0.05),transparent)",borderColor:"rgba(217,70,239,0.3)"}:{}}>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-base flex-shrink-0"
                          style={{ background: i===0?"linear-gradient(135deg,#f59e0b,#d97706)":i===1?"linear-gradient(135deg,#a1a1aa,#71717a)":i===2?"linear-gradient(135deg,#cd7c2f,#92400e)":"#27272a", color:"#fff" }}>
                          {i===0?<Trophy className="w-4 h-4" />:i+1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm">{s.name}</p>
                          <p className="text-xs text-zinc-600">{s.orders} pedidos · ticket médio {fmt(s.avgTicket)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-lg" style={{color:"#d946ef"}}>{fmt(s.revenue)}</p>
                          <p className="text-[10px] text-zinc-600">{totalRevenue>0?`${fmtN((s.revenue/totalRevenue)*100,1)}% do total`:""}</p>
                        </div>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width:`${(s.revenue/maxSellerRev)*100}%`,
                          background:"linear-gradient(90deg,#d946ef,#8b5cf6)",
                          boxShadow:"0 0 8px rgba(217,70,239,0.5)"
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ════ CLIENTES ════ */}
        {tab==="customers" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard label="Crédito / Pagamentos" value={fmt(totalCred)} sub={`${custMovs.filter(m=>m.type==="credit"||m.type==="payment").length} lançamentos`}
                from="#10b981" to="#059669" glow="rgba(16,185,129,0.15)"
                icon={<TrendingUp className="w-4 h-4" style={{color:"#10b981"}} />} />
              <KPICard label="Fiado Gerado" value={fmt(totalDebit)} sub={`${custMovs.filter(m=>m.type==="debit").length} lançamentos`}
                from="#f43f5e" to="#dc2626" glow="rgba(244,63,94,0.12)"
                icon={<TrendingDown className="w-4 h-4" style={{color:"#f43f5e"}} />} />
              <KPICard label="Saldo Usado" value={fmt(totalSaldo)} sub={`${custMovs.filter(m=>m.type==="saldo").length} utilizações`}
                from="#f43f5e" to="#8b5cf6" glow="rgba(244,63,94,0.1)"
                icon={<Wallet className="w-4 h-4" style={{color:"#f43f5e"}} />} />
            </div>

            <Card className="p-5">
              <CardTitle sub="Maiores consumidores no período">Top Clientes</CardTitle>
              {topCustomers.length===0 ? <Empty text="Sem movimentações de cliente no período" /> : (
                <div className="space-y-2">
                  {topCustomers.map((c,i)=>(
                    <div key={c.name} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-800/60">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                        style={{ background:`${PIE_COLORS[i%PIE_COLORS.length]}30`, border:`1px solid ${PIE_COLORS[i%PIE_COLORS.length]}40`, color:PIE_COLORS[i%PIE_COLORS.length] }}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{c.name}</p>
                        <p className="text-xs text-zinc-600">{c.count} movimentações</p>
                      </div>
                      <span className="font-black text-sm" style={{color:PIE_COLORS[i%PIE_COLORS.length]}}>{fmt(c.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <CardTitle sub="Histórico recente">Movimentações Recentes</CardTitle>
              {custMovs.length===0 ? <Empty text="Sem movimentações no período" /> : (
                <div className="divide-y divide-zinc-800/60">
                  {custMovs.slice(0,15).map(m=>{
                    const typeMap: Record<string,{label:string;color:string}> = {
                      debit:   { label:"Fiado",       color:"#f43f5e" },
                      credit:  { label:"Crédito",     color:"#10b981" },
                      payment: { label:"Pagamento",   color:"#8b5cf6" },
                      saldo:   { label:"Saldo Usado", color:"#06b6d4" },
                    };
                    const info=typeMap[m.type]??typeMap.debit;
                    const isPos=m.type==="credit"||m.type==="payment";
                    return (
                      <div key={m.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Badge color={info.color}>{info.label}</Badge>
                          <span className="text-sm truncate">{m.customers?.name??"—"}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-[10px] text-zinc-600">{new Date(m.created_at).toLocaleDateString("pt-BR")}</span>
                          <span className="font-bold text-sm" style={{color:info.color}}>{isPos?"+":"-"}{fmt(m.amount)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ════ ESTOQUE ════ */}
        {tab==="stock" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard label="Alertas de Estoque" value={String(lowStockItems.length+lowStockProds.length)} sub="abaixo do mínimo"
                from="#f59e0b" to="#f97316" glow="rgba(245,158,11,0.15)"
                icon={<AlertTriangle className="w-4 h-4" style={{color:"#f59e0b"}} />} />
              <KPICard label="Insumos Zerados" value={String(outOfStockItems.length)} sub="sem estoque"
                from="#f43f5e" to="#dc2626" glow="rgba(244,63,94,0.15)"
                icon={<AlertTriangle className="w-4 h-4" style={{color:"#f43f5e"}} />} />
              <KPICard label="Total de Insumos" value={String(stockItems.length)} sub="cadastrados"
                from="#3b82f6" to="#6366f1" glow="rgba(59,130,246,0.12)"
                icon={<Boxes className="w-4 h-4" style={{color:"#3b82f6"}} />} />
            </div>

            <Card className="p-5">
              <CardTitle sub="Itens que precisam de reposição urgente">Estoque Crítico</CardTitle>
              {[...outOfStockItems,...lowStockItems.filter(i=>i.current_qty>0)].length===0 ? (
                <div className="text-center py-10">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" style={{filter:"drop-shadow(0 0 8px #10b981)"}} />
                  <p className="text-sm font-semibold text-emerald-400">Insumos dentro do normal</p>
                  <p className="text-xs text-zinc-600 mt-1">Todos os insumos estão acima do estoque mínimo</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {[...outOfStockItems,...lowStockItems.filter(i=>i.current_qty>0)].map(item=>{
                    const isOut=item.current_qty<=0;
                    return (
                      <div key={item.id} className="flex items-center justify-between p-3.5 rounded-xl border"
                        style={{borderColor:isOut?"rgba(244,63,94,0.3)":"rgba(245,158,11,0.3)",background:isOut?"rgba(244,63,94,0.05)":"rgba(245,158,11,0.05)"}}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${isOut?"animate-pulse":""}`} style={{color:isOut?"#f43f5e":"#f59e0b"}} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{item.name}</p>
                            <p className="text-xs text-zinc-600">Mín: {item.min_qty} {item.unit}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-black text-sm" style={{color:isOut?"#f43f5e":"#f59e0b"}}>{item.current_qty} {item.unit}</p>
                          <p className="text-[10px]" style={{color:isOut?"#f43f5e":"#f59e0b"}}>{isOut?"ZERADO":"BAIXO"}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {lowStockProds.length>0 && (
              <Card className="p-5">
                <CardTitle sub="Produtos com estoque abaixo do mínimo">Produtos com Estoque Baixo</CardTitle>
                <div className="grid grid-cols-2 gap-2">
                  {lowStockProds.map(p=>(
                    <div key={p.id} className="flex items-center justify-between p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Package className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          <p className="text-xs text-zinc-600">Mín: {p.stock_min} un.</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-black text-sm text-amber-400">{p.stock} un.</p>
                        <p className="text-[10px] text-violet-400">{fmt(p.sale_price)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Posição de todos os produtos com estoque controlado */}
            {limitedProds.length>0 && (
              <Card className="p-5">
                <CardTitle sub="Todos os produtos com estoque controlado">Posição de Estoque — Produtos</CardTitle>
                <div className="divide-y divide-zinc-800/60">
                  {limitedProds.slice(0,25).map(p=>{
                    const pct = p.stock_min>0 ? Math.min(100,(p.stock/(p.stock_min*3))*100) : Math.min(100,(p.stock/50)*100);
                    const color = p.stock<=0?"#f43f5e":p.stock<=(p.stock_min??0)?"#f59e0b":"#10b981";
                    return (
                      <div key={p.id} className="py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium">{p.name}</span>
                          <span className="text-sm font-bold tabular-nums" style={{color}}>{p.stock} un.</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{width:`${Math.max(2,pct)}%`,background:color,boxShadow:`0 0 6px ${color}60`}} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Posição de insumos */}
            {stockItems.length>0 && (
              <Card className="p-5">
                <CardTitle sub="Posição atual de todos os insumos">Posição de Estoque — Insumos</CardTitle>
                <div className="divide-y divide-zinc-800/60">
                  {stockItems.slice(0,25).map(item=>{
                    const pct = item.min_qty>0 ? Math.min(100,(item.current_qty/(item.min_qty*3))*100) : null;
                    const color = item.current_qty<=0?"#f43f5e":item.current_qty<=item.min_qty?"#f59e0b":"#10b981";
                    return (
                      <div key={item.id} className="py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium">{item.name}</span>
                          <span className="text-sm font-bold tabular-nums" style={{color}}>{item.current_qty} {item.unit}</span>
                        </div>
                        {pct!==null && (
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{width:`${Math.max(2,pct)}%`,background:color,boxShadow:`0 0 6px ${color}60`}} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        </>
      )}
    </div>
  );
}
