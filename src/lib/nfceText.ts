// ─── Ler a notinha (NFC-e) a partir do texto copiado da página da SEFAZ ───
// O dono abre o QR Code no celular, copia a página toda e cola no sistema.
// Cada estado tem uma página diferente, então a leitura procura o que toda nota
// tem: nome, quantidade, unidade, preço unitário e total. Dois formatos:
//  1) com rótulos ("Qtde.: 2 UN: KG Vl. Unit.: 9,98 Vl. Total 19,96") — SP, RS, PR, MS…
//  2) em tabela ("ARROZ 5KG 2,000 UN 23,90 47,80"), só aceita quando qtd × unitário = total.

export interface NfceItem { name: string; code: string | null; qty: number; unit: string; unitPrice: number; total: number }
export interface NfceNote {
  items: NfceItem[];
  store: string | null;
  cnpj: string | null;
  date: string | null;        // AAAA-MM-DD
  key: string | null;         // chave de acesso (44 dígitos)
  itemsTotal: number;         // soma dos itens
  discount: number;
  toPay: number | null;       // "Valor a pagar"
}

export function brNum(s: string): number {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return NaN;
  // 1.234,56 → 1234.56 · 1,605 → 1.605 · 12.50 → 12.5
  if (t.includes(",")) return parseFloat(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ""));
  return parseFloat(t);
}

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const LABEL_LINE = /^(vl\.?\s*total|valor\s+total|qtde?\.?|un\.?:?|vl\.?\s*unit)/i;

function cleanName(s: string): string {
  return s
    .replace(/\(\s*c[óo]d(?:igo|\.)?\s*:?[^)]*\)?/gi, " ")
    .replace(/\bc[óo]d(?:igo|\.)?\s*:?\s*\d+/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–:;,.|#]+|[\s\-–:;,|#]+$/g, "")
    .trim();
}
function codeOf(s: string): string | null {
  return /c[óo]d(?:igo|\.)?\s*:?\s*(\d{3,14})/i.exec(s)?.[1] ?? null;
}

