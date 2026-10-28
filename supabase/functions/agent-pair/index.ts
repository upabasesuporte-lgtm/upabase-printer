// ─── Ligar o programa de impressão à loja com um código (sem e-mail/senha) ───
// Deploy: supabase functions deploy agent-pair --no-verify-jwt
// O sistema (logado) gera o código com create_agent_pair_code(); o programa
// manda o código aqui e recebe um login de uso único (magic link) da loja.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let code = "";
  try { code = String((await req.json())?.code ?? ""); } catch { /* corpo inválido */ }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) return json({ error: "Código inválido" }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // Consome o código (uso único, dentro da validade)
  const { data: row, error } = await supabase.from("agent_pair_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code).is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("user_id").maybeSingle();
  if (error) { console.error("agent-pair:", error.message); return json({ error: "Erro ao conectar" }, 500); }
  if (!row) return json({ error: "Código inválido ou vencido. Gere outro em Configurações." }, 400);

  const { data: user, error: uErr } = await supabase.auth.admin.getUserById(row.user_id);
  const email = user?.user?.email;
  if (uErr || !email) return json({ error: "Conta não encontrada" }, 400);

  const { data: link, error: lErr } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (lErr || !tokenHash) { console.error("agent-pair link:", lErr?.message); return json({ error: "Erro ao conectar" }, 500); }

  return json({ token_hash: tokenHash, email });
});
