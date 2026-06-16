import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Shield, RefreshCw, Link, Plus, Copy, Check,
  Search, Crown, Gift, AlertTriangle, Ban,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "";

interface UserPlan {
  id: string;
  user_id: string;
  email: string;
  plan: "trial" | "active" | "lifetime" | "suspended";
  plan_expires_at: string | null;
  is_lifetime: boolean;
  created_at: string;
}

interface AccessLink {
  id: string;
  token: string;
  plan_type: "trial" | "days" | "lifetime";
  days_granted: number | null;
  note: string | null;
  used_by: string | null;
  used_at: string | null;
  link_expires_at: string | null;
  created_at: string;
}

function daysLeft(expiresAt: string | null, isLifetime: boolean): number | null {
  if (isLifetime) return null;
  if (!expiresAt) return null;
  const diff = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  return diff;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type PlanType = "trial" | "active" | "lifetime" | "suspended" | "expired";

function getPlanState(user: UserPlan): PlanType {
  if (user.plan === "suspended") return "suspended";
  if (user.is_lifetime || user.plan === "lifetime") return "lifetime";
  const dl = daysLeft(user.plan_expires_at, user.is_lifetime);
  if (dl !== null && dl <= 0) return "expired";
  if (user.plan === "trial") return "trial";
  return "active";
}

function PlanBadge({ user }: { user: UserPlan }) {
  const state = getPlanState(user);
  const dl = daysLeft(user.plan_expires_at, user.is_lifetime);

  const cfg: Record<PlanType, { color: string; bg: string; border: string; label: string }> = {
    trial: {
      color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)",
      label: `Trial${dl !== null ? ` · ${dl}d` : ""}`,
    },
    active: {
      color: "#10b981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)",
      label: `Ativo${dl !== null ? ` · ${dl}d` : ""}`,
    },
    lifetime: {
      color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.35)",
      label: "Vitalício",
    },
    expired: {
      color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)",
      label: "Vencido",
    },
    suspended: {
      color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)",
      label: "Suspenso",
    },
  };

  const c = cfg[state];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
      boxShadow: `0 0 8px ${c.color}33`,
    }}>
      {state === "lifetime" && <Crown size={10} />}
      {state === "trial" && <Gift size={10} />}
      {state === "suspended" && <Ban size={10} />}
      {state === "expired" && <AlertTriangle size={10} />}
      {c.label}
    </span>
  );
}

type FilterTab = "all" | "trial" | "active" | "lifetime" | "expired" | "suspended";

