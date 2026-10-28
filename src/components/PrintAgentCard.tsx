import { useEffect, useState } from "react";
import { Download, CheckCircle2, Circle, Link2, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { printAgentOnline } from "../lib/printing";
import { AGENT_DOWNLOAD_URL } from "../pages/print-agent";

// Configurações → Impressão automática: download do programa e se ele está ligado
export function PrintAgentCard({ isLight }: { isLight: boolean }) {
  const [status, setStatus] = useState<{ online: boolean; version: string | null } | null>(null);
  useEffect(() => {
    const check = () => printAgentOnline().then(setStatus).catch(() => setStatus({ online: false, version: null }));
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, []);
  const [pair, setPair] = useState<{ code: string; error?: string } | null>(null);
  const [pairing, setPairing] = useState(false);
  // Gera o código de uso único e abre o programa já com ele (upabase-impressao://)
  async function connect() {
    setPairing(true);
    const { data, error } = await supabase.rpc("create_agent_pair_code");
    setPairing(false);
    if (error || !data) { setPair({ code: "", error: error?.message ?? "Não foi possível gerar o código" }); return; }
    const code = String(data);
    setPair({ code });
    window.location.href = `upabase-impressao://conectar?codigo=${code}`;
  }
  const box = { background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" };
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Instale o <b>Upabase Impressão</b> no computador que tem a impressora. Cupons, pré-contas, pedidos do cardápio e comandas
        lançados em qualquer aparelho (computador, celular ou tablet) saem sozinhos, sem janela de imprimir.
      </p>
      <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={box}>
        {status?.online
          ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#10b981" }} />
          : <Circle className="w-4 h-4 flex-shrink-0 text-zinc-400" />}
        <p className="text-sm flex-1">
          {status === null ? "Verificando..." : status.online
            ? <>Programa ligado e imprimindo{status.version ? ` (versão ${status.version})` : ""}</>
            : "Nenhum computador com o programa ligado agora"}
        </p>
      </div>
      <a href={AGENT_DOWNLOAD_URL}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#315DFB", color: "#fff" }}>
        <Download className="w-4 h-4" /> Baixar programa de impressão (Windows)
      </a>
      <div className="rounded-xl px-4 py-3 space-y-2" style={box}>
        <button type="button" onClick={connect} disabled={pairing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: "#10b981", color: "#fff" }}>
          {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Conectar este computador
        </button>
        {pair?.error && <p className="text-xs text-red-500">{pair.error}</p>}
        {pair?.code && (
          <div className="text-xs text-zinc-500 space-y-1">
            <p>Se o navegador perguntar, clique em <b>Abrir Upabase Impressão</b>. Se não abrir sozinho, digite no programa o código:</p>
            <p className="text-2xl font-black tracking-[0.3em]" style={{ color: isLight ? "#111" : "#fff" }}>{pair.code.slice(0, 4)}-{pair.code.slice(4)}</p>
            <p>Vale por 15 minutos e só uma vez. Sem e-mail e sem senha.</p>
          </div>
        )}
      </div>
      <ol className="list-decimal ml-5 space-y-1 text-xs text-zinc-500">
        <li>Abra o arquivo baixado. Se o Windows mostrar "O Windows protegeu o computador", clique em <b>Mais informações → Executar assim mesmo</b>.</li>
        <li>Volte aqui e clique em <b>Conectar este computador</b> (ou digite no programa o código que aparecer).</li>
        <li>Escolha a impressora e clique em <b>Testar</b>. Pronto: ele liga sozinho junto com o computador.</li>
        <li>Neste computador, desligue o "Imprimir automaticamente" da aba Cozinha (o programa passa a fazer isso).</li>
      </ol>
    </div>
  );
}
