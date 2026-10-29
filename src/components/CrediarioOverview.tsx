// Clientes → Crediário: quem está com parcela atrasada e o que vence nos próximos 7 dias.
import { useEffect, useState } from "react";
import { RefreshCw, MessageCircle, ChevronRight, CheckCircle2 } from "lucide-react";
import { fetchDueInstallments, fetchRules, lateCharge, DEFAULT_RULES, todayIso, type InstallmentStatus, type CrediarioRules } from "../lib/crediario";
import { getStoreSettings } from "../pages/settings";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (iso: string) => iso.split("-").reverse().join("/");

interface Cust { id: string; name: string; phone: string | null }

export function CrediarioOverview({ customers, card, onOpen }: {
  customers: Cust[];
  card: { bg: string; border: string; shadow: string };
  onOpen: (customerId: string) => void;
}) {
  const [list, setList] = useState<InstallmentStatus[] | null>(null);
  const [rules, setRules] = useState<CrediarioRules>(DEFAULT_RULES);

  async function load() {
    setList(null);
    const d = new Date(); d.setDate(d.getDate() + 7);
    const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const [l, r] = await Promise.all([fetchDueInstallments(until), fetchRules()]);
      setList(l); setRules(r);
    } catch { setList([]); }
  }
  useEffect(() => { load(); }, []);

  const byCustomer = (rows: InstallmentStatus[]) => {
    const map: Record<string, InstallmentStatus[]> = {};
    for (const r of rows) (map[r.customer_id] ??= []).push(r);
    return Object.entries(map).map(([cid, items]) => ({
      cid, items, cust: customers.find(c => c.id === cid),
      total: items.reduce((s, i) => s + i.open + lateCharge(i, rules), 0),
      maxLate: Math.max(...items.map(i => i.daysLate)),
    }));
  };

  if (!list) return <div className="flex justify-center py-10"><RefreshCw className="w-5 h-5 animate-spin text-brand-600" /></div>;

  const today = todayIso();
  const late = byCustomer(list.filter(i => i.daysLate > 0)).sort((a, b) => b.maxLate - a.maxLate);
  const soon = byCustomer(list.filter(i => i.daysLate === 0 && i.due_date >= today)).sort((a, b) => a.items[0].due_date.localeCompare(b.items[0].due_date));
  const lateSum = late.reduce((s, g) => s + g.total, 0);

  function whatsapp(g: { cust?: Cust; items: InstallmentStatus[]; total: number }) {
    const store = getStoreSettings();
    const first = (g.cust?.name ?? "").trim().split(/\s+/)[0] ?? "";
    const isLate = g.items.some(i => i.daysLate > 0);
    const lines = [
      `Olá${first ? `, ${first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()}` : ""}! Tudo bem?`,
      isLate ? `Passando para lembrar das parcelas em atraso do seu crediário${store.name ? ` na ${store.name}` : ""}:` : `Lembrete: tem parcela do seu crediário${store.name ? ` na ${store.name}` : ""} vencendo:`,
      "",
      ...g.items.map(i => `• Parcela ${i.number}/${i.total} — ${i.daysLate > 0 ? "venceu" : "vence"} ${dateBr(i.due_date)} — ${fmt(i.open + lateCharge(i, rules))}`),
      "",
      `*Total: ${fmt(g.total)}*`,
      ...(store.pix ? [`PIX: ${store.pix}`] : []),
      "",
      "Obrigado!",
    ];
    let phone = (g.cust?.phone ?? "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) phone = "55" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  const section = (title: string, groups: ReturnType<typeof byCustomer>, tone: string) => (
    <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
      <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
        <h2 className={`text-sm font-semibold flex-1 ${tone}`}>{title}</h2>
        <span className="text-xs text-zinc-500">{groups.length} cliente{groups.length === 1 ? "" : "s"}</span>
      </div>
      <div className="divide-y divide-zinc-800/50">
        {groups.map(g => (
          <div key={g.cid} className="flex items-center gap-3 px-5 py-3">
            <button onClick={() => onOpen(g.cid)} className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold truncate">{g.cust?.name ?? "Cliente"}</p>
              <p className="text-xs text-zinc-500">
                {g.items.length} parcela{g.items.length === 1 ? "" : "s"} · {g.maxLate > 0 ? `até ${g.maxLate} dia${g.maxLate === 1 ? "" : "s"} de atraso` : `vence ${dateBr(g.items[0].due_date)}`}
              </p>
            </button>
            <span className={`text-sm font-bold ${tone}`}>{fmt(g.total)}</span>
            <button onClick={() => whatsapp(g)} title="Cobrar no WhatsApp" className="p-2 rounded-xl" style={{ background: "#25D366", color: "#fff" }}>
              <MessageCircle className="w-4 h-4" />
            </button>
            <button onClick={() => onOpen(g.cid)} className="p-1 text-zinc-500"><ChevronRight className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-2xl px-5 py-4" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Em atraso (com juros e multa)</p>
          <p className={`text-2xl font-black ${lateSum > 0 ? "text-red-500" : "text-emerald-500"}`}>{fmt(lateSum)}</p>
        </div>
        <button onClick={load} className="p-3 rounded-xl text-zinc-400" style={{ background: card.bg, border: card.border }}><RefreshCw className="w-4 h-4" /></button>
      </div>
      {late.length === 0 && soon.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-zinc-500">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          <p className="text-sm">Nenhuma parcela atrasada nem vencendo nos próximos 7 dias.</p>
        </div>
      )}
      {late.length > 0 && section("Parcelas atrasadas", late, "text-red-500")}
      {soon.length > 0 && section("Vencem nos próximos 7 dias", soon, "text-amber-500")}
    </div>
  );
}