export default function AdminPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const navigate = useNavigate();

  // Verificação de autorização no próprio componente
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user || data.user.email !== ADMIN_EMAIL) {
        navigate("/", { replace: true });
      }
    });
  }, [navigate]);
  const card = isLight ? {
    bg: "#ffffff",
    border: "1px solid #e5e7eb",
    shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    bg: "#18181b",
    border: "1px solid rgba(39,39,42,0.8)",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
  const [userPlans, setUserPlans] = useState<UserPlan[]>([]);
  const [accessLinks, setAccessLinks] = useState<AccessLink[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Link generator state
  const [linkType, setLinkType] = useState<"trial" | "days" | "lifetime">("trial");
  const [linkDays, setLinkDays] = useState<number>(30);
  const [linkNote, setLinkNote] = useState("");
  const [generatingLink, setGeneratingLink] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // User table state
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingData(true);
    const [plansRes, linksRes] = await Promise.all([
      supabase.from("user_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("access_links").select("*").order("created_at", { ascending: false }).limit(10),
    ]);
    setUserPlans((plansRes.data ?? []) as UserPlan[]);
    setAccessLinks((linksRes.data ?? []) as AccessLink[]);
    setLoadingData(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Stats
  const nonAdminUsers = userPlans.filter(u => u.email !== ADMIN_EMAIL);
  const totalUsers = nonAdminUsers.length;
  const trialUsers = nonAdminUsers.filter(u => getPlanState(u) === "trial").length;
  const activeUsers = nonAdminUsers.filter(u => getPlanState(u) === "active").length;
  const lifetimeUsers = nonAdminUsers.filter(u => getPlanState(u) === "lifetime").length;
  const expiredUsers = nonAdminUsers.filter(u => getPlanState(u) === "expired").length;
  const suspendedUsers = nonAdminUsers.filter(u => getPlanState(u) === "suspended").length;

  // ── Filtered users for table
  const filteredUsers = nonAdminUsers.filter(u => {
    const matchSearch = u.email.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filterTab === "all") return true;
    if (filterTab === "trial") return getPlanState(u) === "trial";
    if (filterTab === "active") return getPlanState(u) === "active";
    if (filterTab === "lifetime") return getPlanState(u) === "lifetime";
    if (filterTab === "expired") return getPlanState(u) === "expired";
    if (filterTab === "suspended") return getPlanState(u) === "suspended";
    return true;
  });

  // ── Actions
  async function extendPlan(userId: string, days: number) {
    setActionLoading(`extend-${userId}-${days}`);
    const user = userPlans.find(u => u.user_id === userId);
    const base = user?.plan_expires_at && new Date(user.plan_expires_at) > new Date()
      ? new Date(user.plan_expires_at)
      : new Date();
    base.setDate(base.getDate() + days);
    await supabase.from("user_plans").upsert({
      user_id: userId,
      plan: "active",
      plan_expires_at: base.toISOString(),
      is_lifetime: false,
    }, { onConflict: "user_id" });
    await load();
    setActionLoading(null);
  }

  async function grantLifetime(userId: string) {
    setActionLoading(`lifetime-${userId}`);
    await supabase.from("user_plans").upsert({
      user_id: userId,
      plan: "lifetime",
      plan_expires_at: null,
      is_lifetime: true,
    }, { onConflict: "user_id" });
    await load();
    setActionLoading(null);
  }

  async function toggleSuspend(user: UserPlan) {
    setActionLoading(`suspend-${user.user_id}`);
    const newPlan = user.plan === "suspended" ? "active" : "suspended";
    await supabase.from("user_plans").upsert({
      user_id: user.user_id,
      plan: newPlan,
      plan_expires_at: user.plan_expires_at,
      is_lifetime: user.is_lifetime,
    }, { onConflict: "user_id" });
    await load();
    setActionLoading(null);
  }

  async function generateLink() {
    setGeneratingLink(true);
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const daysGranted = linkType === "lifetime" ? null : linkType === "trial" ? 15 : linkDays;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // link expires in 30 days

    const { error } = await supabase.from("access_links").insert({
      token,
      plan_type: linkType,
      days_granted: daysGranted,
      note: linkNote || null,
      link_expires_at: expiresAt.toISOString(),
    });

    if (!error) {
      setGeneratedToken(token);
      setLinkNote("");
      await load();
    }
    setGeneratingLink(false);
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/auth?invite=${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  const kpiCards = [
    { label: "Total de Usuários", value: totalUsers, color: "#8b5cf6", glow: "#7c3aed" },
    { label: "Trial", value: trialUsers, color: "#f59e0b", glow: "#d97706" },
    { label: "Ativos", value: activeUsers, color: "#10b981", glow: "#059669" },
    { label: "Vitalício", value: lifetimeUsers, color: "#a78bfa", glow: "#8b5cf6" },
    { label: "Vencidos", value: expiredUsers, color: "#ef4444", glow: "#dc2626" },
    { label: "Suspensos", value: suspendedUsers, color: "#f43f5e", glow: "#e11d48" },
  ];

  const tabItems: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "trial", label: "Trial" },
    { key: "active", label: "Ativos" },
    { key: "lifetime", label: "Vitalício" },
    { key: "expired", label: "Vencidos" },
    { key: "suspended", label: "Suspensos" },
  ];

  const linkTypeLabels: Record<"trial" | "days" | "lifetime", string> = {
    trial: "Trial (15d)",
    days: "Dias Personalizados",
    lifetime: "Vitalício",
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden px-8 py-7"
        style={{
          background: card.bg,
          border: isLight ? card.border : "1px solid rgba(139,92,246,0.2)",
          boxShadow: isLight ? card.shadow : "0 0 40px rgba(139,92,246,0.08)",
        }}>
        {/* Dot pattern */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.06,
          backgroundImage: "radial-gradient(circle, #8b5cf6 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }} />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", boxShadow: "0 0 24px rgba(124,58,237,0.5)" }}>
            <Shield size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight g-text g-text-purple">
              Painel Admin
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">Gestão de usuários e acessos · {ADMIN_EMAIL}</p>
          </div>
          <button onClick={load} disabled={loadingData}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", color: "#a78bfa" }}>
            <RefreshCw size={13} className={loadingData ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map(({ label, value, color, glow }) => (
          <div key={label} className="rounded-2xl p-4 flex flex-col gap-2"
            style={{
              background: card.bg,
              border: isLight ? card.border : `1px solid ${color}25`,
              boxShadow: isLight ? card.shadow : `0 0 20px ${glow}10`,
            }}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">{label}</p>
            <p className="text-3xl font-black tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Gerar Link de Acesso ─────────────────────────────────────────────── */}
      <div className="rounded-2xl p-6 space-y-4"
        style={{
          background: card.bg,
          border: isLight ? card.border : "1px solid rgba(139,92,246,0.18)",
          boxShadow: isLight ? card.shadow : undefined,
        }}>
        <div className="flex items-center gap-2 mb-2">
          <Link size={16} style={{ color: "#8b5cf6" }} />
          <h2 className="text-sm font-bold text-zinc-200">Gerar Link de Acesso</h2>
        </div>

        {/* Type selector */}
        <div className="flex gap-2 flex-wrap">
          {(["trial", "days", "lifetime"] as const).map(t => (
            <button key={t} onClick={() => setLinkType(t)}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: linkType === t ? "rgba(139,92,246,0.2)" : "rgba(39,39,42,0.6)",
                border: linkType === t ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(63,63,70,0.5)",
                color: linkType === t ? "#c4b5fd" : "#71717a",
                boxShadow: linkType === t ? "0 0 12px rgba(139,92,246,0.15)" : "none",
              }}>
              {linkTypeLabels[t]}
            </button>
          ))}
        </div>

        {/* Days presets */}
        {linkType === "days" && (
          <div className="flex gap-2 flex-wrap">
            {[30, 60, 90, 180, 365].map(d => (
              <button key={d} onClick={() => setLinkDays(d)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: linkDays === d ? "rgba(16,185,129,0.15)" : "rgba(39,39,42,0.6)",
                  border: linkDays === d ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(63,63,70,0.5)",
                  color: linkDays === d ? "#10b981" : "#71717a",
                }}>
                {d}d
              </button>
            ))}
          </div>
        )}

        {/* Note + Generate */}
        <div className="flex gap-3 flex-wrap">
          <input
            placeholder="Observação (opcional)"
            value={linkNote}
            onChange={e => setLinkNote(e.target.value)}
            className="flex-1 min-w-40 px-3.5 py-2.5 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 transition-all"
            style={{ background: "#09090b", border: "1px solid rgba(63,63,70,0.6)" }}
          />
          <button onClick={generateLink} disabled={generatingLink}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
              boxShadow: "0 0 16px rgba(124,58,237,0.35)",
              color: "#fff",
            }}>
            <Plus size={15} />
            {generatingLink ? "Gerando..." : "Gerar Link"}
          </button>
        </div>

        {/* Generated link display */}
        {generatedToken && (
          <div className="flex items-center gap-3 p-3 rounded-xl"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <p className="text-xs text-zinc-400 flex-1 truncate font-mono">
              {window.location.origin}/auth?invite={generatedToken}
            </p>
            <button onClick={() => copyLink(generatedToken)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0"
              style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}>
              {copiedToken === generatedToken ? <Check size={12} /> : <Copy size={12} />}
              {copiedToken === generatedToken ? "Copiado!" : "Copiar"}
            </button>
          </div>
        )}

        {/* Recent links */}
        {accessLinks.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">Links recentes</p>
            {accessLinks.map(link => (
              <div key={link.id} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ background: "rgba(24,24,27,0.8)", border: "1px solid rgba(63,63,70,0.4)" }}>
                <span className="text-xs font-mono text-zinc-400">...{link.token.slice(-8)}</span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                  style={{
                    background: link.plan_type === "lifetime" ? "rgba(167,139,250,0.15)" : link.plan_type === "trial" ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)",
                    color: link.plan_type === "lifetime" ? "#a78bfa" : link.plan_type === "trial" ? "#f59e0b" : "#10b981",
                  }}>
                  {link.plan_type === "trial" ? "Trial 15d" : link.plan_type === "lifetime" ? "Vitalício" : `${link.days_granted}d`}
                </span>
                {link.note && <span className="text-[11px] text-zinc-500 flex-1 truncate">{link.note}</span>}
                <span className="ml-auto text-[10px] font-semibold"
                  style={{ color: link.used_by ? "#ef4444" : "#10b981" }}>
                  {link.used_by ? "Usado" : "Disponível"}
                </span>
                {!link.used_by && (
                  <button onClick={() => copyLink(link.token)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all flex-shrink-0"
                    style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", color: "#a78bfa" }}>
                    {copiedToken === link.token ? <Check size={10} /> : <Copy size={10} />}
                    {copiedToken === link.token ? "OK" : "Copiar"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── User Table ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden"
        style={{
          background: card.bg,
          border: isLight ? card.border : "1px solid rgba(63,63,70,0.5)",
          boxShadow: isLight ? card.shadow : undefined,
        }}>

        {/* Table header */}
        <div className="px-6 py-4 flex items-center gap-4 border-b border-zinc-800/60 flex-wrap gap-y-3">
          <div className="flex items-center gap-2">
            <Users size={15} style={{ color: "#8b5cf6" }} />
            <h2 className="text-sm font-bold text-zinc-200">Usuários</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
              {filteredUsers.length}
            </span>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1 max-w-xs"
            style={{ background: "#09090b", border: "1px solid rgba(63,63,70,0.6)" }}>
            <Search size={13} className="text-zinc-600 flex-shrink-0" />
            <input placeholder="Buscar por e-mail…" value={search} onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none flex-1" />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 flex-wrap">
            {tabItems.map(({ key, label }) => (
              <button key={key} onClick={() => setFilterTab(key)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                style={{
                  background: filterTab === key ? "rgba(139,92,246,0.2)" : "transparent",
                  border: filterTab === key ? "1px solid rgba(139,92,246,0.4)" : "1px solid transparent",
                  color: filterTab === key ? "#c4b5fd" : "#52525b",
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(39,39,42,0.8)" }}>
                {["E-mail", "Plano", "Vencimento", "Criado em", "Ações"].map(h => (
                  <th key={h} className="px-5 py-3 text-left font-semibold text-zinc-600 uppercase tracking-widest text-[10px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingData ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-zinc-600">Carregando...</td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-zinc-600">Nenhum usuário encontrado.</td>
                </tr>
              ) : filteredUsers.map(user => {
                const dl = daysLeft(user.plan_expires_at, user.is_lifetime);
                const expiryColor = dl !== null && dl <= 3 ? "#ef4444" : dl !== null && dl <= 7 ? "#f59e0b" : "#71717a";
                const isSuspending = actionLoading === `suspend-${user.user_id}`;
                const isSuspended = user.plan === "suspended";

                return (
                  <tr key={user.id}
                    className="transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: "1px solid rgba(39,39,42,0.5)" }}>
                    <td className="px-5 py-3 font-mono text-zinc-300">{user.email}</td>
                    <td className="px-5 py-3"><PlanBadge user={user} /></td>
                    <td className="px-5 py-3 font-mono tabular-nums" style={{ color: expiryColor }}>
                      {user.is_lifetime ? <span style={{ color: "#a78bfa" }}>Vitalício</span> : fmtDate(user.plan_expires_at)}
                    </td>
                    <td className="px-5 py-3 text-zinc-500">{fmtDate(user.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* +30d */}
                        <button
                          onClick={() => extendPlan(user.user_id, 30)}
                          disabled={!!actionLoading}
                          className="px-2.5 py-1 rounded-lg font-semibold transition-all disabled:opacity-40 text-[10px]"
                          style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }}>
                          {actionLoading === `extend-${user.user_id}-30` ? "..." : "+30d"}
                        </button>
                        {/* +365d */}
                        <button
                          onClick={() => extendPlan(user.user_id, 365)}
                          disabled={!!actionLoading}
                          className="px-2.5 py-1 rounded-lg font-semibold transition-all disabled:opacity-40 text-[10px]"
                          style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)", color: "#06b6d4" }}>
                          {actionLoading === `extend-${user.user_id}-365` ? "..." : "+365d"}
                        </button>
                        {/* Vitalício */}
                        {!user.is_lifetime && (
                          <button
                            onClick={() => grantLifetime(user.user_id)}
                            disabled={!!actionLoading}
                            className="px-2.5 py-1 rounded-lg font-semibold transition-all disabled:opacity-40 text-[10px]"
                            style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa" }}>
                            {actionLoading === `lifetime-${user.user_id}` ? "..." : "Vitalício"}
                          </button>
                        )}
                        {/* Suspender / Reativar */}
                        <button
                          onClick={() => toggleSuspend(user)}
                          disabled={!!actionLoading}
                          className="px-2.5 py-1 rounded-lg font-semibold transition-all disabled:opacity-40 text-[10px]"
                          style={isSuspended
                            ? { background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }
                            : { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
                          {isSuspending ? "..." : isSuspended ? "Reativar" : "Suspender"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
