// Vercel Serverless Function — gera uma página HTML enxuta com as tags
// Open Graph corretas (título, descrição e IMAGEM DA LOGO da loja) para
// quando o link do cardápio é compartilhado no WhatsApp/Facebook/Telegram.
//
// Só é chamada para visitantes "robôs" de preview de link (ver vercel.json,
// que só redireciona pra cá quando o User-Agent é de um desses serviços).
// Um visitante normal continua caindo direto no app React de sempre.

import { createClient } from "@supabase/supabase-js";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).send("Missing Supabase config");
      return;
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `https://${host}`;

    let uid = typeof req.query.uid === "string" ? req.query.uid : null;
    const slug = typeof req.query.slug === "string" ? req.query.slug : null;

    // Se veio por /loja/:slug, primeiro acha o uid dono desse apelido.
    if (!uid && slug) {
      const { data } = await supabase
        .from("menu_store_settings")
        .select("user_id")
        .filter("settings->>slug", "eq", slug.trim().toLowerCase())
        .maybeSingle();
      uid = data?.user_id ?? null;
    }

    let title = "Cardápio Digital";
    let description = "Veja nosso cardápio, escolha seus itens e faça seu pedido online.";
    let image = `${origin}/og-image.svg`;
    let redirectPath = "/";

    if (uid) {
      const { data: row } = await supabase
        .from("menu_store_settings")
        .select("settings")
        .eq("user_id", uid)
        .maybeSingle();
      const s = row?.settings ?? {};
      if (s.store_name) title = s.store_name;
      if (s.tagline) description = s.tagline;
      if (s.logo_url) image = s.logo_url;
      redirectPath = `/menu/${uid}`;
    }

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(title)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:url" content="${escapeHtml(origin + redirectPath)}" />
<meta property="og:locale" content="pt_BR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(redirectPath)}" />
</head>
<body>
<a href="${escapeHtml(redirectPath)}">${escapeHtml(title)}</a>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).send(html);
  } catch (e) {
    res.status(500).send("Preview error");
  }
}
