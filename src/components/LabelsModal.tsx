// Etiquetas com código de barras (varejo): escolhe os produtos/tamanhos e a
// quantidade, e gera PDF para impressora de etiquetas (40×25 mm), folha A4 ou
// sai na impressora de cupom.
import { useEffect, useMemo, useState } from "react";
import { X, Search, Plus, Minus, Trash2, Download, Printer, RefreshCw, Barcode as BarcodeIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { matchesSearch } from "../lib/search";
import { loadJsPdf, savePdf } from "../lib/pdf";
import { barcodeSvg, drawBarcodePdf } from "../lib/barcode";
import { printDocument } from "../lib/printing";
import { esc } from "../lib/receipt";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface LabelProduct {
  id: string; name: string; barcode: string | null; sale_price: number; stock: number;
  variant_of: string | null; variant_size: string | null; variant_color: string | null;
}
interface Picked { p: LabelProduct; qty: number }

const money = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LabelsModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const [all, setAll] = useState<LabelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchAll(() => supabase.from("products")
      .select("id, name, barcode, sale_price, stock, variant_of, variant_size, variant_color")
      .neq("is_active", false).order("name"))
      .then(r => {
        setAll(((r.data ?? []) as any[]).map(x => ({ ...x, sale_price: Number(x.sale_price ?? 0), stock: Number(x.stock ?? 0) })));
        setLoading(false);
      });
  }, []);

  // Produto principal de uma grade não vira etiqueta: a etiqueta é de cada tamanho/cor
  const parents = useMemo(() => new Set(all.map(p => p.variant_of).filter(Boolean) as string[]), [all]);
  const kidsOf = (id: string) => all.filter(p => p.variant_of === id);
  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim();
    return all.filter(p => matchesSearch(p.name, q) || (p.barcode ?? "").includes(q)).slice(0, 40);
  }, [all, search]);

  function add(list: LabelProduct[], qtyOf: (p: LabelProduct) => number = () => 1) {
    setPicked(prev => {
      const next = [...prev];
      for (const p of list) {
        const i = next.findIndex(x => x.p.id === p.id);
        const q = Math.max(1, qtyOf(p));
        if (i >= 0) next[i] = { ...next[i], qty: next[i].qty + q }; else next.push({ p, qty: q });
      }
      return next;
    });
  }
  const setQty = (id: string, q: number) => setPicked(prev => prev.map(x => x.p.id === id ? { ...x, qty: Math.max(1, Math.min(999, q)) } : x));
  const totalLabels = picked.reduce((n, x) => n + x.qty, 0);
  const expand = () => picked.flatMap(x => Array.from({ length: x.qty }, () => x.p));

  const baseName = (p: LabelProduct) => {
    if (!p.variant_of) return p.name;
    const parent = all.find(x => x.id === p.variant_of);
    return parent?.name ?? p.name;
  };
  const variantTxt = (p: LabelProduct) => [p.variant_size, p.variant_color].filter(Boolean).join(" / ");

  async function pdf(kind: "roll" | "a4") {
    setBusy(kind); setMsg(null);
    try {
      const JsPDF = await loadJsPdf();
      const labels = expand();
      const W = kind === "roll" ? 40 : 66.7, H = kind === "roll" ? 25 : 25.4;
      const doc = kind === "roll"
        ? new JsPDF({ unit: "mm", format: [40, 25], orientation: "landscape" })
        : new JsPDF({ unit: "mm", format: "a4" });
      const cols = 3, rowsPerPage = 11, left = 4.65, top = 8.8;
      labels.forEach((p, i) => {
        let x = 0, y = 0;
        if (kind === "roll") { if (i > 0) doc.addPage([40, 25], "landscape"); }
        else {
          const slot = i % (cols * rowsPerPage);
          if (i > 0 && slot === 0) doc.addPage();
          x = left + (slot % cols) * W; y = top + Math.floor(slot / cols) * H;
          doc.setDrawColor(225); doc.setLineWidth(0.1); doc.rect(x, y, W, H);
        }
        const pad = 2, inner = W - pad * 2;
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7);
        const name: string = doc.splitTextToSize(baseName(p).toUpperCase(), inner)[0] ?? "";
        doc.text(name, x + pad, y + 3.6);
        const vt = variantTxt(p);
        doc.setFontSize(8.5);
        if (vt) doc.text(vt, x + pad, y + 7.4);
        if (showPrice) { doc.setFontSize(9.5); doc.text(money(p.sale_price), x + W - pad, y + 7.4, { align: "right" }); }
        if (p.barcode) {
          const bw = Math.min(inner, kind === "roll" ? 32 : 44); // sobra margem branca dos lados (o leitor precisa)
          drawBarcodePdf(doc, p.barcode, x + (W - bw) / 2, y + 8.8, bw, H - 14.4);
          doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
          doc.text(p.barcode, x + W / 2, y + H - 2.4, { align: "center" });
        } else {
          doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
          doc.text("(sem código de barras)", x + W / 2, y + H / 2 + 3, { align: "center" });
        }
      });
      await savePdf(doc, kind === "roll" ? "Etiquetas 40x25.pdf" : "Etiquetas A4.pdf");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível gerar o PDF");
    }
    setBusy(null);
  }

  async function printOnReceipt() {
    setBusy("receipt"); setMsg(null);
    const labels = expand();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
      *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;max-width:302px;margin:0 auto;padding:4px 6px}
      .lb{padding:8px 4px 10px;border-bottom:2px dashed #000}.n{font-size:14px;font-weight:700;text-transform:uppercase;line-height:1.2}
      .r{display:flex;justify-content:space-between;align-items:baseline;margin-top:3px}.v{font-size:17px;font-weight:900}.p{font-size:18px;font-weight:900}
      .b{height:56px;margin:6px 10px 2px}.c{text-align:center;font-size:13px;letter-spacing:1px}
      @media print{@page{margin:0;size:80mm auto} body{max-width:none;padding:2mm}}</style></head><body>
      ${labels.map(p => `<div class="lb"><div class="n">${esc(baseName(p))}</div>
        <div class="r"><span class="v">${esc(variantTxt(p))}</span>${showPrice ? `<span class="p">${money(p.sale_price)}</span>` : ""}</div>
        ${p.barcode ? `<div class="b">${barcodeSvg(p.barcode, 56)}</div><div class="c">${esc(p.barcode)}</div>` : `<div class="c">(sem código de barras)</div>`}
      </div>`).join("")}</body></html>`;
    try { await printDocument(html, { kind: "receipt", title: "Etiquetas" }); }
    catch { setMsg("Não foi possível imprimir"); }
    setBusy(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
          <h3 className="font-semibold text-base flex items-center gap-2"><BarcodeIcon className="w-5 h-5 text-brand-600" /> Etiquetas</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto ou código de barras..."
              className="w-full pl-9 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm focus:outline-none focus:border-brand-500" />
          </div>

          {loading ? (
            <div className="flex justify-center py-6"><RefreshCw className="w-4 h-4 animate-spin text-brand-600" /></div>
          ) : search.trim() !== "" && (
            <div className="border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 max-h-56 overflow-y-auto">
              {results.length === 0 && <p className="text-sm text-zinc-500 p-3">Nenhum produto encontrado.</p>}
              {results.map(p => parents.has(p.id) ? (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-sm font-semibold truncate">{p.name} <span className="text-xs font-normal text-zinc-500">· grade com {kidsOf(p.id).length}</span></span>
                  <button onClick={() => add(kidsOf(p.id))} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-zinc-700 hover:border-brand-500 hover:text-brand-600">+1 de cada</button>
                  <button onClick={() => add(kidsOf(p.id), k => k.stock)} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-700" style={{ color: "#fff" }}>Qtd do estoque</button>
                </div>
              ) : (
                <button key={p.id} onClick={() => add([p])} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/40">
                  <Plus className="w-4 h-4 text-brand-600 flex-shrink-0" />
                  <span className="flex-1 text-sm truncate">{p.name}</span>
                  <span className="text-xs text-zinc-500 font-mono">{p.barcode || "sem código"}</span>
                </button>
              ))}
            </div>
          )}

          {picked.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{totalLabels} etiqueta{totalLabels === 1 ? "" : "s"}</p>
              {picked.map(x => (
                <div key={x.p.id} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{x.p.name}</p>
                    <p className="text-[11px] text-zinc-500 font-mono">{x.p.barcode || "sem código de barras"} · {money(x.p.sale_price)}</p>
                  </div>
                  <button onClick={() => setQty(x.p.id, x.qty - 1)} className="p-1.5 rounded-lg border border-zinc-700"><Minus className="w-3.5 h-3.5" /></button>
                  <input type="number" min={1} value={x.qty} onChange={e => setQty(x.p.id, parseInt(e.target.value) || 1)}
                    className="w-14 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-center" />
                  <button onClick={() => setQty(x.p.id, x.qty + 1)} className="p-1.5 rounded-lg border border-zinc-700"><Plus className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setPicked(prev => prev.filter(y => y.p.id !== x.p.id))} className="p-1.5 text-zinc-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 text-center py-4">Busque os produtos acima. Para roupa com grade, use "Qtd do estoque" para sair uma etiqueta por peça.</p>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} className="w-4 h-4 accent-brand-600" />
            Mostrar o preço na etiqueta
          </label>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>

        <div className="grid sm:grid-cols-3 gap-2 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button onClick={() => pdf("roll")} disabled={!picked.length || !!busy}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-left" style={{ color: "#fff" }}>
            {busy === "roll" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>PDF 40×25 mm<span className="block text-[11px] font-normal opacity-80">Impressora de etiquetas</span></span>
          </button>
          <button onClick={() => pdf("a4")} disabled={!picked.length || !!busy}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border border-zinc-700 hover:bg-zinc-800/40 disabled:opacity-40 text-left">
            {busy === "a4" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>PDF folha A4<span className="block text-[11px] font-normal text-zinc-500">3 colunas, papel adesivo</span></span>
          </button>
          <button onClick={printOnReceipt} disabled={!picked.length || !!busy}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border border-zinc-700 hover:bg-zinc-800/40 disabled:opacity-40 text-left">
            {busy === "receipt" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            <span>Impressora de cupom<span className="block text-[11px] font-normal text-zinc-500">Recorta e cola na peça</span></span>
          </button>
        </div>
      </div>
    </div>
  );
}
