import { useEffect, useState, useCallback, useRef } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useTheme } from "../contexts/ThemeContext";

import {
  LayoutDashboard,
  ShoppingCart,
  UtensilsCrossed,
  Package,
  Boxes,
  Users,
  Wallet,
  BarChart3,
  Settings,
  Store,
  LogOut,
  Clock,
  TrendingUp,
  LockOpen,
  Lock,
  Shield,
  Crown,
  Gift,
  AlertTriangle,
  Camera,
  Star,
  MessageSquare,
  Sun,
  Moon,
} from "lucide-react";
import { AvaliacaoModal } from "../components/AvaliacaoModal";

const ADMIN_EMAIL = "upabasesuporte@gmail.com";

const menuItems = [
  { label: "Dashboard",       icon: LayoutDashboard, path: "/",                color: "#7B2FBE" },
  { label: "Caixa",           icon: Wallet,          path: "/cash",            color: "#7B2FBE" },
  { label: "Vendas",          icon: ShoppingCart,    path: "/pdv",             color: "#7B2FBE" },
  { label: "Cardápio Digital",icon: Store,           path: "/digital-menu",    color: "#7B2FBE" },
  { label: "Mesas",           icon: UtensilsCrossed, path: "/tables",          color: "#f43f5e" },
  { label: "Produtos",        icon: Package,         path: "/products",        color: "#10b981" },
  { label: "Estoque",         icon: Boxes,           path: "/stock",           color: "#3b82f6" },
  { label: "Clientes",        icon: Users,           path: "/customers",       color: "#d946ef" },
  { label: "Contas a Pagar",  icon: Wallet,          path: "/accounts-payable",color: "#f97316" },
  { label: "Relatórios",      icon: BarChart3,       path: "/reports",         color: "#06b6d4" },
  { label: "Configurações",   icon: Settings,        path: "/settings",        color: "#71717a" },
];

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function timeSince(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return "agora";
  if (diff < 60) return `${diff}min`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

interface UserPlanRecord {
  plan: "trial" | "active" | "lifetime" | "suspended";
  plan_expires_at: string | null;
  is_lifetime: boolean;
}

function daysLeftFromNow(expiresAt: string | null, isLifetime: boolean): number | null {
  if (isLifetime) return null;
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
}

function PlanBadge({ plan }: { plan: UserPlanRecord }) {
  const dl = daysLeftFromNow(plan.plan_expires_at, plan.is_lifetime);
  const isExpired = !plan.is_lifetime && dl !== null && dl <= 0;

  if (plan.is_lifetime || plan.plan === "lifetime") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
        color: "#a78bfa", background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)",
        boxShadow: "0 0 8px rgba(167,139,250,0.2)",
      }}>
        <Crown size={10} /> Vitalício
      </span>
    );
  }

  if (plan.plan === "suspended" || isExpired) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
        color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)",
        boxShadow: "0 0 8px rgba(239,68,68,0.2)",
      }}>
        <AlertTriangle size={10} /> {plan.plan === "suspended" ? "Suspenso" : "Vencido"}
      </span>
    );
  }

  if (plan.plan === "trial") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
        color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)",
        boxShadow: "0 0 8px rgba(245,158,11,0.2)",
      }}>
        <Gift size={10} /> Trial{dl !== null ? ` · ${dl}d` : ""}
      </span>
    );
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      color: "#10b981", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)",
      boxShadow: "0 0 8px rgba(16,185,129,0.2)",
    }}>
      ✓ Ativo{dl !== null ? ` · ${dl}d` : ""}
    </span>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  // ── Paleta dinâmica (não toca em nenhuma lógica de negócio)
  const T = {
    pageBg:    isLight ? "#F8F9FA"  : "#09090b",
    sidebarBg: isLight ? "#ffffff"  : "linear-gradient(180deg,#0f0f13 0%,#09090b 100%)",
    headerBg:  isLight ? "#ffffff"  : "linear-gradient(135deg,#0f0f13 0%,#09090b 100%)",
    border:    isLight ? "#e5e7eb"  : "rgba(39,39,42,0.8)",
    text:      isLight ? "#111111"  : "#ffffff",
    clockGrad: isLight ? "linear-gradient(135deg,#7B2FBE,#00B4D8)" : "linear-gradient(135deg,#c4b5fd,#67e8f9)",
    nameGrad:  isLight ? "linear-gradient(135deg,#7B2FBE,#00B4D8)" : "linear-gradient(135deg,#c4b5fd,#a78bfa)",
  };
  const [loading,         setLoading]         = useState(true);
  const [userEmail,       setUserEmail]       = useState<string | null>(null);
  const [userId,          setUserId]          = useState<string | null>(null);
  const [showReview,      setShowReview]      = useState(false);
  const [userPlan,        setUserPlan]        = useState<UserPlanRecord | null>(null);
  const [companyName,     setCompanyName]     = useState<string | null>(null);
  const [avatarUrl,       setAvatarUrl]       = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Relógio
  const [now, setNow] = useState(new Date());

  // Dados do topo
  const [todaySales,      setTodaySales]      = useState<number>(0);
  const [cashOpenedAt,    setCashOpenedAt]    = useState<string | null>(null);
  const [occupiedTables,  setOccupiedTables]  = useState<number>(0);
  const [totalTables,     setTotalTables]     = useState<number>(0);

  // ── processInvite
  async function processInvite(token: string, uid: string) {
    const { data: linkData } = await supabase
      .from("access_links")
      .select("*")
      .eq("token", token)
      .is("used_by", null)
      .maybeSingle();

    if (!linkData) return;

    const now = new Date();
    let expiresAt: string | null = null;
    let isLifetime = false;
    let plan: "trial" | "active" | "lifetime" = "active";

    if (linkData.plan_type === "lifetime") {
      isLifetime = true;
      plan = "lifetime";
    } else {
      const days = linkData.days_granted ?? (linkData.plan_type === "trial" ? 15 : 30);
      const expiry = new Date(now);
      expiry.setDate(expiry.getDate() + days);
      expiresAt = expiry.toISOString();
      plan = linkData.plan_type === "trial" ? "trial" : "active";
    }

    await supabase.from("user_plans")
      .update({ plan, plan_expires_at: expiresAt, is_lifetime: isLifetime })
      .eq("user_id", uid);

    await supabase.from("access_links").update({
      used_by: uid,
      used_at: now.toISOString(),
    }).eq("token", token);
  }

  // ── Auth
  useEffect(() => {
    async function checkAuth() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate("/auth"); return; }
      setUserEmail(data.user.email ?? null);
      setAvatarUrl(data.user.user_metadata?.avatar_url ?? null);
      const uid = data.user.id;
      setUserId(uid);

      // Handle pending invite from localStorage
      const pendingInvite = localStorage.getItem("pending_invite");
      if (pendingInvite) {
        localStorage.removeItem("pending_invite");
        await processInvite(pendingInvite, uid);
      }

      setLoading(false);
    }
    checkAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // ── Relógio — atualiza a cada segundo
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Dados operacionais do topo
  const loadHeaderData = useCallback(async (uid: string) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [registerRes, tablesRes, planRes, settingsRes] = await Promise.all([
      supabase.from("cash_registers")
        .select("opened_at")
        .eq("user_id", uid)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("tables")
        .select("status")
        .eq("is_active", true),
      supabase.from("user_plans")
        .select("plan, plan_expires_at, is_lifetime")
        .eq("user_id", uid)
        .maybeSingle(),
      supabase.from("store_settings")
        .select("name")
        .eq("user_id", uid)
        .maybeSingle(),
    ]);

    // "Vendas hoje" usa o mesmo filtro do Caixa: desde a abertura (ou meia-noite se fechado)
    const filterFrom = registerRes.data?.opened_at ?? todayStart.toISOString();
    const salesRes = await supabase.from("sales")
      .select("total_amount, discount, origin")
      .eq("status", "paid")
      .eq("user_id", uid)
      .gte("created_at", filterFrom);

    // iFood: valor bruto (total + comissão) para bater com recibos
    const total = (salesRes.data ?? []).reduce(
      (s: number, r: any) =>
        r.origin === "ifood"
          ? s + Number(r.total_amount ?? 0) + Number(r.discount ?? 0)
          : s + Number(r.total_amount ?? 0),
      0
    );
    setTodaySales(total);
    setCashOpenedAt(registerRes.data?.opened_at ?? null);

    const allTables = tablesRes.data ?? [];
    setTotalTables(allTables.length);
    setOccupiedTables(allTables.filter((t: { status: string }) => t.status === "occupied").length);

    if (planRes.data) {
      setUserPlan(planRes.data as UserPlanRecord);
    } else {
      setUserPlan(null);
    }

    setCompanyName((settingsRes.data as { name?: string } | null)?.name ?? null);
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadHeaderData(userId);
    const id = setInterval(() => loadHeaderData(userId), 90_000);
    return () => clearInterval(id);
  }, [userId, loadHeaderData]);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setAvatarUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `avatars/${userId}.${ext}`;
    await supabase.storage.from("menu-assets").upload(path, file, { upsert: true, contentType: file.type });
    const { data: pub } = supabase.storage.from("menu-assets").getPublicUrl(path);
    const url = pub.publicUrl;
    await supabase.auth.updateUser({ data: { avatar_url: url } });
    setAvatarUrl(url);
    setAvatarUploading(false);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/auth");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: T.pageBg }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-zinc-600 uppercase tracking-widest">Carregando...</p>
        </div>
      </div>
    );
  }

  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: T.pageBg, color: T.text }}>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="w-72 flex flex-col flex-shrink-0"
        style={{ background: T.sidebarBg, borderRight: `1px solid ${T.border}` }}>

        {/* Logo */}
        <div className="h-20 flex items-center justify-center" style={{ overflow: "visible", borderBottom: `1px solid ${T.border}` }}>
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
            alt="Logo"
            style={{ height: 160, width: "auto", display: "block", imageRendering: "auto", pointerEvents: "none" }}
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className="block"
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "9px 14px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: isActive ? 600 : 500,
                  transition: "all 0.15s",
                  color: isActive ? item.color : "#71717a",
                  background: isActive ? `${item.color}15` : "transparent",
                  boxShadow: isActive ? `inset 0 0 0 1px ${item.color}30` : "none",
                })}
              >
                {({ isActive }) => (
                  <>
                    <span className="flex-shrink-0" style={isActive ? { filter:`drop-shadow(0 0 4px ${item.color})` } : {}}>
                      <Icon size={16} />
                    </span>
                    <span>{item.label}</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: item.color, boxShadow:`0 0 6px ${item.color}` }} />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}

          {/* Admin nav items — only for admin email */}
          {userEmail === ADMIN_EMAIL && (
            <>
              <NavLink
                to="/admin"
                end
                className="block"
                style={({ isActive }) => ({
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "9px 14px", borderRadius: "12px", fontSize: "13px",
                  fontWeight: isActive ? 600 : 500, transition: "all 0.15s",
                  color: isActive ? "#8b5cf6" : "#71717a",
                  background: isActive ? "#8b5cf615" : "transparent",
                  boxShadow: isActive ? "inset 0 0 0 1px #8b5cf630" : "none",
                })}
              >
                {({ isActive }) => (
                  <>
                    <span className="flex-shrink-0" style={isActive ? { filter: "drop-shadow(0 0 4px #8b5cf6)" } : {}}>
                      <Shield size={16} />
                    </span>
                    <span>Painel Admin</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: "#8b5cf6", boxShadow: "0 0 6px #8b5cf6" }} />
                    )}
                  </>
                )}
              </NavLink>
              <NavLink
                to="/admin/avaliacoes"
                className="block"
                style={({ isActive }) => ({
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "9px 14px", borderRadius: "12px", fontSize: "13px",
                  fontWeight: isActive ? 600 : 500, transition: "all 0.15s",
                  color: isActive ? "#f59e0b" : "#71717a",
                  background: isActive ? "#f59e0b15" : "transparent",
                  boxShadow: isActive ? "inset 0 0 0 1px #f59e0b30" : "none",
                })}
              >
                {({ isActive }) => (
                  <>
                    <span className="flex-shrink-0" style={isActive ? { filter: "drop-shadow(0 0 4px #f59e0b)" } : {}}>
                      <Star size={16} />
                    </span>
                    <span>Avaliações</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: "#f59e0b", boxShadow: "0 0 6px #f59e0b" }} />
                    )}
                  </>
                )}
              </NavLink>
            </>
          )}
        </nav>

        {/* Rodapé minimalista — tema + sair */}
        <div className="px-3 py-2 flex items-center gap-2" style={{ borderTop: `1px solid ${T.border}` }}>
          <button
            onClick={toggleTheme}
            title={isLight ? "Tema escuro" : "Tema claro"}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all flex-shrink-0"
            style={isLight
              ? { color: "#7B2FBE", background: "rgba(123,47,190,0.08)", border: "1px solid rgba(123,47,190,0.18)" }
              : { color: "#a78bfa", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.18)" }}
          >
            {isLight ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          <button onClick={handleLogout}
            title="Sair"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all text-zinc-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
            style={{ border: "1px solid transparent" }}>
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="h-16 px-6 flex items-center justify-between flex-shrink-0 gap-4"
          style={{ background: T.headerBg, borderBottom: `1px solid ${T.border}` }}>

          {/* Esquerda — online + relógio + data */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Online */}
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" style={{ boxShadow:"0 0 6px #10b981" }} />
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium hidden sm:block">Online</span>
            </div>

            <div className="w-px h-5 bg-zinc-800" />

            {/* Relógio */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
              <span className="text-sm font-bold tabular-nums tracking-tight"
                style={isLight
                  ? { color: "#7B2FBE", WebkitTextFillColor: "#7B2FBE", backgroundClip: "unset", WebkitBackgroundClip: "unset", background: "none" }
                  : { background: "linear-gradient(135deg,#c4b5fd,#67e8f9)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
                {timeStr}
              </span>
            </div>

            {/* Data */}
            <span className="text-xs text-zinc-500 capitalize hidden md:block">{dateStr}</span>
          </div>

          {/* Centro — métricas operacionais */}
          <div className="flex items-center gap-1 flex-1 justify-center">

            {/* Vendas do dia */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
              style={{ background:"rgba(16,185,129,0.06)", borderColor:"rgba(16,185,129,0.2)" }}>
              <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color:"#10b981" }} />
              <div className="leading-none">
                <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">Vendas hoje</p>
                <p className="text-xs font-black tabular-nums" style={{ color:"#10b981" }}>{fmt(todaySales)}</p>
              </div>
            </div>

            <div className="w-px h-8 bg-zinc-800/80" />

            {/* Caixa */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
              style={cashOpenedAt
                ? { background:"rgba(139,92,246,0.06)", borderColor:"rgba(139,92,246,0.2)" }
                : { background:"rgba(244,63,94,0.05)",  borderColor:"rgba(244,63,94,0.18)" }}>
              {cashOpenedAt
                ? <LockOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color:"#8b5cf6" }} />
                : <Lock     className="w-3.5 h-3.5 flex-shrink-0" style={{ color:"#f43f5e" }} />}
              <div className="leading-none">
                <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">Caixa</p>
                <p className="text-xs font-black"
                  style={{ color: cashOpenedAt ? "#8b5cf6" : "#f43f5e" }}>
                  {cashOpenedAt ? `Aberto · ${timeSince(cashOpenedAt)}` : "Fechado"}
                </p>
              </div>
            </div>

            <div className="w-px h-8 bg-zinc-800/80" />

            {/* Mesas */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
              style={occupiedTables > 0
                ? { background:"rgba(245,158,11,0.06)", borderColor:"rgba(245,158,11,0.2)" }
                : { background:"rgba(113,113,122,0.06)", borderColor:"rgba(113,113,122,0.18)" }}>
              <UtensilsCrossed className="w-3.5 h-3.5 flex-shrink-0"
                style={{ color: occupiedTables > 0 ? "#f59e0b" : "#52525b" }} />
              <div className="leading-none">
                <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">Mesas</p>
                <p className="text-xs font-black"
                  style={{ color: occupiedTables > 0 ? "#f59e0b" : "#52525b" }}>
                  {occupiedTables > 0 ? `${occupiedTables}/${totalTables} ocupadas` : "Todas livres"}
                </p>
              </div>
            </div>
          </div>

          {/* Direita — plan badge + empresa + avatar */}
          <div className="flex-shrink-0 flex items-center gap-3">
            {userEmail !== ADMIN_EMAIL && userPlan && (
              <PlanBadge plan={userPlan} />
            )}

            {companyName && (
              <div className="hidden md:flex flex-col items-end leading-none">
                <span className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1">Estabelecimento</span>
                <span className="font-black leading-none"
                  style={isLight
                    ? { fontSize: 15, color: "#7B2FBE", WebkitTextFillColor: "#7B2FBE", backgroundClip: "unset", WebkitBackgroundClip: "unset", background: "none" }
                    : { fontSize: 15, background: "linear-gradient(135deg,#c4b5fd,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  {companyName}
                </span>
              </div>
            )}

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <button
              onClick={() => avatarInputRef.current?.click()}
              title="Clique para alterar foto de perfil"
              className="relative w-9 h-9 rounded-full overflow-hidden flex-shrink-0 group cursor-pointer"
              style={{ boxShadow: "0 0 12px rgba(124,58,237,0.4)" }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-black text-xs text-white"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
                  {userEmail ? userEmail.charAt(0).toUpperCase() : "U"}
                </div>
              )}
              {avatarUploading && (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="w-3.5 h-3.5 text-white" />
              </div>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto min-h-0">
          <div className="p-6 min-h-full">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Modal de avaliação — disponível em qualquer página */}
      {userId && (
        <AvaliacaoModal
          open={showReview}
          userId={userId}
          avatarUrl={avatarUrl}
          onClose={() => setShowReview(false)}
        />
      )}
    </div>
  );
}
