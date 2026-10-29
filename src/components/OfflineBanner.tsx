// Aviso de "sem internet" e envio automático das vendas guardadas (em qualquer aba).
import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useOfflineQueue, syncQueue, retryErrored, readQueue } from "../lib/offline";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OfflineBanner() {
  const { online: browserOnline, queue } = useOfflineQueue();
  // Wi-Fi ligado mas sem internet: o navegador acha que está online; a tentativa de envio diz a verdade
  const [stuck, setStuck] = useState(false);
  const pending = queue.filter(q => q.status === "pending");
  const errored = queue.filter(q => q.status === "error");
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(0);
  const [showErrors, setShowErrors] = useState(false);

  async function trySync() {
    if (sending) return;
    setSending(true);
    const r = await syncQueue().catch(() => ({ sent: 0, failed: 0 }));
    setSending(false);
    setStuck(readQueue().some(q => q.status === "pending"));
    if (r.sent > 0) { setJustSent(r.sent); setTimeout(() => setJustSent(0), 6000); }
  }

  // Envia assim que a internet volta e, enquanto houver fila, tenta a cada 20 s
  useEffect(() => {
    if (pending.length === 0) return;
    trySync();
    const t = setInterval(trySync, 20_000);
    window.addEventListener("online", trySync);
    return () => { clearInterval(t); window.removeEventListener("online", trySync); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, browserOnline]);

  const online = browserOnline && !stuck;
  if (online && pending.length === 0 && errored.length === 0 && !justSent) return null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-2xl text-sm border"
        style={!online || pending.length
          ? { background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }
          : errored.length ? { background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }
          : { background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46" }}>
        {!online ? <WifiOff className="w-4 h-4 shrink-0" />
          : pending.length ? <RefreshCw className={`w-4 h-4 shrink-0 ${sending ? "animate-spin" : ""}`} />
          : errored.length ? <AlertTriangle className="w-4 h-4 shrink-0" />
          : <CheckCircle2 className="w-4 h-4 shrink-0" />}
        <p className="flex-1 min-w-[200px]">
          {!online
            ? <><b>Sem internet.</b> Pode continuar vendendo no PDV: as vendas ficam guardadas neste computador{pending.length ? ` (${pending.length} guardada${pending.length > 1 ? "s" : ""})` : ""} e sobem sozinhas quando a internet voltar.</>
            : pending.length
            ? <><b>Enviando {pending.length} venda{pending.length > 1 ? "s" : ""} guardada{pending.length > 1 ? "s" : ""}…</b> Não feche o sistema até terminar.</>
            : errored.length
            ? <><b>{errored.length} venda{errored.length > 1 ? "s" : ""} guardada{errored.length > 1 ? "s" : ""} não {errored.length > 1 ? "subiram" : "subiu"}.</b> Confira antes de fechar o caixa.</>
            : <><b>Tudo enviado.</b> {justSent} venda{justSent > 1 ? "s" : ""} feita{justSent > 1 ? "s" : ""} sem internet {justSent > 1 ? "já estão" : "já está"} no sistema.</>}
        </p>
        {online && pending.length > 0 && !sending && (
          <button onClick={trySync} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/70 border border-current">Enviar agora</button>
        )}
        {errored.length > 0 && (
          <button onClick={() => setShowErrors(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/70 border border-current">Ver</button>
        )}
      </div>

      {showErrors && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowErrors(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl p-5 space-y-3 shadow-2xl text-gray-900" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <p className="font-bold flex-1">Vendas guardadas que não subiram</p>
              <button onClick={() => setShowErrors(false)} className="p-1 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500">Elas continuam guardadas neste computador. Tente de novo; se repetir, chame o suporte com o motivo abaixo.</p>
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
              {errored.map(e => (
                <div key={e.id} className="py-2 text-sm">
                  <div className="flex justify-between"><b>#{e.orderNum}</b><span>{fmt(e.total)}</span></div>
                  <p className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleString("pt-BR")}</p>
                  <p className="text-xs text-red-600">{e.error}</p>
                </div>
              ))}
            </div>
            <button onClick={() => { retryErrored(); setShowErrors(false); trySync(); }}
              className="w-full py-2.5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700" style={{ color: "#fff" }}>
              Tentar enviar de novo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
