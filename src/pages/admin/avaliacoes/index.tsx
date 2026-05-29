import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { useTheme } from "../../../contexts/ThemeContext";
import {
  Star, Check, X, RefreshCw, ChevronLeft, Trash2, MessageSquare,
} from "lucide-react";

const ADMIN_EMAIL = "upabasesuporte@gmail.com";

interface Avaliacao {
  id: string;
  usuario_id: string | null;
  nome: string;
  foto_url: string | null;
  estrelas: number;
  texto: string;
  aprovado: boolean;
  created_at: string;
}

type Filtro = "pendentes" | "aprovadas" | "todas";

export default function AdminAvaliacoesPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const card = isLight ? {
    bg: "#ffffff",
    border: "1px solid #e5e7eb",
    shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    bg: "#18181b",
    border: "1px solid rgba(39,39,42,0.8)",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
  const [avaliacoes, setAvaliacoes]   = useState<Avaliacao[]>([]);
  const [loading, setLoading]         = useState(true);
  const [actionId, setActionId]       = useState<string | null>(null);
  const [filtro, setFiltro]           = useState<Filtro>("pendentes");

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email !== ADMIN_EMAIL) { navigate("/"); return; }
    setLoading(true);
    const { data } = await supabase
      .from("avaliacoes")
      .select("*")
      .order("aprovado")          // pendentes primeiro (false < true)
      .order("created_at", { ascending: false });
    setAvaliacoes((data ?? []) as Avaliacao[]);
    setLoading(false);
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  async function setAprovado(id: string, aprovado: boolean) {
    setActionId(id);
    await supabase.from("avaliacoes").update({ aprovado }).eq("id", id);
    setAvaliacoes(prev => prev.map(a => a.id === id ? { ...a, aprovado } : a));
    setActionId(null);
  }

  async function excluir(id: string) {
    if (!window.confirm("Excluir esta avaliação permanentemente?")) return;
    setActionId(id + "_del");
    await supabase.from("avaliacoes").delete().eq("id", id);
    setAvaliacoes(prev => prev.filter(a => a.id !== id));
    setActionId(null);
  }

  const lista = avaliacoes.filter(a => {
    if (filtro === "pendentes") return !a.aprovado;
    if (filtro === "aprovadas") return a.aprovado;
    return true;
  });

  const countPendentes = avaliacoes.filter(a => !a.aprovado).length;
  const countAprovadas = avaliacoes.filter(a =>  a.aprovado).length;

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl p-5 mb-5"
        style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin")}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors border border-zinc-800">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#f59e0b", boxShadow: "0 0 6px #f59e0b" }} />
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#f59e0b" }}>Admin</span>
              </div>
              <h1 className="text-2xl font-black" style={{ color: isLight ? "#111" : "#fff" }}>Avaliações</h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                <span className="text-amber-400">{countPendentes} pendente{countPendentes !== 1 ? "s" : ""}</span>
                <span className="mx-1">·</span>
                <span className="text-emerald-400">{countAprovadas} aprovada{countAprovadas !== 1 ? "s" : ""}</span>
              </p>
            </div>
          </div>
          <button onClick={load}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl border border-zinc-800 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {([
          ["pendentes", `Pendentes (${countPendentes})`],
          ["aprovadas", `Aprovadas (${countAprovadas})`],
          ["todas",     `Todas (${avaliacoes.length})`],
        ] as [Filtro, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFiltro(key)}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              filtro === key ? "bg-violet-600 text-white" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Lista ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="w-5 h-5 animate-spin text-violet-400" />
        </div>
      ) : lista.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-zinc-800 rounded-2xl">
          <MessageSquare className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-semibold">
            Nenhuma avaliação {filtro === "pendentes" ? "pendente" : filtro === "aprovadas" ? "aprovada" : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map(a => {
            const isLoading   = actionId === a.id || actionId === a.id + "_del";
            const isDelLoading = actionId === a.id + "_del";
            return (
              <div
                key={a.id}
                className={`flex gap-4 p-4 rounded-2xl border transition-all ${
                  a.aprovado
                    ? "bg-zinc-900/50 border-zinc-800"
                    : "bg-amber-500/[0.04] border-amber-500/20"
                }`}
              >
                {/* Avatar */}
                <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800 flex-shrink-0 flex items-center justify-center border border-zinc-700">
                  {a.foto_url ? (
                    <img src={a.foto_url} className="w-full h-full object-cover" alt={a.nome} />
                  ) : (
                    <span className="text-base font-black text-zinc-400">
                      {a.nome[0]?.toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold text-white">{a.nome}</span>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${i < a.estrelas ? "fill-amber-400 text-amber-400" : "text-zinc-700"}`}
                        />
                      ))}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      a.aprovado
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}>
                      {a.aprovado ? "Aprovada" : "Pendente"}
                    </span>
                    <span className="text-xs text-zinc-600 ml-auto whitespace-nowrap">
                      {new Date(a.created_at).toLocaleDateString("pt-BR", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{a.texto}</p>
                </div>

                {/* Ações */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  {!a.aprovado ? (
                    <button
                      onClick={() => setAprovado(a.id, true)}
                      disabled={isLoading}
                      title="Aprovar avaliação"
                      className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl transition-colors disabled:opacity-40"
                    >
                      {actionId === a.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Check className="w-4 h-4" />}
                    </button>
                  ) : (
                    <button
                      onClick={() => setAprovado(a.id, false)}
                      disabled={isLoading}
                      title="Remover aprovação"
                      className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl transition-colors disabled:opacity-40"
                    >
                      {actionId === a.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <X className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => excluir(a.id)}
                    disabled={isDelLoading}
                    title="Excluir"
                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors disabled:opacity-40"
                  >
                    {isDelLoading
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
