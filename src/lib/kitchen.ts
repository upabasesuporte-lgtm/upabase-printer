// Cozinha / Bar / Balcão: setores de impressão e impressão de tickets.
// Cada estação (aparelho com "imprimir automaticamente" ligado na aba Cozinha)
// imprime sozinha os itens enviados dos seus setores — em qualquer aba aberta
// (ver StationPrinter). Para sair sem a janela de impressão, o Chrome da
// estação usa --kiosk-printing.
import { supabase } from "./supabase";

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
  cancelled?: boolean;   // ticket de CANCELAMENTO (item já impresso foi tirado)
  addition?: boolean;    // ACRÉSCIMO: a mesa já tinha pedido antes
  sentBy?: string | null; // quem enviou (garçom)
  reprint?: boolean;     // segunda via
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtQty = (q: number) => Number.isInteger(Number(q)) ? String(Number(q)) : String(Number(q)).replace(".", ",");

// Comanda no mesmo padrão do cupom (lib/receipt): quantidade em destaque,
// o que vai na marmita logo abaixo, bebidas separadas no fim. Sem preços.
const DRINK_RX = /bebida|coca|água|agua|suco|refrigerante|refri|vinho|cerveja|chopp|milkshake|café|leite|guaraná|guarana|fanta|sprite|lata|600ml|2l\b/i;

function ticketLine(l: TicketLine): string {
  return `<div class="it"><span class="q">${esc(fmtQty(l.quantity))}x</span><span class="n">${esc(l.product_name ?? "Produto")}</span></div>`
    + (l.notes ? `<div class="d">${esc(l.notes)}</div>` : "");
}

function ticketHtml(t: Ticket): string {
  const now = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(", ", " · ");
  const food = t.lines.filter(l => !DRINK_RX.test(l.product_name ?? ""));
  const drinks = t.lines.filter(l => DRINK_RX.test(l.product_name ?? ""));
  return `<div class="t">
    ${t.cancelled ? `<div class="inv">CANCELADO · NÃO PREPARAR</div>` : ""}
    ${!t.cancelled && t.addition ? `<div class="inv">ACRÉSCIMO</div>` : ""}
    <div class="hd"><span>${esc(SECTOR_LABEL[t.sector].toUpperCase())}</span><span>${t.reprint ? "2ª VIA" : ""}</span></div>
    <div class="org">${esc(t.origin)}</div>
    <div class="meta">PEDIDO #${esc(t.orderNum)} · ${esc(now)}${t.sentBy ? ` · ${esc(t.sentBy)}` : ""}</div>
    <div class="sep"></div>
    ${food.map(ticketLine).join("")}
    ${drinks.length ? `${food.length ? `<div class="sec">BEBIDAS</div>` : ""}${drinks.map(ticketLine).join("")}` : ""}
    ${t.extra ? `<div class="sep"></div><div class="ex">${esc(t.extra)}</div>` : ""}
  </div>`;
}

