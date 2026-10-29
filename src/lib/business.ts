// Tipo de negócio da loja: "food" (restaurante/marmitaria, o padrão) ou
// "retail" (loja de roupas, calçados e varejo). Guardado em store_settings e
// copiado para este aparelho, para o menu e as telas se adaptarem na hora.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type BusinessType = "food" | "retail";
const KEY = "business_type";
const EVENT = "business-type-change";

// Abas que só fazem sentido em restaurante (somem no varejo)
export const FOOD_ONLY_ROUTES = ["/tables", "/kitchen", "/costs"];
// Abas que só aparecem no varejo
export const RETAIL_ONLY_ROUTES = ["/consignments"];

export function routeFitsBusiness(path: string, t: BusinessType) {
  return t === "retail" ? !FOOD_ONLY_ROUTES.includes(path) : !RETAIL_ONLY_ROUTES.includes(path);
}

export function getBusinessType(): BusinessType {
  try { return localStorage.getItem(KEY) === "retail" ? "retail" : "food"; } catch { return "food"; }
}

function cacheBusinessType(t: BusinessType) {
  try { localStorage.setItem(KEY, t); } catch { /* sem armazenamento */ }
  window.dispatchEvent(new Event(EVENT));
}

export async function refreshBusinessType(userId: string): Promise<void> {
  const { data, error } = await supabase.from("store_settings").select("business_type").eq("user_id", userId).maybeSingle();
  if (error) return; // sem internet: segue com o guardado
  cacheBusinessType(data?.business_type === "retail" ? "retail" : "food");
}

export async function saveBusinessType(userId: string, t: BusinessType): Promise<string | null> {
  const { error } = await supabase.from("store_settings")
    .upsert({ user_id: userId, business_type: t, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return error.message;
  cacheBusinessType(t);
  return null;
}

export function useBusinessType(): BusinessType {
  const [t, setT] = useState<BusinessType>(getBusinessType);
  useEffect(() => {
    const on = () => setT(getBusinessType());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return t;
}
