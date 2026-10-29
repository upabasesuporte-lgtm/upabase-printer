// Código de barras para etiquetas: EAN-13 (13 dígitos, padrão do varejo) ou
// Code 128 (qualquer outro código). Gera as barras como "1"/"0" (módulos) e
// desenha em SVG (cupom) ou retângulos no PDF.

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

const C128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export function eanCheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, 12)) === Number(code[12]);
}

// Código interno da loja (começa com 2 = uso interno, não colide com códigos de fábrica)
export function newInternalEan(): string {
  let s = "2";
  for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10);
  return s + eanCheckDigit(s);
}

function ean13Modules(code: string): string {
  const parity = EAN_PARITY[Number(code[0])];
  let m = "101";
  for (let i = 1; i <= 6; i++) m += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(code[i])];
  m += "01010";
  for (let i = 7; i <= 12; i++) m += EAN_R[Number(code[i])];
  return m + "101";
}

function code128Modules(text: string): string {
  const chars = [...text].map(c => c.charCodeAt(0)).filter(c => c >= 32 && c <= 126);
  const codes = [104, ...chars.map(c => c - 32)];
  let check = 104;
  for (let i = 1; i < codes.length; i++) check += codes[i] * i;
  codes.push(check % 103, 106);
  let m = "";
  for (const c of codes) {
    const w = C128[c];
    for (let i = 0; i < w.length; i++) m += (i % 2 === 0 ? "1" : "0").repeat(Number(w[i]));
  }
  return m;
}

export interface Barcode { modules: string; kind: "ean13" | "code128"; text: string }

export function encodeBarcode(code: string): Barcode {
  const c = code.trim();
  if (isValidEan13(c)) return { modules: ean13Modules(c), kind: "ean13", text: c };
  return { modules: code128Modules(c), kind: "code128", text: c };
}

// SVG com as barras (sem texto). Largura em módulos; a zona clara fica por conta de quem usa.
export function barcodeSvg(code: string, height = 50): string {
  const { modules } = encodeBarcode(code);
  let rects = "";
  for (let i = 0; i < modules.length;) {
    if (modules[i] === "1") {
      let j = i; while (j < modules.length && modules[j] === "1") j++;
      rects += `<rect x="${i}" y="0" width="${j - i}" height="${height}"/>`;
      i = j;
    } else i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules.length} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block;width:100%;height:100%">${rects}</svg>`;
}

// Desenha no jsPDF (mm): barras a partir de (x, y), largura total w, altura h
export function drawBarcodePdf(doc: any, code: string, x: number, y: number, w: number, h: number) {
  const { modules } = encodeBarcode(code);
  const mw = w / modules.length;
  doc.setFillColor(0, 0, 0);
  for (let i = 0; i < modules.length;) {
    if (modules[i] === "1") {
      let j = i; while (j < modules.length && modules[j] === "1") j++;
      doc.rect(x + i * mw, y, (j - i) * mw, h, "F");
      i = j;
    } else i++;
  }
}
