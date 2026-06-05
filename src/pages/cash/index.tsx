import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Lock, Unlock,
  CreditCard, Banknote, Smartphone, Ticket, BarChart2,
  X, CheckCircle2, AlertCircle, RefreshCw, Clock,
  TrendingUp, TrendingDown, ShoppingBag, Utensils, Monitor,
  History, BookOpen, ChevronRight, ChevronDown, Package, Eye,
  Edit2, Plus, Minus, Trash2, Search, Save,
} from "lucide-react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type PaymentMethod = "cash" | "credit" | "debit" | "pix" | "voucher" | "fiado" | "house_credit" | "ifood_receivable";
type SaleChannel = "pdv" | "digital_menu" | "tables" | "ifood";
type MovementType = "opening" | "sale" | "sangria" | "aporte" | "closing";

interface CashRegister {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_amount: number | null;
  status: "open" | "closed";
  operator_name: string | null;
}

interface Movement {
  id: string;
  register_id: string;
  movement_type: MovementType;
  amount: number;
  payment_method: PaymentMethod | null;
  channel: SaleChannel | null;
  description: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const PAYMENT_INFO: Record<PaymentMethod, { label: string; icon: React.ReactNode; color: string; bar: string }> = {
  cash:         { label: "Dinheiro",       icon: <Banknote className="w-4 h-4" />,    color: "text-emerald-400", bar: "bg-emerald-500" },
  credit:       { label: "Crédito",        icon: <CreditCard className="w-4 h-4" />,  color: "text-blue-400",    bar: "bg-blue-500" },
  debit:        { label: "Débito",         icon: <CreditCard className="w-4 h-4" />,  color: "text-indigo-400",  bar: "bg-indigo-500" },
  pix:          { label: "PIX",            icon: <Smartphone className="w-4 h-4" />,  color: "text-violet-400",  bar: "bg-violet-500" },
  voucher:      { label: "Vale Refeição",  icon: <Ticket className="w-4 h-4" />,      color: "text-amber-400",   bar: "bg-amber-500" },
  fiado:            { label: "Fiado (A Rec.)",    icon: <TrendingUp className="w-4 h-4" />,  color: "text-orange-400", bar: "bg-orange-500" },
  house_credit:     { label: "Saldo Cliente",    icon: <Wallet className="w-4 h-4" />,      color: "text-teal-400",   bar: "bg-teal-500" },
  ifood_receivable: { label: "iFood (A Receber)",icon: <ShoppingBag className="w-4 h-4" />, color: "text-red-400",    bar: "bg-red-500" },
};

const CHANNEL_INFO: Record<SaleChannel, { label: string; icon: React.ReactNode; bar: string }> = {
  pdv:          { label: "PDV",             icon: <Monitor className="w-4 h-4" />,   bar: "bg-violet-500" },
  digital_menu: { label: "Cardápio Digital",icon: <ShoppingBag className="w-4 h-4" />, bar: "bg-blue-500" },
  tables:       { label: "Mesas",           icon: <Utensils className="w-4 h-4" />, bar: "bg-emerald-500" },
  ifood:        { label: "iFood",           icon: <ShoppingBag className="w-4 h-4" />, bar: "bg-red-500" },
};

const MOV_LABELS: Record<MovementType, { label: string; sign: string; color: string }> = {
  opening: { label: "Abertura",   sign: "+", color: "text-zinc-400" },
  sale:    { label: "Venda",      sign: "+", color: "text-emerald-400" },
  aporte:  { label: "Aporte",    sign: "+", color: "text-blue-400" },
  sangria: { label: "Sangria",   sign: "-", color: "text-red-400" },
  closing: { label: "Fechamento", sign: "–", color: "text-zinc-400" },
};

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`w-full ${wide ? "max-w-lg" : "max-w-md"} bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
          <h3 className="font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Input de valor monetário ─────────────────────────────────────────────────

function AmountInput({ value, onChange, label, placeholder = "0,00" }: {
  value: string; onChange: (v: string) => void; label: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium">R$</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-9 pr-3.5 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all"
        />
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CashPage() {
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

  const [register,  setRegister]  = useState<CashRegister | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [userId,    setUserId]    = useState<string | null>(null);

  // Sub-abas
  const [subTab, setSubTab] = useState<"current" | "history">("current");
  const [historyRegs,      setHistoryRegs]      = useState<CashRegister[]>([]);
  const [historyLoading,   setHistoryLoading]   = useState(false);
  const [histSalesTotals,  setHistSalesTotals]  = useState<Record<string, number>>({});
  const [histSalesCounts,  setHistSalesCounts]  = useState<Record<string, number>>({});

  // Modais
  const [showOpen,    setShowOpen]    = useState(false);
  const [showSangria, setShowSangria] = useState(false);
  const [showAporte,  setShowAporte]  = useState(false);
  const [showClose,   setShowClose]   = useState(false);

  // Formulários
  const [initialAmount,   setInitialAmount]   = useState("");
  const [operatorName,    setOperatorName]    = useState("");
  const [movAmount,       setMovAmount]       = useState("");
  const [movDescription,  setMovDescription]  = useState("");
  const [movPayment,      setMovPayment]      = useState<PaymentMethod>("cash");
  const [actionLoading,   setActionLoading]   = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  // Fechamento
  const [closingOperator, setClosingOperator] = useState("");
  const [countedAmount,   setCountedAmount]   = useState("");

  // Total de vendas real (da tabela sales, não cash_movements)
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesRows, setSalesRows] = useState<Array<{ total_amount: number; discount: number | null; payments: any; origin: string | null }>>([]);

  // ── Métricas calculadas ──
  const sales        = movements.filter(m => m.movement_type === "sale");
  const totalSales   = sales.reduce((s, m) => s + m.amount, 0);
  const totalSangria = movements.filter(m => m.movement_type === "sangria").reduce((s, m) => s + m.amount, 0);
  const totalAporte  = movements.filter(m => m.movement_type === "aporte").reduce((s, m) => s + m.amount, 0);
  const cashSales    = sales.filter(m => m.payment_method === "cash").reduce((s, m) => s + m.amount, 0);
  const currentBalance = (register?.opening_amount ?? 0) + cashSales + totalAporte - totalSangria;

  const countedVal   = parseFloat(countedAmount.replace(",", ".")) || 0;
  const difference   = countedAmount ? countedVal - currentBalance : null;

  // Helpers: valor bruto de uma venda (iFood = total + comissão = valor do recibo; outros = total normal)
  const saleGross = (s: typeof salesRows[0]) =>
    s.origin === "ifood"
      ? Number(s.total_amount ?? 0) + Number(s.discount ?? 0)
      : Number(s.total_amount ?? 0);

  // Breakdown por forma de pagamento — iFood A Receber mostra valor bruto (recibo)
  const paymentBreakdown = (Object.keys(PAYMENT_INFO) as PaymentMethod[]).map(method => {
    const amount = salesRows
      .flatMap(s => {
        const pmts = Array.isArray(s.payments) ? s.payments : [];
        return pmts.map((p: any) => ({
          method: p.method as string,
          // iFood A Receber: soma a comissão para chegar no valor do recibo
          amount: p.method === "ifood_receivable"
            ? Number(p.amount ?? 0) + Number(s.discount ?? 0)
            : Number(p.amount ?? 0),
        }));
      })
      .filter(p => p.method === method)
      .reduce((sum, p) => sum + p.amount, 0);
    return { method, amount, pct: salesTotal > 0 ? (amount / salesTotal) * 100 : 0 };
  }).filter(p => p.amount > 0);

  // Breakdown por canal — iFood mostra valor bruto (recibo)
  const channelBreakdown = (Object.keys(CHANNEL_INFO) as SaleChannel[]).map(channel => {
    const amount = salesRows
      .filter(s => {
        const origin = s.origin ?? "pdv";
        if (channel === "digital_menu") return origin === "digital_menu" || origin === "cardapio_digital";
        if (channel === "tables")       return origin === "tables" || origin === "mesa";
        return origin === channel;
      })
      .reduce((sum, s) => sum + saleGross(s), 0);
    return { channel, amount, pct: salesTotal > 0 ? (amount / salesTotal) * 100 : 0 };
  });

  // ── Carregar caixa atual ──
  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserId(user.id);

    const { data: reg } = await supabase
      .from("cash_registers")
      .select("*")
      .eq("user_id", user?.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reg) {
      setRegister(reg);
      const { data: movs } = await supabase
        .from("cash_movements")
        .select("*")
        .eq("register_id", reg.id)
        .order("created_at", { ascending: false });
      setMovements(movs ?? []);

      // Carrega vendas (iFood usa valor bruto = total + comissão para bater com recibos)
      const { data: salesData } = await supabase
        .from("sales")
        .select("total_amount, discount, payments, origin")
        .eq("user_id", user?.id)
        .eq("status", "paid")
        .gte("created_at", reg.opened_at);
      const rows = salesData ?? [];
      setSalesRows(rows);
      setSalesTotal(rows.reduce((s: number, r: any) => {
        // iFood: usa valor bruto (o que aparece no recibo = total + comissão)
        if (r.origin === "ifood") return s + Number(r.total_amount ?? 0) + Number(r.discount ?? 0);
        return s + Number(r.total_amount ?? 0);
      }, 0));
    } else {
      setRegister(null);
      setMovements([]);
      setSalesTotal(0);
      setSalesRows([]);
    }
    setLoading(false);
  }, []);

  // ── Carregar histórico ──
  const loadHistory = useCallback(async () => {
    if (!userId) return;
    setHistoryLoading(true);

    const { data } = await supabase
      .from("cash_registers")
      .select("*")
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(30);
    const regs = data ?? [];
    setHistoryRegs(regs);

    // Busca totais de vendas para todos os caixas em uma só query
    if (regs.length > 0) {
      const oldest = regs[regs.length - 1].opened_at;
      const { data: salesData } = await supabase
        .from("sales")
        .select("total_amount, discount, origin, created_at")
        .eq("user_id", userId)
        .eq("status", "paid")
        .gte("created_at", oldest);
      const allSales = salesData ?? [];
      const totals: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const reg of regs) {
        const end = reg.closed_at ?? new Date().toISOString();
        const regSales = allSales.filter((s: any) => s.created_at >= reg.opened_at && s.created_at <= end);
        totals[reg.id] = regSales.reduce((sum, s: any) =>
          s.origin === "ifood" ? sum + Number(s.total_amount ?? 0) + Number(s.discount ?? 0) : sum + Number(s.total_amount ?? 0), 0);
        counts[reg.id] = regSales.length;
      }
      setHistSalesTotals(totals);
      setHistSalesCounts(counts);
    }

    setHistoryLoading(false);
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (subTab === "history" && userId) loadHistory();
  }, [subTab, userId, loadHistory]);

  // ── Abrir caixa ──
  async function handleOpenRegister() {
    if (!userId) return;
    setActionLoading(true);
    setError(null);
    const amount = parseFloat(initialAmount.replace(",", ".")) || 0;

    const { data, error: err } = await supabase
      .from("cash_registers")
      .insert({ user_id: userId, opening_amount: amount, status: "open", operator_name: operatorName || null })
      .select()
      .single();

    if (err) { setError("Erro ao abrir o caixa. Verifique as tabelas no Supabase."); setActionLoading(false); return; }

    await supabase.from("cash_movements").insert({
      register_id: data.id, user_id: userId,
      movement_type: "opening", amount, payment_method: "cash",
      description: `Abertura de caixa${operatorName ? ` — ${operatorName}` : ""}`,
    });

    setShowOpen(false); setInitialAmount(""); setOperatorName("");
    await loadData();
    setActionLoading(false);
  }

  // ── Sangria ──
  async function handleSangria() {
    if (!register || !userId) return;
    setActionLoading(true);
    setError(null);
    const amount = parseFloat(movAmount.replace(",", "."));
    if (!amount || amount <= 0) { setError("Informe um valor válido."); setActionLoading(false); return; }
    if (amount > currentBalance) { setError("Valor maior que o saldo em dinheiro disponível."); setActionLoading(false); return; }

    await supabase.from("cash_movements").insert({
      register_id: register.id, user_id: userId,
      movement_type: "sangria", amount, payment_method: "cash",
      description: movDescription || "Sangria de caixa",
    });

    setShowSangria(false); setMovAmount(""); setMovDescription("");
    await loadData(); setActionLoading(false);
  }

  // ── Aporte ──
  async function handleAporte() {
    if (!register || !userId) return;
    setActionLoading(true);
    setError(null);
    const amount = parseFloat(movAmount.replace(",", "."));
    if (!amount || amount <= 0) { setError("Informe um valor válido."); setActionLoading(false); return; }

    await supabase.from("cash_movements").insert({
      register_id: register.id, user_id: userId,
      movement_type: "aporte", amount, payment_method: "cash",
      description: movDescription || "Aporte de caixa",
    });

    setShowAporte(false); setMovAmount(""); setMovDescription("");
    await loadData(); setActionLoading(false);
  }

  // ── Fechar caixa ──
  async function handleCloseRegister() {
    if (!register || !userId) return;
    setActionLoading(true);

    const closingDesc = `Fechamento de caixa${closingOperator ? ` — ${closingOperator}` : ""}${difference !== null ? ` | Contado: ${fmt(countedVal)} | Diferença: ${fmt(difference)}` : ""}`;

    await supabase.from("cash_registers")
      .update({ status: "closed", closed_at: new Date().toISOString(), closing_amount: currentBalance })
      .eq("id", register.id);

    await supabase.from("cash_movements").insert({
      register_id: register.id, user_id: userId,
      movement_type: "closing", amount: currentBalance, payment_method: "cash",
      description: closingDesc,
    });

    setShowClose(false); setClosingOperator(""); setCountedAmount("");
    await loadData();
    setActionLoading(false);
  }

  // ── Render: carregando ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <RefreshCw className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }

  // ── Sub-abas (sempre visíveis) ──
  const tabs = (
    <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: card.bg, border: card.border }}>
      <button onClick={() => setSubTab("current")}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
        style={subTab === "current"
          ? { background: "rgba(123,47,190,0.15)", color: "#7B2FBE", border: "1px solid rgba(123,47,190,0.3)" }
          : { color: "#71717a", border: "1px solid transparent" }}>
        <BookOpen className="w-3.5 h-3.5" />
        Caixa Atual
      </button>
      <button onClick={() => setSubTab("history")}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
        style={subTab === "history"
          ? { background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }
          : { color: "#71717a", border: "1px solid transparent" }}>
        <History className="w-3.5 h-3.5" />
        Histórico de Caixas
      </button>
    </div>
  );

  // ── Render: caixa fechado ──
  if (!register) {
    return (
      <>
        <div className="space-y-4">
          {tabs}

          {subTab === "current" && (
            <div className="flex items-center justify-center min-h-[400px] p-6">
              <div className="w-full max-w-sm text-center">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-zinc-800"
                  style={{background:"linear-gradient(135deg,rgba(16,185,129,0.1),rgba(16,185,129,0.05))",boxShadow:"0 0 30px rgba(16,185,129,0.15)"}}>
                  <Lock className="w-9 h-9" style={{color:"#10b981"}} />
                </div>
                <h2 className="text-2xl font-black mb-2 g-text g-text-green">
                  Caixa Fechado
                </h2>
                <p className="text-zinc-500 text-sm mb-8 leading-relaxed">
                  Abra o caixa para começar a registrar vendas,<br />
                  sangrias e aportes do dia.
                </p>
                <button
                  onClick={() => setShowOpen(true)}
                  className="w-full font-bold py-3 rounded-xl transition-all"
                  style={{background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",boxShadow:"0 0 20px rgba(16,185,129,0.4)"}}
                >
                  <Unlock className="w-4 h-4 inline mr-2" />
                  Abrir Caixa
                </button>
              </div>
            </div>
          )}

          {subTab === "history" && (
            <HistoryTab regs={historyRegs} loading={historyLoading} userId={userId} salesTotals={histSalesTotals} salesCounts={histSalesCounts} />
          )}
        </div>

        {showOpen && (
          <Modal title="Abertura de Caixa" onClose={() => setShowOpen(false)}>
            <OpenModalContent
              error={error} initialAmount={initialAmount} setInitialAmount={setInitialAmount}
              operatorName={operatorName} setOperatorName={setOperatorName}
              actionLoading={actionLoading} onConfirm={handleOpenRegister}
            />
          </Modal>
        )}
      </>
    );
  }

  // ── Render: caixa aberto ──
  return (
    <div className="space-y-5">

      {/* ── Cabeçalho status ── */}
      <div className="relative overflow-hidden rounded-2xl p-5"
        style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
          backgroundImage: `radial-gradient(rgba(123,47,190,0.08) 1px, transparent 1px)`, backgroundSize:"24px 24px" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: isLight ? "linear-gradient(135deg,rgba(123,47,190,0.04) 0%,rgba(0,180,216,0.03) 100%)" : "linear-gradient(135deg,rgba(123,47,190,0.08) 0%,transparent 100%)" }} />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{background:"#10b981",boxShadow:"0 0 6px #10b981"}} />
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#10b981"}}>Caixa Aberto</span>
            </div>
            <h1 className="text-2xl font-black"
              style={{background: "linear-gradient(135deg,#7B2FBE,#00B4D8)", WebkitBackgroundClip:"text", display:"inline-block",WebkitTextFillColor:"transparent", backgroundClip:"text"}}>
              Controle de Caixa
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Aberto em {fmtDateTime(register.opened_at)}
              {register.operator_name && ` · Operador: ${register.operator_name}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors" title="Atualizar">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => { setShowClose(true); setClosingOperator(""); setCountedAmount(""); }}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all border border-red-500/30 text-red-400 hover:bg-red-500/10">
              <Lock className="w-4 h-4" />
              Fechar Caixa
            </button>
          </div>
        </div>
      </div>

