// Impressão de cupons, pré-contas e pedidos.
// - No aparelho com impressora: imprime por um iframe escondido (sem abrir
//   janela; com o atalho --kiosk-printing sai direto, sem perguntar nada).
// - No celular sem impressora: manda para a fila (print_queue) e o computador
//   do caixa (estação com "cupons dos celulares" ligado) imprime sozinho.
// - Com o programa de impressão (Upabase Impressão) ligado na loja, todo
//   aparelho manda para a fila, inclusive o computador: sai sem janela nenhuma.
import { supabase } from "./supabase";
import { getStationPrefs, deviceId } from "./kitchen";

export type PrintTarget = "auto" | "here" | "station";
const TARGET_KEY = "print_target";

export function getPrintTarget(): PrintTarget {
  try { const v = localStorage.getItem(TARGET_KEY); return v === "here" || v === "station" ? v : "auto"; } catch { return "auto"; }
}
export function setPrintTarget(v: PrintTarget) {
  try { if (v === "auto") localStorage.removeItem(TARGET_KEY); else localStorage.setItem(TARGET_KEY, v); } catch { /* sem storage */ }
}

// Celular/tablet: tela de toque e sem mouse
const isMobileDevice = () => {
  try { return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches; } catch { return false; }
};

// Algum computador imprimindo cupons agora? (sinal nos últimos 30 s)
// agentOnly: só conta o programa de impressão instalado
export async function receiptStationOnline(agentOnly = false): Promise<boolean> {
  const since = new Date(Date.now() - 30_000).toISOString();
  let q = supabase.from("print_stations").select("device_id", { count: "exact", head: true })
    .eq("receipts", true).gte("seen_at", since).neq("device_id", deviceId());
  if (agentOnly) q = q.eq("is_agent", true);
  const { count } = await q;
  return (count ?? 0) > 0;
}

// Programa de impressão conectado (qualquer setor ou cupons), para a tela de Configurações
export async function printAgentOnline(): Promise<{ online: boolean; version: string | null }> {
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data } = await supabase.from("print_stations").select("agent_version")
    .eq("is_agent", true).gte("seen_at", since).limit(1);
  const row = (data ?? [])[0] as { agent_version: string | null } | undefined;
  return { online: !!row, version: row?.agent_version ?? null };
}

// Imprime um documento HTML completo neste aparelho, sem abrir janela
export function printLocal(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* sem impressora */ }
    setTimeout(() => iframe.remove(), 60_000);
  }, 300);
}

function toast(text: string, ok = true) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:12px;font:600 14px Arial,sans-serif;color:#fff;background:${ok ? "#059669" : "#dc2626"};box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function sendToStation(html: string, kind: string, title?: string): Promise<boolean> {
  const { error } = await supabase.from("print_queue").insert({
    kind, title: title ?? null, html, sent_by: navigator.userAgent.includes("Mobile") ? "celular" : "aparelho",
  });
  return !error;
}

// Ponto único de impressão de documentos (cupom, pré-conta, pedido).
// Devolve onde foi impresso.
export async function printDocument(html: string, opts: { kind: "receipt" | "prebill" | "order"; title?: string }): Promise<"here" | "station"> {
  const target = getPrintTarget();
  // Este aparelho é a estação de impressão: imprime aqui
  const isStation = getStationPrefs().autoPrint;
  let useStation = false;
  if (target === "station") useStation = true;
  else if (target === "auto" && !isStation) {
    // Celular: qualquer estação serve. Computador: só o programa (o navegador do caixa imprime aqui mesmo)
    useStation = await receiptStationOnline(!isMobileDevice()).catch(() => false);
  }

  if (useStation) {
    if (target === "station" && !(await receiptStationOnline().catch(() => false))) {
      toast("Nenhum computador de impressão ligado agora. O documento sai assim que ele for ligado (até 30 min).", false);
    }
    if (await sendToStation(html, opts.kind, opts.title)) {
      if (isMobileDevice() || target === "station") toast("Enviado para a impressora do caixa");
      return "station";
    }
    toast("Não foi possível enviar para o caixa. Imprimindo aqui.", false);
  }
  printLocal(html);
  return "here";
}

// Usado pela estação: imprime o que os celulares enviaram
export async function claimAndPrintQueue(): Promise<number> {
  const { data, error } = await supabase.rpc("claim_print_queue", { p_device: deviceId() });
  if (error || !data?.length) return 0;
  for (const row of data as { html: string }[]) {
    printLocal(row.html);
    // Um de cada vez: com --kiosk-printing cada documento vira um corte
    await new Promise(r => setTimeout(r, 1500));
  }
  return data.length;
}
