// Estação de impressão em segundo plano: se este aparelho está com "imprimir
// automaticamente" ligado (aba Cozinha), os pedidos enviados dos seus setores
// saem na impressora com o sistema aberto em QUALQUER aba — o caixa pode ficar
// no PDV que a comanda da cozinha sai do mesmo jeito.
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { getStationPrefs, deviceId, printTickets, ticketsFromRows, type ClaimRow, type Sector } from "../lib/kitchen";
import { claimAndPrintQueue, printAgentOnline } from "../lib/printing";

export function StationPrinter() {
  const busy = useRef(false);
  const lastBeat = useRef(0);
  // Programa de impressão instalado na loja: ele imprime tudo e o navegador fica quieto
  const agent = useRef({ online: false, at: 0 });

  useEffect(() => {
    async function tick() {
      const prefs = getStationPrefs();
      if (!prefs.autoPrint || (prefs.sectors.length === 0 && !prefs.receipts) || busy.current) return;
      busy.current = true;
      try {
        // Sinal de vida: quem envia pedido sabe que há impressora ligada para o setor
        if (Date.now() - lastBeat.current > 10_000) {
          lastBeat.current = Date.now();
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            await supabase.from("print_stations").upsert(
              { user_id: session.user.id, device_id: deviceId(), sectors: prefs.sectors, receipts: prefs.receipts, seen_at: new Date().toISOString() },
              { onConflict: "user_id,device_id" });
          }
        }
        if (Date.now() - agent.current.at > 15_000) {
          agent.current = { online: (await printAgentOnline().catch(() => ({ online: false }))).online, at: Date.now() };
        }
        if (agent.current.online) return;

        // Cupons e pré-contas enviados pelos celulares
        if (prefs.receipts) await claimAndPrintQueue();

        if (prefs.sectors.length === 0) return;
        const { data, error } = await supabase.rpc("claim_kitchen_print", { p_sectors: prefs.sectors });
        if (!error && data?.length) printTickets(await ticketsFromRows(data as ClaimRow[]));

        const { data: cx } = await supabase.rpc("claim_kitchen_cancellations", { p_sectors: prefs.sectors });
        const rows = (cx ?? []) as { sale_id: string | null; origin_label: string | null; sector: Sector; product_name: string | null; quantity: number }[];
        if (rows.length) printTickets(rows.map(r => ({
          sector: r.sector, origin: r.origin_label ?? "Pedido", orderNum: (r.sale_id ?? "").slice(-6).toUpperCase(),
          lines: [{ quantity: Number(r.quantity), product_name: r.product_name, notes: null }], cancelled: true,
        })));
      } catch { /* sem rede: tenta de novo no próximo ciclo */ }
      finally { busy.current = false; }
    }
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, []);

  return null;
}
