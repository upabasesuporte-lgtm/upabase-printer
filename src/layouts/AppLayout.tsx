import { useEffect, useState, useCallback, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useTheme } from "../contexts/ThemeContext";
import type { UserPlanRecord, PlanType } from "../lib/plans";
import { isPlanValid, isRouteAllowed, PLAN_ROUTES } from "../lib/plans";
import { TrialBanner } from "../components/TrialBanner";
import { OfflineBanner } from "../components/OfflineBanner";
import { isNetworkError, saveCache, readCache } from "../lib/offline";
import { supportWhatsAppUrl } from "../lib/support";
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
  TrendingUp,
  LockOpen,
  Lock,
  Shield,
  Crown,
  CalendarDays,
  AlertTriangle,
  Camera,
  Star,
  MessageSquare,
  HelpCircle,
  Menu,
  X,
  Truck,
  Building2,
  Repeat,
  ChefHat,
  PiggyBank,
} from "lucide-react";
import { OperatorGate } from "../components/OperatorGate";
import { StationPrinter } from "../components/StationPrinter";
import { useOperators, loadOperators, canAccessRoute, setCurrentOperator, operatorsEnabled, requireApproval } from "../lib/operators";
import { AvaliacaoModal } from "../components/AvaliacaoModal";
import { prefetchReports, clearReportsCache } from "../pages/reports";
import { clearDashboardCache } from "../pages/dashboard";

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "";

