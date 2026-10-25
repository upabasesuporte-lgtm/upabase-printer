// Cozinha / Bar / Balcão: setores de impressão e impressão de tickets.
// Cada estação (aparelho com a aba Cozinha aberta) escolhe seus setores e, com
// "imprimir automaticamente" ligado, imprime sozinha os itens novos. Para sair
// sem a janela de impressão, o Chrome da estação usa --kiosk-printing.

export type Sector = "kitchen" | "bar" | "counter";

export const SECTOR_LABEL: Record<Sector, string> = {
  kitchen: "Cozinha",
  bar: "Bar",
  counter: "Balcão",
};

export const SECTORS: Sector[] = ["kitchen", "bar", "counter"];

export interface TicketLine { quantity: number; product_name: string | null; notes: string | null }

export interface Ticket {
  sector: Sector;
  origin: string;      // "MESA 5", "BALCÃO #A1B2C3", "DELIVERY — João"
  orderNum: string;
  lines: TicketLine[];
  extra?: string | null; // observação do pedido / endereço
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtQty = (q: number) => Number.isInteger(Number(q)) ? String(Number(q)) : String(Number(q)).replace(".", ",");

function ticketHtml(t: Ticket): string {
  const now = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `<div class="t">
    <div class="sec">${esc(SECTOR_LABEL[t.sector].toUpperCase())}</div>
    <div class="org">${esc(t.origin)}</div>
    <div class="meta">#${esc(t.orderNum)} · ${esc(now)}</div>
    <div class="sep"></div>
    ${t.lines.map(l => `<div class="ln"><b>${esc(fmtQty(l.quantity))}x</b> ${esc(l.product_name ?? "Produto")}</div>${l.notes ? `<div class="nt">→ ${esc(l.notes)}</div>` : ""}`).join("")}
    ${t.extra ? `<div class="sep"></div><div class="nt">${esc(t.extra)}</div>` : ""}
  </div>`;
}

// Imprime por um iframe escondido (não abre janela; com --kiosk-printing sai
// direto na impressora padrão do aparelho). Vários tickets saem em sequência,
// cada um numa "página" (corte) própria.
export function printTickets(tickets: Ticket[]) {
  if (tickets.length === 0) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedido</title><style>
    @page { margin: 0; size: 80mm auto; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; width: 80mm; }
    .t { padding: 8px 10px 14px; page-break-after: always; }
    .sec { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-align: center; }
    .org { font-size: 22px; font-weight: 900; text-align: center; margin-top: 2px; }
    .meta { font-size: 11px; text-align: center; margin-top: 2px; }
    .sep { border-top: 1px dashed #000; margin: 6px 0; }
    .ln { font-size: 16px; margin: 4px 0; }
    .nt { font-size: 13px; margin: 0 0 4px 14px; }
  </style></head><body>${tickets.map(ticketHtml).join("")}</body></html>`;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* sem impressora */ }
    setTimeout(() => iframe.remove(), 60_000);
  }, 250);
}

// Preferências desta estação (ficam neste aparelho)
const STATION_KEY = "kitchen_station";
export interface StationPrefs { sectors: Sector[]; autoPrint: boolean }

export function getStationPrefs(): StationPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(STATION_KEY) ?? "null");
    if (v && Array.isArray(v.sectors)) return { sectors: v.sectors.filter((s: string) => SECTORS.includes(s as Sector)), autoPrint: !!v.autoPrint };
  } catch { /* sem storage */ }
  return { sectors: [...SECTORS], autoPrint: false };
}

export function setStationPrefs(p: StationPrefs) {
  try { localStorage.setItem(STATION_KEY, JSON.stringify(p)); } catch { /* sem storage */ }
}
