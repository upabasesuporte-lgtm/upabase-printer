// Busca que ignora acentos e maiúsculas: "oleo" encontra "Óleo" e vice-versa.

export function normalizeSearch(v: string): string {
  return v.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function matchesSearch(text: string | null | undefined, query: string): boolean {
  const q = normalizeSearch(query);
  return q === "" || normalizeSearch(text ?? "").includes(q);
}

const ACCENT_CLASS: Record<string, string> = {
  a: "[aáàâãä]", e: "[eéèêë]", i: "[iíìîï]", o: "[oóòôõö]", u: "[uúùûü]", c: "[cç]", n: "[nñ]",
};

// Regex (para o filtro `imatch` do Supabase) que encontra o termo com ou sem acento.
// Remove os caracteres que quebram a sintaxe do filtro `or(...)` do PostgREST.
export function accentInsensitivePattern(query: string): string {
  const clean = normalizeSearch(query).replace(/[,()"\\]/g, " ");
  return Array.from(clean)
    .map(ch => ACCENT_CLASS[ch] ?? ch.replace(/[.*+?^${}|[\]\\]/g, "\\$&"))
    .join("");
}
