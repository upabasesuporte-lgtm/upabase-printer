import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";
import {
  TrendingUp, TrendingDown, ShoppingCart, Package,
  AlertTriangle, UtensilsCrossed, Store, ArrowRight,
  RefreshCw, Bell, Clock, Banknote, BarChart3,
  CheckCircle2, Zap, Wallet, Calendar,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Sale {
  id: string; total_amount: number; discount: number | null;
  origin: string | null; created_at: string; status: string; seller_name: string | null;
}

interface SaleItem {
  product_id: string; quantity: number; unit_price: number;
  products: { name: string } | null;
}

interface Product {
  id: string; name: string; stock: number; stock_min: number;
}

type Period = "day" | "week" | "month" | "year" | "custom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

function getRange(period: Period, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(); to.setHours(23, 59, 59, 999);
  switch (period) {
    case "day": {
      const from = new Date(now); from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    case "week": {
      const from = new Date(now);
      from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // Monday
      from.setHours(0, 0, 0, 0);
      return { from, to };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to };
    }
    case "year": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from, to };
    }
    case "custom":
      return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
  }
}

function todayStr() { return new Date().toISOString().split("T")[0]; }
function monthStartStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

const PIE_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#06b6d4", "#d946ef"];

const PERIOD_LABELS: Record<Period, string> = {
  day: "Hoje", week: "Esta Semana", month: "Este Mês", year: "Este Ano", custom: "Personalizado",
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-xs"
      style={isLight
        ? { background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 4px 24px rgba(0,0,0,0.1)", color: "#374151" }
        : { background: "rgba(24,24,27,0.98)", border: "1px solid rgba(63,63,70,0.5)", boxShadow: "0 8px 32px rgba(0,0,0,0.6),0 0 0 1px rgba(139,92,246,0.25)", color: "#a1a1aa" }}>
      <p className="mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="font-bold" style={{ color: p.color }}>
          {p.name === "revenue" ? fmt(p.value) : `${p.value} pedidos`}
        </p>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, change, changeLabel, from: gFrom, to: gTo, glow }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode;
  change?: number | null; changeLabel?: string; from: string; to: string; glow: string;
}) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const hasChange = change !== null && change !== undefined;
  const positive  = hasChange && change! >= 0;

  const cardStyle = isLight ? {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    background: "linear-gradient(135deg,#18181b 0%,#09090b 100%)",
    border: "1px solid rgba(39,39,42,0.8)",
    boxShadow: `0 0 30px ${glow}`,
  };

  return (
    <div className="relative overflow-hidden rounded-2xl p-5 cursor-default" style={cardStyle}>
      {/* Faixa gradiente no topo (light) / glow blur (dark) */}
      {isLight
        ? <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${gFrom},${gTo})`, borderRadius:"12px 12px 0 0" }} />
        : <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full opacity-15 blur-3xl" style={{ background:`linear-gradient(135deg,${gFrom},${gTo})` }} />
      }
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>{label}</span>
          <div className="p-2 rounded-xl" style={{ background:`${gFrom}18`, border:`1px solid ${gFrom}30` }}>{icon}</div>
        </div>
        <div className="text-2xl font-black tabular-nums"
          style={{ background:`linear-gradient(135deg,${gFrom},${gTo})`, WebkitBackgroundClip:"text", display:"inline-block",WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
          {value}
        </div>
        {sub && <p className="text-[11px] mt-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>{sub}</p>}
        {hasChange && (
          <div className={`flex items-center gap-1 mt-2 text-xs font-semibold ${positive ? "text-emerald-500" : "text-red-500"}`}>
            {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {pct(change!)} {changeLabel ?? "vs período anterior"}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
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

  const [userId,    setUserId]    = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [period,    setPeriod]    = useState<Period>("month");
  const [customFrom,setCustomFrom]= useState(monthStartStr());
  const [customTo,  setCustomTo]  = useState(todayStr());
  const [showCustom,setShowCustom]= useState(false);

  const [sales,       setSales]       = useState<Sale[]>([]);
  const [prevSales,   setPrevSales]   = useState<Sale[]>([]);
  const [todayItems,  setTodayItems]  = useState<SaleItem[]>([]);
  const [ifoodItems,  setIfoodItems]  = useState<SaleItem[]>([]);
  const [lowStock,    setLowStock]    = useState<Product[]>([]);
  const [pendingDig,  setPendingDig]  = useState(0);
  const [tableStats,  setTableStats]  = useState({ total: 0, occupied: 0 });
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [apExpenses,  setApExpenses]  = useState(0);

  // ── Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user) setUserId(data.user.id); });
  }, []);

  // ── Load
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const { from, to } = getRange(period, customFrom, customTo);
    const fromISO = from.toISOString();
    const toISO   = to.toISOString();
    // Usa data LOCAL (não UTC) para evitar bug de timezone onde "hoje 23h" vira "amanhã" em UTC
    const pad = (n: number) => String(n).padStart(2, "0");
    const toLocalDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fromDate = toLocalDate(from);
    const toDate   = toLocalDate(to);

    // Previous period for comparison (same duration)
    const duration = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - duration).toISOString();
    const prevTo   = from.toISOString();

    const [salesRes, prevRes, prodRes, digRes, tabRes, recentRes, apRes] = await Promise.all([
      supabase.from("sales").select("id,total_amount,discount,origin,created_at,status,seller_name")
        .eq("user_id", userId).eq("status", "paid")
        .gte("created_at", fromISO).lte("created_at", toISO).order("created_at"),
      supabase.from("sales").select("id,total_amount")
        .eq("user_id", userId).eq("status", "paid")
        .gte("created_at", prevFrom).lte("created_at", prevTo),
      supabase.from("products").select("id,name,stock,stock_min")
        .eq("is_active", true).order("stock").limit(30),
      supabase.from("digital_orders").select("id", { count: "exact", head: true })
        .eq("status", "pending").eq("user_id", userId),
      supabase.from("tables").select("id,status").eq("is_active", true),
      supabase.from("sales").select("id,total_amount,origin,created_at,status,seller_name")
        .eq("user_id", userId).eq("status", "paid")
        .order("created_at", { ascending: false }).limit(10),
      supabase.from("accounts_payable").select("amount,discount,interest,fine,status,paid_date,due_date")
        .eq("user_id", userId).not("status", "eq", "cancelled"),
    ]);

    const currentSales = (salesRes.data ?? []) as Sale[];
    setSales(currentSales);
    setPrevSales((prevRes.data ?? []) as Sale[]);

    // Load today's sale items using sale IDs (avoids complex join)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todaySaleIds = currentSales
      .filter(s => new Date(s.created_at) >= todayStart)
      .map(s => s.id);
    if (todaySaleIds.length > 0) {
      const { data: itemsData } = await supabase
        .from("sale_items").select("product_id,quantity,unit_price,products(name)")
        .in("sale_id", todaySaleIds);
      setTodayItems((itemsData ?? []) as unknown as SaleItem[]);
    } else {
      setTodayItems([]);
    }

    // Carrega itens das vendas iFood no período
    const ifoodSaleIds = currentSales.filter(s => s.origin === "ifood").map(s => s.id);
    if (ifoodSaleIds.length > 0) {
      const { data: iData } = await supabase
        .from("sale_items").select("product_id,quantity,unit_price,products(name)")
        .in("sale_id", ifoodSaleIds);
      setIfoodItems((iData ?? []) as unknown as SaleItem[]);
    } else {
      setIfoodItems([]);
    }

    const prods = (prodRes.data ?? []) as Product[];
    setLowStock(prods.filter(p => p.stock <= (p.stock_min ?? 0) && p.stock_min > 0));
    setPendingDig(digRes.count ?? 0);
    const tabs = (tabRes.data ?? []) as { id: string; status: string }[];
    setTableStats({ total: tabs.length, occupied: tabs.filter(t => t.status === "occupied").length });
    setRecentSales((recentRes.data ?? []) as Sale[]);

    // Filtra despesas pelo período com lógica de fluxo de caixa real:
    // - contas PAGAS: usa paid_date (quando o dinheiro saiu de verdade)
    // - contas PENDENTES/VENCIDAS: usa due_date (quando o dinheiro deveria sair)
    const filteredAp = (apRes.data ?? []).filter((b: any) => {
      const dateRef = b.status === "paid" ? (b.paid_date ?? b.due_date) : b.due_date;
      if (!dateRef) return false;
      return dateRef >= fromDate && dateRef <= toDate;
    });
    const totalAp = filteredAp.reduce((s: number, b: any) =>
      s + b.amount - (b.discount || 0) + (b.interest || 0) + (b.fine || 0), 0);
    setApExpenses(totalAp);

    setLoading(false);
  }, [userId, period, customFrom, customTo]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  // ── Derived KPIs
  const totalRev   = useMemo(() => sales.reduce((a, s) => a + s.total_amount, 0), [sales]);
  const prevRev    = useMemo(() => prevSales.reduce((a, s) => a + s.total_amount, 0), [prevSales]);
  const revChange  = prevRev > 0 ? ((totalRev - prevRev) / prevRev) * 100 : null;
  const totalCount = sales.length;
  const prevCount  = prevSales.length;
  const cntChange  = prevCount > 0 ? ((totalCount - prevCount) / prevCount) * 100 : null;
  const avgTicket  = totalCount > 0 ? totalRev / totalCount : 0;
  const prevAvg    = prevCount > 0 ? prevRev / prevCount : 0;
  const avgChange  = prevAvg > 0 ? ((avgTicket - prevAvg) / prevAvg) * 100 : null;
  const netResult  = totalRev - apExpenses;

  // ── Chart data
  const chartData = useMemo(() => {
    const { from, to } = getRange(period, customFrom, customTo);
    const diffDays = Math.ceil((to.getTime() - from.getTime()) / 86400000);

    if (period === "year" || diffDays > 60) {
      // Monthly breakdown
      const months: Record<string, { revenue: number; orders: number }> = {};
      sales.forEach(s => {
        const d = new Date(s.created_at);
        const key = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
        if (!months[key]) months[key] = { revenue: 0, orders: 0 };
        months[key].revenue += s.total_amount; months[key].orders++;
      });
      return Object.entries(months).map(([date, v]) => ({ date, ...v, revenue: parseFloat(v.revenue.toFixed(2)) }));
    } else {
      // Daily breakdown
      const days = Math.min(diffDays, 31);
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
        const next = new Date(d); next.setDate(next.getDate() + 1);
        const day = sales.filter(s => { const sd = new Date(s.created_at); return sd >= d && sd < next; });
        return {
          date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          revenue: parseFloat(day.reduce((a, s) => a + s.total_amount, 0).toFixed(2)),
          orders: day.length,
        };
      });
    }
  }, [sales, period, customFrom, customTo]);

  // ── Channel data (period-scoped)
  const channelData = useMemo(() => [
    { name: "PDV",              value: sales.filter(s => !s.origin || s.origin === "pdv").reduce((a, s) => a + s.total_amount, 0) },
    { name: "Mesas",            value: sales.filter(s => s.origin === "mesa").reduce((a, s) => a + s.total_amount, 0) },
    { name: "Cardápio Digital", value: sales.filter(s => s.origin === "cardapio_digital" || s.origin === "digital_menu").reduce((a, s) => a + s.total_amount, 0) },
    { name: "iFood",            value: sales.filter(s => s.origin === "ifood").reduce((a, s) => a + s.total_amount, 0) },
  ].filter(c => c.value > 0), [sales]);

  // ── iFood metrics
  const ifoodSales      = sales.filter(s => s.origin === "ifood");
  const ifoodCount      = ifoodSales.length;
  const ifoodNet        = ifoodSales.reduce((a, s) => a + s.total_amount, 0);
  const ifoodCommission = ifoodSales.reduce((a, s) => a + (s.discount ?? 0), 0);
  const ifoodGross      = ifoodNet + ifoodCommission;
  const ifoodProdMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  ifoodItems.forEach(item => {
    const name = (item.products as any)?.name ?? "Produto";
    if (!ifoodProdMap[item.product_id]) ifoodProdMap[item.product_id] = { name, qty: 0, revenue: 0 };
    ifoodProdMap[item.product_id].qty      += item.quantity;
    ifoodProdMap[item.product_id].revenue  += item.quantity * item.unit_price;
  });
  const ifoodTopProds = Object.values(ifoodProdMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const ifoodTotalQty = ifoodTopProds.reduce((s, p) => s + p.qty, 0);

  // ── Top products (today's items)
  const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  todayItems.forEach(item => {
    const name = item.products?.name ?? "Produto";
    if (!productMap[item.product_id]) productMap[item.product_id] = { name, qty: 0, revenue: 0 };
    productMap[item.product_id].qty += item.quantity;
    productMap[item.product_id].revenue += item.quantity * item.unit_price;
  });
  const topProducts      = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const maxProdRevenue   = topProducts[0]?.revenue ?? 1;

  // ── Alerts
  const alerts: { icon: React.ReactNode; text: string; link: string; color: string; glow: string }[] = [];
  if (pendingDig > 0) alerts.push({ icon: <Bell className="w-4 h-4" style={{ color: "#f59e0b" }} />, text: `${pendingDig} pedido${pendingDig > 1 ? "s" : ""} digital${pendingDig > 1 ? "is" : ""} aguardando`, link: "/digital-menu", color: "border-amber-500/20 bg-amber-500/5", glow: "rgba(245,158,11,0.15)" });
  if (tableStats.occupied > 0) alerts.push({ icon: <UtensilsCrossed className="w-4 h-4" style={{ color: "#06b6d4" }} />, text: `${tableStats.occupied} mesa${tableStats.occupied > 1 ? "s" : ""} ocupada${tableStats.occupied > 1 ? "s" : ""}`, link: "/tables", color: "border-cyan-500/20 bg-cyan-500/5", glow: "rgba(6,182,212,0.15)" });
  lowStock.slice(0, 3).forEach(p => alerts.push({ icon: <AlertTriangle className="w-4 h-4" style={{ color: "#f43f5e" }} />, text: `Estoque baixo: ${p.name} (${p.stock} restantes)`, link: "/stock", color: "border-red-500/20 bg-red-500/5", glow: "rgba(244,63,94,0.15)" }));

  const now = new Date(), hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-6" style={isLight ? {
          background: "#3B82F6",
          border: "1px solid #3B82F6",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(59,130,246,0.08), 0 24px 48px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.2)",
        } : {
          background: "linear-gradient(135deg,#18181b 0%,#09090b 100%)",
          backgroundImage: "radial-gradient(rgba(139,92,246,0.07) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          border: "1px solid rgba(39,39,42,0.8)",
        }}>
        {isLight ? null : <div className="absolute inset-0 bg-gradient-to-r from-violet-900/10 to-cyan-900/5 pointer-events-none" />}
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" style={{ boxShadow: "0 0 6px rgba(255,255,255,0.6)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: isLight ? "#fff" : "#a1a1aa" }}>Ao vivo</span>
            </div>
            <h1 className="text-2xl font-black" style={{ color: isLight ? "#fff" : "var(--gradient-text, #fff)" }}>
              {greeting}!
            </h1>
            <p className="text-xs mt-1" style={{ color: isLight ? "rgba(255,255,255,0.8)" : "#71717a" }}>{now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={isLight ? {
              background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff",
              boxShadow: loading ? "none" : "0 2px 8px rgba(0,0,0,0.1)",
            } : {
              background: "#18181b", border: "1px solid #3f3f46", color: "#a1a1aa",
              boxShadow: loading ? "none" : "0 0 12px rgba(139,92,246,0.2)",
            }}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} style={{ color: isLight ? "#fff" : loading ? "#7B2FBE" : "#71717a" }} />
            {loading ? "Carregando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {/* ── Period Filter ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: isLight ? "#9CA3AF" : "#71717a" }} />
        {(["day", "week", "month", "year", "custom"] as Period[]).map(p => (
          <button key={p} onClick={() => { setPeriod(p); if (p === "custom") setShowCustom(true); else setShowCustom(false); }}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p
              ? isLight
                ? { background: "#3B82F6", color: "#fff", border: "1px solid #3B82F6", boxShadow: "0 2px 8px rgba(59,130,246,0.3)" }
                : { background: "rgba(139,92,246,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.4)", boxShadow: "0 0 12px rgba(139,92,246,0.2)" }
              : isLight
                ? { background: "#fff", color: "#6B7280", border: "1px solid #e5e7eb" }
                : { background: "#18181b", color: "#71717a", border: "1px solid #27272a" }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {showCustom && (
          <div className="flex items-center gap-2 ml-1">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs focus:outline-none"
              style={isLight ? { background:"#fff", border:"1px solid #e5e7eb", color:"#374151" } : { background:"#18181b", border:"1px solid #3f3f46", color:"#fff" }} />
            <span className="text-xs" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>até</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs focus:outline-none"
              style={isLight ? { background:"#fff", border:"1px solid #e5e7eb", color:"#374151" } : { background:"#18181b", border:"1px solid #3f3f46", color:"#fff" }} />
          </div>
        )}
      </div>

      {/* ── Resultado do Período (Receita - Despesas) ── */}
      <div className="relative overflow-hidden rounded-2xl p-5 flex items-center gap-5 flex-wrap" style={isLight ? {
          background: netResult >= 0 ? "rgba(16,185,129,0.06)" : "rgba(244,63,94,0.06)",
          border: `1px solid ${netResult >= 0 ? "rgba(16,185,129,0.25)" : "rgba(244,63,94,0.25)"}`,
          boxShadow: `0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)`,
        } : {
          background: netResult >= 0 ? "rgba(16,185,129,0.06)" : "rgba(244,63,94,0.06)",
          border: `1px solid ${netResult >= 0 ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.3)"}`,
          boxShadow: `0 0 24px ${netResult >= 0 ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)"}`,
        }}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>
            Resultado — {PERIOD_LABELS[period]}
          </p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-black tabular-nums" style={{ color: netResult >= 0 ? "#10b981" : "#f43f5e" }}>
              {netResult >= 0 ? "+" : ""}{fmt(netResult)}
            </span>
            <span className="text-sm" style={{ color: isLight ? "#6B7280" : "#71717a" }}>
              {netResult >= 0 ? "Lucro" : "Prejuízo"} no período
            </span>
          </div>
        </div>
        <div className="flex gap-6 flex-wrap">
          <div className="text-center">
            <p className="text-[11px] mb-0.5" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>Receitas</p>
            <p className="text-base font-bold" style={{ color: "#10b981" }}>{fmt(totalRev)}</p>
          </div>
          <div className="text-center">
            <p className="text-[11px] mb-0.5" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>Despesas</p>
            <p className="text-base font-bold" style={{ color: "#f43f5e" }}>{fmt(apExpenses)}</p>
            <Link to="/accounts-payable" className="text-[10px] underline" style={{ color: isLight ? "#7B2FBE" : "#71717a" }}>ver contas</Link>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Faturamento" value={fmt(totalRev)} sub={`${totalCount} ${totalCount === 1 ? "venda" : "vendas"}`}
          from="#8b5cf6" to="#06b6d4" glow="rgba(139,92,246,0.15)" change={revChange}
          icon={<Banknote className="w-4 h-4" style={{ color: "#8b5cf6" }} />} />
        <KpiCard label="Pedidos" value={totalCount} sub="confirmados"
          from="#06b6d4" to="#3b82f6" glow="rgba(6,182,212,0.12)" change={cntChange}
          icon={<ShoppingCart className="w-4 h-4" style={{ color: "#06b6d4" }} />} />
        <KpiCard label="Ticket Médio" value={fmt(avgTicket)} sub="por pedido"
          from="#10b981" to="#059669" glow="rgba(16,185,129,0.12)" change={avgChange}
          icon={<TrendingUp className="w-4 h-4" style={{ color: "#10b981" }} />} />
        <KpiCard label="Contas a Pagar" value={fmt(apExpenses)} sub="despesas no período"
          from="#f43f5e" to="#f97316" glow="rgba(244,63,94,0.1)"
          icon={<Wallet className="w-4 h-4" style={{ color: "#f43f5e" }} />} />
      </div>

      {/* Revenue chart */}
      <div className="rounded-2xl p-6" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold" style={{ color: isLight ? "#111" : "#fff" }}>Faturamento — {PERIOD_LABELS[period]}</h2>
            <p className="text-xs mt-0.5" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Total: {fmt(totalRev)}</p>
          </div>
          <Link to="/reports" className="flex items-center gap-1.5 text-xs font-semibold transition-colors" style={{ color: "#7B2FBE" }}>
            Ver relatório <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {chartData.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Sem dados para este período.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7B2FBE" stopOpacity={isLight ? 0.25 : 0.4} />
                  <stop offset="95%" stopColor="#7B2FBE" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? "#f3f4f6" : "#27272a"} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: isLight ? "#9CA3AF" : "#52525b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => v === 0 ? "0" : `R$${(v / 1000).toFixed(1)}k`} tick={{ fill: isLight ? "#9CA3AF" : "#52525b", fontSize: 11 }} axisLine={false} tickLine={false} width={55} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="revenue" stroke="#7B2FBE" strokeWidth={2.5} fill="url(#revGrad)"
                dot={{ fill: "#7B2FBE", strokeWidth: 0, r: 3 }} activeDot={{ r: 5, fill: "#00B4D8", stroke: "#7B2FBE", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Row 3: Top products + Channel + Alerts */}
      <div className="grid grid-cols-3 gap-4">

        {/* Top products */}
        <div className="rounded-2xl p-5" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold" style={{ color: isLight ? "#111" : "#fff" }}>Top Produtos Hoje</h2>
            <BarChart3 className="w-4 h-4" style={{ color: isLight ? "#9CA3AF" : "#52525b" }} />
          </div>
          {topProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-8 h-8 mx-auto mb-2" style={{ color: isLight ? "#D1D5DB" : "#3f3f46" }} />
              <p className="text-xs" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Nenhuma venda hoje</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => {
                const colors = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#d946ef"];
                const c = colors[i % colors.length];
                return (
                  <div key={p.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs w-4 flex-shrink-0 font-mono" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>{i + 1}</span>
                        <span className="text-xs font-medium truncate" style={{ color: isLight ? "#374151" : "#d4d4d8" }}>{p.name}</span>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span className="text-xs font-bold" style={{ color: c }}>{fmt(p.revenue)}</span>
                        <span className="text-xs ml-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>({p.qty}×)</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isLight ? "#F3F4F6" : "#27272a" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${(p.revenue / maxProdRevenue) * 100}%`, background: c }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Channel breakdown */}
        <div className="rounded-2xl p-5" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold" style={{ color: isLight ? "#111" : "#fff" }}>Canais de Venda</h2>
            <Store className="w-4 h-4" style={{ color: isLight ? "#9CA3AF" : "#52525b" }} />
          </div>
          {channelData.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart className="w-8 h-8 mx-auto mb-2" style={{ color: isLight ? "#D1D5DB" : "#3f3f46" }} />
              <p className="text-xs" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Nenhuma venda no período</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={channelData} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={4} dataKey="value">
                    {channelData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: isLight ? "#fff" : "#18181b", border: `1px solid ${isLight ? "#e5e7eb" : "#27272a"}`, borderRadius: 12, fontSize: 12, color: isLight ? "#374151" : "#d4d4d8" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {channelData.map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span style={{ color: isLight ? "#6B7280" : "#a1a1aa" }}>{c.name}</span>
                    </div>
                    <span className="font-bold" style={{ color: PIE_COLORS[i % PIE_COLORS.length] }}>{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* iFood Report */}
        {ifoodCount > 0 && (
          <div className="bg-zinc-900 border border-red-500/20 rounded-2xl p-5" style={{ boxShadow: "0 0 24px rgba(239,68,68,0.06)", gridColumn: "1 / -1" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">🛵</span>
                <h2 className="text-sm font-bold text-white">Resumo iFood — {PERIOD_LABELS[period]}</h2>
              </div>
              <span className="text-xs text-red-400 font-semibold px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded-full">{ifoodCount} pedido{ifoodCount !== 1 ? "s" : ""}</span>
            </div>
            {/* Cards de valor */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-zinc-950 rounded-xl p-3 border border-zinc-800">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Valor Bruto</p>
                <p className="text-base font-black text-white">{fmt(ifoodGross)}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{ifoodTotalQty} item{ifoodTotalQty !== 1 ? "s" : ""} vendido{ifoodTotalQty !== 1 ? "s" : ""}</p>
              </div>
              <div className="bg-zinc-950 rounded-xl p-3 border border-red-500/20">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Comissão iFood</p>
                <p className="text-base font-black text-red-400">-{fmt(ifoodCommission)}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{ifoodGross > 0 ? ((ifoodCommission / ifoodGross) * 100).toFixed(1) : "0"}% do bruto</p>
              </div>
              <div className="bg-zinc-950 rounded-xl p-3 border border-emerald-500/20">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Valor Líquido</p>
                <p className="text-base font-black text-emerald-400">{fmt(ifoodNet)}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Ticket médio {ifoodCount > 0 ? fmt(ifoodNet / ifoodCount) : "—"}</p>
              </div>
            </div>
            {/* Top produtos iFood */}
            {ifoodTopProds.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">Produtos mais vendidos</p>
                <div className="space-y-1.5">
                  {ifoodTopProds.map(p => (
                    <div key={p.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-red-400 font-bold flex-shrink-0">{p.qty}×</span>
                        <span className="text-zinc-300 truncate">{p.name}</span>
                      </div>
                      <span className="text-zinc-400 flex-shrink-0 ml-3">{fmt(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Alerts */}
        <div className="rounded-2xl p-5" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold" style={{ color: isLight ? "#111" : "#fff" }}>Alertas</h2>
            <Bell className="w-4 h-4" style={{ color: isLight ? "#9CA3AF" : "#52525b" }} />
          </div>
          {alerts.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" style={{ filter: "drop-shadow(0 0 8px #10b981)" }} />
              <p className="text-sm font-semibold" style={{ color: "#10b981" }}>Tudo em ordem!</p>
              <p className="text-xs mt-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Sem alertas no momento</p>
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <Link key={i} to={a.link}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all hover:brightness-110 ${a.color}`}
                  style={{ boxShadow: `0 0 12px ${a.glow}` }}>
                  <span className="flex-shrink-0 mt-0.5">{a.icon}</span>
                  <span className="leading-relaxed" style={{ color: isLight ? "#374151" : "#d4d4d8" }}>{a.text}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent sales */}
      <div className="rounded-2xl p-5" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold" style={{ color: isLight ? "#111" : "#fff" }}>Vendas Recentes</h2>
          <Link to="/reports" className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#7B2FBE" }}>
            Ver todas <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {recentSales.length === 0 ? (
          <div className="text-center py-8">
            <Zap className="w-8 h-8 mx-auto mb-2" style={{ color: isLight ? "#D1D5DB" : "#3f3f46" }} />
            <p className="text-xs" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Nenhuma venda registrada ainda</p>
          </div>
        ) : (
          <div className="space-y-1">
            {recentSales.map((sale, idx) => {
              const origin = sale.origin;
              const channelLabel = !origin || origin === "pdv" ? "PDV" : origin === "mesa" ? "Mesa" : "Cardápio Digital";
              const channelColor = !origin || origin === "pdv" ? "#8b5cf6" : origin === "mesa" ? "#f59e0b" : "#10b981";
              return (
                <div key={sale.id}
                  className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-xl transition-all"
                  style={{ background: idx % 2 === 0 ? (isLight ? "rgba(123,47,190,0.03)" : "rgba(255,255,255,0.02)") : "transparent" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg flex-shrink-0"
                      style={{ color: channelColor, background: `${channelColor}15`, border: `1px solid ${channelColor}25` }}>
                      {channelLabel}
                    </span>
                    <div className="min-w-0">
                      <span className="font-mono text-xs" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>#{sale.id.slice(-6).toUpperCase()}</span>
                      {sale.seller_name && <span className="text-xs ml-2" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>{sale.seller_name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <span className="text-xs flex items-center gap-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>
                      <Clock className="w-3 h-3" />
                      {new Date(sale.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="font-black text-sm" style={{ color: isLight ? "#111" : "#fff" }}>{fmt(sale.total_amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
