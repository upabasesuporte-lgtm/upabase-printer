// ─── Mercado Pago Webhook Handler ─────────────────────────────────────────────
// Deploy: supabase functions deploy mp-webhook
// Webhook URL: https://SEU_PROJETO.supabase.co/functions/v1/mp-webhook
// Configure essa URL no painel do Mercado Pago em Webhooks → preapproval

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Mapa: preapproval_plan_id do MP → plan_type do sistema
const MP_PLAN_MAP: Record<string, string> = {
  "CONFIGURE_MP_ID_LOJA_MENSAL":     "loja",
  "CONFIGURE_MP_ID_LOJA_ANUAL":      "loja",
  "CONFIGURE_MP_ID_DELIVERY_MENSAL": "delivery",
  "CONFIGURE_MP_ID_DELIVERY_ANUAL":  "delivery",
  "CONFIGURE_MP_ID_PRO_MENSAL":      "pro",
  "CONFIGURE_MP_ID_PRO_ANUAL":       "pro",
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // MP envia eventos do tipo "subscription_preapproval"
  if (body.type !== "subscription_preapproval" || !body.data?.id) {
    return new Response("OK", { status: 200 });
  }

  const subscriptionId = body.data.id;

  // Busca detalhes da assinatura na API do MP
  const mpRes = await fetch(
    `https://api.mercadopago.com/preapproval/${subscriptionId}`,
    { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
  );

  if (!mpRes.ok) {
    console.error("Erro ao buscar assinatura no MP:", await mpRes.text());
    return new Response("MP Error", { status: 500 });
  }

  const sub = await mpRes.json();

  // Campos relevantes
  const payerEmail   = sub.payer_email as string | undefined;
  const planId       = sub.preapproval_plan_id as string | undefined;
  const status       = sub.status as string; // authorized | paused | cancelled | pending

  if (!payerEmail) {
    console.error("Sem payer_email na assinatura");
    return new Response("OK", { status: 200 });
  }

  const planType = planId ? MP_PLAN_MAP[planId] : undefined;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  if (status === "authorized") {
    // Assinatura ativa — calcula expiração (1 mês ou 1 ano dependendo do plano)
    const expiresAt = new Date();
    const isAnnual = planId?.includes("ANUAL") || planId?.includes("anual");
    isAnnual ? expiresAt.setFullYear(expiresAt.getFullYear() + 1)
             : expiresAt.setMonth(expiresAt.getMonth() + 1);

    const { error } = await supabase
      .from("user_plans")
      .update({
        plan:                "active",
        plan_type:           planType ?? null,
        plan_expires_at:     expiresAt.toISOString(),
        mp_subscription_id:  subscriptionId,
        is_lifetime:         false,
      })
      .eq("email", payerEmail);

    if (error) console.error("Erro ao atualizar plano:", error);

  } else if (status === "cancelled" || status === "paused") {
    const { error } = await supabase
      .from("user_plans")
      .update({
        plan:               "suspended",
        mp_subscription_id: subscriptionId,
      })
      .eq("email", payerEmail);

    if (error) console.error("Erro ao suspender plano:", error);
  }

  return new Response("OK", { status: 200 });
});