// Formato 1: rótulos "Qtde.:" … "Vl. Total"
function parseLabeled(text: string): NfceItem[] {
  const items: NfceItem[] = [];
  const rx = new RegExp(String.raw`Qtd[ae]?\.?\s*:?\s*(${NUM})`, "gi");
  const hits: { idx: number; end: number; qty: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) hits.push({ idx: m.index, end: rx.lastIndex, qty: brNum(m[1]) });
  let prevEnd = 0;
  hits.forEach((h, k) => {
    const tail = text.slice(h.end, k + 1 < hits.length ? hits[k + 1].idx : text.length);
    const unit = /\bUN(?:ID(?:ADE)?)?\.?\s*:?\s*([A-Za-zÇç]{1,6})\b/i.exec(tail)?.[1] ?? "UN";
    const vu = new RegExp(String.raw`Vl\.?\s*Unit(?:\.|ário|ario)?\s*:?\s*(?:R\$\s*)?(${NUM})`, "i").exec(tail);
    const vt = new RegExp(String.raw`(?:Vl\.?|Valor)\s*Total\s*:?\s*(?:R\$\s*)?(${NUM})`, "i").exec(tail);
    const unitPrice = vu ? brNum(vu[1]) : NaN;
    let total = vt ? brNum(vt[1]) : NaN;
    if (isNaN(total) && !isNaN(unitPrice)) total = Math.round(h.qty * unitPrice * 100) / 100;

    // Nome: o que vem entre o item anterior e este "Qtde"
    const seg = text.slice(prevEnd, h.idx);
    const lines = seg.split("\n").map(l => l.trim()).filter(l => l && !LABEL_LINE.test(l));
    let nameLines = lines;
    // O primeiro item vem depois do cabeçalho (mercado, endereço): pega só a última linha com nome
    if (k === 0 || lines.length > 3) {
      const last = lines.length - 1;
      nameLines = last >= 1 && /^\(?\s*c[óo]d/i.test(lines[last]) ? lines.slice(last - 1) : lines.slice(-1);
    }
    const rawName = nameLines.join(" ");
    const name = cleanName(rawName);
    if (name && h.qty > 0 && total >= 0 && !isNaN(total)) {
      items.push({ name, code: codeOf(rawName), qty: h.qty, unit: unit.toUpperCase(), unitPrice: isNaN(unitPrice) ? total / h.qty : unitPrice, total });
    }
    prevEnd = vt ? h.end + vt.index + vt[0].length : h.end + tail.length;
  });
  return items;
}

// Formato 2: linha de tabela, aceita só quando a conta fecha
const ROW = new RegExp(
  String.raw`^(?:\d{1,3}\s+(?:\d{1,14}\s+)?|\d{4,14}\s+)?(.*?[A-Za-zÀ-ÿ].*?)\s+(${NUM})\s*([A-Za-z]{1,5})\.?\s+(?:[xX]\s+)?(?:R\$\s*)?(${NUM})\s+(?:R\$\s*)?(${NUM})$`,
);
function parseTable(lines: string[]): NfceItem[] {
  const items: NfceItem[] = [];
  // Procura pela última linha do item (o total) e volta até 6 linhas atrás do nome,
  // sem pegar linhas que já viraram item
  let from = 0;
  for (let e = 0; e < lines.length; e++) {
    for (let n = 1; n <= 6 && e - n + 1 >= from; n++) {
      const joined = lines.slice(e - n + 1, e + 1).join(" ").replace(/\s+/g, " ").trim();
      const m = ROW.exec(joined);
      if (!m) continue;
      const qty = brNum(m[2]), unitPrice = brNum(m[4]), total = brNum(m[5]);
      if (!(qty > 0) || isNaN(unitPrice) || isNaN(total)) continue;
      if (Math.abs(qty * unitPrice - total) > Math.max(0.05, total * 0.02)) continue;
      const name = cleanName(m[1]);
      if (!name || /^(total|subtotal|valor|desconto)/i.test(name)) continue;
      items.push({ name, code: codeOf(m[1]), qty, unit: m[3].toUpperCase(), unitPrice, total });
      from = e + 1;
      break;
    }
  }
  return items;
}

function money(text: string, label: string): number | null {
  const m = new RegExp(String.raw`${label}\s*(?:R\$)?\s*:?\s*(?:R\$)?\s*(${NUM})`, "i").exec(text);
  return m ? brNum(m[1]) : null;
}

export function parseNfceText(raw: string): NfceNote {
  const text = raw.replace(/\r/g, "").replace(/[ \t]/g, " ").replace(/[ ]{2,}/g, " ");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  let items = /Qtd[ae]?\.?\s*:/i.test(text) ? parseLabeled(text) : [];
  if (items.length === 0) items = parseTable(lines);

  const cnpjM = /CNPJ\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i.exec(text);
  let store: string | null = null;
  if (cnpjM) {
    const before = text.slice(0, cnpjM.index).split("\n").map(l => l.trim()).filter(Boolean);
    store = before.reverse().find(l => /[A-Za-z]{3}/.test(l) && !/consulta|nfc-?e|secretaria|fazenda|documento auxiliar|danfe/i.test(l)) ?? null;
    if (store && store.length > 80) store = store.slice(0, 80);
  }
  const dm = /Emiss[ãa]o\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(text) ?? /(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}/.exec(text);
  const keyM = /(?:\d{4}\s?){10}\d{4}/.exec(text.replace(/\n/g, " "));
  const key = keyM ? keyM[0].replace(/\s/g, "") : null;

  return {
    items,
    store,
    cnpj: cnpjM ? cnpjM[1].replace(/\D/g, "") : null,
    date: dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null,
    key: key && key.length === 44 ? key : null,
    itemsTotal: Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100,
    discount: money(text, String.raw`Descontos?`) ?? 0,
    toPay: money(text, String.raw`Valor\s+a\s+pagar`),
  };
}

// Unidade da nota → unidade do estoque
export function nfceUnit(u: string): string {
  const x = u.toUpperCase();
  if (x === "KG" || x === "KGS") return "kg";
  if (x === "G" || x === "GR" || x === "GRS") return "g";
  if (x === "L" || x === "LT" || x === "LTS" || x === "LITRO") return "litro";
  if (x === "ML") return "ml";
  if (x === "PCT" || x === "PC" || x === "PT" || x === "PACOTE") return "pacote";
  if (x === "CX" || x === "CXA") return "caixa";
  if (x === "DZ" || x === "DUZ") return "dúzia";
  if (x === "LATA" || x === "LT.") return "lata";
  if (x === "FD" || x === "FDO") return "fardo";
  return "unidade";
}