const menuItems = [
  { label: "Dashboard",       icon: LayoutDashboard, path: "/",                color: "#3b82f6" },
  { label: "Caixa",           icon: Wallet,          path: "/cash",            color: "#3b82f6" },
  { label: "Vendas",          icon: ShoppingCart,    path: "/pdv",             color: "#3b82f6" },
  { label: "Clientes",        icon: Users,           path: "/customers",       color: "#3b82f6" },
  { label: "Catálogo Digital",icon: Store,           path: "/digital-menu",    color: "#3b82f6" },
  { label: "Mesas",           icon: UtensilsCrossed, path: "/tables",          color: "#3b82f6" },
  { label: "Cozinha",         icon: ChefHat,         path: "/kitchen",         color: "#3b82f6" },
  { label: "Produtos",        icon: Package,         path: "/products",        color: "#3b82f6" },
  { label: "Estoque",         icon: Boxes,           path: "/stock",           color: "#3b82f6" },
  { label: "Compras",         icon: Truck,           path: "/purchases",       color: "#3b82f6" },
  { label: "Custo e Lucro",   icon: PiggyBank,       path: "/costs",           color: "#3b82f6" },
  { label: "Fornecedores",    icon: Building2,       path: "/suppliers",       color: "#3b82f6" },
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

// Vencimento do plano no topo — verde em dia, vermelho quando vencido/suspenso
function PlanBadge({ plan }: { plan: UserPlanRecord }) {
  const dl = daysLeftFromNow(plan.plan_expires_at, plan.is_lifetime);
  const isExpired = !plan.is_lifetime && dl !== null && dl <= 0;

  if (plan.is_lifetime || plan.plan === "lifetime") {
    return (
      <div className="flex items-center gap-2 pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full border"
        style={{ background: "rgba(167,139,250,0.08)", borderColor: "rgba(167,139,250,0.35)" }}>
        <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(167,139,250,0.18)", color: "#8b5cf6" }}>
          <Crown size={14} />
        </span>
        <span className="text-xs font-bold whitespace-nowrap" style={{ color: "#8b5cf6" }}>Vitalício</span>
      </div>
    );
  }

  const alert = plan.plan === "suspended" || isExpired;
  const color = alert ? "#ef4444" : "#10b981";
  const dateText = plan.plan_expires_at
    ? new Date(plan.plan_expires_at).toLocaleDateString("pt-BR")
    : null;

  const label = plan.plan === "suspended"
    ? "Plano suspenso"
    : isExpired
      ? "Venceu em"
      : plan.plan === "trial"
        ? "Teste grátis até"
        : "Vencimento";

  return (
    <div className="flex items-center gap-2 pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full border"
      title={dateText ? `${label} ${dateText}` : label}
      style={{
        background: alert ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.07)",
        borderColor: alert ? "rgba(239,68,68,0.45)" : "rgba(16,185,129,0.3)",
      }}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${alert ? "animate-pulse" : ""}`}
        style={{ background: alert ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)", color }}>
        {alert ? <AlertTriangle size={14} /> : <CalendarDays size={14} />}
      </span>
      <div className="leading-none">
        <p className="hidden sm:block text-[10px] font-medium text-zinc-500 mb-1 whitespace-nowrap">{label}</p>
        <p className="text-xs font-bold tabular-nums whitespace-nowrap" style={{ color }}>
          {dateText ?? (plan.plan === "suspended" ? "Suspenso" : "—")}
          {!alert && dl !== null && (
            <span className="hidden sm:inline font-medium text-zinc-500"> · {dl === 1 ? "1 dia" : `${dl} dias`}</span>
          )}
        </p>
      </div>
    </div>
  );
}

// Card de métrica do topo (vendas, caixa, mesas)
function HeaderStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 pl-1.5 pr-4 py-1.5 rounded-full border"
      style={{ background: "#ffffff", borderColor: `${color}33` }}>
      <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}1a`, color }}>
        {icon}
      </span>
      <div className="leading-none">
        <p className="text-[10px] font-medium text-zinc-500 mb-1 whitespace-nowrap">{label}</p>
        <p className="text-[13px] font-bold tabular-nums whitespace-nowrap" style={{ color }}>{value}</p>
      </div>
    </div>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
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
  const ops = useOperators();
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

  // Dados do topo
  const [todaySales,      setTodaySales]      = useState<number>(0);
  const [cashOpenedAt,    setCashOpenedAt]    = useState<string | null>(null);
  const [occupiedTables,  setOccupiedTables]  = useState<number>(0);
  const [totalTables,     setTotalTables]     = useState<number>(0);

  // ── processInvite
  async function processInvite(token: string) {
    // Validado e aplicado no banco (redeem_access_link): o navegador não grava plano
    const { error } = await supabase.rpc("redeem_access_link", { p_token: token });
    if (error) console.warn("convite:", error.message);
  }

  // ── Auth
  useEffect(() => {
    async function checkAuth() {
      const { data, error: userErr } = await supabase.auth.getUser();
      // Sem internet: usa a sessão guardada neste aparelho em vez de mandar para o login
      let user = data.user;
      if (!user && userErr && isNetworkError(userErr)) user = (await supabase.auth.getSession()).data.session?.user ?? null;
      if (!user) { navigate("/auth"); return; }
      setUserEmail(user.email ?? null);
      setAvatarUrl(user.user_metadata?.avatar_url ?? null);
      const uid = user.id;
      setUserId(uid);
      loadOperators(uid);

      // Handle pending invite from sessionStorage (expires on session end)
      const pendingInvite = sessionStorage.getItem("pending_invite");
      if (pendingInvite) {
        sessionStorage.removeItem("pending_invite");
        await processInvite(pendingInvite);
      }

      // Auto-criar trial de 15 dias para novos usuários
      const { data: existingPlan } = await supabase
        .from("user_plans")
        .select("id")
        .eq("user_id", uid)
        .maybeSingle();
      if (!existingPlan) {
        // Teste grátis de 15 dias criado pelo banco (ensure_trial_plan)
        await supabase.rpc("ensure_trial_plan");
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
      .neq("origin", "fiado_payment") // recebimento de fiado não é venda nova (igual ao Caixa)
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
      saveCache("plan_" + uid, planRes.data);
    } else if (planRes.error && isNetworkError(planRes.error)) {
      // Sem internet: vale o plano da última vez (não bloqueia a loja por queda de rede)
      setUserPlan(readCache<UserPlanRecord>("plan_" + uid));
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
    // Com funcionários: sair desconecta o aparelho da loja (só volta com e-mail
    // e senha do dono), então pede PIN de quem pode autorizar
    if (!(await requireApproval("Sair e desconectar este aparelho"))) return;
    clearReportsCache();
    clearDashboardCache();
    setCurrentOperator(null);
    await supabase.auth.signOut();
    navigate("/auth");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: T.pageBg }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-zinc-600 uppercase tracking-widest">Carregando...</p>
        </div>
      </div>
    );
  }

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
  }).filter(item => canAccessRoute(item.path, ops)); // abas da função do operador (sem operadores = todas)

  // Funcionários com PIN: sem operador escolhido a tela fica travada; aba fora
  // da função manda para a primeira aba liberada.
  const opsOn = operatorsEnabled(ops);
  const opLocked = opsOn && !ops.current;
  const opBlocked = opsOn && !opLocked && !canAccessRoute(currentPath, ops);
  const firstAllowedPath = visibleMenuItems[0]?.path ?? null;

  // O plano está inválido (expirado ou suspenso)?
  const planBlocked = !isAdmin && !isPlanValid(userPlan);
  // A rota atual está liberada para o plano?
  const routeBlocked = !isAdmin && !planBlocked && !isRouteAllowed(currentPath, userPlan);
  // PDV em tela cheia no desktop: sem o topo para o carrinho ocupar a altura toda
  const pdvFullScreen = currentPath === "/pdv" && (!planReady || (!planBlocked && !routeBlocked));

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: T.pageBg, color: T.text }}>

      {/* ── Overlay móvel ───────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      {/* Espaço reservado da sidebar recolhida (desktop) — ao expandir ela sobrepõe o conteúdo */}
      <div className="hidden md:block w-[92px] flex-shrink-0" />

      <aside className={`group w-72 flex flex-col flex-shrink-0 fixed h-[100dvh] z-50 transition-all duration-300 md:top-3 md:bottom-3 md:left-3 md:h-auto md:w-[72px] md:hover:w-64 md:z-30 md:rounded-2xl md:border md:shadow-xl md:overflow-hidden md:duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{ background: T.sidebarBg, borderColor: T.border, borderRightWidth: 1 }}>

        {/* Logo (somente celular) */}
        <div className="hidden h-24 items-center justify-center" style={{ overflow: "visible", borderBottom: `1px solid ${T.border}` }}>
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2028%20de%20jul.%20de%202026,%2014_45_53.png"
            alt="Logo"
            style={{ height: "auto", width: 190, maxWidth: "80%", display: "block", imageRendering: "auto", pointerEvents: "none" }}
          />
        </div>

        {/* Nav */}
        <nav className={`sidebar-nav flex-1 px-3 pt-3 pb-0 space-y-1 overflow-y-auto overflow-x-hidden`}>
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                onClick={() => setSidebarOpen(false)}
                onMouseEnter={item.path === "/reports" ? prefetchReports : undefined}
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
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  // Item ativo com o degradê do logo (momento de marca)
                  color: isActive ? "#ffffff" : "#71717a",
                  background: isActive ? "linear-gradient(135deg, #7C3FFA 0%, #315DFB 55%, #00B8C8 100%)" : "transparent",
                  boxShadow: isActive ? "0 4px 12px rgba(49,93,251,0.25)" : "none",
                })}
                title={item.label}
              >
                {({ isActive }) => (
                  <>
                    <span className="relative flex-shrink-0">
                      <Icon size={16} />
                      {/* Ponto de alerta no ícone quando a sidebar está recolhida (desktop) */}
                      {item.path === "/digital-menu" && digitalPending > 0 && (
                        <span className="hidden md:block md:group-hover:hidden absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full animate-pulse"
                          style={{ background: "#f43f5e", boxShadow: "0 0 6px rgba(244,63,94,0.8)" }} />
                      )}
                    </span>
                    <span className={`md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200`}>{item.label}</span>
                    {/* Badge de pedidos pendentes no Cardápio Digital */}
                    {item.path === "/digital-menu" && digitalPending > 0 && (
                      <span className={`ml-auto flex-shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-black text-white animate-pulse md:opacity-0 md:group-hover:opacity-100`}
                        style={{ background: "#f43f5e", boxShadow: "0 0 8px rgba(244,63,94,0.6)", padding: "0 4px" }}>
                        {digitalPending}
                      </span>
                    )}
                    {isActive && digitalPending === 0 && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 md:opacity-0 md:group-hover:opacity-100"
                        style={{ background: "#ffffff" }} />
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
                  whiteSpace: "nowrap", overflow: "hidden",
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
                    <span className="md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">Painel Admin</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 md:opacity-0 md:group-hover:opacity-100"
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
                  whiteSpace: "nowrap", overflow: "hidden",
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
                    <span className="md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">Avaliações</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 md:opacity-0 md:group-hover:opacity-100"
                        style={{ background: "#f59e0b", boxShadow: "0 0 6px #f59e0b" }} />
                    )}
                  </>
                )}
              </NavLink>
            </>
          )}
        </nav>

        {/* Rodapé minimalista — tema + feedback + suporte + sair */}
        <div className={`px-3 pt-2 pb-3 space-y-1.5`} style={{ borderTop: `1px solid ${T.border}` }}>
          <div className={`flex items-center gap-2 md:flex-col md:group-hover:flex-row`}>
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

          {opsOn && ops.current && (
            <button onClick={() => setCurrentOperator(null)}
              title={`Trocar operador — agora: ${ops.current.name}`}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all font-semibold text-sm whitespace-nowrap overflow-hidden"
              style={{ background: "rgba(49,93,251,0.10)", border: "1px solid rgba(49,93,251,0.35)", color: "#315DFB" }}>
              <Repeat size={16} className="flex-shrink-0" />
              <span className={`md:hidden md:group-hover:inline truncate`}>Trocar operador · {ops.current.name}</span>
            </button>
          )}

          <button
            onClick={() => window.open(supportWhatsAppUrl(`Olá! Preciso de ajuda com o sistema.${companyName ? ` Loja: ${companyName}.` : ""}${userEmail ? ` Conta: ${userEmail}.` : ""} Tela: ${menuItems.find(m => m.path === currentPath)?.label ?? currentPath}.`), "_blank")}
            title="Suporte"
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all text-green-600 hover:text-green-500 font-medium text-sm whitespace-nowrap overflow-hidden"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", hover: { background: "rgba(34,197,94,0.12)" } }}>
            <HelpCircle size={16} className="flex-shrink-0" />
            <span className={`md:hidden md:group-hover:inline`}>Suporte</span>
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className={`h-16 px-4 md:px-4 flex items-center justify-between flex-shrink-0 gap-3 md:gap-4 md:mx-3 md:mt-3 md:rounded-2xl md:border md:shadow-sm ${pdvFullScreen ? "md:hidden" : ""}`}
          style={{ background: T.headerBg, borderColor: T.border, borderBottomWidth: 1 }}>

          {/* Menu hambúrguer móvel */}
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden flex-shrink-0 p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            style={{ color: T.text }}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Esquerda — métricas operacionais (apenas desktop) */}
          <div className="hidden lg:flex items-center gap-2.5 flex-1">

            {/* Vendas do dia (com funcionários: só quem tem a aba Dashboard) */}
            {canAccessRoute("/", ops) && (
              <HeaderStat
                icon={<TrendingUp size={15} />}
                label="Vendas hoje"
                value={fmt(todaySales)}
                color="#10b981"
              />
            )}

            {/* Caixa */}
            <HeaderStat
              icon={cashOpenedAt ? <LockOpen size={15} /> : <Lock size={15} />}
              label="Caixa"
              value={cashOpenedAt ? `Aberto · ${timeSince(cashOpenedAt)}` : "Fechado"}
              color={cashOpenedAt ? "#315DFB" : "#f43f5e"}
            />

            {/* Mesas */}
            <HeaderStat
              icon={<UtensilsCrossed size={15} />}
              label="Mesas"
              value={occupiedTables > 0 ? `${occupiedTables}/${totalTables} ocupadas` : "Todas livres"}
              color={occupiedTables > 0 ? "#f59e0b" : "#71717a"}
            />
          </div>

          {/* Direita — vencimento do plano + empresa + avatar */}
          <div className="flex-shrink-0 flex items-center gap-2 md:gap-3">
            {userEmail !== ADMIN_EMAIL && userPlan && (
              <PlanBadge plan={userPlan} />
            )}


            {companyName && (
              <div className="hidden md:flex flex-col items-end leading-none">
                <span className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1">Estabelecimento</span>
                <span className="font-black leading-none"
                  style={isLight
                    ? { fontSize: 15, color: "#111827", WebkitTextFillColor: "#111827", backgroundClip: "unset", WebkitBackgroundClip: "unset", background: "none" }
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
              style={{ boxShadow: "0 2px 8px rgba(49,93,251,0.25)" }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-black text-xs text-white"
                  style={{ background: "linear-gradient(135deg, #7C3FFA 0%, #315DFB 55%, #00B8C8 100%)" }}>
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
          <div className="p-3 sm:p-6 min-h-full">
            <OfflineBanner />
            {!isAdmin && planReady && <TrialBanner plan={userPlan} />}
            {opBlocked
                ? (!planReady ? null : firstAllowedPath && firstAllowedPath !== currentPath
                    ? <Navigate to={firstAllowedPath} replace />
                    : <p className="text-sm text-zinc-500">Nenhuma aba liberada para a sua função. Peça ao dono para revisar em Configurações → Funcionários.</p>)
              : !planReady
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

      {/* Funcionários: tela de PIN e autorização (só aparece se houver operadores) */}
      <OperatorGate />
      {/* Estação de impressão: imprime os pedidos da cozinha em qualquer aba */}
      <StationPrinter />

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
