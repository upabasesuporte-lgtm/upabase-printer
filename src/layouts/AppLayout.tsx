import { useEffect, useState, useCallback, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useTheme } from "../contexts/ThemeContext";
import { UserPlanRecord, isPlanValid, isRouteAllowed, PLAN_ROUTES, PlanType } from "../lib/plans";
import { PlanBlock } from "../components/PlanBlock";
import { unlockAudio, playAlertBeep } from "../lib/audio";

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
  HelpCircle,
  Menu,
  X,
  Truck,
  Building2,
} from "lucide-react";
import { AvaliacaoModal } from "../components/AvaliacaoModal";

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "";

const menuItems = [
  { label: "Dashboard",       icon: LayoutDashboard, path: "/",                color: "#3b82f6" },
  { label: "Caixa",           icon: Wallet,          path: "/cash",            color: "#3b82f6" },
  { label: "Vendas",          icon: ShoppingCart,    path: "/pdv",             color: "#3b82f6" },
  { label: "Catálogo Digital",icon: Store,           path: "/digital-menu",    color: "#3b82f6" },
  { label: "Mesas",           icon: UtensilsCrossed, path: "/tables",          color: "#3b82f6" },
  { label: "Produtos",        icon: Package,         path: "/products",        color: "#3b82f6" },
  { label: "Estoque",         icon: Boxes,           path: "/stock",           color: "#3b82f6" },
  { label: "Compras",         icon: Truck,           path: "/purchases",       color: "#3b82f6" },
  { label: "Fornecedores",    icon: Building2,       path: "/suppliers",       color: "#3b82f6" },
  { label: "Clientes",        icon: Users,           path: "/customers",       color: "#3b82f6" },
  { label: "Contas a Pagar",  icon: Wallet,          path: "/accounts-payable",color: "#3b82f6" },
  { label: "Relatórios",      icon: BarChart3,       path: "/reports",         color: "#3b82f6" },
  { label: "Configurações",   icon: Settings,        path: "/settings",        color: "#3b82f6" },
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

// UserPlanRecord vem de src/lib/plans.ts

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
  const location = useLocation();
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
  const [planReady,       setPlanReady]       = useState(false); // evita flash do PlanBlock antes dos dados carregarem
  const [userEmail,       setUserEmail]       = useState<string | null>(null);
  const [userId,          setUserId]          = useState<string | null>(null);
  const [showReview,      setShowReview]      = useState(false);
  const [userPlan,        setUserPlan]        = useState<UserPlanRecord | null>(null);
  const [companyName,     setCompanyName]     = useState<string | null>(null);
  const [avatarUrl,       setAvatarUrl]       = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [sidebarOpen,     setSidebarOpen]     = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Badge + alarme de pedidos pendentes no Cardápio Digital
  const [digitalPending, setDigitalPending] = useState(0);
  const appAlertLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Rejeita link expirado
    if (linkData.link_expires_at && new Date(linkData.link_expires_at) < new Date()) return;

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

      // Handle pending invite from sessionStorage (expires on session end)
      const pendingInvite = sessionStorage.getItem("pending_invite");
      if (pendingInvite) {
        sessionStorage.removeItem("pending_invite");
        await processInvite(pendingInvite, uid);
      }

      // Auto-criar trial de 15 dias para novos usuários
      const { data: existingPlan } = await supabase
        .from("user_plans")
        .select("id")
        .eq("user_id", uid)
        .maybeSingle();
      if (!existingPlan) {
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 15);
        await supabase.from("user_plans").insert({
          user_id: uid,
          email: data.user.email,
          plan: "trial",
          plan_expires_at: trialEnd.toISOString(),
          is_lifetime: false,
        });
      }

      setLoading(false);
    }
    checkAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // ── Desbloqueia AudioContext no primeiro clique (necessário para som funcionar)
  useEffect(() => {
    const unlock = () => { unlockAudio(); document.removeEventListener("click", unlock, true); document.removeEventListener("touchstart", unlock, true); };
    document.addEventListener("click", unlock, true);
    document.addEventListener("touchstart", unlock, true);
    return () => { document.removeEventListener("click", unlock, true); document.removeEventListener("touchstart", unlock, true); };
  }, []);

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
        .select("plan, plan_expires_at, is_lifetime, plan_type, mp_subscription_id")
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
    setPlanReady(true); // dados do plano carregados — libera o gate

    setCompanyName((settingsRes.data as { name?: string } | null)?.name ?? null);
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadHeaderData(userId);
    const id = setInterval(() => loadHeaderData(userId), 90_000);
    return () => clearInterval(id);
  }, [userId, loadHeaderData]);

  // ── Pedidos digitais pendentes — badge + alarme de qualquer aba ──────────
  useEffect(() => {
    if (!userId) return;

    // Carrega contagem inicial de pedidos pendentes
    supabase.from("digital_orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending")
      .then(({ count }) => { if (count) setDigitalPending(count); });

    const ch = supabase.channel("layout-dm-orders")
      .on("postgres_changes", {
        event: "INSERT", schema: "public",
        table: "digital_orders", filter: `user_id=eq.${userId}`,
      }, () => {
        setDigitalPending(n => n + 1);
        // Loop contínuo de alarme quando fora da aba do cardápio digital
        if (!window.location.pathname.includes("/digital-menu")) {
          if (!appAlertLoopRef.current) {
            playAlertBeep();
            appAlertLoopRef.current = setInterval(playAlertBeep, 4000);
          }
        }
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public",
        table: "digital_orders", filter: `user_id=eq.${userId}`,
      }, (p) => {
        const newStatus = (p.new as any).status;
        if (newStatus !== "pending") {
          setDigitalPending(n => Math.max(0, n - 1));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      if (appAlertLoopRef.current) { clearInterval(appAlertLoopRef.current); appAlertLoopRef.current = null; }
    };
  }, [userId]);

  // Ao entrar na aba do cardápio digital: zera badge e para o loop do AppLayout
  // (o digital-menu vai iniciar o próprio loop se houver pedidos pendentes)
  useEffect(() => {
    if (location.pathname === "/digital-menu") {
      setDigitalPending(0);
      // Para o loop do AppLayout — digital-menu inicia o próprio
      if (appAlertLoopRef.current) { clearInterval(appAlertLoopRef.current); appAlertLoopRef.current = null; }
    }
  }, [location.pathname]);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxSizeBytes = 5 * 1024 * 1024; // 5MB

    if (!allowedMimeTypes.includes(file.type)) {
      alert("Apenas JPEG, PNG e WebP permitidos");
      return;
    }

    if (file.size > maxSizeBytes) {
      alert("Arquivo muito grande (máximo 5MB)");
      return;
    }

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

  // ── Controle de plano ─────────────────────────────────────────────────────
  const isAdmin = userEmail === ADMIN_EMAIL;

  // Rota atual (primeiro segmento: "/" | "/cash" | "/digital-menu" ...)
  const currentPath = (() => {
    const seg = location.pathname.replace(/^\//, "").split("/")[0];
    return seg ? `/${seg}` : "/";
  })();

  // Itens do menu visíveis para o plano do usuário
  const visibleMenuItems = menuItems.filter(item => {
    if (isAdmin) return true;
    if (!userPlan || !isPlanValid(userPlan)) return false;
    if (userPlan.is_lifetime || userPlan.plan === "trial") return true;
    if (!userPlan.plan_type) return true;
    return PLAN_ROUTES[userPlan.plan_type as PlanType]?.includes(item.path) ?? false;
  });

  // O plano está inválido (expirado ou suspenso)?
  const planBlocked = !isAdmin && !isPlanValid(userPlan);
  // A rota atual está liberada para o plano?
  const routeBlocked = !isAdmin && !planBlocked && !isRouteAllowed(currentPath, userPlan);

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: T.pageBg, color: T.text }}>

      {/* ── Overlay móvel ───────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className={`w-72 flex flex-col flex-shrink-0 fixed md:relative h-screen z-50 md:z-auto transition-all duration-300 md:duration-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
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
        <nav className="flex-1 px-3 pt-3 pb-0 space-y-1 overflow-y-auto">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                onClick={() => setSidebarOpen(false)}
                className="block"
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "11px 14px",
                  borderRadius: "12px",
                  fontSize: "14px",
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
                    {/* Badge de pedidos pendentes no Cardápio Digital */}
                    {item.path === "/digital-menu" && digitalPending > 0 && (
                      <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-black text-white animate-pulse"
                        style={{ background: "#f43f5e", boxShadow: "0 0 8px rgba(244,63,94,0.6)", padding: "0 4px" }}>
                        {digitalPending}
                      </span>
                    )}
                    {isActive && digitalPending === 0 && (
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
                onClick={() => setSidebarOpen(false)}
                className="block"
                style={({ isActive }) => ({
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "11px 14px", borderRadius: "12px", fontSize: "14px",
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
                onClick={() => setSidebarOpen(false)}
                className="block"
                style={({ isActive }) => ({
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "11px 14px", borderRadius: "12px", fontSize: "14px",
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

        {/* Rodapé minimalista — tema + feedback + suporte + sair */}
        <div className="px-3 pt-2 pb-3 space-y-1.5" style={{ borderTop: `1px solid ${T.border}` }}>
          <div className="flex items-center gap-2">
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

            {userEmail !== ADMIN_EMAIL && (
              <button
                onClick={() => setShowReview(true)}
                title="Avaliar sistema"
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 flex-shrink-0"
                style={{ border: "1px solid transparent" }}>
                <MessageSquare size={14} />
              </button>
            )}

            <button onClick={handleLogout}
              title="Sair"
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-all text-zinc-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
              style={{ border: "1px solid transparent" }}>
              <LogOut size={14} />
            </button>
          </div>

          <button
            onClick={() => window.open("https://wa.me/5518997066843?text=upabase%20atendente%20wesley", "_blank")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all text-green-600 hover:text-green-500 font-medium text-sm"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", hover: { background: "rgba(34,197,94,0.12)" } }}>
            <HelpCircle size={16} />
            <span>Suporte</span>
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="h-16 px-4 md:px-6 flex items-center justify-between flex-shrink-0 gap-3 md:gap-4"
          style={{ background: T.headerBg, borderBottom: `1px solid ${T.border}` }}>

          {/* Menu hambúrguer móvel */}
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden flex-shrink-0 p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            style={{ color: T.text }}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Esquerda — online + relógio + data */}
          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0 md:flex-1">
            {/* Online */}
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" style={{ boxShadow:"0 0 6px #10b981" }} />
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium">Online</span>
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

          {/* Centro — métricas operacionais (apenas desktop) */}
          <div className="hidden lg:flex items-center gap-1 flex-1 justify-center">

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
          <div className="flex-shrink-0 flex items-center gap-2 md:gap-3">
            {userEmail !== ADMIN_EMAIL && userPlan && (
              <div className="hidden sm:block">
                <PlanBadge plan={userPlan} />
              </div>
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
            {!planReady
              ? <Outlet />
              : planBlocked
                ? <PlanBlock plan={userPlan} userEmail={userEmail} onLogout={handleLogout} />
                : routeBlocked
                  ? <Navigate to="/" replace />
                  : <Outlet />
            }
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