      {/* Sub-abas */}
      {tabs}

      {subTab === "current" && (
        <>
          {/* ── Cards de resumo ── */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <SummaryCard label="Total de Vendas" value={fmt(salesTotal)}
              sub={`${sales.length} venda${sales.length !== 1 ? "s" : ""}`}
              icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-emerald-500/15" iconColor="text-emerald-400" accent color="#10b981" />
            <SummaryCard label="Saldo em Dinheiro" value={fmt(currentBalance)}
              sub={`Fundo inicial: ${fmt(register.opening_amount)}`}
              icon={<Wallet className="w-5 h-5" />} iconBg="bg-violet-500/15" iconColor="text-violet-400" color="#7c3aed" />
            <SummaryCard label="Sangrias" value={fmt(totalSangria)} sub="Retiradas do caixa"
              icon={<TrendingDown className="w-5 h-5" />} iconBg="bg-red-500/15" iconColor="text-red-400" color="#ef4444" />
            <SummaryCard label="Aportes" value={fmt(totalAporte)} sub="Entradas extras"
              icon={<ArrowUpCircle className="w-5 h-5" />} iconBg="bg-blue-500/15" iconColor="text-blue-400" color="#3b82f6" />
          </div>

          {/* ── Ações rápidas ── */}
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => { setShowSangria(true); setError(null); setMovAmount(""); setMovDescription(""); }}
              style={{ background: card.bg, border: card.border }}
              className="flex items-center gap-2 hover:bg-red-500/10 hover:border-red-500/40 text-sm font-medium px-4 py-2.5 rounded-xl transition-all text-red-400">
              <ArrowDownCircle className="w-4 h-4" /> Sangria
            </button>
            <button onClick={() => { setShowAporte(true); setError(null); setMovAmount(""); setMovDescription(""); }}
              style={{ background: card.bg, border: card.border }}
              className="flex items-center gap-2 hover:bg-blue-500/10 hover:border-blue-500/40 text-sm font-medium px-4 py-2.5 rounded-xl transition-all text-blue-400">
              <ArrowUpCircle className="w-4 h-4" /> Aporte
            </button>
          </div>

          {/* ── Painéis de breakdown ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Vendas por canal */}
            <div className="relative overflow-hidden rounded-2xl p-5"
              style={{ background: card.bg, border: card.border, boxShadow: isLight ? card.shadow : "0 0 24px rgba(139,92,246,0.08)" }}>
              <div className="flex items-center gap-2 mb-5">
                <BarChart2 className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-semibold">Vendas por Canal</h3>
              </div>
              {totalSales === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-6">Nenhuma venda registrada ainda.</p>
              ) : (
                <div className="space-y-4">
                  {channelBreakdown.map(({ channel, amount, pct }) => {
                    const info = CHANNEL_INFO[channel];
                    return (
                      <div key={channel}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 text-sm text-zinc-300">
                            <span className="text-zinc-400">{info.icon}</span>{info.label}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-white">{pct.toFixed(1)}%</span>
                            <span className="text-xs text-zinc-400">{fmt(amount)}</span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: isLight ? "#EBEBEB" : "rgba(39,39,42,0.8)" }}>
                          <div className={`h-full rounded-full transition-all duration-700 ${info.bar}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Formas de pagamento */}
            <div className="relative overflow-hidden rounded-2xl p-5"
              style={{ background: card.bg, border: card.border, boxShadow: isLight ? card.shadow : "0 0 24px rgba(59,130,246,0.08)" }}>
              <div className="flex items-center gap-2 mb-5">
                <CreditCard className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-semibold">Formas de Pagamento</h3>
              </div>
              {paymentBreakdown.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-6">Nenhuma venda registrada ainda.</p>
              ) : (
                <div className="space-y-3">
                  {paymentBreakdown.map(({ method, amount, pct }) => {
                    const info = PAYMENT_INFO[method];
                    return (
                      <div key={method} className="flex items-center gap-3">
                        <div className={`${info.color} flex-shrink-0`}>{info.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-zinc-300">{info.label}</span>
                            <span className="text-xs text-zinc-400">{fmt(amount)}</span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isLight ? "#EBEBEB" : "rgba(39,39,42,0.8)" }}>
                            <div className={`h-full rounded-full transition-all duration-700 ${info.bar}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <span className="text-xs font-bold text-white w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Histórico de movimentos ── */}
          <div className="relative overflow-hidden rounded-2xl"
            style={{ background: card.bg, border: card.border, boxShadow: isLight ? card.shadow : "0 0 24px rgba(113,113,122,0.08)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-semibold">Movimentos do Caixa</h3>
              </div>
              <span className="text-xs text-zinc-500">{movements.length} registro{movements.length !== 1 ? "s" : ""}</span>
            </div>
            {movements.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-sm">Nenhum movimento registrado ainda.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide" style={{ borderBottom: `1px solid ${isLight ? "#F3F4F6" : "rgba(39,39,42,0.6)"}`, color: isLight ? "#9CA3AF" : "#71717a" }}>
                      <th className="text-left px-5 py-3">Horário</th>
                      <th className="text-left px-5 py-3">Tipo</th>
                      <th className="text-left px-5 py-3">Descrição</th>
                      <th className="text-left px-5 py-3">Pagamento</th>
                      <th className="text-left px-5 py-3">Canal</th>
                      <th className="text-right px-5 py-3">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, idx) => {
                      const info = MOV_LABELS[m.movement_type];
                      const isOut = m.movement_type === "sangria";
                      const payInfo = m.payment_method ? PAYMENT_INFO[m.payment_method as PaymentMethod] : null;
                      return (
                        <tr key={m.id} className="transition-colors"
                          style={{ background: idx % 2 === 0 ? (isLight ? "rgba(123,47,190,0.025)" : "rgba(255,255,255,0.015)") : "transparent" }}
                          onMouseEnter={e => (e.currentTarget.style.background = isLight ? "rgba(123,47,190,0.06)" : "rgba(255,255,255,0.04)")}
                          onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? (isLight ? "rgba(123,47,190,0.025)" : "rgba(255,255,255,0.015)") : "transparent")}>
                          <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: isLight ? "#9CA3AF" : "#a1a1aa" }}>{fmtTime(m.created_at)}</td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${info.color}`}
                              style={{ background: isLight ? "rgba(123,47,190,0.08)" : "rgba(39,39,42,0.8)" }}>
                              {info.label}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 max-w-[200px] truncate" style={{ color: isLight ? "#374151" : "#d4d4d8" }}>{m.description || "—"}</td>
                          <td className="px-5 py-3.5">
                            {payInfo ? (
                              <div className={`flex items-center gap-1.5 text-xs ${payInfo.color}`}>
                                {payInfo.icon} {payInfo.label}
                              </div>
                            ) : <span style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>—</span>}
                          </td>
                          <td className="px-5 py-3.5">
                            {m.channel ? (
                              <div className="flex items-center gap-1.5 text-xs" style={{ color: isLight ? "#6B7280" : "#a1a1aa" }}>
                                {CHANNEL_INFO[m.channel].icon} {CHANNEL_INFO[m.channel].label}
                              </div>
                            ) : <span style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>—</span>}
                          </td>
                          <td className={`px-5 py-3.5 text-right font-semibold whitespace-nowrap ${isOut ? "text-red-400" : "text-emerald-400"}`}>
                            {isOut ? "–" : "+"} {fmt(m.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {subTab === "history" && (
        <HistoryTab regs={historyRegs} loading={historyLoading} userId={userId} salesTotals={histSalesTotals} salesCounts={histSalesCounts} />
      )}

      {/* ══ Modais ══════════════════════════════════════════════════════════ */}

      {/* Modal Sangria */}
      {showSangria && (
        <Modal title="Sangria de Caixa" onClose={() => setShowSangria(false)}>
          <div className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg flex gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between text-sm">
              <span className="text-zinc-400">Saldo disponível</span>
              <span className="font-bold text-emerald-400">{fmt(currentBalance)}</span>
            </div>
            <AmountInput label="Valor a retirar" value={movAmount} onChange={setMovAmount} />
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Motivo</label>
              <input placeholder="Ex: Pagamento de fornecedor" value={movDescription}
                onChange={(e) => setMovDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all" />
            </div>
            <button onClick={handleSangria} disabled={actionLoading}
              className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors">
              {actionLoading ? "Processando..." : "Confirmar Sangria"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal Aporte */}
      {showAporte && (
        <Modal title="Aporte de Caixa" onClose={() => setShowAporte(false)}>
          <div className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg flex gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}
            <AmountInput label="Valor a adicionar" value={movAmount} onChange={setMovAmount} />
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Motivo</label>
              <input placeholder="Ex: Troco adicional" value={movDescription}
                onChange={(e) => setMovDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all" />
            </div>
            <button onClick={handleAporte} disabled={actionLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors">
              {actionLoading ? "Processando..." : "Confirmar Aporte"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal Fechar Caixa */}
      {showClose && (
        <Modal title="Fechamento de Caixa" onClose={() => setShowClose(false)} wide>
          <div className="space-y-4">

            {/* Resumo financeiro */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2.5 text-sm">
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Resumo do Caixa</p>
              <Row label="Fundo Inicial" value={fmt(register.opening_amount)} />
              <Row label="Total de Vendas" value={fmt(salesTotal)} positive />
              <Row label="Aportes" value={fmt(totalAporte)} positive />
              <Row label="Sangrias" value={fmt(totalSangria)} negative />
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                <span className="font-semibold text-white">Saldo Esperado em Dinheiro</span>
                <span className="text-lg font-bold text-emerald-400">{fmt(currentBalance)}</span>
              </div>
            </div>

            {/* Vendas por forma de pagamento */}
            {paymentBreakdown.length > 0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Vendas por Forma de Pagamento</p>
                <div className="space-y-1.5">
                  {paymentBreakdown.map(({ method, amount }) => {
                    const info = PAYMENT_INFO[method];
                    return (
                      <div key={method} className="flex items-center justify-between text-sm">
                        <div className={`flex items-center gap-1.5 ${info.color}`}>{info.icon} {info.label}</div>
                        <span className="font-semibold text-white">{fmt(amount)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Operador que fecha */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Operador que está fechando (opcional)</label>
              <input placeholder="Nome do operador" value={closingOperator}
                onChange={(e) => setClosingOperator(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all" />
            </div>

            {/* Valor contado */}
            <AmountInput label="Valor contado em caixa (dinheiro físico)" value={countedAmount} onChange={setCountedAmount} />
            {difference !== null && (
              <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold ${
                difference === 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : difference > 0  ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}>
                <span>{difference === 0 ? "✓ Caixa conferido" : difference > 0 ? "Sobra no caixa" : "Falta no caixa"}</span>
                <span>{difference > 0 ? "+" : ""}{fmt(difference)}</span>
              </div>
            )}

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex gap-2 text-xs text-amber-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Esta ação é irreversível. O caixa será fechado e um novo deverá ser aberto para continuar vendendo.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowClose(false)}
                className="py-2.5 rounded-lg border border-zinc-700 text-sm font-medium hover:bg-zinc-800 transition-colors">
                Cancelar
              </button>
              <button onClick={handleCloseRegister} disabled={actionLoading}
                className="py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {actionLoading ? "Fechando..." : "Confirmar Fechamento"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Abrir Caixa (caso o usuário queira reabrir) */}
      {showOpen && (
        <Modal title="Abertura de Caixa" onClose={() => setShowOpen(false)}>
          <OpenModalContent
            error={error} initialAmount={initialAmount} setInitialAmount={setInitialAmount}
            operatorName={operatorName} setOperatorName={setOperatorName}
            actionLoading={actionLoading} onConfirm={handleOpenRegister}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── Sub-componente: Aba de Histórico ─────────────────────────────────────────

interface HistSaleRow { id: string; total_amount: number; discount: number | null; payments: any; origin: string | null; created_at: string; }

function HistoryTab({
  regs, loading, userId, salesTotals, salesCounts,
}: {
  regs: CashRegister[];
  loading: boolean;
  userId: string | null;
  salesTotals: Record<string, number>;
  salesCounts: Record<string, number>;
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

  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { movs: Movement[]; sales: HistSaleRow[] }>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  // ── Editar venda do histórico ─────────────────────────────────────────────
  const [editingSale, setEditingSale] = useState<any | null>(null);
  const [editRegId, setEditRegId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editPayments, setEditPayments] = useState<{ method: string; amount: number }[]>([]);
  const [editProducts, setEditProducts] = useState<any[]>([]);
  const [editItemPriceId, setEditItemPriceId] = useState<string | null>(null);
  const [editItemPriceVal, setEditItemPriceVal] = useState("");
  const [editProductSearch, setEditProductSearch] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editPayMethod, setEditPayMethod] = useState<PaymentMethod>("cash");

  const fmtEdit = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function openEditSale(sale: HistSaleRow, regId: string) {
    const { data: fullSale } = await supabase.from("sales").select("*").eq("id", sale.id).single();
    const { data: items } = await supabase.from("sale_items").select("*, products(name)").eq("sale_id", sale.id);
    if (editProducts.length === 0) {
      const { data: prods } = await supabase.from("products").select("*").neq("is_active", false).order("name");
      setEditProducts(prods ?? []);
    }
    setEditingSale(fullSale ?? sale);
    setEditRegId(regId);
    setEditItems(items ?? []);
    setEditPayments(Array.isArray((fullSale ?? sale).payments) ? (fullSale ?? sale).payments : []);
    setEditItemPriceId(null); setEditItemPriceVal(""); setEditProductSearch("");
  }

  async function histUpdateQty(item: any, delta: number) {
    const newQty = Math.max(1, item.quantity + delta);
    await supabase.from("sale_items").update({ quantity: newQty, total_price: item.unit_price * newQty }).eq("id", item.id);
    setEditItems(prev => prev.map((i: any) => i.id === item.id ? { ...i, quantity: newQty, total_price: item.unit_price * newQty } : i));
  }

  async function histConfirmPrice(item: any) {
    const newPrice = parseFloat(editItemPriceVal.replace(",", ".")) || 0;
    await supabase.from("sale_items").update({ unit_price: newPrice, total_price: newPrice * item.quantity }).eq("id", item.id);
    setEditItems(prev => prev.map((i: any) => i.id === item.id ? { ...i, unit_price: newPrice, total_price: newPrice * item.quantity } : i));
    setEditItemPriceId(null); setEditItemPriceVal("");
  }

  async function histDeleteItem(itemId: string) {
    await supabase.from("sale_items").delete().eq("id", itemId);
    setEditItems(prev => prev.filter((i: any) => i.id !== itemId));
  }

  async function histAddItem(product: any) {
    if (!editingSale) return;
    const existing = editItems.find((i: any) => i.product_id === product.id);
    if (existing) { await histUpdateQty(existing, 1); }
    else {
      const price = product.sale_price ?? product.price ?? 0;
      const { data } = await supabase.from("sale_items").insert({
        sale_id: editingSale.id, product_id: product.id,
        quantity: 1, unit_price: price, total_price: price, notes: null,
      }).select("*, products(name)").single();
      if (data) setEditItems(prev => [...prev, data]);
    }
    setEditProductSearch("");
  }

  async function saveEditSale() {
    if (!editingSale || !editRegId || editSaving) return;
    setEditSaving(true);
    try {
      const saleId = editingSale.id;
      const orderNum = saleId.slice(-6).toUpperCase();
      const newTotal = editItems.reduce((s: number, i: any) => s + i.unit_price * i.quantity, 0);
      const payments = editPayments.filter(p => p.amount > 0);

      const { error } = await supabase.from("sales")
        .update({ payments, total_amount: newTotal }).eq("id", saleId);
      if (error) throw error;

      // Atualiza cash_movements do caixa FECHADO original
      await supabase.from("cash_movements").delete()
        .eq("movement_type", "sale").eq("user_id", userId)
        .like("description", `%#${orderNum}%`);
      for (const p of payments) {
        const desc = p.method === "fiado" ? `Fiado - Venda #${orderNum}` :
                     p.method === "house_credit" ? `Saldo Cliente - Venda #${orderNum}` :
                     `Venda #${orderNum}`;
        await supabase.from("cash_movements").insert({
          register_id: editRegId, user_id: userId, movement_type: "sale",
          amount: p.amount, payment_method: p.method as PaymentMethod,
          channel: "pdv", description: desc,
        });
      }

      // Sincroniza customer_movements se houver fiado
      if (editingSale.customer_id) {
        const newFiado = payments.filter(p => p.method === "fiado").reduce((s, p) => s + p.amount, 0);
        const { data: oldMovs } = await supabase.from("customer_movements").select("amount, type").eq("sale_id", saleId);
        const oldFiado = (oldMovs ?? []).filter((m: any) => m.type === "debit").reduce((s: number, m: any) => s + m.amount, 0);
        await supabase.from("customer_movements").delete().eq("sale_id", saleId);
        if (oldFiado !== newFiado) {
          const { data: cust } = await supabase.from("customers").select("fiado_balance").eq("id", editingSale.customer_id).single();
          await supabase.from("customers").update({ fiado_balance: Math.max(0, (cust as any)?.fiado_balance - oldFiado + newFiado) }).eq("id", editingSale.customer_id);
        }
        if (newFiado > 0) {
          await supabase.from("customer_movements").insert({
            customer_id: editingSale.customer_id, user_id: userId,
            type: "debit", amount: newFiado, description: `Fiado - Venda #${orderNum}`,
            sale_id: saleId, payment_methods: [],
          });
        }
      }

      // Recarrega os detalhes deste registro
      const { data: updSales } = await supabase.from("sales")
        .select("id, total_amount, discount, payments, origin, created_at")
        .eq("register_id", editRegId).eq("status", "paid").order("created_at", { ascending: false });
      setDetails(prev => ({ ...prev, [editRegId!]: { ...prev[editRegId!], sales: updSales ?? [] } }));
      setEditingSale(null);
    } catch (e: any) { alert("Erro ao salvar: " + (e?.message ?? String(e))); }
    finally { setEditSaving(false); }
  }

  async function toggleDetail(reg: CashRegister) {
    if (expanded === reg.id) { setExpanded(null); return; }
    setExpanded(reg.id);
    if (details[reg.id]) return;
    setDetailLoading(reg.id);
    const [{ data: movData }, { data: salesData }] = await Promise.all([
      supabase.from("cash_movements").select("*").eq("register_id", reg.id).order("created_at", { ascending: false }),
      supabase.from("sales")
        .select("id, total_amount, discount, payments, origin, created_at")
        .eq("user_id", userId ?? "")
        .eq("status", "paid")
        .gte("created_at", reg.opened_at)
        .lte("created_at", reg.closed_at ?? new Date().toISOString())
        .order("created_at", { ascending: false }),
    ]);
    setDetails(prev => ({ ...prev, [reg.id]: { movs: movData ?? [], sales: salesData ?? [] } }));
    setDetailLoading(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 text-violet-400 animate-spin mr-2" />
        <span className="text-sm text-zinc-500">Carregando histórico...</span>
      </div>
    );
  }

  if (regs.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-zinc-800 rounded-2xl">
        <History className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
        <p className="text-sm font-semibold text-zinc-500">Nenhum caixa registrado ainda.</p>
        <p className="text-xs text-zinc-600 mt-1">O histórico aparece após o primeiro fechamento.</p>
      </div>
    );
  }

  const fmtCur = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <>
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500 px-1">
        <History className="w-3.5 h-3.5" />
        <span>{regs.length} registro{regs.length !== 1 ? "s" : ""} encontrado{regs.length !== 1 ? "s" : ""}</span>
      </div>

      {regs.map((reg) => {
        const isOpen = reg.status === "open";
        const duration = reg.closed_at
          ? Math.round((new Date(reg.closed_at).getTime() - new Date(reg.opened_at).getTime()) / 60000)
          : Math.round((Date.now() - new Date(reg.opened_at).getTime()) / 60000);
        const hours = Math.floor(duration / 60);
        const mins  = duration % 60;
        const durationStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
        const isExpanded = expanded === reg.id;
        const det = details[reg.id];
        const totalVendido = salesTotals[reg.id] ?? 0;
        const numVendas = salesCounts[reg.id] ?? 0;

        return (
          <div key={reg.id}
            className="rounded-2xl overflow-hidden transition-all"
            style={{ background: card.bg, boxShadow: card.shadow, border: `1px solid ${isOpen ? "rgba(16,185,129,0.3)" : isExpanded ? "rgba(123,47,190,0.3)" : (isLight ? "#e5e7eb" : "#27272a")}` }}>

            {/* Cabeçalho do registro */}
            <div className="p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={isOpen
                      ? { background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }
                      : { background: "rgba(123,47,190,0.1)", border: "1px solid rgba(123,47,190,0.25)" }}>
                    {isOpen ? <Unlock className="w-4 h-4 text-emerald-400" /> : <Lock className="w-4 h-4" style={{ color: "#7B2FBE" }} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOpen ? "bg-emerald-500/15 text-emerald-400" : ""}`}
                        style={!isOpen ? { background: "rgba(123,47,190,0.12)", color: "#7B2FBE" } : {}}>
                        {isOpen ? "EM ABERTO" : "FECHADO"}
                      </span>
                      <span className="text-[10px] text-zinc-500">Duração: {durationStr}</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: isLight ? "#18181b" : "#e4e4e7" }}>
                      {new Date(reg.opened_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {/* Valores resumo */}
                <div className="flex gap-5 text-right items-start">
                  <div>
                    <p className="text-[10px] text-zinc-500 mb-0.5">Fundo Inicial</p>
                    <p className="text-sm font-bold" style={{ color: isLight ? "#3f3f46" : "#a1a1aa" }}>{fmtCur(reg.opening_amount ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 mb-0.5">Total Vendido</p>
                    <p className="text-sm font-black" style={{ color: "#7B2FBE" }}>{fmtCur(totalVendido)}</p>
                    <p className="text-[10px] text-zinc-500">{numVendas} venda{numVendas !== 1 ? "s" : ""}</p>
                  </div>
                  {reg.closing_amount !== null && (
                    <div>
                      <p className="text-[10px] text-zinc-500 mb-0.5">Saldo Caixa</p>
                      <p className="text-sm font-bold text-emerald-400">{fmtCur(reg.closing_amount)}</p>
                      <p className="text-[10px] text-zinc-500">dinheiro</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Linha de detalhe rápido */}
              <div className="mt-3 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs" style={{ borderTop: `1px solid ${isLight ? "#f3f4f6" : "#27272a"}` }}>
                <div>
                  <p className="text-zinc-500 mb-0.5">Aberto por</p>
                  <p className="font-medium" style={{ color: isLight ? "#3f3f46" : "#d4d4d8" }}>{reg.operator_name || "—"}</p>
                </div>
                <div>
                  <p className="text-zinc-500 mb-0.5">Abertura</p>
                  <p className="font-medium" style={{ color: isLight ? "#3f3f46" : "#d4d4d8" }}>{new Date(reg.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <div>
                  <p className="text-zinc-500 mb-0.5">Fechamento</p>
                  <p className="font-medium" style={{ color: isLight ? "#3f3f46" : "#d4d4d8" }}>
                    {reg.closed_at ? new Date(reg.closed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 mb-0.5">Data fechamento</p>
                  <p className="font-medium" style={{ color: isLight ? "#3f3f46" : "#d4d4d8" }}>
                    {reg.closed_at ? new Date(reg.closed_at).toLocaleDateString("pt-BR") : "—"}
                  </p>
                </div>
              </div>

              {/* Botão expandir */}
              <button
                onClick={() => toggleDetail(reg)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: isExpanded ? "rgba(123,47,190,0.1)" : (isLight ? "#f3f4f6" : "rgba(39,39,42,0.5)"), color: isExpanded ? "#7B2FBE" : "#71717a", border: isExpanded ? "1px solid rgba(123,47,190,0.25)" : "1px solid transparent" }}>
                {detailLoading === reg.id
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Carregando...</>
                  : <><Eye className="w-3.5 h-3.5" /> {isExpanded ? "Ocultar detalhes" : "Ver vendas e movimentos"} <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} /></>}
              </button>
            </div>

            {/* Painel de detalhes expandido */}
            {isExpanded && det && (
              <div style={{ borderTop: `1px solid ${isLight ? "#e5e7eb" : "#27272a"}` }}>

                {/* Vendas individuais */}
                <div className="p-4 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" /> Vendas do período ({det.sales.length})
                  </p>
                  {det.sales.length === 0 ? (
                    <p className="text-xs text-zinc-600 text-center py-4">Nenhuma venda registrada neste período.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
                      {det.sales.map((sale, idx) => {
                        const gross = sale.origin === "ifood"
                          ? Number(sale.total_amount ?? 0) + Number(sale.discount ?? 0)
                          : Number(sale.total_amount ?? 0);
                        const pmts: { method: string; amount: number }[] = Array.isArray(sale.payments) ? sale.payments : [];
                        const payStr = pmts.map(p => {
                          const info = PAYMENT_INFO[p.method as PaymentMethod];
                          return info ? info.label : p.method;
                        }).join(", ") || "—";
                        const chLabel = CHANNEL_INFO[sale.origin as SaleChannel]?.label ?? sale.origin ?? "PDV";
                        return (
                          <div key={sale.id ?? idx}
                            className="flex items-center justify-between px-3 py-2 rounded-xl text-xs gap-3"
                            style={{ background: idx % 2 === 0 ? (isLight ? "rgba(123,47,190,0.03)" : "rgba(123,47,190,0.06)") : "transparent" }}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-zinc-500 flex-shrink-0">
                                {new Date(sale.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <span className="text-zinc-400 truncate">{payStr}</span>
                              <span className="text-zinc-600 flex-shrink-0">{chLabel}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="font-bold" style={{ color: "#7B2FBE" }}>{fmtCur(gross)}</span>
                              <button
                                onClick={() => openEditSale(sale, reg.id)}
                                className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-violet-600 text-zinc-300 hover:text-white rounded-lg transition-all text-xs font-medium border border-zinc-700 hover:border-violet-500">
                                <Edit2 className="w-3 h-3" /> Editar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Movimentos (sangria/aporte) */}
                {det.movs.filter(m => m.movement_type === "sangria" || m.movement_type === "aporte").length > 0 && (
                  <div className="px-4 pb-4 space-y-1.5" style={{ borderTop: `1px solid ${isLight ? "#f3f4f6" : "#27272a"}`, paddingTop: 12 }}>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-1.5">
                      <ArrowUpCircle className="w-3.5 h-3.5" /> Movimentos de caixa
                    </p>
                    {det.movs.filter(m => m.movement_type === "sangria" || m.movement_type === "aporte").map((mov, idx) => {
                      const cfg = MOV_LABELS[mov.movement_type];
                      return (
                        <div key={mov.id} className="flex items-center justify-between px-3 py-2 rounded-xl text-xs gap-3"
                          style={{ background: idx % 2 === 0 ? (isLight ? "rgba(113,113,122,0.04)" : "rgba(39,39,42,0.5)") : "transparent" }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`font-bold flex-shrink-0 ${cfg.color}`}>{cfg.sign}</span>
                            <span className="font-semibold flex-shrink-0" style={{ color: isLight ? "#3f3f46" : "#d4d4d8" }}>{cfg.label}</span>
                            {mov.description && <span className="text-zinc-500 truncate">{mov.description}</span>}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-zinc-500">{new Date(mov.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className={`font-bold ${cfg.color}`}>{cfg.sign}{fmtCur(mov.amount)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>

      {/* ── Modal: Editar Venda do Histórico ─────────────────────────────── */}
      {editingSale && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Editar Venda · #{editingSale.id?.slice(-6).toUpperCase()}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {new Date(editingSale.created_at).toLocaleString("pt-BR")} · Caixa fechado
                </p>
              </div>
              <button onClick={() => setEditingSale(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Resumo */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-zinc-950 rounded-xl p-3">
                  <p className="text-xs text-zinc-500 mb-0.5">Total atual</p>
                  <p className="text-sm font-black" style={{ color: "#7B2FBE" }}>
                    {fmtEdit(editItems.reduce((s: number, i: any) => s + i.unit_price * i.quantity, 0))}
                  </p>
                </div>
                <div className="bg-zinc-950 rounded-xl p-3">
                  <p className="text-xs text-zinc-500 mb-0.5">Itens</p>
                  <p className="text-sm font-semibold">{editItems.length}</p>
                </div>
              </div>

              {/* Itens */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Itens da venda</p>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {editItems.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.products?.name ?? "Produto"}</p>
                        {editItemPriceId === item.id ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-zinc-500">R$</span>
                            <input autoFocus type="text" inputMode="decimal" value={editItemPriceVal}
                              onChange={e => setEditItemPriceVal(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") histConfirmPrice(item); if (e.key === "Escape") { setEditItemPriceId(null); } }}
                              onBlur={() => histConfirmPrice(item)}
                              className="w-20 text-xs px-1.5 py-0.5 bg-zinc-800 border border-violet-500 rounded text-white focus:outline-none" />
                            <span className="text-xs text-zinc-500">/ un.</span>
                          </div>
                        ) : (
                          <button onClick={() => { setEditItemPriceId(item.id); setEditItemPriceVal(String(item.unit_price)); }}
                            className="text-xs text-zinc-500 hover:text-violet-400 text-left mt-0.5">
                            {fmtEdit(item.unit_price)} / un. · <span className="text-white font-semibold">{fmtEdit(item.unit_price * item.quantity)}</span>
                            <span className="ml-1 text-violet-500 text-[10px]">(editar)</span>
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => histUpdateQty(item, -1)} className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <button onClick={() => histUpdateQty(item, 1)} className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                      </div>
                      <button onClick={() => histDeleteItem(item.id)}
                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {editItems.length === 0 && <p className="text-center py-4 text-xs text-zinc-600">Nenhum item.</p>}
                </div>
              </div>

              {/* Adicionar produto */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Adicionar produto</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input value={editProductSearch} onChange={e => setEditProductSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { const f = editProducts.filter(p => p.name.toLowerCase().includes(editProductSearch.toLowerCase())); if (f.length > 0) histAddItem(f[0]); } }}
                    placeholder="Digite o nome e pressione Enter..."
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500" />
                </div>
                {editProductSearch.length >= 1 && (
                  <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto">
                    {editProducts.filter(p => p.name.toLowerCase().includes(editProductSearch.toLowerCase())).slice(0, 6).map((p: any) => (
                      <button key={p.id} onClick={() => histAddItem(p)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-950 hover:bg-violet-600/10 border border-zinc-800 hover:border-violet-500/30 rounded-xl text-left">
                        <div><p className="text-sm font-medium text-white">{p.name}</p><p className="text-xs text-zinc-500">{fmtEdit(p.sale_price ?? p.price)}</p></div>
                        <Plus className="w-4 h-4 text-violet-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Formas de pagamento */}
              <div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Formas de pagamento</p>
                {/* Entradas existentes com troca direta de método */}
                {editPayments.map((entry, i) => (
                  <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2 mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">Clique para trocar</span>
                      <button onClick={() => setEditPayments(prev => prev.filter((_, j) => j !== i))} className="p-1 text-zinc-600 hover:text-red-400 rounded"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {(["cash","pix","credit","debit","fiado"] as PaymentMethod[]).map(m => (
                        <button key={m}
                          onClick={() => setEditPayments(prev => prev.map((e, j) => j === i ? { ...e, method: m } : e))}
                          className={`px-2 py-1.5 border rounded-lg text-xs font-medium transition-all ${entry.method === m ? PAYMENT_INFO[m].color.replace("text-","text-") + " border-current bg-current/10" : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                          {PAYMENT_INFO[m]?.label ?? m}
                        </button>
                      ))}
                    </div>
                    <input type="number" min="0.01" step="0.01" value={entry.amount}
                      onChange={e => { const v = parseFloat(e.target.value) || 0; setEditPayments(prev => prev.map((en, j) => j === i ? { ...en, amount: v } : en)); }}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500" />
                  </div>
                ))}
                {/* Adicionar forma */}
                <div className="grid grid-cols-4 gap-1 mb-2">
                  {(["cash","pix","credit","debit","fiado"] as PaymentMethod[]).map(m => (
                    <button key={m} onClick={() => setEditPayMethod(m)}
                      className={`px-2 py-1.5 border rounded-lg text-xs font-medium transition-all ${editPayMethod === m ? "border-violet-500 bg-violet-500/10 text-violet-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}>
                      {PAYMENT_INFO[m]?.label ?? m}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="number" min="0.01" step="0.01"
                    placeholder="Valor"
                    id="hist-pay-input"
                    className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const v = parseFloat((e.target as HTMLInputElement).value) || 0;
                        if (v > 0) { setEditPayments(prev => [...prev.filter(p => p.method !== editPayMethod), { method: editPayMethod, amount: v }]); (e.target as HTMLInputElement).value = ""; }
                      }
                    }} />
                  <button
                    onClick={() => {
                      const inp = document.getElementById("hist-pay-input") as HTMLInputElement;
                      const v = parseFloat(inp?.value) || 0;
                      if (v > 0) { setEditPayments(prev => [...prev.filter(p => p.method !== editPayMethod), { method: editPayMethod, amount: v }]); if (inp) inp.value = ""; }
                    }}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {editPayments.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 rounded-xl mt-2">
                    <span className="text-sm font-semibold">Total</span>
                    <span className="text-base font-black text-emerald-400">{fmtEdit(editPayments.reduce((s, p) => s + p.amount, 0))}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setEditingSale(null)} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium">Cancelar</button>
              <button onClick={saveEditSale} disabled={editSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                {editSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-componente: Conteúdo do modal Abrir Caixa ───────────────────────────

function OpenModalContent({ error, initialAmount, setInitialAmount, operatorName, setOperatorName, actionLoading, onConfirm }: {
  error: string | null;
  initialAmount: string; setInitialAmount: (v: string) => void;
  operatorName: string; setOperatorName: (v: string) => void;
  actionLoading: boolean; onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg flex gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}
      <AmountInput label="Valor inicial em caixa (troco)" value={initialAmount} onChange={setInitialAmount} />
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Operador (opcional)</label>
        <input placeholder="Nome do operador" value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all" />
      </div>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 leading-relaxed">
        <p className="font-medium text-zinc-300 mb-1">Abertura em:</p>
        <p>{new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })}</p>
      </div>
      <button onClick={onConfirm} disabled={actionLoading}
        className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors">
        {actionLoading ? "Abrindo..." : "Confirmar Abertura"}
      </button>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, icon, iconBg, iconColor, color }: {
  label: string; value: string; sub: string;
  icon: React.ReactNode; iconBg: string; iconColor: string; accent?: boolean; color?: string;
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
    <div className="relative overflow-hidden rounded-2xl p-5"
      style={{ background: card.bg, border: card.border, boxShadow: isLight ? card.shadow : (color ? `0 0 28px ${color}22` : "none") }}>
      {/* Faixa gradiente no topo — efeito moderno igual dashboard */}
      {isLight && (
        <div className="absolute top-0 left-0 right-0 pointer-events-none"
          style={{ height: 3, background: color ? `linear-gradient(90deg,${color},${color}88)` : "linear-gradient(90deg,#7B2FBE,#00B4D8)" }} />
      )}
      {color && (
        <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-20 blur-2xl pointer-events-none"
          style={{ background: color }} />
      )}
      <div className="flex items-start justify-between mb-4 relative z-10">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center ${iconColor}`}>{icon}</div>
      </div>
      <p className="text-2xl font-bold mb-1 relative z-10" style={{ color: color || (isLight ? "#7B2FBE" : "#fff") }}>{value}</p>
      <p className="text-xs text-zinc-500 relative z-10">{sub}</p>
    </div>
  );
}

function Row({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className={positive ? "text-emerald-400" : negative ? "text-red-400" : "text-zinc-300"}>
        {positive ? "+" : negative ? "–" : ""} {value}
      </span>
    </div>
  );
}
