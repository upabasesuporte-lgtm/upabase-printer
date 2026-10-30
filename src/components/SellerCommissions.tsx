// Comissão e metas por vendedor (Relatórios → Vendedores). Base da comissão:
// total da venda sem taxa de entrega e sem taxa de serviço, menos as trocas/
// devoluções daquela venda. Meta é mensal.
import { useEffect, useMemo, useState } from "react";
import { Target, Settings2, Download, RefreshCw, X, Save, Percent } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { getSellers, getStoreSettings } from "../pages/settings";
import { loadJsPdf, savePdf } from "../lib/pdf";
import { useEscapeKey } from "../hooks/useEscapeKey";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); };
const parseNum = (s: string) => { const t = String(s).trim(); return parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0; };

interface Rule { pct?: number; goal?: number }
interface Row { name: string; orders: number; gross: number; returns: number; base: number; pct: number; commission: number; goal: number }

export function SellerCommissions({ isLight, card }: { isLight: boolean; card: { bg: string; border: string; shadow: string } }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const months = useMemo(() => { const out: string[] = []; const d = new Date(); d.setDate(1); for (let i = 0; i < 12; i++) { out.push(monthKey(d)); d.setMonth(d.getMonth() - 1); } return out; }, []);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [defPct, setDefPct] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadRules() {
    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? null;
    setUserId(uid);
    if (!uid) return;
    const { data } = await supabase.from("store_settings").select("seller_rules, commission_default_pct").eq("user_id", uid).maybeSingle();
    setRules((data?.seller_rules ?? {}) as Record<string, Rule>);
    setDefPct(Number(data?.commission_default_pct ?? 0));
  }
  useEffect(() => { loadRules(); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setRows(null);
      const [y, m] = month.split("-").map(Number);
      const from = new Date(y, m - 1, 1).toISOString(), to = new Date(y, m, 1).toISOString();
      const { data: sales } = await fetchAll(() => supabase.from("sales")
        .select("id, total_amount, delivery_fee, service_tax, seller_name")
        .eq("status", "paid").neq("origin", "fiado_payment").gte("created_at", from).lt("created_at", to));
      const list = (sales ?? []) as any[];
      const ids = list.filter(s => s.seller_name).map(s => s.id);
      const returnsBySale: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data: rets } = await supabase.from("sale_returns").select("sale_id, total").in("sale_id", ids.slice(i, i + 150));
        for (const r of (rets ?? []) as any[]) returnsBySale[r.sale_id] = (returnsBySale[r.sale_id] ?? 0) + Number(r.total);
      }
      const map: Record<string, { orders: number; gross: number; returns: number }> = {};
      for (const s of list) {
        if (!s.seller_name) continue;
        const x = (map[s.seller_name] ??= { orders: 0, gross: 0, returns: 0 });
        x.orders++;
        x.gross += Number(s.total_amount ?? 0) - Number(s.delivery_fee ?? 0) - Number(s.service_tax ?? 0);
        x.returns += returnsBySale[s.id] ?? 0;
      }
      // Vendedores cadastrados aparecem mesmo sem venda (para ver a meta)
      for (const n of getSellers()) map[n] ??= { orders: 0, gross: 0, returns: 0 };
      if (alive) setRows(Object.entries(map).map(([name, x]) => {
        const base = Math.max(0, x.gross - x.returns);
        const pct = rules[name]?.pct ?? defPct;
        return { name, ...x, base, pct, commission: Math.round(base * pct) / 100, goal: rules[name]?.goal ?? 0 };
      }).sort((a, b) => b.base - a.base));
    })();
    return () => { alive = false; };
  }, [month, rules, defPct]);

  const isCurrent = month === monthKey(new Date());
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayFrac = isCurrent ? now.getDate() / daysInMonth : 1;
  const totalCommission = (rows ?? []).reduce((s, r) => s + r.commission, 0);

  async function pdf() {
    if (!rows) return;
    setBusy(true);
    try {
      const JsPDF = await loadJsPdf();
      const store = getStoreSettings();
      const doc = new JsPDF({ unit: "mm", format: "a4" });
      const L = 14, R = 196; let y = 18;
      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(store.name || "Comissões", L, y); y += 7;
      doc.setFontSize(12); doc.text(`Comissões de ${monthLabel(month)}`, L, y); y += 10;
      const cols = [L, L + 50, L + 72, L + 104, L + 132, L + 150, R];
      doc.setFontSize(8.5); doc.setTextColor(110);
      ["VENDEDOR", "PEDIDOS", "VENDAS", "DEVOLUÇÕES", "BASE", "%", "COMISSÃO"].forEach((h, i) => doc.text(h, cols[i], y, i === 0 ? {} : { align: "right" }));
      doc.setTextColor(0); y += 2; doc.setDrawColor(200); doc.line(L, y, R, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      for (const r of rows.filter(r => r.orders > 0)) {
        if (y > 275) { doc.addPage(); y = 18; }
        doc.text(r.name, cols[0], y);
        doc.text(String(r.orders), cols[1], y, { align: "right" });
        doc.text(fmt(r.gross), cols[2], y, { align: "right" });
        doc.text(r.returns ? "-" + fmt(r.returns) : "—", cols[3], y, { align: "right" });
        doc.text(fmt(r.base), cols[4], y, { align: "right" });
        doc.text(`${String(r.pct).replace(".", ",")}%`, cols[5], y, { align: "right" });
        doc.setFont("helvetica", "bold"); doc.text(fmt(r.commission), cols[6], y, { align: "right" }); doc.setFont("helvetica", "normal");
        y += 7;
      }
      doc.setDrawColor(0); doc.line(L + 110, y - 3, R, y - 3); y += 3;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text("Total de comissões", L + 110, y); doc.text(fmt(totalCommission), R, y, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(110);
      doc.text("Base = vendas sem taxa de entrega e de serviço, menos trocas/devoluções.", L, y + 10);
      await savePdf(doc, `Comissoes ${monthLabel(month)}.pdf`);
    } catch { /* sem internet para o gerador de PDF */ }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
      <div className="flex items-center gap-2 flex-wrap">
        <Target className="w-4 h-4" style={{ color: "#d946ef" }} />
        <h2 className="text-sm font-bold flex-1">Comissão e metas do mês</h2>
        <select value={month} onChange={e => setMonth(e.target.value)} className={`px-3 py-1.5 rounded-xl text-sm border ${isLight ? "bg-white border-gray-200" : "bg-zinc-950 border-zinc-800"}`}>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button onClick={pdf} disabled={busy || !rows} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-zinc-700 disabled:opacity-50">
          {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
        </button>
        <button onClick={() => setShowCfg(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ background: "#d946ef", color: "#fff" }}>
          <Settings2 className="w-3.5 h-3.5" /> Comissões e metas
        </button>
      </div>

      {!rows ? (
        <div className="flex justify-center py-6"><RefreshCw className="w-5 h-5 animate-spin" style={{ color: "#d946ef" }} /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum vendedor cadastrado nem venda com vendedor em {monthLabel(month)}. Cadastre em Configurações → Vendedores e escolha o vendedor no PDV.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const pctGoal = r.goal > 0 ? Math.min(100, (r.base / r.goal) * 100) : 0;
            const expected = r.goal * dayFrac;
            const ahead = r.base >= expected;
            return (
              <div key={r.name} className={`rounded-xl p-3 ${isLight ? "bg-gray-50" : "bg-zinc-950"}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <p className="font-bold text-sm">{r.name}</p>
                    <p className="text-[11px] text-zinc-500">{r.orders} pedido{r.orders === 1 ? "" : "s"} · vendas {fmt(r.base)}{r.returns > 0 ? ` (−${fmt(r.returns)} devoluções)` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500">Comissão {String(r.pct).replace(".", ",")}%</p>
                    <p className="text-base font-black" style={{ color: "#d946ef" }}>{fmt(r.commission)}</p>
                  </div>
                </div>
                {r.goal > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-500">Meta {fmt(r.goal)}</span>
                      <span className={`font-semibold ${r.base >= r.goal ? "text-emerald-500" : isCurrent ? (ahead ? "text-emerald-500" : "text-amber-500") : "text-zinc-500"}`}>
                        {r.base >= r.goal ? "Meta batida! 🎉" : `${Math.round(pctGoal)}% · faltam ${fmt(r.goal - r.base)}${isCurrent ? (ahead ? " · no ritmo" : " · abaixo do ritmo") : ""}`}
                      </span>
                    </div>
                    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: isLight ? "#e5e7eb" : "#27272a" }}>
                      <div className="h-full rounded-full" style={{ width: `${pctGoal}%`, background: r.base >= r.goal ? "#10b981" : "linear-gradient(90deg,#d946ef,#8b5cf6)" }} />
                      {isCurrent && r.base < r.goal && <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${dayFrac * 100}%`, background: isLight ? "#111" : "#fff", opacity: 0.5 }} title="Onde deveria estar hoje" />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-between items-center pt-1 border-t border-zinc-800/40">
            <span className="text-sm text-zinc-500">Total de comissões</span>
            <span className="text-lg font-black">{fmt(totalCommission)}</span>
          </div>
          <p className="text-[11px] text-zinc-500">Base = vendas sem taxa de entrega e de serviço, menos trocas/devoluções. A marca na barra mostra onde a meta deveria estar hoje.</p>
        </div>
      )}

      {showCfg && userId && (
        <RulesModal userId={userId} isLight={isLight} names={[...new Set([...getSellers(), ...(rows ?? []).map(r => r.name)])]}
          rules={rules} defPct={defPct} onClose={() => setShowCfg(false)}
          onSaved={(r, d) => { setRules(r); setDefPct(d); setShowCfg(false); }} />
      )}
    </div>
  );
}

function RulesModal({ userId, isLight, names, rules, defPct, onClose, onSaved }: {
  userId: string; isLight: boolean; names: string[]; rules: Record<string, Rule>; defPct: number;
  onClose: () => void; onSaved: (rules: Record<string, Rule>, defPct: number) => void;
}) {
  useEscapeKey(onClose);
  const [def, setDef] = useState(String(defPct).replace(".", ","));
  const [draft, setDraft] = useState<Record<string, { pct: string; goal: string }>>(() =>
    Object.fromEntries(names.map(n => [n, { pct: rules[n]?.pct != null ? String(rules[n].pct).replace(".", ",") : "", goal: rules[n]?.goal ? String(rules[n].goal).replace(".", ",") : "" }])));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field = `px-3 py-2 rounded-xl text-sm border w-full ${isLight ? "bg-white border-gray-200" : "bg-zinc-950 border-zinc-800"}`;

  async function save() {
    setSaving(true); setErr(null);
    const out: Record<string, Rule> = { ...rules };
    for (const [n, v] of Object.entries(draft)) {
      const r: Rule = {};
      if (v.pct.trim() !== "") r.pct = Math.max(0, Math.min(100, parseNum(v.pct)));
      if (v.goal.trim() !== "") r.goal = Math.max(0, parseNum(v.goal));
      if (r.pct == null && !r.goal) delete out[n]; else out[n] = r;
    }
    const d = Math.max(0, Math.min(100, parseNum(def)));
    const { error } = await supabase.from("store_settings").upsert({ user_id: userId, seller_rules: out, commission_default_pct: d, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { setErr("Erro ao salvar: " + error.message); return; }
    onSaved(out, d);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}
        style={{ background: isLight ? "#fff" : "#18181b" }}>
        <div className="flex items-center gap-2">
          <Percent className="w-5 h-5" style={{ color: "#d946ef" }} />
          <h3 className="font-bold flex-1">Comissões e metas</h3>
          <button onClick={onClose} className="p-1 text-zinc-500"><X className="w-5 h-5" /></button>
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Comissão padrão (%)</p>
          <input inputMode="decimal" value={def} onChange={e => setDef(e.target.value)} className={field} />
          <p className="text-[11px] text-zinc-500 mt-1">Vale para quem não tiver uma % própria abaixo.</p>
        </div>
        {names.length === 0 ? (
          <p className="text-sm text-zinc-500">Cadastre os vendedores em Configurações → Vendedores.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_120px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 px-1">
              <span>Vendedor</span><span>%</span><span>Meta do mês (R$)</span>
            </div>
            {names.map(n => (
              <div key={n} className="grid grid-cols-[1fr_80px_120px] gap-2 items-center">
                <span className="text-sm font-semibold truncate">{n}</span>
                <input inputMode="decimal" value={draft[n]?.pct ?? ""} placeholder={def || "0"} onChange={e => setDraft(d => ({ ...d, [n]: { ...d[n], pct: e.target.value } }))} className={field} />
                <input inputMode="decimal" value={draft[n]?.goal ?? ""} placeholder="sem meta" onChange={e => setDraft(d => ({ ...d, [n]: { ...d[n], goal: e.target.value } }))} className={field} />
              </div>
            ))}
          </div>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button onClick={save} disabled={saving} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: "#d946ef", color: "#fff" }}>
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
        </button>
      </div>
    </div>
  );
}