// Imprime um documento por um iframe escondido (não abre janela; com
// --kiosk-printing sai direto na impressora padrão do aparelho).
export function thermalHtml(bodyHtml: string, css: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pedido</title><style>
    @page { margin: 0; size: 80mm auto; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; max-width: 80mm; }
    ${css}
  </style></head><body>${bodyHtml}</body></html>`;
}

export function printHtml(bodyHtml: string, css: string) {
  const html = thermalHtml(bodyHtml, css);
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

// Vários tickets saem em sequência, cada um numa "página" (corte) própria.
const TICKET_CSS = `
    .t { padding: 8px 8px 14px; line-height: 1.3; -webkit-font-smoothing: none; }
    .t + .t { page-break-before: always; } /* corte entre tickets, sem página em branco no fim */
    .inv { background: #000; color: #fff; font-size: 16px; font-weight: 900; text-align: center; padding: 4px; margin-bottom: 6px; border-radius: 3px; }
    .hd { display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; letter-spacing: 1px; }
    .org { font-size: 22px; font-weight: 900; text-align: center; margin-top: 2px; text-transform: uppercase; }
    .meta { font-size: 12px; font-weight: 400; text-align: center; margin-top: 2px; }
    .sep { border-top: 2px dashed #000; margin: 7px 0; }
    .it { display: flex; align-items: flex-start; gap: 7px; margin-top: 8px; }
    .q { background: #000; color: #fff; font-size: 17px; font-weight: 900; padding: 1px 6px; border-radius: 3px; white-space: nowrap; line-height: 1.25; }
    .n { flex: 1; font-size: 17px; font-weight: 400; text-transform: uppercase; }
    .d { font-size: 15px; font-weight: 700; padding-left: 40px; margin-top: 1px; }
    .sec { display: flex; align-items: center; gap: 6px; margin: 12px 0 2px; font-size: 14px; font-weight: 900; letter-spacing: 1px; }
    .sec:before, .sec:after { content: ""; flex: 1; border-top: 2px dashed #000; }
    .ex { font-size: 14px; font-weight: 400; }
`;

export function printTickets(tickets: Ticket[]) {
  if (tickets.length === 0) return;
  printHtml(tickets.map(ticketHtml).join(""), TICKET_CSS);
}

// Documento completo dos tickets (usado pelo programa de impressão)
export function ticketsDocument(tickets: Ticket[]): string {
  return thermalHtml(tickets.map(ticketHtml).join(""), TICKET_CSS);
}

// ── Origem do pedido (mesa, balcão, delivery) para o ticket ──────────────────

export interface KSale {
  id: string; origin: string | null; notes: string | null; customer_name: string | null;
  delivery_address: string | null; table_id: string | null; customer: string | null; table: string | null;
  // Mapa de entregas: ponto da venda (GPS do cliente ou marcado na loja) e o salvo no cadastro do cliente
  lat?: number | null; lng?: number | null; customer_id?: string | null;
  cust_lat?: number | null; cust_lng?: number | null; total?: number | null;
  payments?: { method: string; amount: number }[] | null;      // formas de pagamento da venda
  pay_method?: string | null; change_for?: number | null;       // pedido do Cardápio (troco)
}

export function originOf(s: KSale | undefined): { label: string; kind: "table" | "delivery" | "counter" } {
  if (!s) return { label: "Pedido", kind: "counter" };
  const who = s.customer_name || s.customer;
  if (s.origin === "mesa" || s.table_id) return { label: `MESA ${s.table ?? ""}`.trim(), kind: "table" };
  if (s.delivery_address) return { label: `DELIVERY${who ? ` — ${who}` : ""}`, kind: "delivery" };
  if (s.origin === "ifood") return { label: `IFOOD${who ? ` — ${who}` : ""}`, kind: "delivery" };
  if (s.origin === "cardapio_digital" || s.origin === "digital_menu") return { label: `CARDÁPIO${who ? ` — ${who}` : ""}`, kind: "counter" };
  return { label: `BALCÃO${who ? ` — ${who}` : ""}`, kind: "counter" };
}

export async function loadSales(ids: string[]): Promise<Record<string, KSale>> {
  if (ids.length === 0) return {};
  const full = await supabase.from("sales")
    .select("id, origin, notes, customer_name, delivery_address, table_id, total_amount, delivery_lat, delivery_lng, customer_id, payments, customers(name, lat, lng), digital_orders(payment_method, change_for)")
    .in("id", ids);
  // Segurança: se a consulta completa falhar, os tickets continuam saindo com o básico
  const data: any[] | null = !full.error ? full.data : (await supabase.from("sales")
    .select("id, origin, notes, customer_name, delivery_address, table_id, customers(name)")
    .in("id", ids)).data;
  const rows = (data ?? []) as any[];
  const tableIds = [...new Set(rows.map(r => r.table_id).filter(Boolean))];
  const tables: Record<string, string> = {};
  if (tableIds.length) {
    const { data: t } = await supabase.from("tables").select("id, name").in("id", tableIds);
    for (const r of t ?? []) tables[(r as any).id] = (r as any).name;
  }
  const out: Record<string, KSale> = {};
  for (const r of rows) out[r.id] = {
    id: r.id, origin: r.origin, notes: r.notes, customer_name: r.customer_name,
    delivery_address: r.delivery_address, table_id: r.table_id,
    customer: r.customers?.name ?? null, table: r.table_id ? tables[r.table_id] ?? null : null,
    lat: r.delivery_lat ?? null, lng: r.delivery_lng ?? null, customer_id: r.customer_id ?? null,
    cust_lat: r.customers?.lat ?? null, cust_lng: r.customers?.lng ?? null, total: r.total_amount ?? null,
    payments: Array.isArray(r.payments) ? r.payments : null,
    pay_method: r.digital_orders?.[0]?.payment_method ?? null, change_for: r.digital_orders?.[0]?.change_for ?? null,
  };
  return out;
}

// Linhas reservadas para impressão (claim_kitchen_print / claim_items_print) → tickets por pedido e setor
export interface ClaimRow {
  item_id: string; sale_id: string; sector: Sector; quantity: number; notes: string | null;
  product_name: string | null; addition?: boolean | null; sent_by?: string | null;
}

export async function ticketsFromRows(rows: ClaimRow[]): Promise<Ticket[]> {
  if (rows.length === 0) return [];
  const info = await loadSales([...new Set(rows.map(r => r.sale_id))]);
  const groups = new Map<string, Ticket>();
  for (const r of rows) {
    const key = `${r.sale_id}|${r.sector}`;
    const s = info[r.sale_id];
    if (!groups.has(key)) groups.set(key, {
      sector: r.sector, origin: originOf(s).label, orderNum: r.sale_id.slice(-6).toUpperCase(), lines: [],
      extra: [s?.delivery_address, s?.notes].filter(Boolean).join(" · ") || null,
      addition: !!r.addition, sentBy: r.sent_by ?? null,
    });
    groups.get(key)!.lines.push({ quantity: Number(r.quantity), product_name: r.product_name, notes: r.notes });
  }
  return [...groups.values()];
}

// ── Preferências desta estação (ficam neste aparelho) ────────────────────────

const STATION_KEY = "kitchen_station";
// receipts: também imprime cupons/pré-contas enviados pelos celulares (fila print_queue)
export interface StationPrefs { sectors: Sector[]; autoPrint: boolean; receipts: boolean }

export function getStationPrefs(): StationPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(STATION_KEY) ?? "null");
    if (v && Array.isArray(v.sectors)) return { sectors: v.sectors.filter((s: string) => SECTORS.includes(s as Sector)), autoPrint: !!v.autoPrint, receipts: v.receipts !== false };
  } catch { /* sem storage */ }
  return { sectors: [...SECTORS], autoPrint: false, receipts: true };
}

export function setStationPrefs(p: StationPrefs) {
  try { localStorage.setItem(STATION_KEY, JSON.stringify(p)); } catch { /* sem storage */ }
}

// Identificador deste aparelho (para o sinal de "impressora ligada")
export function deviceId(): string {
  try {
    let id = localStorage.getItem("device_id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("device_id", id); }
    return id;
  } catch { return "sem-storage"; }
}

// Setores com alguma estação imprimindo agora (sinal nos últimos 30 s)
export async function onlineSectors(): Promise<Set<Sector>> {
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data } = await supabase.from("print_stations").select("sectors").gte("seen_at", since);
  const out = new Set<Sector>();
  for (const r of (data ?? []) as { sectors: string[] }[]) for (const s of r.sectors ?? []) if (SECTORS.includes(s as Sector)) out.add(s as Sector);
  return out;
}

// "Imprimir os pedidos das mesas neste aparelho" quando nenhuma estação do setor estiver ligada
const PRINT_HERE_KEY = "tables_print_here";
export function getPrintHere(): boolean {
  try { return localStorage.getItem(PRINT_HERE_KEY) === "1"; } catch { return false; }
}
export function setPrintHere(v: boolean) {
  try { if (v) localStorage.setItem(PRINT_HERE_KEY, "1"); else localStorage.removeItem(PRINT_HERE_KEY); } catch { /* sem storage */ }
}

// Reserva os itens e imprime aqui (ninguém mais imprime os mesmos)
export async function printItemsHere(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc("claim_items_print", { p_ids: ids });
  if (error) throw error;
  const tickets = await ticketsFromRows((data ?? []) as ClaimRow[]);
  printTickets(tickets);
  return tickets.length;
}
