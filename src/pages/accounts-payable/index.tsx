import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Wallet, Mic, MicOff, Plus, X, Search, Send, Sparkles,
  CheckCircle2, AlertCircle, XCircle, Trash2, Edit2,
  FileText, BarChart2, RefreshCw, Check, DollarSign,
  Repeat, ChevronDown, Loader2, Clock,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type BillStatus = "pending" | "paid" | "partial" | "overdue" | "cancelled" | "scheduled";

interface Bill {
  id: string;
  description: string;
  supplier: string | null;
  category: string;
  cost_center: string | null;
  document_number: string | null;
  competence_date: string | null;
  due_date: string;
  paid_date: string | null;
  amount: number;
  discount: number;
  interest: number;
  fine: number;
  paid_amount: number;
  status: BillStatus;
  payment_method: string | null;
  bank_account: string | null;
  installment_number: number | null;
  total_installments: number | null;
  installment_group_id: string | null;
  recurrence: string;
  notes: string | null;
  tags: string[] | null;
  quick_input: string | null;
  created_at: string;
}

interface BillForm {
  description: string; supplier: string; category: string; cost_center: string;
  document_number: string; competence_date: string; due_date: string;
  amount: string; discount: string; interest: string; fine: string;
  payment_method: string; bank_account: string; installments: string;
  recurrence: string; notes: string; tags: string; status: BillStatus;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().split("T")[0];

const CATS: { key: string; label: string; color: string; keywords: string[] }[] = [
  { key: "alimentacao",  label: "Alimentação",     color: "#f59e0b", keywords: ["mercado","supermercado","padaria","açougue","restaurante","lanche","ifood","comida","delivery","alimentos","hortifruti","feira","minimercado"] },
  { key: "transporte",   label: "Transporte",       color: "#3b82f6", keywords: ["uber","taxi","combustível","gasolina","álcool","diesel","posto","estacionamento","pedágio","ônibus","frete","moto","carro","veículo"] },
  { key: "aluguel",      label: "Aluguel",          color: "#8b5cf6", keywords: ["aluguel","locação","alugar","arrendamento","condomínio","imóvel"] },
  { key: "utilities",    label: "Contas/Utilities", color: "#06b6d4", keywords: ["luz","energia","água","gás","internet","telefone","celular","tim","claro","vivo","oi","net","streaming","netflix","spotify"] },
  { key: "saude",        label: "Saúde",            color: "#10b981", keywords: ["farmácia","remédio","médico","plano","hospital","dentista","consulta","exame","clínica","fisio"] },
  { key: "salarios",     label: "Salários",         color: "#f43f5e", keywords: ["salário","funcionário","folha","adiantamento","pro labore","comissão","holerite"] },
  { key: "impostos",     label: "Impostos",         color: "#ef4444", keywords: ["imposto","simples","dasn","irpj","iss","icms","taxa","darf","guia","inss","fgts","pgdas","tributo"] },
  { key: "marketing",    label: "Marketing",        color: "#d946ef", keywords: ["marketing","publicidade","anúncio","facebook","google","instagram","meta","ads","propaganda"] },
  { key: "fornecedores", label: "Fornecedores",     color: "#f97316", keywords: ["fornecedor","compra","mercadoria","estoque","produto","nota","nf","atacado","distribuidora"] },
  { key: "manutencao",   label: "Manutenção",       color: "#84cc16", keywords: ["manutenção","conserto","reparo","técnico","instalação","peça","reforma"] },
  { key: "escritorio",   label: "Escritório",       color: "#64748b", keywords: ["papelaria","escritório","material","caneta","papel","impressão","toner","expediente"] },
  { key: "outros",       label: "Outros",           color: "#71717a", keywords: [] },
];

const STATUS_CFG: Record<BillStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:   { label: "Em aberto",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)"  },
  paid:      { label: "Pago",         color: "#10b981", bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.35)"  },
  partial:   { label: "Pago parcial", color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   border: "rgba(6,182,212,0.35)"   },
  overdue:   { label: "Vencido",      color: "#f43f5e", bg: "rgba(244,63,94,0.12)",   border: "rgba(244,63,94,0.35)"   },
  cancelled: { label: "Cancelado",    color: "#71717a", bg: "rgba(113,113,122,0.12)", border: "rgba(113,113,122,0.35)" },
  scheduled: { label: "Agendado",     color: "#8b5cf6", bg: "rgba(139,92,246,0.12)",  border: "rgba(139,92,246,0.35)"  },
};

const PAY_METHODS = [
  { key: "boleto",       label: "Boleto"         },
  { key: "pix",         label: "PIX"            },
  { key: "transfer",    label: "Transferência"  },
  { key: "credit_card", label: "Cartão Crédito" },
  { key: "debit_card",  label: "Cartão Débito"  },
  { key: "check",       label: "Cheque"         },
  { key: "cash",        label: "Dinheiro"       },
];

const fmt  = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
const catOf = (key: string) => CATS.find(c => c.key === key) ??
  { key, label: key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()), color: "#a78bfa" };
const finalAmt = (b: Pick<Bill, "amount" | "discount" | "interest" | "fine">) =>
  b.amount - (b.discount || 0) + (b.interest || 0) + (b.fine || 0);

const defaultForm = (): BillForm => ({
  description: "", supplier: "", category: "outros", cost_center: "",
  document_number: "", competence_date: "", due_date: todayStr(),
  amount: "", discount: "0", interest: "0", fine: "0",
  payment_method: "", bank_account: "", installments: "1",
  recurrence: "none", notes: "", tags: "", status: "pending",
});

// ─── Smart Parser ─────────────────────────────────────────────────────────────

