// ─── Mercado Pago Webhook Handler ─────────────────────────────────────────────
// Deploy: supabase functions deploy mp-webhook --no-verify-jwt
// Webhook URL: https://omsjsgnyjjuvixwyevox.supabase.co/functions/v1/mp-webhook

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MP_ACCESS_TOKEN    = Deno.env.get("MP_ACCESS_TOKEN")            ?? "";
const MP_WEBHOOK_SECRET  = Deno.env.get("MP_WEBHOOK_SECRET")          ?? "";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")               ?? "";
const SUPABASE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")  ?? "";

// Mapa: preapproval_plan_id do MP → plan_type do sistema
const MP_PLAN_MAP: Record<string, string> = {
  "972256de953c4c65b3ee06365d1f0808": "loja",      // Loja Mensal
  "a3716e086f1b425e832657a2576e54ca": "loja",      // Loja Anual
  "c54f782a2ca144f3b277b00e8fad57a6": "delivery",  // Delivery Mensal
  "76f5b3dd887c4a34916da685289c2eaa": "delivery",  // Delivery Anual
  "a9f190a3ee544a33b9d0287446d2ba77": "pro",       // Pro Mensal
  "d729eedfaa7b4bbaac2f07029d21b8d4": "pro",       // Pro Anual
};

const ANNUAL_IDS = new Set([
  "a3716e086f1b425e832657a2576e54ca",
  "76f5b3dd887c4a34916da685289c2eaa",
  "d729eedfaa7b4bbaac2f07029d21b8d4",
]);

// ─── Verificação de assinatura do MP ─────────────────────────────────────────
async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  if (!MP_WEBHOOK_SECRET) return false; // rejeita se secret não estiver configurado
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId) return false;

  // Extrai ts e v1 do header "ts=...,v1=..."
  const parts = Object.fromEntries(
    xSignature.split(",").map(p => p.split("=") as [string, string])
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  // Extrai o id do data
  let dataId = "";
  try { dataId = JSON.parse(rawBody)?.data?.id ?? ""; } catch { /* noop */ }

  // Template: id:{data.id};request-id:{x-request-id};ts:{ts};
  const template = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(template));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return hex === v1;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();

  // Verifica assinatura
  const valid = await verifySignature(req, rawBody);
  if (!valid) {
    console.warn("Assinatura inválida — requisição rejeitada");
    return new Response("Unauthorized", { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(rawBody); } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Ignora eventos que não sejam de assinatura
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

  const payerEmail = sub.payer_email as string | undefined;
  const planId     = sub.preapproval_plan_id as string | undefined;
  const status     = sub.status as string; // authorized | paused | cancelled | pending

  if (!payerEmail) {
    console.error("Sem payer_email na assinatura", subscriptionId);
    return new Response("OK", { status: 200 });
  }

  const planType = planId ? MP_PLAN_MAP[planId] : undefined;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  if (status === "authorized") {
    const expiresAt = new Date();
    ANNUAL_IDS.has(planId ?? "")
      ? expiresAt.setFullYear(expiresAt.getFullYear() + 1)
      : expiresAt.setMonth(expiresAt.getMonth() + 1);

    const { error } = await supabase
      .from("user_plans")
      .update({
        plan:               "active",
        plan_type:          planType ?? null,
        plan_expires_at:    expiresAt.toISOString(),
        mp_subscription_id: subscriptionId,
        is_lifetime:        false,
      })
      .eq("email", payerEmail);

    if (error) console.error("Erro ao ativar plano:", error);
    else console.log(`Plano ${planType} ativado — sub ${subscriptionId}`);

  } else if (status === "cancelled" || status === "paused") {
    const { error } = await supabase
      .from("user_plans")
      .update({
        plan:               "suspended",
        mp_subscription_id: subscriptionId,
      })
      .eq("email", payerEmail);

    if (error) console.error("Erro ao suspender plano:", error);
    else console.log(`Plano suspenso — sub ${subscriptionId} (status: ${status})`);
  }

  return new Response("OK", { status: 200 });
});
