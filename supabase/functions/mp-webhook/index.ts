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
    xSignature.split(",").map(p => p.trim().split("=") as [string, string])
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  // Extrai o id do data
  let dataId = new URL(req.url).searchParams.get("data.id") ?? "";
  if (!dataId) { try { dataId = String(JSON.parse(rawBody)?.data?.id ?? ""); } catch { /* noop */ } }
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();

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

  const type = body.type as string | undefined;
  const dataId = body.data?.id ? String(body.data.id) : "";
  if (!dataId || (type !== "subscription_preapproval" && type !== "subscription_authorized_payment")) {
    return new Response("OK", { status: 200 });
  }

  const mp = (path: string) => fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });

  // Mensalidade cobrada (renovação): chega como authorized_payment e aponta para a assinatura
  let subscriptionId = dataId;
  let paymentApproved = false;
  if (type === "subscription_authorized_payment") {
    const payRes = await mp(`/authorized_payments/${dataId}`);
    if (!payRes.ok) {
      console.error("Erro ao buscar cobrança no MP:", await payRes.text());
      return new Response("MP Error", { status: 500 });
    }
    const pay = await payRes.json();
    subscriptionId = pay.preapproval_id;
    paymentApproved = pay.payment?.status === "approved" || pay.status === "processed";
    if (!subscriptionId || !paymentApproved) {
      console.log(`Cobrança ${dataId} ainda não aprovada (status: ${pay.status}/${pay.payment?.status})`);
      return new Response("OK", { status: 200 });
    }
  }

  // Busca detalhes da assinatura na API do MP
  const mpRes = await mp(`/preapproval/${subscriptionId}`);
  if (!mpRes.ok) {
    console.error("Erro ao buscar assinatura no MP:", await mpRes.text());
    return new Response("MP Error", { status: 500 });
  }
  const sub = await mpRes.json();

  const payerEmail = (sub.payer_email as string | undefined)?.trim() || undefined;
  const planId     = sub.preapproval_plan_id as string | undefined;
  const status     = sub.status as string; // authorized | paused | cancelled | pending
  const planType   = planId ? MP_PLAN_MAP[planId] : undefined;
  const supabase   = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Encontra a conta: primeiro pela assinatura já vinculada, depois pelo e-mail (sem diferenciar maiúsculas)
  let row: { user_id: string; plan_expires_at: string | null; is_lifetime: boolean | null } | null = null;
  {
    const { data } = await supabase.from("user_plans").select("user_id, plan_expires_at, is_lifetime")
      .eq("mp_subscription_id", subscriptionId).limit(1).maybeSingle();
    row = data;
  }
  if (!row && payerEmail) {
    const { data } = await supabase.from("user_plans").select("user_id, plan_expires_at, is_lifetime")
      .ilike("email", payerEmail.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
    row = data;
  }
  if (!row) {
    // Pagou com e-mail diferente do cadastro: liberar manualmente pelo painel Admin
    console.error(`Assinatura ${subscriptionId} sem conta correspondente (e-mail MP: ${payerEmail ?? "vazio"}, plano: ${planType ?? planId})`);
    return new Response("OK", { status: 200 });
  }

  // Conta vitalícia não muda por causa de assinatura
  if (row.is_lifetime) {
    console.log(`Assinatura ${subscriptionId} ignorada: conta vitalícia`);
    return new Response("OK", { status: 200 });
  }

  if (status === "authorized") {
    // Vale até a próxima cobrança + 3 dias de folga (cartão recusado, atraso do MP)
    const fallback = new Date();
    ANNUAL_IDS.has(planId ?? "")
      ? fallback.setFullYear(fallback.getFullYear() + 1)
      : fallback.setMonth(fallback.getMonth() + 1);
    const next = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
    const base = next && !isNaN(next.getTime()) && next > new Date() ? next : fallback;
    const expiresAt = new Date(base.getTime() + 3 * 86400000);
    // Nunca encurta um vencimento que já está mais longe
    const current = row.plan_expires_at ? new Date(row.plan_expires_at) : null;
    const finalExpires = current && current > expiresAt ? current : expiresAt;

    const { error } = await supabase
      .from("user_plans")
      .update({
        plan:               "active",
        plan_type:          planType ?? null,
        plan_expires_at:    finalExpires.toISOString(),
        mp_subscription_id: subscriptionId,
        is_lifetime:        false,
      })
      .eq("user_id", row.user_id);

    if (error) console.error("Erro ao ativar plano:", error);
    else console.log(`Plano ${planType} ativo até ${finalExpires.toISOString()} — sub ${subscriptionId}${paymentApproved ? " (mensalidade paga)" : ""}`);

  } else if (status === "cancelled" || status === "paused") {
    // Cancelou: continua usando até o fim do período já pago; depois o vencimento bloqueia sozinho
    const { error } = await supabase
      .from("user_plans")
      .update({ mp_subscription_id: subscriptionId })
      .eq("user_id", row.user_id);

    if (error) console.error("Erro ao registrar cancelamento:", error);
    else console.log(`Assinatura ${status} — sub ${subscriptionId}; acesso segue até o vencimento já pago`);
  }

  return new Response("OK", { status: 200 });
});