function parseQuickInput(text: string) {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lower = norm(text);

  // Amount
  let amount = "";
  let amountRaw = ""; // guarda o texto do número para limpar da descrição
  const amtPatterns = [
    /r\$\s*([\d.]+(?:,\d{1,2})?)/i,
    /([\d.]+(?:,\d{1,2})?)\s*(?:reais?|brl|real)/i,
    /([\d]+(?:\.\d{3})*,\d{2})/,
    /([\d]+(?:,\d{1,2})?)\s*(?:conto|pila)/i,
    /([\d]+\.\d{2})/,
  ];
  for (const p of amtPatterns) {
    const m = text.match(p);
    if (m) {
      const raw = m[1].replace(/\./g, "").replace(",", ".");
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0) { amount = n.toFixed(2); amountRaw = m[1]; break; }
    }
  }
  // Fallback: número solto sem unidade (ex: "aluguel 2500 dia 10")
  // Remove contextos de data antes de buscar o número
  if (!amount) {
    const textSemData = text
      .replace(/\bdia\s+\d{1,2}\b/gi, " ")
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
    const m = textSemData.match(/\b(\d+(?:[.,]\d{1,2})?)\b/);
    if (m) {
      const raw = m[1].replace(",", ".");
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0) { amount = n.toFixed(2); amountRaw = m[1]; }
    }
  }

  // Due date
  let due_date = todayStr();
  const nd = new Date();
  if (/amanha/.test(lower) || /amanhã/.test(lower)) {
    nd.setDate(nd.getDate() + 1); due_date = nd.toISOString().split("T")[0];
  } else if (/proximo\s*mes/.test(lower) || /próximo\s*mês/.test(lower)) {
    nd.setMonth(nd.getMonth() + 1); due_date = nd.toISOString().split("T")[0];
  } else {
    const dayM  = lower.match(/\bdia\s+(\d{1,2})\b/);
    const slashM = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dayM) {
      const d2 = new Date(); d2.setDate(parseInt(dayM[1]));
      if (d2 < new Date()) d2.setMonth(d2.getMonth() + 1);
      due_date = d2.toISOString().split("T")[0];
    } else if (slashM) {
      const yr = slashM[3] ? parseInt(slashM[3]) : new Date().getFullYear();
      const d2 = new Date(yr < 100 ? 2000 + yr : yr, parseInt(slashM[2]) - 1, parseInt(slashM[1]));
      due_date = d2.toISOString().split("T")[0];
    }
  }

  // Category
  let category = "outros";
  let maxScore = 0;
  for (const cat of CATS) {
    if (cat.key === "outros") continue;
    const score = cat.keywords.reduce((s, kw) => s + (lower.includes(norm(kw)) ? 2 : 0), 0);
    if (score > maxScore) { maxScore = score; category = cat.key; }
  }

  // Description (strip amount, date tokens)
  let description = text
    .replace(/r\$\s*[\d.,]+/gi, "")
    .replace(/[\d.,]+\s*(?:reais?|brl|real|conto|pila)/gi, "")
    .replace(/\bdia\s+\d{1,2}\b/gi, "")
    .replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, "")
    .replace(/próximo\s*mês/gi, "").replace(/proximo\s*mes/gi, "")
    .replace(/amanhã/gi, "").replace(/amanha/gi, "")
    .replace(/[,;]\s*$/, "").replace(/\s+/g, " ").trim();
  // Remove número solto capturado pelo fallback (não coberto pelos replaces acima)
  if (amountRaw) {
    const escaped = amountRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    description = description.replace(new RegExp(`\\b${escaped}\\b`), "").replace(/\s+/g, " ").trim();
  }
  if (!description) description = text.trim();

  return { description, amount, due_date, category };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccountsPayablePage() {
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
  const [userId,  setUserId]  = useState<string | null>(null);
  const [bills,   setBills]   = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<"bills" | "reports">("bills");

  // Quick input
  const [quickText,     setQuickText]     = useState("");
  const [quickSaving,   setQuickSaving]   = useState(false);
  const [listening,     setListening]     = useState(false);
  const [quickFeedback, setQuickFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const recogRef = useRef<any>(null);

  // Filters
  const [search,    setSearch]    = useState("");
  const [statusF,   setStatusF]   = useState("all");
  const [categoryF, setCategoryF] = useState("all");
  const [periodF,   setPeriodF]   = useState("month");

  // Full form modal
  const [showFull,   setShowFull]   = useState(false);
  const [editBill,   setEditBill]   = useState<Bill | null>(null);
  const [form,       setForm]       = useState<BillForm>(defaultForm());
  const [formSaving, setFormSaving] = useState(false);

  // Partial payment modal
  const [payModal,  setPayModal]  = useState<Bill | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("pix");
  const [payDate,   setPayDate]   = useState(todayStr());
  const [paySaving, setPaySaving] = useState(false);

  // Inline category dropdown
  const [editCatId,       setEditCatId]       = useState<string | null>(null);
  const [inlineNewCat,    setInlineNewCat]     = useState("");

  // Custom category for form modal
  const [showNewCatInput, setShowNewCatInput]  = useState(false);
  const [newCatText,      setNewCatText]       = useState("");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Custom categories derived from existing bills
  const customCats = useMemo(() => {
    const standard = new Set(CATS.map(c => c.key));
    const found = [...new Set(bills.map(b => b.category).filter(c => !standard.has(c)))];
    return found.map(k => ({ key: k, label: k.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()), color: "#a78bfa" }));
  }, [bills]);

  // ── Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user) setUserId(data.user.id); });
  }, []);

  // ── Load
  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("accounts_payable")
      .select("*").eq("user_id", userId).order("due_date", { ascending: true });
    if (data) {
      const now = todayStr();
      setBills((data as Bill[]).map(b => ({
        ...b,
        status: b.status === "pending" && b.due_date < now ? "overdue" : b.status,
      })));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId) { setLoading(true); load(); }
  }, [userId, load]);

  // ── Filtered list
  const filtered = useMemo(() => {
    const now = new Date();
    return bills.filter(b => {
      if (search && !b.description.toLowerCase().includes(search.toLowerCase()) &&
          !(b.supplier?.toLowerCase().includes(search.toLowerCase()))) return false;
      if (statusF !== "all" && b.status !== statusF) return false;
      if (categoryF !== "all" && b.category !== categoryF) return false;
      if (periodF !== "all") {
        const due = new Date(b.due_date + "T12:00:00");
        if (periodF === "today") { if (b.due_date !== todayStr()) return false; }
        else if (periodF === "week") {
          const start = new Date(now); start.setDate(start.getDate() - start.getDay());
          const end   = new Date(start); end.setDate(end.getDate() + 6);
          if (due < start || due > end) return false;
        } else if (periodF === "month") {
          if (due.getMonth() !== now.getMonth() || due.getFullYear() !== now.getFullYear()) return false;
        } else if (periodF === "overdue") {
          if (b.status !== "overdue") return false;
        }
      }
      return true;
    });
  }, [bills, search, statusF, categoryF, periodF]);

  // ── Summary cards
  const summary = useMemo(() => {
    const now = new Date();
    let relevantBills = bills;

    // Apply period filter to summary
    if (periodF !== "all") {
      relevantBills = bills.filter(b => {
        const due = new Date(b.due_date + "T12:00:00");
        if (periodF === "today") { return b.due_date === todayStr(); }
        else if (periodF === "week") {
          const start = new Date(now); start.setDate(start.getDate() - start.getDay());
          const end   = new Date(start); end.setDate(end.getDate() + 6);
          return due >= start && due <= end;
        } else if (periodF === "month") {
          return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
        } else if (periodF === "overdue") {
          return b.status === "overdue";
        }
        return true;
      });
    }

    return {
      total:   relevantBills.reduce((s, b) => s + finalAmt(b), 0),
      pending: relevantBills.filter(b => b.status === "pending" || b.status === "overdue").reduce((s, b) => s + finalAmt(b), 0),
      paid:    relevantBills.filter(b => b.status === "paid" || b.status === "partial").reduce((s, b) => s + (b.paid_amount || finalAmt(b)), 0),
      overdue: bills.filter(b => b.status === "overdue").reduce((s, b) => s + finalAmt(b), 0),
      overdueCount: bills.filter(b => b.status === "overdue").length,
    };
  }, [bills, periodF]);

  // ── Report data
  const reportByCat = useMemo(() => {
    const now = new Date();
    const map: Record<string, number> = {};
    bills.filter(b => {
      const d = new Date(b.due_date + "T12:00:00");
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).forEach(b => { map[b.category] = (map[b.category] || 0) + finalAmt(b); });
    return CATS.filter(c => map[c.key]).map(c => ({ name: c.label, value: map[c.key], color: c.color }));
  }, [bills]);

  const reportBySupplier = useMemo(() => {
    const now = new Date();
    const map: Record<string, number> = {};
    bills.filter(b => {
      const d = new Date(b.due_date + "T12:00:00");
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && b.supplier;
    }).forEach(b => { if (b.supplier) map[b.supplier] = (map[b.supplier] || 0) + finalAmt(b); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));
  }, [bills]);

  // ── Voice input
  function toggleVoice() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      alert("Reconhecimento de voz requer Chrome ou Edge."); return;
    }
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.lang = "pt-BR"; r.continuous = false; r.interimResults = false;
    r.onresult = (e: any) => { setQuickText(e.results[0][0].transcript); setListening(false); };
    r.onerror  = () => setListening(false);
    r.onend    = () => setListening(false);
    r.start(); recogRef.current = r; setListening(true);
  }

  // ── Quick save
  async function submitQuick() {
    if (!quickText.trim() || !userId || quickSaving) return;
    setQuickSaving(true);
    const parsed = parseQuickInput(quickText.trim());
    if (!parsed.amount) {
      setQuickFeedback({ ok: false, text: "Não identifiquei o valor. Ex: 'mercado 150 reais' ou 'aluguel 2500 dia 10'" });
      setQuickSaving(false);
      setTimeout(() => setQuickFeedback(null), 5000);
      return;
    }
    const { data, error } = await supabase.from("accounts_payable").insert({
      user_id: userId, description: parsed.description, category: parsed.category,
      amount: parseFloat(parsed.amount), due_date: parsed.due_date,
      discount: 0, interest: 0, fine: 0, paid_amount: 0,
      status: parsed.due_date < todayStr() ? "overdue" : "pending",
      recurrence: "none", quick_input: quickText.trim(),
    }).select("*").single();
    setQuickSaving(false);
    if (error || !data) {
      setQuickFeedback({ ok: false, text: "Erro ao salvar: " + (error?.message ?? "") });
    } else {
      const cat = catOf(parsed.category);
      setQuickFeedback({ ok: true, text: `✓  ${parsed.description}  ·  ${fmt(parseFloat(parsed.amount))}  ·  ${cat.label}  ·  Venc: ${fmtD(parsed.due_date)}` });
      setBills(prev => [data as Bill, ...prev]);
      setQuickText("");
    }
    setTimeout(() => setQuickFeedback(null), 6000);
  }

  // ── Full form
  function openNew() { setEditBill(null); setForm(defaultForm()); setShowFull(true); }
  function openEdit(b: Bill) {
    setEditBill(b);
    setForm({
      description: b.description, supplier: b.supplier ?? "", category: b.category,
      cost_center: b.cost_center ?? "", document_number: b.document_number ?? "",
      competence_date: b.competence_date ?? "", due_date: b.due_date,
      amount: b.amount.toFixed(2), discount: b.discount.toFixed(2),
      interest: b.interest.toFixed(2), fine: b.fine.toFixed(2),
      payment_method: b.payment_method ?? "", bank_account: b.bank_account ?? "",
      installments: b.total_installments?.toString() ?? "1", recurrence: b.recurrence,
      notes: b.notes ?? "", tags: (b.tags ?? []).join(", "), status: b.status,
    });
    setShowFull(true);
  }

  async function saveForm() {
    if (!userId || !form.description || !form.amount || !form.due_date) return;
    setFormSaving(true);
    const amt   = parseFloat(form.amount)   || 0;
    const disc  = parseFloat(form.discount) || 0;
    const intr  = parseFloat(form.interest) || 0;
    const fine  = parseFloat(form.fine)     || 0;
    const installN = parseInt(form.installments) || 1;
    const tags  = form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : null;
    const base  = {
      user_id: userId, description: form.description, supplier: form.supplier || null,
      category: form.category, cost_center: form.cost_center || null,
      document_number: form.document_number || null, competence_date: form.competence_date || null,
      amount: amt, discount: disc, interest: intr, fine, paid_amount: 0,
      status: form.status, payment_method: form.payment_method || null,
      bank_account: form.bank_account || null, recurrence: form.recurrence,
      notes: form.notes || null, tags: tags?.length ? tags : null,
    };

    if (editBill) {
      const { data } = await supabase.from("accounts_payable")
        .update({ ...base, updated_at: new Date().toISOString() })
        .eq("id", editBill.id).select("*").single();
      if (data) setBills(prev => prev.map(b => b.id === editBill.id ? data as Bill : b));
    } else if (installN > 1) {
      const groupId = crypto.randomUUID();
      const rows = Array.from({ length: installN }, (_, i) => {
        const d = new Date(form.due_date + "T12:00:00"); d.setMonth(d.getMonth() + i);
        return { ...base, installment_number: i + 1, total_installments: installN,
          installment_group_id: groupId, due_date: d.toISOString().split("T")[0],
          amount: Math.round((amt / installN) * 100) / 100 };
      });
      const { data } = await supabase.from("accounts_payable").insert(rows).select("*");
      if (data) setBills(prev => [...(data as Bill[]), ...prev]);
    } else {
      const { data } = await supabase.from("accounts_payable")
        .insert({ ...base, due_date: form.due_date }).select("*").single();
      if (data) setBills(prev => [data as Bill, ...prev]);
    }
    setFormSaving(false); setShowFull(false);
  }

  // ── Actions
  async function markPaid(b: Bill) {
    const { data } = await supabase.from("accounts_payable")
      .update({ status: "paid", paid_date: todayStr(), paid_amount: finalAmt(b), updated_at: new Date().toISOString() })
      .eq("id", b.id).select("*").single();
    if (data) setBills(prev => prev.map(x => x.id === b.id ? data as Bill : x));
  }

  async function savePartial() {
    if (!payModal || !payAmount) return;
    setPaySaving(true);
    const paid  = parseFloat(payAmount);
    const total = finalAmt(payModal);
    const { data } = await supabase.from("accounts_payable")
      .update({ status: paid >= total ? "paid" : "partial", paid_amount: paid,
        paid_date: payDate, payment_method: payMethod, updated_at: new Date().toISOString() })
      .eq("id", payModal.id).select("*").single();
    if (data) setBills(prev => prev.map(x => x.id === payModal.id ? data as Bill : x));
    setPaySaving(false); setPayModal(null); setPayAmount("");
  }

  async function cancelBill(b: Bill) {
    const { data } = await supabase.from("accounts_payable")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", b.id).select("*").single();
    if (data) setBills(prev => prev.map(x => x.id === b.id ? data as Bill : x));
  }

  async function deleteBill(b: Bill) {
    if (!confirm(`Excluir "${b.description}"?`)) return;
    await supabase.from("accounts_payable").delete().eq("id", b.id);
    setBills(prev => prev.filter(x => x.id !== b.id));
  }

  async function updateCategory(id: string, category: string) {
    await supabase.from("accounts_payable").update({ category }).eq("id", id);
    setBills(prev => prev.map(b => b.id === id ? { ...b, category } : b));
    setEditCatId(null);
  }

  async function bulkPay() {
    if (!selected.size || !confirm(`Marcar ${selected.size} conta(s) como pagas?`)) return;
    const now = todayStr();
    await Promise.all([...selected].map(id => {
      const b = bills.find(x => x.id === id); if (!b) return;
      return supabase.from("accounts_payable")
        .update({ status: "paid", paid_date: now, paid_amount: finalAmt(b), updated_at: new Date().toISOString() })
        .eq("id", id);
    }));
    setBills(prev => prev.map(b => selected.has(b.id)
      ? { ...b, status: "paid", paid_date: now, paid_amount: finalAmt(b) } : b));
    setSelected(new Set());
  }

  const toggleSelect = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const inp = "w-full px-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 transition-all";
  const formFinal = (parseFloat(form.amount)||0) - (parseFloat(form.discount)||0) + (parseFloat(form.interest)||0) + (parseFloat(form.fine)||0);
  const installN  = parseInt(form.installments) || 1;

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl p-6"
        style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
          backgroundImage:"radial-gradient(rgba(249,115,22,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-orange-900/10 to-transparent pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl border border-zinc-700" style={{background:"rgba(249,115,22,0.15)",boxShadow:"0 0 16px rgba(249,115,22,0.2)"}}>
              <Wallet className="w-6 h-6" style={{color:"#f97316"}} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{background:"#f97316",boxShadow:"0 0 6px #f97316"}} />
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#f97316"}}>Financeiro</span>
              </div>
              <h1 className="text-2xl font-black"
                className="g-text g-text-orange">
                Contas a Pagar
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">Gerencie suas despesas com lançamento inteligente por voz ou texto</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all">
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
            <button onClick={openNew}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
              style={{background:"linear-gradient(135deg,#d97706,#f59e0b)",color:"#000",boxShadow:"0 0 14px rgba(245,158,11,0.3)"}}>
              <Plus className="w-3.5 h-3.5" /> Lançamento Completo
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(() => {
          const totalLabel = periodF === "all" ? "Total Geral"
            : periodF === "today" ? "Total de Hoje"
            : periodF === "week" ? "Total da Semana"
            : periodF === "month" ? "Total do Mês"
            : periodF === "overdue" ? "Total Vencido"
            : "Total do Mês";
          return [
          { label: totalLabel,       value:fmt(summary.total),      gFrom:"#f97316", gTo:"#fb923c", glow:"rgba(249,115,22,0.15)",  sub:"todas as contas"      },
          { label:"A Pagar",         value:fmt(summary.pending),    gFrom:"#f59e0b", gTo:"#fbbf24", glow:"rgba(245,158,11,0.15)",  sub:"em aberto e vencidos" },
          { label:"Pago no Mês",     value:fmt(summary.paid),       gFrom:"#10b981", gTo:"#34d399", glow:"rgba(16,185,129,0.15)",  sub:"liquidado"            },
          { label:"Contas Vencidas", value:fmt(summary.overdue),    gFrom:"#f43f5e", gTo:"#fb7185", glow:"rgba(244,63,94,0.15)",   sub:"títulos em atraso"    },
        ].map(s => (
          <div key={s.label} className="relative overflow-hidden rounded-2xl p-5 cursor-default"
            style={isLight ? {
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
            } : {
              background: card.bg, border: card.border,
              boxShadow: `0 0 24px ${s.glow}`,
            }}>
            {isLight
              ? <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${s.gFrom},${s.gTo})`, borderRadius:"12px 12px 0 0" }} />
              : <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-20 blur-2xl pointer-events-none" style={{ background: s.gFrom }} />
            }
            <div className="relative z-10">
              <span className="block text-[11px] font-semibold uppercase tracking-widest" style={{ color: isLight ? "#9CA3AF" : "#71717a" }}>{s.label}</span>
              <div className="text-xl font-black tabular-nums mt-2">
                <span style={isLight
                  ? { background:`linear-gradient(135deg,${s.gFrom},${s.gTo})`, WebkitBackgroundClip:"text", display:"inline-block", WebkitTextFillColor:"transparent", backgroundClip:"text" }
                  : { color: s.gFrom }}>
                  {s.value}
                </span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>{s.sub}</p>
            </div>
          </div>
        ));})()}
      </div>

      {/* ── Quick Input Bar ── */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{color:"#f59e0b"}} />
          <p className="text-sm font-bold">Lançamento Rápido com IA</p>
          <span className="text-[11px] text-zinc-500">— fale ou escreva naturalmente, pressione Enter</span>
        </div>

        <div className="flex gap-2">
          <button onClick={toggleVoice}
            className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center transition-all ${listening ? "animate-pulse" : ""}`}
            style={listening
              ? {background:"rgba(244,63,94,0.2)",border:"1px solid rgba(244,63,94,0.5)",color:"#f43f5e"}
              : {background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.35)",color:"#f59e0b"}}>
            {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          <input
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitQuick()}
            placeholder='"mercado 250 reais"  ·  "aluguel 1500 dia 10"  ·  "conta de luz 180"  ·  "folha 8000 dia 5"'
            className="flex-1 px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 transition-all"
          />
          <button onClick={submitQuick} disabled={!quickText.trim() || quickSaving}
            className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center transition-all disabled:opacity-40"
            style={{background:"linear-gradient(135deg,#d97706,#f59e0b)",color:"#000",boxShadow:"0 0 12px rgba(245,158,11,0.25)"}}>
            {quickSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        {quickFeedback && (
          <div className="px-3 py-2 rounded-xl text-xs font-medium"
            style={quickFeedback.ok
              ? {background:"rgba(16,185,129,0.1)",color:"#10b981",border:"1px solid rgba(16,185,129,0.25)"}
              : {background:"rgba(244,63,94,0.1)",color:"#f43f5e",border:"1px solid rgba(244,63,94,0.25)"}}>
            {quickFeedback.text}
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 rounded-2xl p-1.5" style={{ background: isLight ? "#f3f4f6" : "rgba(24,24,27,0.8)", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
        {([
          { key: "bills"   as const, label: "Contas",      icon: <FileText  className="w-3.5 h-3.5" /> },
          { key: "reports" as const, label: "Relatórios",  icon: <BarChart2 className="w-3.5 h-3.5" /> },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex-1 justify-center"
            style={tab === t.key
              ? {background:"rgba(245,158,11,0.15)",color:"#f59e0b",boxShadow:"inset 0 0 0 1px rgba(245,158,11,0.3)"}
              : {color:"#71717a"}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ════ CONTAS TAB ════ */}
      <div className="space-y-3" style={{ display: tab === "bills" ? "block" : "none" }}>
          {/* Filters row */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar descrição ou fornecedor..."
                className="w-full pl-9 pr-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/60" />
            </div>
            <select value={periodF} onChange={e => setPeriodF(e.target.value)}
              className="px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500/60 cursor-pointer">
              <option value="all">Todos os períodos</option>
              <option value="today">Hoje</option>
              <option value="week">Esta semana</option>
              <option value="month">Este mês</option>
              <option value="overdue">Vencidos</option>
            </select>
            <select value={statusF} onChange={e => setStatusF(e.target.value)}
              className="px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500/60 cursor-pointer">
              <option value="all">Todos os status</option>
              {(Object.entries(STATUS_CFG) as [BillStatus, typeof STATUS_CFG[BillStatus]][]).map(([k, v]) =>
                <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={categoryF} onChange={e => setCategoryF(e.target.value)}
              className="px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500/60 cursor-pointer">
              <option value="all">Todas as categorias</option>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {selected.size > 0 && (
              <button onClick={bulkPay}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all"
                style={{background:"rgba(16,185,129,0.15)",color:"#10b981",border:"1px solid rgba(16,185,129,0.3)"}}>
                <Check className="w-3.5 h-3.5" /> Baixar {selected.size} selecionado{selected.size > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Overdue alert banner */}
          {summary.overdueCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border"
              style={{background:"rgba(244,63,94,0.08)",borderColor:"rgba(244,63,94,0.35)"}}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" style={{color:"#f43f5e"}} />
              <p className="text-sm font-semibold" style={{color:"#f43f5e"}}>
                {summary.overdueCount} conta{summary.overdueCount > 1 ? "s" : ""} vencida{summary.overdueCount > 1 ? "s" : ""} em atraso
              </p>
              <button onClick={() => { setStatusF("all"); setPeriodF("overdue"); }}
                className="ml-auto text-xs font-bold underline" style={{color:"#f43f5e"}}>
                Ver todas
              </button>
            </div>
          )}

          {/* Bill list */}
          {loading ? (
            <div className="text-center py-16 text-zinc-500 text-sm">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-zinc-700" />
              Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
              <Wallet className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">Nenhuma conta encontrada.</p>
              <p className="text-zinc-600 text-xs mt-1">Use o lançamento rápido acima ou clique em "Lançamento Completo".</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(b => {
                const sc  = STATUS_CFG[b.status];
                const cat = catOf(b.category);
                const fin = finalAmt(b);
                const sel = selected.has(b.id);

                return (
                  <div key={b.id}
                    className="rounded-2xl p-4 flex gap-3 items-start transition-all"
                    style={{ background: card.bg, border: sel ? "1px solid rgba(245,158,11,0.4)" : card.border, boxShadow: card.shadow }}>

                    {/* Checkbox */}
                    <button onClick={() => toggleSelect(b.id)}
                      className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                      style={sel
                        ? {background:"rgba(245,158,11,0.2)",border:"1px solid rgba(245,158,11,0.5)"}
                        : isLight ? {background:"#f3f4f6",border:"1px solid #d1d5db"} : {background:"#27272a",border:"1px solid #3f3f46"}}>
                      {sel && <Check className="w-3 h-3 text-amber-400" />}
                    </button>

                    {/* Category dot */}
                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{background: cat.color}} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Descrição */}
                      <div className="mb-2">
                        <p className="font-semibold text-sm text-white truncate">{b.description}</p>
                        {b.supplier && <p className="text-xs text-zinc-500">{b.supplier}</p>}
                      </div>

                      {/* Divisor */}
                      <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", marginBottom: "8px" }} />

                      {/* Status, Datas e Valor */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg"
                          style={{background: sc.bg, color: sc.color, border:`1px solid ${sc.border}`}}>
                          {sc.label}
                        </span>
                        <span className="text-[11px] text-zinc-500">Venc: {fmtD(b.due_date)}</span>
                        {b.paid_date && <span className="text-[11px] text-zinc-600">Pago: {fmtD(b.paid_date)}</span>}

                        {/* Category badge — click to edit */}
                        <div className="relative">
                          <button onClick={() => setEditCatId(editCatId === b.id ? null : b.id)}
                            className="text-[11px] px-2 py-0.5 rounded-lg flex items-center gap-1 transition-all hover:opacity-80"
                            style={{background:`${cat.color}20`,color:cat.color,border:`1px solid ${cat.color}40`}}>
                            {cat.label} <ChevronDown className="w-3 h-3" />
                          </button>
                          {editCatId === b.id && (
                            <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden w-52">
                              <div className="max-h-56 overflow-y-auto">
                                {CATS.map(c => (
                                  <button key={c.key} onClick={() => { updateCategory(b.id, c.key); setInlineNewCat(""); }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 transition-colors flex items-center gap-2"
                                    style={{color: c.color}}>
                                    <div className="w-2 h-2 rounded-full" style={{background: c.color}} />
                                    {c.label}
                                    {b.category === c.key && <Check className="w-3 h-3 ml-auto" />}
                                  </button>
                                ))}
                                {customCats.map(c => (
                                  <button key={c.key} onClick={() => { updateCategory(b.id, c.key); setInlineNewCat(""); }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 transition-colors flex items-center gap-2"
                                    style={{color: c.color}}>
                                    <div className="w-2 h-2 rounded-full" style={{background: c.color}} />
                                    {c.label} ★
                                    {b.category === c.key && <Check className="w-3 h-3 ml-auto" />}
                                  </button>
                                ))}
                              </div>
                              <div className="border-t border-zinc-800 p-2">
                                <input
                                  value={inlineNewCat}
                                  onChange={e => setInlineNewCat(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter" && inlineNewCat.trim()) {
                                      const slug = inlineNewCat.toLowerCase().trim().replace(/\s+/g, "_");
                                      updateCategory(b.id, slug);
                                      setInlineNewCat("");
                                    }
                                  }}
                                  placeholder="Nova categoria... (Enter)"
                                  className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {b.installment_number && b.total_installments && (
                          <span className="text-[11px] text-zinc-600">{b.installment_number}/{b.total_installments}</span>
                        )}
                        {b.recurrence !== "none" && (
                          <Repeat className="w-3 h-3 text-zinc-600" title="Recorrente" />
                        )}
                        {b.cost_center && (
                          <span className="text-[11px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">{b.cost_center}</span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {(b.status === "pending" || b.status === "overdue") && (
                        <>
                          <button onClick={() => markPaid(b)} title="Marcar como pago"
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-zinc-800"
                            style={{color:"#10b981"}}>
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => { setPayModal(b); setPayAmount(finalAmt(b).toFixed(2)); setPayDate(todayStr()); }}
                            title="Pagamento parcial"
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-zinc-800"
                            style={{color:"#06b6d4"}}>
                            <DollarSign className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button onClick={() => openEdit(b)} title="Editar"
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-zinc-800 text-zinc-400 hover:text-white">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {b.status !== "cancelled" && b.status !== "paid" && (
                        <button onClick={() => cancelBill(b)} title="Cancelar"
                          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-zinc-800 text-zinc-600 hover:text-amber-400">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => deleteBill(b)} title="Excluir"
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-zinc-800 text-zinc-600 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* ════ RELATÓRIOS TAB ════ */}
      <div className="space-y-5" style={{ display: tab === "reports" ? "block" : "none" }}>
          <div className="rounded-2xl p-5" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
            <p className="text-sm font-bold mb-4">Gastos por Categoria — Este Mês</p>
            {reportByCat.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-10">Sem dados para este mês.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={reportByCat} margin={{top:0,right:0,left:0,bottom:0}}>
                  <XAxis dataKey="name" tick={{fontSize:11,fill:"#71717a"}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fontSize:10,fill:"#71717a"}} axisLine={false} tickLine={false}
                    tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} width={48} />
                  <Tooltip
                    formatter={(v: number) => [fmt(v), "Total"]}
                    contentStyle={{background:"#18181b",border:"1px solid #3f3f46",borderRadius:12,fontSize:12}} />
                  <Bar dataKey="value" radius={[6,6,0,0]} isAnimationActive={false}>
                    {reportByCat.map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-2xl p-5" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
            <p className="text-sm font-bold mb-4">Top Fornecedores — Este Mês</p>
            {reportBySupplier.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-10">Nenhum fornecedor cadastrado este mês.</p>
            ) : (
              <div className="space-y-3">
                {reportBySupplier.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-zinc-600 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                      <div className="h-2 rounded-full transition-all" style={{
                        width: `${(s.value / reportBySupplier[0].value * 100).toFixed(0)}%`,
                        background: "linear-gradient(90deg,#d97706,#f59e0b)"
                      }} />
                    </div>
                    <span className="text-xs text-zinc-300 flex-shrink-0 w-36 truncate">{s.name}</span>
                    <span className="text-xs font-bold text-amber-400 flex-shrink-0 w-24 text-right">{fmt(s.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>

      {/* ════ PARTIAL PAYMENT MODAL ════ */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setPayModal(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-zinc-800">
              <h3 className="font-bold text-base">Registrar Pagamento</h3>
              <button onClick={() => setPayModal(null)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-zinc-950 rounded-xl">
                <p className="text-sm font-semibold">{payModal.description}</p>
                <p className="text-xs text-zinc-500 mt-0.5">Total: {fmt(finalAmt(payModal))}</p>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Valor pago (R$)</label>
                <input type="number" step="0.01" value={payAmount}
                  onChange={e => setPayAmount(e.target.value)} className={inp} placeholder="0,00" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Forma de pagamento</label>
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className={inp}>
                  {PAY_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Data do pagamento</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inp} />
              </div>
              <button onClick={savePartial} disabled={!payAmount || paySaving}
                className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                style={{background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",boxShadow:"0 0 14px rgba(16,185,129,0.3)"}}>
                {paySaving ? "Salvando..." : "Confirmar Pagamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ FULL FORM MODAL ════ */}
      {showFull && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col" style={{maxHeight:"92vh"}}>
            <div className="flex items-center justify-between p-5 border-b border-zinc-800 flex-shrink-0">
              <h3 className="font-bold text-base">{editBill ? "Editar Conta" : "Nova Conta — Formulário Completo"}</h3>
              <button onClick={() => setShowFull(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Identificação */}
              <section>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Identificação</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-zinc-500 mb-1 block">Descrição *</label>
                    <input value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
                      className={inp} placeholder="Ex: Aluguel da loja, Conta de energia..." />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Fornecedor</label>
                    <input value={form.supplier} onChange={e => setForm(f => ({...f, supplier: e.target.value}))}
                      className={inp} placeholder="Nome do fornecedor" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Nº Documento (NF, boleto...)</label>
                    <input value={form.document_number} onChange={e => setForm(f => ({...f, document_number: e.target.value}))}
                      className={inp} placeholder="NF-0001, boleto 2024..." />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Categoria</label>
                    <select
                      value={showNewCatInput ? "__new__" : form.category}
                      onChange={e => {
                        if (e.target.value === "__new__") { setShowNewCatInput(true); setNewCatText(""); }
                        else { setShowNewCatInput(false); setForm(f => ({...f, category: e.target.value})); }
                      }}
                      className={inp}>
                      <optgroup label="Categorias padrão">
                        {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </optgroup>
                      {customCats.length > 0 && (
                        <optgroup label="Minhas categorias">
                          {customCats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </optgroup>
                      )}
                      <option value="__new__">✚ Nova categoria...</option>
                    </select>
                    {showNewCatInput && (
                      <input
                        autoFocus
                        value={newCatText}
                        onChange={e => {
                          setNewCatText(e.target.value);
                          const slug = e.target.value.toLowerCase().trim().replace(/\s+/g, "_");
                          setForm(f => ({...f, category: slug || "outros"}));
                        }}
                        placeholder="Ex: Insumos, Material de Limpeza..."
                        className={inp + " mt-2"}
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Centro de Custo</label>
                    <input value={form.cost_center} onChange={e => setForm(f => ({...f, cost_center: e.target.value}))}
                      className={inp} placeholder="Ex: Loja 1, Matriz, Online..." />
                  </div>
                </div>
              </section>

              {/* Datas */}
              <section>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Datas</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Data de Competência</label>
                    <input type="date" value={form.competence_date}
                      onChange={e => setForm(f => ({...f, competence_date: e.target.value}))} className={inp} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Data de Vencimento *</label>
                    <input type="date" value={form.due_date}
                      onChange={e => setForm(f => ({...f, due_date: e.target.value}))} className={inp} />
                  </div>
                </div>
              </section>

              {/* Valores */}
              <section>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Valores</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Valor Original *</label>
                    <input type="number" step="0.01" min="0" value={form.amount}
                      onChange={e => setForm(f => ({...f, amount: e.target.value}))} className={inp} placeholder="0,00" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Desconto (R$)</label>
                    <input type="number" step="0.01" min="0" value={form.discount}
                      onChange={e => setForm(f => ({...f, discount: e.target.value}))} className={inp} placeholder="0,00" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Juros (R$)</label>
                    <input type="number" step="0.01" min="0" value={form.interest}
                      onChange={e => setForm(f => ({...f, interest: e.target.value}))} className={inp} placeholder="0,00" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Multa (R$)</label>
                    <input type="number" step="0.01" min="0" value={form.fine}
                      onChange={e => setForm(f => ({...f, fine: e.target.value}))} className={inp} placeholder="0,00" />
                  </div>
                  <div className="col-span-2">
                    <div className="flex justify-between items-center px-4 py-3 rounded-xl"
                      style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)"}}>
                      <span className="text-sm font-semibold text-zinc-300">Valor Final Calculado</span>
                      <span className="text-xl font-black" style={{color:"#f59e0b"}}>{fmt(formFinal)}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Pagamento */}
              <section>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Pagamento</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Forma de Pagamento</label>
                    <select value={form.payment_method}
                      onChange={e => setForm(f => ({...f, payment_method: e.target.value}))} className={inp}>
                      <option value="">Selecione...</option>
                      {PAY_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Conta Bancária</label>
                    <input value={form.bank_account}
                      onChange={e => setForm(f => ({...f, bank_account: e.target.value}))}
                      className={inp} placeholder="Ex: Bradesco, Nubank..." />
                  </div>
                </div>
              </section>

              {/* Parcelamento & Recorrência */}
              {!editBill && (
                <section>
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Parcelamento & Recorrência</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Número de parcelas</label>
                      <input type="number" min="1" max="60" value={form.installments}
                        onChange={e => setForm(f => ({...f, installments: e.target.value}))} className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Recorrência fixa</label>
                      <select value={form.recurrence}
                        onChange={e => setForm(f => ({...f, recurrence: e.target.value}))} className={inp}>
                        <option value="none">Sem recorrência</option>
                        <option value="weekly">Semanal</option>
                        <option value="monthly">Mensal</option>
                        <option value="yearly">Anual</option>
                      </select>
                    </div>
                    {installN > 1 && form.amount && (
                      <div className="col-span-2 p-3 rounded-xl space-y-1.5"
                        style={{background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.2)"}}>
                        <p className="text-xs text-zinc-500 font-semibold mb-2">Prévia das parcelas ({form.installments}x de {fmt((parseFloat(form.amount)||0) / installN)}):</p>
                        {Array.from({ length: Math.min(installN, 6) }, (_, i) => {
                          const d = new Date(form.due_date + "T12:00:00"); d.setMonth(d.getMonth() + i);
                          return (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-zinc-500">{i + 1}/{installN} · {d.toLocaleDateString("pt-BR")}</span>
                              <span className="text-amber-400 font-semibold">{fmt((parseFloat(form.amount)||0) / installN)}</span>
                            </div>
                          );
                        })}
                        {installN > 6 && <p className="text-[11px] text-zinc-600">... e mais {installN - 6} parcela{installN - 6 > 1 ? "s" : ""}</p>}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Status */}
              <section>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Status</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_CFG) as BillStatus[]).map(s => {
                    const sc = STATUS_CFG[s];
                    return (
                      <button key={s} onClick={() => setForm(f => ({...f, status: s}))}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                        style={form.status === s
                          ? {background: sc.bg, color: sc.color, border:`1px solid ${sc.border}`}
                          : isLight ? {background:"#f9fafb", color:"#6b7280", border:"1px solid #e5e7eb"} : {background:"#27272a", color:"#52525b", border:"1px solid #3f3f46"}}>
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Notes & Tags */}
              <section className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Observações internas</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                    className={inp + " resize-none"} rows={3} placeholder="Notas internas..." />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Tags (separadas por vírgula)</label>
                  <input value={form.tags} onChange={e => setForm(f => ({...f, tags: e.target.value}))}
                    className={inp} placeholder="urgente, mensal, fixo, custo-variavel..." />
                  <p className="text-[11px] text-zinc-600 mt-1.5">Ex: urgente, mensal, fixo</p>
                </div>
              </section>
            </div>

            <div className="p-5 border-t border-zinc-800 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowFull(false)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all">
                Cancelar
              </button>
              <button onClick={saveForm}
                disabled={!form.description || !form.amount || !form.due_date || formSaving}
                className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                style={{background:"linear-gradient(135deg,#d97706,#f59e0b)",color:"#000",boxShadow:"0 0 14px rgba(245,158,11,0.3)"}}>
                {formSaving ? "Salvando..." : editBill ? "Salvar Alterações" : installN > 1 ? `Gerar ${installN} Parcelas` : "Salvar Conta"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
