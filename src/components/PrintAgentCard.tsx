import { useEffect, useState } from "react";
import { Download, CheckCircle2, Circle } from "lucide-react";
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
      <ol className="list-decimal ml-5 space-y-1 text-xs text-zinc-500">
        <li>Abra o arquivo baixado. Se o Windows mostrar "O Windows protegeu o computador", clique em <b>Mais informações → Executar assim mesmo</b>.</li>
        <li>Entre com o mesmo e-mail e senha do sistema (só na primeira vez).</li>
        <li>Escolha a impressora e clique em <b>Testar</b>. Pronto: ele liga sozinho junto com o computador.</li>
        <li>Neste computador, desligue o "Imprimir automaticamente" da aba Cozinha (o programa passa a fazer isso).</li>
      </ol>
    </div>
  );
}
