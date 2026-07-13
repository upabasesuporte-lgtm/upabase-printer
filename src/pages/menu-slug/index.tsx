import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

// Página "ponte": recebe /loja/:slug, acha a loja dona desse apelido e
// redireciona pra URL canônica /menu/:uid — assim o link compartilhado
// fica curto e com o nome da loja, sem precisar mexer no cardápio público
// (menu/index.tsx) que já funciona com o :uid direto. Rota 100% client-side
// (React Router), não depende de nenhuma configuração no vercel.json.
export default function MenuSlugRedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!slug) { setNotFound(true); return; }
      const { data, error } = await supabase
        .from("menu_store_settings")
        .select("user_id")
        .filter("settings->>slug", "eq", slug.trim().toLowerCase())
        .maybeSingle();
      if (cancelled) return;
      if (!error && data?.user_id) {
        navigate(`/menu/${data.user_id}`, { replace: true });
      } else {
        setNotFound(true);
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [slug, navigate]);

  if (notFound) {
    return (
      <div style={{ minHeight: "100vh", background: "#09090b", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Cardápio não encontrado</h1>
        <p style={{ color: "#71717a", fontSize: 13 }}>Confira se o link está certo.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#a1a1aa", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
      Carregando…
    </div>
  );
}
