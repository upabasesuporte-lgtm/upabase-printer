// Molde único do cupom (PDV, Mesas, Cardápio Digital, pré-conta).
// Feito para impressora térmica: só preto, letras firmes (nada abaixo de 12px),
// sem caixas; a quantidade sai em destaque (fundo preto) e as bebidas ficam
// separadas no fim — quem monta e quem entrega bate o olho e não esquece nada.
// Negrito forte só no que precisa saltar aos olhos (nº do pedido, 1x/2x, Obs,
// BEBIDAS, TOTAL); o resto em letra normal, que gasta menos a cabeça térmica.

export interface ReceiptStore {
  name: string; cnpj?: string | null; show_cnpj?: boolean | null;
  address?: string | null; phone?: string | null; footer_message?: string | null;
}

export interface ReceiptLine {
  qty: number;
  name: string;
  total?: number | null;    // valor da linha (sem preço: comanda/pré-conta sem valores)
  unit?: number | null;     // preço unitário (mostra "2 × 22,00" quando qty > 1)
  details?: string[];       // opções escolhidas, acompanhamentos
  notes?: string | null;    // observação do item
  addon?: boolean;          // adicional: vai junto do item anterior
  drink?: boolean;          // bebida: seção separada
}

export interface ReceiptData {
  title: string;                       // título da aba (não sai no papel)
  store: ReceiptStore;
  heading?: string | null;             // ex.: "MESA 5" ou "CONFERÊNCIA DE CONTA"
  orderNum: string;
  date: string;
  info?: { label: string; value: string }[];
  lines: ReceiptLine[];
  totals?: { label: string; value: string; strong?: boolean }[];
  payments?: { label: string; value: string }[];
  notes?: string[];                    // chave Pix, troco, fiado, observação do pedido
  footer?: string | null;
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const brl = (v: number) => "R$ " + money(v);
const qtyText = (q: number) => (Number.isInteger(Number(q)) ? String(Number(q)) : String(Number(q)).replace(".", ",")) + "x";

// (18) 99720-5115 / 52.986.972/0001-09 — só formata quando o número está completo
export function fmtPhone(p?: string | null) {
  const d = String(p ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(p ?? "");
}
export function fmtCnpj(c?: string | null) {
  const d = String(c ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return String(c ?? "");
}

export const RECEIPT_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:400;color:#000;background:#fff;line-height:1.3;
       max-width:302px;margin:0 auto;padding:10px 8px;-webkit-font-smoothing:none}
  .c{text-align:center}
  .store{font-size:19px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}
  .sub{font-size:12px;font-weight:400}
  .sep{border-top:2px dashed #000;margin:8px 0}
  .head{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;font-weight:900}
  .big{font-size:17px;font-weight:700;text-align:center;margin:2px 0}
  .info{font-size:13px;font-weight:400;margin-top:2px}
  .info b{font-weight:700}
  .it{display:flex;align-items:flex-start;gap:6px;margin-top:7px}
  .q{background:#000;color:#fff;font-weight:900;font-size:14px;padding:1px 5px;border-radius:3px;white-space:nowrap;line-height:1.25}
  .n{flex:1;font-size:15px;font-weight:400;text-transform:uppercase}
  .v{font-size:14px;font-weight:400;white-space:nowrap}
  .d{font-size:13px;font-weight:400;padding-left:34px;margin-top:1px}
  .d.ob{font-weight:900}
  .sec{display:flex;align-items:center;gap:6px;margin:12px 0 2px;font-size:13px;font-weight:900;letter-spacing:1px}
  .sec:before,.sec:after{content:"";flex:1;border-top:2px dashed #000}
  .row{display:flex;justify-content:space-between;font-size:13px;font-weight:400;margin-top:2px}
  .row.t{font-size:18px;font-weight:900;margin-top:5px}
  .note{font-size:13px;font-weight:400;margin-top:3px}
  .foot{font-size:13px;font-weight:400;text-align:center}
  .pbtn{position:fixed;top:12px;right:12px;background:#315DFB;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
  @media print{@page{margin:0;size:80mm auto} body{max-width:none;padding:2mm 2mm 4mm} .pbtn{display:none!important}}
`;

function lineHtml(l: ReceiptLine, subs: ReceiptLine[]): string {
  const rows: string[] = [];
  rows.push(`<div class="it"><span class="q">${esc(qtyText(l.qty))}</span><span class="n">${esc(l.name)}</span>${l.total != null ? `<span class="v">${money(l.total)}</span>` : ""}</div>`);
  if (l.unit != null && l.qty > 1) rows.push(`<div class="d">${esc(l.qty)} × ${money(l.unit)}</div>`);
  for (const d of l.details ?? []) rows.push(`<div class="d">${esc(d)}</div>`);
  for (const s of subs) rows.push(`<div class="d">+ ${esc(qtyText(s.qty))} ${esc(s.name)}${s.total ? ` · ${money(s.total)}` : ""}${s.notes ? ` (${esc(s.notes)})` : ""}</div>`);
  if (l.notes) rows.push(`<div class="d ob">Obs: ${esc(l.notes)}</div>`);
  return rows.join("");
}

// Adicionais grudam no item de cima; bebidas vão para a seção própria
function itemsHtml(lines: ReceiptLine[]): string {
  const groups: { line: ReceiptLine; subs: ReceiptLine[] }[] = [];
  for (const l of lines) {
    if (l.addon && groups.length && !groups[groups.length - 1].line.drink) groups[groups.length - 1].subs.push(l);
    else groups.push({ line: l, subs: [] });
  }
  const food = groups.filter(g => !g.line.drink), drinks = groups.filter(g => g.line.drink);
  if (!food.length && !drinks.length) return `<div class="note">Sem itens</div>`;
  return food.map(g => lineHtml(g.line, g.subs)).join("")
    + (drinks.length ? `${food.length ? `<div class="sec">BEBIDAS</div>` : ""}${drinks.map(g => lineHtml(g.line, g.subs)).join("")}` : "");
}

export function receiptHtml(d: ReceiptData): string {
  const s = d.store;
  const contact = [s.address ? esc(s.address) : "", s.phone ? esc(fmtPhone(s.phone)) : ""].filter(Boolean);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>${RECEIPT_CSS}</style></head><body>
  <button class="pbtn" onclick="window.print()">Imprimir</button>
  <div class="c">
    <div class="store">${esc(s.name || "Minha Loja")}</div>
    ${contact.map(c => `<div class="sub">${c}</div>`).join("")}
    ${s.show_cnpj && s.cnpj ? `<div class="sub">CNPJ ${esc(fmtCnpj(s.cnpj))}</div>` : ""}
  </div>
  <div class="sep"></div>
  ${d.heading ? `<div class="big">${esc(d.heading)}</div>` : ""}
  <div class="head"><span>PEDIDO #${esc(d.orderNum)}</span><span>${esc(d.date)}</span></div>
  ${(d.info ?? []).map(i => `<div class="info">${i.label ? `<b>${esc(i.label)}:</b> ` : ""}${esc(i.value)}</div>`).join("")}
  <div class="sep"></div>
  ${itemsHtml(d.lines)}
  ${(d.totals ?? []).length ? `<div class="sep"></div>${d.totals!.map(t => `<div class="row${t.strong ? " t" : ""}"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`).join("")}` : ""}
  ${(d.payments ?? []).length ? `<div class="sep"></div>${d.payments!.map(p => `<div class="row"><span>${esc(p.label)}</span><span>${esc(p.value)}</span></div>`).join("")}` : ""}
  ${(d.notes ?? []).map(n => `<div class="note">${esc(n)}</div>`).join("")}
  ${d.footer ? `<div class="sep"></div><div class="foot">${esc(d.footer)}</div>` : ""}
  </body></html>`;
}

// Data/hora curta do cupom: 28/10 · 19:34
export const receiptDate = (iso?: string | Date) =>
  new Date(iso ?? Date.now()).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(", ", " · ");
