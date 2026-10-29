// Crediário do cliente: parcelas com vencimento, atrasos com juros/multa,
// receber (abre o "Pagar Fiado"), carnê em PDF e cobrança no WhatsApp.
import { useEffect, useState } from "react";
import { CalendarClock, Download, MessageCircle, RefreshCw, X } from "lucide-react";
import { fetchCustomerInstallments, fetchRules, lateCharge, DEFAULT_RULES, type InstallmentStatus, type CrediarioRules } from "../lib/crediario";
import { getStoreSettings } from "../pages/settings";
import { loadJsPdf, savePdf } from "../lib/pdf";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (iso: string) => iso.split("-").reverse().join("/");
const saleNo = (id: string) => "#" + id.slice(-6).toUpperCase();

interface Props {
  customer: { id: string; name: string; phone?: string | null };
  card: { bg: string; border: string; shadow: string };
  isLight: boolean;
  reloadKey: unknown;
  // Leva para o "Pagar Fiado" com o valor da parcela (e lança juros/multa antes, se escolhido)
  onReceive: (amount: number, charge: number, label: string) => void;
}

export function CrediarioCard({ customer, card, isLight, reloadKey, onReceive }: Props) {
  const [list, setList] = useState<InstallmentStatus[] | null>(null);
  const [rules, setRules] = useState<CrediarioRules>(DEFAULT_RULES);
  const [receiving, setReceiving] = useState<InstallmentStatus | null>(null);
  const [withCharge, setWithCharge] = useState(true);
  const [showPaid, setShowPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchCustomerInstallments(customer.id), fetchRules()])
      .then(([l, r]) => { if (alive) { setList(l); setRules(r); } })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [customer.id, reloadKey]);

  if (!list || list.length === 0) return null;

  const open = list.filter(i => !i.paid);
  const late = open.filter(i => i.daysLate > 0);
  const openTotal = open.reduce((s, i) => s + i.open, 0);
  const lateTotal = late.reduce((s, i) => s + i.open + lateCharge(i, rules), 0);
  const shown = showPaid ? list : open;
  const label = (i: InstallmentStatus) => `parcela ${i.number}/${i.total} da venda ${saleNo(i.sale_id)}`;

  async function carne() {
    setBusy(true); setMsg(null);
    try {
      const JsPDF = await loadJsPdf();
      const store = getStoreSettings();
      const doc = new JsPDF({ unit: "mm", format: "a4" });
      const slipH = 92, L = 12, R = 198;
      list!.forEach((i, idx) => {
        const slot = idx % 3;
        if (idx > 0 && slot === 0) doc.addPage();
        const y = 8 + slot * (slipH + 4);
        doc.setDrawColor(150); doc.setLineWidth(0.3); doc.roundedRect(L, y, R - L, slipH, 3, 3);
        doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(0);
        doc.text(store.name || "Carnê", L + 6, y + 11);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
        const contact = [store.address, store.phone].filter(Boolean).join("  ·  ");
        if (contact) doc.text(doc.splitTextToSize(contact, R - L - 70)[0], L + 6, y + 16.5);
        doc.setTextColor(0); doc.setFontSize(11);
        doc.text(`Cliente: ${customer.name}`, L + 6, y + 28);
        doc.text(`Venda ${saleNo(i.sale_id)}`, L + 6, y + 35);
        doc.setFont("helvetica", "bold"); doc.setFontSize(22);
        doc.text(`${i.number}/${i.total}`, R - 6, y + 13, { align: "right" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
        doc.text("PARCELA", R - 6, y + 18, { align: "right" });
        doc.setTextColor(0);
        doc.setFontSize(10); doc.text("Vencimento", L + 6, y + 50); doc.text("Valor", L + 70, y + 50);
        doc.setFont("helvetica", "bold"); doc.setFontSize(16);
        doc.text(dateBr(i.due_date), L + 6, y + 58); doc.text(fmt(i.amount), L + 70, y + 58);
        if (i.paid) {
          doc.setTextColor(20, 140, 60); doc.setFontSize(18); doc.text("PAGA", R - 6, y + 58, { align: "right" }); doc.setTextColor(0);
        }
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
        doc.text(`Após o vencimento: multa de ${rules.multaPct}% e juros de ${rules.jurosMesPct}% ao mês.`, L + 6, y + 68);
        if (store.pix) doc.text(`Pix: ${store.pix}`, L + 6, y + 73);
        doc.setDrawColor(120); doc.line(L + 6, y + 85, L + 80, y + 85); doc.line(L + 100, y + 85, R - 6, y + 85);
        doc.text("Recebido em", L + 6, y + 89); doc.text("Assinatura", L + 100, y + 89);
        doc.setTextColor(0);
      });
      await savePdf(doc, `Carne ${customer.name}.pdf`.replace(/[\\/:*?"<>|]/g, ""));
    } catch (e) { setMsg(e instanceof Error ? e.message : "Não foi possível gerar o carnê"); }
    setBusy(false);
  }

  function whatsapp() {
    const store = getStoreSettings();
    const first = customer.name.trim().split(/\s+/)[0] ?? "";
    const lines = [
      `Olá${first ? `, ${first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()}` : ""}! Tudo bem?`,
      `Passando para lembrar das parcelas do seu crediário${store.name ? ` na ${store.name}` : ""}:`,
      "",
      ...late.map(i => `• Parcela ${i.number}/${i.total} — venceu ${dateBr(i.due_date)} — ${fmt(i.open + lateCharge(i, rules))}`),
      "",
      `*Total em atraso: ${fmt(lateTotal)}*`,
      ...(store.pix ? [`PIX: ${store.pix}`] : []),
      "",
      "Obrigado!",
    ];
    let phone = (customer.phone ?? "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) phone = "55" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  return (
    <div className="rounded-2xl p-5 space-y-3" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarClock className="w-4 h-4 text-brand-600" />
        <h2 className="text-sm font-semibold flex-1">Crediário</h2>
        <button onClick={carne} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-zinc-700 hover:bg-zinc-800/30 disabled:opacity-50">
          {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Carnê (PDF)
        </button>
        {late.length > 0 && (
          <button onClick={whatsapp} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ background: "#25D366", color: "#fff" }}>
            <MessageCircle className="w-3.5 h-3.5" /> Cobrar atrasadas
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
        {[
          { l: "Parcelas em aberto", v: String(open.length), c: "" },
          { l: "Falta pagar", v: fmt(openTotal), c: "text-amber-500" },
          { l: "Em atraso (c/ juros)", v: fmt(lateTotal), c: late.length ? "text-red-500" : "" },
        ].map(k => (
          <div key={k.l} className={`rounded-xl px-2 py-2 ${isLight ? "bg-gray-50" : "bg-zinc-950"}`}>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k.l}</p>
            <p className={`text-sm font-bold ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {receiving && (
        <div className={`rounded-xl p-3 space-y-2 border ${isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800"}`}>
          <div className="flex items-center">
            <p className="text-sm font-semibold flex-1">Receber {label(receiving)}</p>
            <button onClick={() => setReceiving(null)} className="p-1 text-zinc-500"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm">Parcela: <b>{fmt(receiving.open)}</b></p>
          {lateCharge(receiving, rules) > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={withCharge} onChange={e => setWithCharge(e.target.checked)} className="w-4 h-4 accent-brand-600" />
              Cobrar juros/multa de {fmt(lateCharge(receiving, rules))} ({receiving.daysLate} dia{receiving.daysLate === 1 ? "" : "s"} de atraso)
            </label>
          )}
          <button onClick={() => { const c = withCharge ? lateCharge(receiving, rules) : 0; onReceive(receiving.open, c, label(receiving)); setReceiving(null); }}
            className="w-full py-2.5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700" style={{ color: "#fff" }}>
            Receber {fmt(receiving.open + (withCharge ? lateCharge(receiving, rules) : 0))}
          </button>
        </div>
      )}

      <div className="divide-y divide-zinc-800/40">
        {shown.map(i => {
          const charge = lateCharge(i, rules);
          return (
            <div key={i.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="w-10 font-bold">{i.number}/{i.total}</span>
              <span className="flex-1 min-w-0">
                <span className="block">vence {dateBr(i.due_date)}</span>
                <span className="block text-[11px] text-zinc-500">venda {saleNo(i.sale_id)}</span>
              </span>
              <span className="text-right">
                <span className="block font-semibold">{fmt(i.paid ? i.amount : i.open)}</span>
                {charge > 0 && <span className="block text-[11px] text-red-500">+ {fmt(charge)} juros</span>}
              </span>
              <span className={`w-24 text-right text-xs font-semibold ${i.paid ? "text-emerald-500" : i.daysLate > 0 ? "text-red-500" : "text-amber-500"}`}>
                {i.paid ? "paga" : i.daysLate > 0 ? `${i.daysLate} dia${i.daysLate === 1 ? "" : "s"} atraso` : "em aberto"}
              </span>
              {!i.paid && (
                <button onClick={() => { setReceiving(i); setWithCharge(true); }} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-700" style={{ color: "#fff" }}>
                  Receber
                </button>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-sm text-emerald-500 py-2">Todas as parcelas estão pagas.</p>}
      </div>
      {list.some(i => i.paid) && (
        <button onClick={() => setShowPaid(v => !v)} className="text-xs font-semibold text-brand-600">{showPaid ? "Esconder parcelas pagas" : "Ver também as pagas"}</button>
      )}
      <p className="text-[11px] text-zinc-500">As parcelas são quitadas pelo "Pagar Fiado" — o pagamento abate sempre a parcela mais antiga.</p>
      {msg && <p className="text-xs text-red-500">{msg}</p>}
    </div>
  );
}
