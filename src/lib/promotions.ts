// Promoções: desconto em % para toda a loja, uma categoria, marca, coleção ou
// produtos escolhidos, num período e (opcional) só em alguns dias da semana.
// O PDV troca o preço do produto pelo menor preço válido (promoção ou o "preço
// promocional" do cadastro) e guarda o normal em list_price para mostrar riscado.

export interface Promotion {
  id: string; name: string;
  scope: "all" | "category" | "brand" | "collection" | "products";
  target: string | null; product_ids: string[];
  discount_pct: number; starts_on: string | null; ends_on: string | null;
  weekdays: number[]; active: boolean;
}

interface PromoProduct {
  id: string; sale_price: number; category_id?: string | null; variant_of?: string | null;
  brand?: string | null; collection?: string | null; promo_price?: number | null; promo_price_until?: string | null;
}

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function promoStatus(p: Promotion, now = new Date()): "active" | "scheduled" | "ended" | "paused" | "otherday" {
  const today = localIso(now);
  if (!p.active) return "paused";
  if (p.ends_on && p.ends_on < today) return "ended";
  if (p.starts_on && p.starts_on > today) return "scheduled";
  if (p.weekdays?.length && !p.weekdays.includes(now.getDay())) return "otherday";
  return "active";
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function matches(p: Promotion, prod: PromoProduct): boolean {
  switch (p.scope) {
    case "all": return true;
    case "category": return !!p.target && prod.category_id === p.target;
    case "brand": return !!p.target && norm(prod.brand) === norm(p.target);
    case "collection": return !!p.target && norm(prod.collection) === norm(p.target);
    case "products": return p.product_ids.includes(prod.id) || (!!prod.variant_of && p.product_ids.includes(prod.variant_of));
  }
}

export function bestPrice(prod: PromoProduct, promos: Promotion[], now = new Date()): { price: number; label: string } | null {
  const base = Number(prod.sale_price) || 0;
  if (base <= 0) return null;
  const today = localIso(now);
  let best: { price: number; label: string } | null = null;
  const pp = prod.promo_price != null ? Number(prod.promo_price) : null;
  if (pp != null && pp >= 0 && pp < base && (!prod.promo_price_until || prod.promo_price_until >= today)) best = { price: pp, label: "Promoção" };
  for (const p of promos) {
    if (promoStatus(p, now) !== "active" || !matches(p, prod)) continue;
    const price = Math.round(base * (1 - Number(p.discount_pct) / 100) * 100) / 100;
    if (!best || price < best.price) best = { price, label: p.name };
  }
  return best;
}

// Produtos com o preço da promoção aplicado (list_price = preço normal)
export function applyPromotions<T extends PromoProduct>(products: T[], promos: Promotion[]): (T & { list_price?: number; promo_label?: string })[] {
  const now = new Date();
  return products.map(p => {
    const b = bestPrice(p, promos, now);
    return b ? { ...p, sale_price: b.price, list_price: Number(p.sale_price), promo_label: b.label } : p;
  });
}
