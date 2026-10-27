// Localização sem custo: mapa (Leaflet + OpenStreetMap), CEP (ViaCEP) e
// endereço → ponto (Nominatim, do OpenStreetMap). O Nominatim gratuito pede no
// máximo 1 busca por segundo e que os resultados sejam guardados — por isso a
// fila abaixo e a memória de endereços (delivery_locations) no banco.

export type LatLng = { lat: number; lng: number };

// ── Mapa (carregado da CDN só quando aparece na tela) ────────────────────────
let leafletPromise: Promise<any> | null = null;
export function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.async = true;
    js.onload = () => resolve(w.L);
    js.onerror = () => { leafletPromise = null; reject(new Error("Não foi possível carregar o mapa (sem internet?)")); };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Mesmo endereço escrito de jeitos diferentes vira a mesma chave
export const addressKey = (a: string) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ── CEP → rua, bairro, cidade, UF (ViaCEP, gratuito) ─────────────────────────
export async function lookupCep(cep: string): Promise<{ street: string; district: string; city: string; state: string } | null> {
  const d = cep.replace(/\D/g, "");
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (j.erro) return null;
    return { street: j.logradouro ?? "", district: j.bairro ?? "", city: j.localidade ?? "", state: j.uf ?? "" };
  } catch { return null; }
}

// ── Endereço → ponto (Nominatim) ──────────────────────────────────────────────
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function nominatim(params: Record<string, string>, near?: LatLng | null): Promise<{ pos: LatLng; exact: boolean } | null> {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  const all: Record<string, string> = { format: "jsonv2", limit: "1", addressdetails: "1", countrycodes: "br", "accept-language": "pt-BR", ...params };
  if (near) {
    const d = 0.3; // ~30 km em volta da loja
    all.viewbox = `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
    all.bounded = "1";
  }
  for (const [k, v] of Object.entries(all)) u.searchParams.set(k, v);
  return throttled(async () => {
    try {
      const r = await fetch(u.toString());
      if (!r.ok) return null;
      const j = await r.json();
      const hit = Array.isArray(j) ? j[0] : null;
      if (!hit) return null;
      return { pos: { lat: Number(hit.lat), lng: Number(hit.lon) }, exact: !!hit.address?.house_number };
    } catch { return null; }
  });
}

// Tira rótulos e observações que atrapalham a busca ("Bairro:", "ao lado de...", horários)
export function cleanAddress(a: string): string {
  let s = a.replace(/\b(bairro|rua|n[uú]mero|endere[cç]o|complemento)\s*:/gi, " ");
  s = s.replace(/\(.*?\)/g, " ");
  const cut = s.search(/\b(ao lado|perto|pr[oó]ximo|em frente|fundos|apto|apartamento|bloco|obra|refer[eê]ncia|as \d{1,2}[:h]|às \d{1,2}[:h])\b/i);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/\s+-\s+/g, ", ").replace(/\s{2,}/g, " ").replace(/[\s,;-]+$/g, "").trim();
}

// Busca de endereço de entrega perto da loja. Não encontrado → null (fica para marcar à mão)
const MISS_KEY = "geo_miss";
function missed(key: string): boolean {
  try { const m = JSON.parse(localStorage.getItem(MISS_KEY) ?? "{}"); return !!m[key] && Date.now() - m[key] < 3 * 86400_000; } catch { return false; }
}
function markMiss(key: string) {
  try { const m = JSON.parse(localStorage.getItem(MISS_KEY) ?? "{}"); m[key] = Date.now(); localStorage.setItem(MISS_KEY, JSON.stringify(m)); } catch { /* sem storage */ }
}

export async function geocodeDelivery(address: string, store: { pos: LatLng | null; city: string | null; state: string | null }): Promise<{ pos: LatLng; exact: boolean } | null> {
  const key = addressKey(address);
  if (!key || missed(key)) return null;
  const clean = cleanAddress(address);
  if (clean.replace(/[^a-z]/gi, "").length < 4) { markMiss(key); return null; }
  const where = [store.city, store.state].filter(Boolean).join(", ");
  const tries = [clean, clean.split(",")[0]].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const t of tries) {
    const hit = await nominatim({ q: where ? `${t}, ${where}` : t }, store.pos);
    if (hit) return hit;
  }
  markMiss(key);
  return null;
}

// Endereço da loja (a partir dos campos de Configurações)
export async function geocodeStore(a: { street: string; number: string; district: string; city: string; state: string }): Promise<{ pos: LatLng; exact: boolean } | null> {
  if (!a.city) return null;
  const street = [a.number, a.street].filter(Boolean).join(" ");
  if (street) {
    const hit = await nominatim({ street, city: a.city, state: a.state, country: "Brasil" });
    if (hit) return hit;
  }
  if (a.district) {
    const hit = await nominatim({ q: `${a.district}, ${a.city}, ${a.state}` });
    if (hit) return { pos: hit.pos, exact: false };
  }
  const hit = await nominatim({ city: a.city, state: a.state, country: "Brasil" });
  return hit ? { pos: hit.pos, exact: false } : null;
}
