import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";

interface AvaliacaoPublica {
  id: string;
  nome: string;
  foto_url: string | null;
  estrelas: number;
  texto: string;
}

export function AvaliacoesPublicas() {
  const [reviews, setReviews] = useState<AvaliacaoPublica[]>([]);
  const [idx, setIdx]         = useState(0);
  const [loaded, setLoaded]   = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("avaliacoes")
      .select("id, nome, foto_url, estrelas, texto")
      .eq("aprovado", true)
      .order("created_at", { ascending: false })
      .limit(20);
    setReviews((data ?? []) as AvaliacaoPublica[]);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-avança a cada 5 s
  useEffect(() => {
    if (reviews.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % reviews.length), 5000);
    return () => clearInterval(t);
  }, [reviews.length]);

  // Se não carregou ainda ou não há avaliações aprovadas: não renderiza nada
  if (!loaded || reviews.length === 0) return null;

  const curr = reviews[idx];
  const prev = () => setIdx(i => (i - 1 + reviews.length) % reviews.length);
  const next = () => setIdx(i => (i + 1) % reviews.length);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#9CA3AF" }}>
        O que nossos clientes dizem
      </p>
      <p className="text-xs mb-3" style={{ color: "#9CA3AF" }}>
        Seja um dos primeiros e ajude a moldar o sistema
      </p>

      {/* Card do depoimento atual */}
      <div className="relative rounded-xl p-4" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
        {/* Foto + nome */}
        <div className="flex items-center gap-3 mb-3">
          {curr.foto_url ? (
            <img
              src={curr.foto_url}
              alt={curr.nome}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              style={{ border: "1px solid #e5e7eb" }}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-black text-sm"
              style={{ background: "linear-gradient(135deg,#7B2FBE,#00B4D8)", color: "#fff" }}
            >
              {curr.nome[0]?.toUpperCase()}
            </div>
          )}
          <p className="text-sm font-semibold truncate" style={{ color: "#111" }}>{curr.nome}</p>
        </div>

        {/* Estrelas */}
        <div className="flex gap-0.5 mb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`w-3 h-3 ${i < curr.estrelas ? "fill-amber-400 text-amber-400" : ""}`}
              style={i >= curr.estrelas ? { color: "#D1D5DB" } : {}}
            />
          ))}
        </div>

        {/* Texto */}
        <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "#374151" }}>"{curr.texto}"</p>

        {/* Navegação (só quando há mais de 1) */}
        {reviews.length > 1 && (
          <div className="flex items-center justify-between mt-3">
            <div className="flex gap-1">
              {reviews.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  style={{
                    width: i === idx ? 14 : 5, height: 5,
                    borderRadius: 99, transition: "all 0.3s",
                    background: i === idx ? "#7B2FBE" : "#D1D5DB",
                  }}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <button onClick={prev} className="p-1 rounded-lg transition-colors" style={{ color: "#9CA3AF" }}
                onMouseEnter={e => { e.currentTarget.style.color = "#7B2FBE"; e.currentTarget.style.background = "#F3F4F6"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#9CA3AF"; e.currentTarget.style.background = "transparent"; }}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={next} className="p-1 rounded-lg transition-colors" style={{ color: "#9CA3AF" }}
                onMouseEnter={e => { e.currentTarget.style.color = "#7B2FBE"; e.currentTarget.style.background = "#F3F4F6"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#9CA3AF"; e.currentTarget.style.background = "transparent"; }}>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
