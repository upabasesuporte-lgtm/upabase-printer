// Cozinha (KDS + estação de impressão + despacho + motoboys).
// Os itens chegam aqui quando são lançados (Mesas, PDV, Cardápio Digital) e a
// categoria do produto tem setor (Cozinha/Bar/Balcão) — ver aba "Setores".
import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { PageHeader } from "../../components/PageHeader";
import { playAlertBeep } from "../../lib/audio";
import { fetchAll } from "../../lib/fetchAll";
import { requireApproval } from "../../lib/operators";
import {
  SECTOR_LABEL, SECTORS, printTickets, getStationPrefs, setStationPrefs, originOf, loadSales,
  type Sector, type StationPrefs, type KSale,
} from "../../lib/kitchen";
import { getPrintTarget, setPrintTarget, type PrintTarget } from "../../lib/printing";
import type { MapOrder } from "./DeliveryMap";
// Mapa de entregas: carregado só quando aberto
const DeliveryMap = lazy(() => import("./DeliveryMap"));
import {
  ChefHat, Printer, Smartphone, Clock, Bike, Store, UtensilsCrossed, CheckCircle2, Flame,
  Plus, Trash2, Save, Loader2, Info, Tags,
} from "lucide-react";

type KdsState = "new" | "preparing" | "ready";

interface KItem {
  id: string; sale_id: string; sector: Sector; quantity: number; notes: string | null;
  kds_state: KdsState; kds_created_at: string; product_name: string;
}
interface Courier { id: string; name: string; phone: string | null; fee_per_delivery: number; active: boolean }
interface Category { id: string; name: string; print_sector: Sector | null }

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Base sem largura: campos de largura fixa usam inputBase (com w-full o tamanho fixo era ignorado)
const inputBase = "px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-all";
const inputCls = "w-full " + inputBase;

export default function KitchenPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const card = isLight
    ? { background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.05)" }
    : { background: "#18181b", border: "1px solid rgba(39,39,42,0.8)" };
  const [tab, setTab] = useState<"orders" | "couriers" | "sectors">("orders");

  return (
    <div className="space-y-4">
      <PageHeader title="Cozinha" subtitle="Pedidos por setor, impressão automática e despacho" />
      <div className="flex gap-2 flex-wrap">
        {([["orders", "Pedidos", ChefHat], ["couriers", "Motoboys", Bike], ["sectors", "Setores", Tags]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all"
            style={tab === k ? { background: "#315DFB", color: "#fff" } : { ...card, color: isLight ? "#374151" : "#d4d4d8" }}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "orders" && <SetupWarning card={card} onGo={() => setTab("sectors")} />}
      {tab === "orders" && <OrdersBoard isLight={isLight} card={card} />}
      {tab === "couriers" && <CouriersTab isLight={isLight} card={card} />}
      {tab === "sectors" && <SectorsTab isLight={isLight} card={card} />}
    </div>
  );
}

// Aviso quando nenhuma categoria tem setor: nada chega na cozinha até configurar
function SetupWarning({ card, onGo }: { card: React.CSSProperties; onGo: () => void }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user.id;
      if (!uid) return;
      const [{ count }, { data: us }] = await Promise.all([
        supabase.from("categories").select("id", { count: "exact", head: true }).eq("user_id", uid).not("print_sector", "is", null),
        supabase.from("user_settings").select("uncategorized_print_sector").eq("user_id", uid).maybeSingle(),
      ]);
      setMissing((count ?? 0) === 0 && !(us as any)?.uncategorized_print_sector);
    })();
  }, []);
  if (!missing) return null;
  return (
    <div className="rounded-2xl p-4 flex flex-wrap items-center gap-3" style={{ ...card, border: "2px solid #f59e0b" }}>
      <Info className="w-5 h-5 text-amber-500" />
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-bold">Nenhum pedido vai chegar aqui ainda</p>
        <p className="text-xs text-zinc-500">Escolha para qual setor (Cozinha, Bar ou Balcão) vai cada categoria de produto.</p>
      </div>
      <button onClick={onGo} className="px-4 py-2 rounded-xl text-sm font-bold" style={{ color: "#fff", background: "#f59e0b" }}>Configurar setores</button>
    </div>
  );
}

// ── Pedidos (KDS) ─────────────────────────────────────────────────────────────

function OrdersBoard({ isLight, card }: { isLight: boolean; card: React.CSSProperties }) {
  const [prefs, setPrefs] = useState<StationPrefs>(getStationPrefs);
  const [items, setItems] = useState<KItem[]>([]);
  const [sales, setSales] = useState<Record<string, KSale>>({});
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  // Atalho do Chrome com impressão direta (sem a janela de imprimir)
  const kioskCmd = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing ${window.location.origin}`;
  const [courierPick, setCourierPick] = useState<string | null>(null); // pedido com a lista de motoboys aberta
  const [view, setView] = useState<"list" | "map">(() => {
    try { return localStorage.getItem("kitchen_view") === "map" ? "map" : "list"; } catch { return "list"; }
  });
  const changeView = (v: "list" | "map") => { setView(v); try { localStorage.setItem("kitchen_view", v); } catch { /* sem storage */ } };
  const seen = useRef<Set<string> | null>(null);

  const updatePrefs = (p: StationPrefs) => { setPrefs(p); setStationPrefs(p); };
  const [target, setTarget] = useState<PrintTarget>(() => getPrintTarget());

  const load = useCallback(async () => {
    if (prefs.sectors.length === 0) { setItems([]); setLoading(false); return; }
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const { data, error } = await supabase.from("sale_items")
      .select("id, sale_id, sector, quantity, notes, kds_state, kds_created_at, products(name)")
      .in("kds_state", ["new", "preparing", "ready"]).in("sector", prefs.sectors)
      .gte("kds_created_at", since).order("kds_created_at").limit(1000);
    if (error) { setErr(error.message); setLoading(false); return; }
    setErr(null);
    const list: KItem[] = (data ?? []).map((r: any) => ({ ...r, quantity: Number(r.quantity), product_name: r.products?.name ?? "Produto" }));
    // Aviso sonoro quando chega item novo (não na primeira carga)
    const ids = new Set(list.map(i => i.id));
    if (seen.current && list.some(i => i.kds_state === "new" && !seen.current!.has(i.id))) {
      try { playAlertBeep(); } catch { /* sem áudio */ }
    }
    seen.current = ids;
    setItems(list);
    const saleIds = [...new Set(list.map(i => i.sale_id))];
    setSales(await loadSales(saleIds));
    setLoading(false);
  }, [prefs.sectors.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancelamentos (item já impresso foi diminuído/excluído): aviso na tela e ticket
  const [cancels, setCancels] = useState<{ id: string; origin_label: string | null; sector: Sector; product_name: string | null; quantity: number; created_at: string }[]>([]);
  const cancelSeen = useRef<Set<string> | null>(null);
  const loadCancels = useCallback(async () => {
    if (prefs.sectors.length === 0) { setCancels([]); return; }
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await supabase.from("kitchen_cancellations")
      .select("id, origin_label, sector, product_name, quantity, created_at")
      .in("sector", prefs.sectors).is("dismissed_at", null).gte("created_at", since).order("created_at", { ascending: false });
    const list = ((data ?? []) as any[]).map(r => ({ ...r, quantity: Number(r.quantity) }));
    if (cancelSeen.current && list.some(c => !cancelSeen.current!.has(c.id))) { try { playAlertBeep(); } catch { /* sem áudio */ } }
    cancelSeen.current = new Set(list.map(c => c.id));
    setCancels(list);
    // Os tickets de cancelamento são impressos pelo StationPrinter (em qualquer aba)
  }, [prefs.sectors.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  async function dismissCancel(id: string) {
    setCancels(prev => prev.filter(c => c.id !== id));
    await supabase.from("kitchen_cancellations").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
  }

  useEffect(() => {
    load(); loadCancels();
    const t = setInterval(() => { load(); loadCancels(); }, 5000);
    const c = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load, loadCancels]);

  useEffect(() => {
    supabase.from("couriers").select("id,name,phone,fee_per_delivery,active").eq("active", true).order("name")
      .then(({ data }) => setCouriers((data ?? []) as Courier[]));
  }, []);

  async function setState(ids: string[], state: "preparing" | "ready" | "done") {
    setItems(prev => state === "done" ? prev.filter(i => !ids.includes(i.id)) : prev.map(i => ids.includes(i.id) ? { ...i, kds_state: state } : i));
    const patch: Record<string, unknown> = { kds_state: state };
    if (state === "ready") patch.ready_at = new Date().toISOString();
    const { error } = await supabase.from("sale_items").update(patch).in("id", ids);
    if (error) setErr(error.message);
    load();
  }

  async function dispatch(saleId: string, ids: string[], type: "counter" | "table" | "delivery", courierId?: string) {
    await setState(ids, "done");
    const { error } = await supabase.from("sales").update({
      dispatch_type: type, courier_id: courierId ?? null, dispatched_at: new Date().toISOString(),
    }).eq("id", saleId);
    if (error) setErr(error.message);
  }

  function reprint(saleId: string, list: KItem[]) {
    const s = sales[saleId];
    const bySector = new Map<Sector, KItem[]>();
    for (const i of list) bySector.set(i.sector, [...(bySector.get(i.sector) ?? []), i]);
    printTickets([...bySector.entries()].map(([sector, its]) => ({
      sector, origin: originOf(s).label, orderNum: saleId.slice(-6).toUpperCase(),
      lines: its.map(i => ({ quantity: i.quantity, product_name: i.product_name, notes: i.notes })),
      extra: [s?.delivery_address, s?.notes].filter(Boolean).join(" · ") || null,
    })));
  }

  // Um cartão por pedido em cada coluna
  const columns = useMemo(() => {
    const cols: Record<KdsState, { saleId: string; items: KItem[]; since: number }[]> = { new: [], preparing: [], ready: [] };
    const map = new Map<string, KItem[]>();
    for (const i of items) {
      const k = `${i.kds_state}|${i.sale_id}`;
      map.set(k, [...(map.get(k) ?? []), i]);
    }
    for (const [k, its] of map) {
      const [st, saleId] = k.split("|") as [KdsState, string];
      cols[st].push({ saleId, items: its, since: Math.min(...its.map(i => new Date(i.kds_created_at).getTime())) });
    }
    for (const st of Object.keys(cols) as KdsState[]) cols[st].sort((a, b) => a.since - b.since);
    return cols;
  }, [items]);

  // Como o cliente paga (para o motoboy saber se cobra e se leva troco)
  const PAY_LABEL: Record<string, string> = { cash: "Dinheiro", pix: "PIX", credit: "Crédito", debit: "Débito", fiado: "Fiado", house_credit: "Saldo", ifood_receivable: "iFood" };
  function payText(s: KSale | undefined): string | null {
    if (!s) return null;
    if (s.pay_method) {
      const base = PAY_LABEL[s.pay_method] ?? s.pay_method;
      return s.change_for && Number(s.change_for) > 0 ? `${base} · troco p/ ${fmt(Number(s.change_for))}` : base;
    }
    const ps = (s.payments ?? []).filter(p => Number(p.amount) > 0);
    return ps.length ? ps.map(p => PAY_LABEL[p.method] ?? p.method).join(" + ") : null;
  }

  // Entregas para o mapa: um ponto por pedido (pronto só quando todos os itens ficaram prontos)
  const mapOrders = useMemo<MapOrder[]>(() => {
    const bySale = new Map<string, KItem[]>();
    for (const i of items) bySale.set(i.sale_id, [...(bySale.get(i.sale_id) ?? []), i]);
    const out: MapOrder[] = [];
    for (const [saleId, its] of bySale) {
      const s = sales[saleId];
      const o = originOf(s);
      if (o.kind !== "delivery") continue;
      const since = Math.min(...its.map(i => new Date(i.kds_created_at).getTime()));
      out.push({
        saleId, label: o.label, address: s?.delivery_address ?? null, mins: Math.max(0, Math.floor((now - since) / 60000)),
        ready: its.every(i => i.kds_state === "ready"), ids: its.map(i => i.id),
        lat: s?.lat ?? null, lng: s?.lng ?? null, custLat: s?.cust_lat ?? null, custLng: s?.cust_lng ?? null,
        customerId: s?.customer_id ?? null, total: s?.total ?? null,
        num: saleId.slice(-6).toUpperCase(), payText: payText(s),
      });
    }
    return out.sort((a, b) => b.mins - a.mins);
  }, [items, sales, now]);

  const muted = isLight ? "text-gray-500" : "text-zinc-400";
  const chip = (on: boolean) => on
    ? { background: "#315DFB", color: "#fff", border: "1px solid #315DFB" }
    : { ...card, color: isLight ? "#374151" : "#d4d4d8" };

  const COLS: { key: KdsState; title: string; icon: React.ReactNode; color: string }[] = [
    { key: "new", title: "Novos", icon: <Clock className="w-4 h-4" />, color: "#f59e0b" },
    { key: "preparing", title: "Em preparo", icon: <Flame className="w-4 h-4" />, color: "#315DFB" },
    { key: "ready", title: "Prontos", icon: <CheckCircle2 className="w-4 h-4" />, color: "#10b981" },
  ];

  return (
    <div className="space-y-4">
      {/* Configuração desta estação */}
      <div className="rounded-2xl p-4 flex flex-wrap items-center gap-3" style={card}>
        <span className={`text-xs font-semibold ${muted}`}>Esta tela mostra:</span>
        {SECTORS.map(s => {
          const on = prefs.sectors.includes(s);
          return (
            <button key={s} onClick={() => updatePrefs({ ...prefs, sectors: on ? prefs.sectors.filter(x => x !== s) : [...prefs.sectors, s] })}
              className="px-3 py-1.5 rounded-lg text-xs font-bold" style={chip(on)}>{SECTOR_LABEL[s]}</button>
          );
        })}
        <div className="flex-1" />
        <button onClick={() => updatePrefs({ ...prefs, autoPrint: !prefs.autoPrint })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={chip(prefs.autoPrint)}>
          <Printer className="w-3.5 h-3.5" /> {prefs.autoPrint ? "Imprimindo automaticamente" : "Imprimir automaticamente: desligado"}
        </button>
        {prefs.autoPrint && (
          <button onClick={() => updatePrefs({ ...prefs, receipts: !prefs.receipts })}
            title="Cupons, pré-contas e pedidos lançados pelos celulares saem nesta impressora"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={chip(prefs.receipts)}>
            <Smartphone className="w-3.5 h-3.5" /> {prefs.receipts ? "Cupons dos celulares: saem aqui" : "Cupons dos celulares: desligado"}
          </button>
        )}
        {!prefs.autoPrint && (
          <label className={`flex items-center gap-1.5 text-xs ${muted}`} title="Onde saem o cupom, a pré-conta e o pedido lançados neste aparelho">
            Este aparelho imprime:
            <select value={target} onChange={e => { setTarget(e.target.value as PrintTarget); setPrintTarget(e.target.value as PrintTarget); }}
              className="px-2 py-1 rounded-lg text-xs font-semibold" style={chip(false)}>
              <option value="auto">Automático</option>
              <option value="here">Aqui mesmo</option>
              <option value="station">No computador do caixa</option>
            </select>
          </label>
        )}
        <button onClick={() => setShowHelp(v => !v)} className={`flex items-center gap-1 text-xs underline ${muted}`}>
          <Info className="w-3.5 h-3.5" /> Como configurar a impressora
        </button>
      </div>

      {showHelp && (
        <div className="rounded-2xl p-4 text-sm space-y-2" style={card}>
          <p className="font-bold">Estação de impressão (uma por impressora)</p>
          <ol className={`list-decimal ml-5 space-y-1 ${muted}`}>
            <li>No computador ligado à impressora (cozinha, bar ou balcão), deixe essa impressora como <b>padrão</b> do Windows.</li>
            <li>
              Crie o atalho de impressão direta: clique com o botão direito na <b>Área de Trabalho → Novo → Atalho</b>, cole o texto abaixo e dê o nome <b>Upabase Caixa</b>.
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <code className="px-2 py-1 rounded bg-black/10 text-[11px] break-all">{kioskCmd}</code>
                <button onClick={() => { navigator.clipboard?.writeText(kioskCmd).then(() => setCopied(true)).catch(() => {}); setTimeout(() => setCopied(false), 2500); }}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold" style={chip(copied)}>{copied ? "Copiado!" : "Copiar"}</button>
              </div>
              <span className="text-xs">Antes de abrir pelo atalho, <b>feche todas as janelas do Chrome</b> (senão ele ignora a impressão direta). Daí em diante, sempre abra o sistema por esse atalho: nada de janela de imprimir, sai direto.</span>
            </li>
            <li>Entre na aba <b>Cozinha</b>, marque os setores dessa impressora (ex.: só Bar) e ligue <b>Imprimir automaticamente</b>.</li>
            <li>Deixe o sistema aberto (pode ser em qualquer aba, até no PDV). Cada pedido novo do setor sai sozinho, sem janela de impressão.</li>
            <li>Garçom no celular? Deixe <b>Cupons dos celulares</b> ligado neste computador: cupom, pré-conta e pedido lançados no celular saem nesta impressora. No celular fica "Automático" (ou escolha "No computador do caixa").</li>
          </ol>
          <p className={muted}>Só uma impressora? Marque Cozinha, Bar e Balcão na mesma estação e tudo sai nela. Duas estações do mesmo setor não imprimem o mesmo pedido duas vezes.</p>
          <p className={muted}>Os setores de cada categoria são definidos na aba <b>Setores</b>.</p>
        </div>
      )}

      {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}

      {cancels.length > 0 && (
        <div className="rounded-2xl p-3 space-y-2" style={{ ...card, border: "2px solid #ef4444" }}>
          <p className="text-sm font-black text-red-500">Cancelados — não preparar</p>
          {cancels.map(c => (
            <div key={c.id} className="flex items-center gap-2">
              <p className="flex-1 text-sm"><b>{c.quantity}x</b> {c.product_name ?? "Produto"} <span className={muted}>· {c.origin_label}</span></p>
              <button onClick={() => dismissCancel(c.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "#fff", background: "#ef4444" }}>Ok, visto</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {(["list", "map"] as const).map(v => (
          <button key={v} onClick={() => changeView(v)} className="px-4 py-2 rounded-xl text-sm font-bold" style={chip(view === v)}>
            {v === "list" ? "Lista" : `Mapa de entregas${mapOrders.length ? ` (${mapOrders.length})` : ""}`}
          </button>
        ))}
      </div>

      {view === "map" ? (
        <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>}>
          <DeliveryMap orders={mapOrders} couriers={couriers} isLight={isLight} card={card}
            onDispatch={(saleId, ids, courierId) => dispatch(saleId, ids, "delivery", courierId)} />
        </Suspense>
      ) : loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {COLS.map(col => (
            <div key={col.key} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <span style={{ color: col.color }}>{col.icon}</span>
                <h3 className="text-sm font-black">{col.title}</h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${col.color}22`, color: col.color }}>{columns[col.key].length}</span>
              </div>
              {columns[col.key].length === 0 && (
                <div className={`rounded-2xl p-6 text-center text-xs ${muted}`} style={card}>Nenhum pedido</div>
              )}
              {columns[col.key].map(({ saleId, items: its, since }) => {
                const s = sales[saleId];
                const o = originOf(s);
                const mins = Math.max(0, Math.floor((now - since) / 60000));
                const late = col.key !== "ready" && mins >= 30 ? "#ef4444" : col.key !== "ready" && mins >= 15 ? "#f59e0b" : null;
                const ids = its.map(i => i.id);
                return (
                  <div key={saleId} className="rounded-2xl p-4 space-y-3" style={{ ...card, ...(late ? { border: `2px solid ${late}` } : {}) }}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5" style={{ color: "#315DFB" }}>
                        {o.kind === "table" ? <UtensilsCrossed className="w-4 h-4" /> : o.kind === "delivery" ? <Bike className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-black leading-tight truncate">{o.label}</p>
                        <p className={`text-[11px] ${muted}`}>#{saleId.slice(-6).toUpperCase()}</p>
                      </div>
                      <span className="text-xs font-bold flex items-center gap-1" style={{ color: late ?? (isLight ? "#6b7280" : "#a1a1aa") }}>
                        <Clock className="w-3.5 h-3.5" /> {mins} min
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {its.map(i => (
                        <div key={i.id}>
                          <p className="text-sm"><b>{i.quantity}x</b> {i.product_name}
                            {prefs.sectors.length > 1 && <span className={`ml-1.5 text-[10px] font-bold uppercase ${muted}`}>{SECTOR_LABEL[i.sector]}</span>}
                          </p>
                          {i.notes && <p className="text-xs text-amber-500 ml-4">→ {i.notes}</p>}
                        </div>
                      ))}
                    </div>
                    {(s?.delivery_address || s?.notes) && (
                      <p className={`text-xs ${muted}`}>{[s?.delivery_address, s?.notes].filter(Boolean).join(" · ")}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {col.key === "new" && (
                        <button onClick={() => setState(ids, "preparing")} className="flex-1 h-10 rounded-xl text-sm font-semibold shadow-sm" style={{ color: "#fff", background: "#315DFB" }}>Iniciar preparo</button>
                      )}
                      {col.key !== "ready" && (
                        <button onClick={() => setState(ids, "ready")} className="flex-1 h-10 rounded-xl text-sm font-semibold shadow-sm" style={{ color: "#fff", background: "#10b981" }}>Pronto</button>
                      )}
                      {col.key === "ready" && (o.kind === "table" ? (
                        <button onClick={() => dispatch(saleId, ids, "table")} className="flex-1 h-10 rounded-xl text-sm font-semibold shadow-sm" style={{ color: "#fff", background: "#10b981" }}>Entregue na mesa</button>
                      ) : (
                        <>
                          <button onClick={() => dispatch(saleId, ids, "counter")} className="flex-1 h-10 rounded-xl text-sm font-semibold shadow-sm" style={{ color: "#fff", background: "#10b981" }}>Balcão</button>
                          <button onClick={() => setCourierPick(courierPick === saleId ? null : saleId)}
                            className="flex-1 h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
                            style={courierPick === saleId
                              ? { background: "#315DFB", color: "#fff" }
                              : { ...card, color: isLight ? "#111827" : "#f4f4f5" }}>
                            <Bike className="w-4 h-4" /> Motoboy
                          </button>
                        </>
                      ))}
                      <button onClick={() => reprint(saleId, its)} title="Imprimir de novo"
                        className={`h-10 w-10 rounded-xl flex items-center justify-center ${muted}`} style={card}><Printer className="w-4 h-4" /></button>
                    </div>
                    {/* Escolha do motoboy: nomes em botões grandes e legíveis */}
                    {courierPick === saleId && (
                      <div className="grid grid-cols-2 gap-2">
                        {couriers.length === 0 && <p className={`col-span-2 text-xs ${muted}`}>Cadastre motoboys na aba Motoboys.</p>}
                        {couriers.map(c => (
                          <button key={c.id} onClick={() => { setCourierPick(null); dispatch(saleId, ids, "delivery", c.id); }}
                            className="h-10 rounded-xl text-sm font-semibold truncate px-2"
                            style={{ ...card, color: isLight ? "#111827" : "#f4f4f5" }}>
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Motoboys + acerto do dia ─────────────────────────────────────────────────

type Delivery = { id: string; courier_id: string; dispatched_at: string; total_amount: number; delivery_fee: number; customer_name: string | null; courier_payment_id: string | null };
const PAY_METHODS: { key: "cash" | "pix"; label: string }[] = [
  { key: "cash", label: "Dinheiro (sai da gaveta)" },
  { key: "pix", label: "PIX" },
];

function CouriersTab({ isLight, card }: { isLight: boolean; card: React.CSSProperties }) {
  const [list, setList] = useState<Courier[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const muted = isLight ? "text-gray-500" : "text-zinc-400";
  const border = isLight ? "1px solid #e5e7eb" : "1px solid #27272a";

  // Acerto do caixa atual (zera quando o caixa fecha) ou histórico por data
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const [mode, setMode] = useState<"current" | "day">("current");
  const [day, setDay] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  const [openReg, setOpenReg] = useState<{ id: string; opened_at: string } | null>(null);
  const [regLoaded, setRegLoaded] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  // Entregas de turnos anteriores que ficaram sem pagar (não somem quando o caixa fecha)
  const [pendingOld, setPendingOld] = useState<Delivery[]>([]);
  const [payFor, setPayFor] = useState<{ c: Courier; ids: string[]; amount: number } | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "pix">("cash");
  const [payAmount, setPayAmount] = useState("");
  // Pagamentos ficam numa lista própria: não somem se a venda for excluída
  const [payments, setPayments] = useState<{ id: string; courier_id: string; amount: number; deliveries: number; method: string | null; paid_at: string; cash_movement_id: string | null }[]>([]);

  const mapRows = (data: any[] | null) => ((data ?? []) as any[]).map(r => ({ ...r, total_amount: Number(r.total_amount) || 0, delivery_fee: Number(r.delivery_fee) || 0 })) as Delivery[];
  const SEL = "id, courier_id, dispatched_at, total_amount, delivery_fee, customer_name, courier_payment_id";

  async function loadList() {
    const { data, error } = await supabase.from("couriers").select("id,name,phone,fee_per_delivery,active").eq("active", true).order("name");
    if (error) setErr(error.message); else setList((data ?? []) as Courier[]);
  }
  async function loadReg() {
    const { data } = await supabase.from("cash_registers").select("id,opened_at").eq("status", "open")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    setOpenReg((data as any) ?? null);
    setRegLoaded(true);
  }
  async function loadDeliveries() {
    loadPayments();
    if (mode === "day") {
      const from = new Date(`${day}T00:00:00`).toISOString();
      const to = new Date(`${day}T23:59:59.999`).toISOString();
      const { data } = await fetchAll(() => supabase.from("sales").select(SEL)
        .not("courier_id", "is", null).gte("dispatched_at", from).lte("dispatched_at", to).order("dispatched_at"));
      setDeliveries(mapRows(data)); setPendingOld([]);
      return;
    }
    if (!openReg) { setDeliveries([]); }
    else {
      const { data } = await fetchAll(() => supabase.from("sales").select(SEL)
        .not("courier_id", "is", null).gte("dispatched_at", openReg.opened_at).order("dispatched_at"));
      setDeliveries(mapRows(data));
    }
    const before = openReg?.opened_at ?? new Date().toISOString();
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const { data: old } = await fetchAll(() => supabase.from("sales").select(SEL)
      .not("courier_id", "is", null).is("courier_payment_id", null)
      .gte("dispatched_at", since).lt("dispatched_at", before).order("dispatched_at"));
    setPendingOld(mapRows(old));
  }
  async function loadPayments() {
    let from: string, to: string;
    if (mode === "day") { from = new Date(`${day}T00:00:00`).toISOString(); to = new Date(`${day}T23:59:59.999`).toISOString(); }
    else if (openReg) { from = openReg.opened_at; to = new Date(Date.now() + 60_000).toISOString(); }
    else { setPayments([]); return; }
    const { data } = await fetchAll(() => supabase.from("courier_payments")
      .select("id,courier_id,amount,deliveries,method,paid_at,cash_movement_id")
      .gte("paid_at", from).lte("paid_at", to).order("paid_at", { ascending: false }));
    setPayments(((data ?? []) as any[]).map(p => ({ ...p, amount: Number(p.amount) || 0 })));
  }
  async function reversePayment(p: { id: string; courier_id: string; amount: number }) {
    const nm = list.find(c => c.id === p.courier_id)?.name ?? "motoboy";
    if (!confirm(`Estornar o pagamento de ${fmt(p.amount)} para ${nm}? A saída sai do caixa e as entregas voltam para "a pagar".`)) return;
    if (!(await requireApproval(`Estornar pagamento do motoboy ${nm}`))) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("reverse_courier_payment", { p_payment_id: p.id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(`Pagamento de ${nm} estornado. Agora é só pagar de novo com o valor certo.`);
    setTimeout(() => setOk(null), 6000);
    loadDeliveries();
  }
  useEffect(() => { loadList(); loadReg(); }, []);
  useEffect(() => { if (regLoaded) loadDeliveries(); }, [mode, day, openReg?.id, regLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!name.trim()) { setErr("Informe o nome."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from("couriers").insert({
      name: name.trim(), phone: phone.trim() || null, fee_per_delivery: parseFloat(fee.replace(",", ".")) || 0,
    });
    if (error) setErr(error.message); else { setName(""); setPhone(""); setFee(""); await loadList(); }
    setBusy(false);
  }
  async function updateFee(c: Courier, v: string) {
    const n = parseFloat(v.replace(",", ".")) || 0;
    if (n === c.fee_per_delivery) return;
    const { error } = await supabase.from("couriers").update({ fee_per_delivery: n }).eq("id", c.id);
    if (error) setErr(error.message); else loadList();
  }
  async function remove(c: Courier) {
    if (!confirm(`Remover ${c.name}? O histórico de entregas continua salvo.`)) return;
    const { error } = await supabase.from("couriers").update({ active: false }).eq("id", c.id);
    if (error) setErr(error.message); else loadList();
  }

  function openPay(c: Courier, ids: string[]) {
    setErr(null);
    if (!openReg) { setErr("Abra o caixa para pagar o motoboy — o pagamento é lançado como saída do caixa."); return; }
    setPayMethod("cash");
    setPayFor({ c, ids, amount: ids.length * c.fee_per_delivery });
    setPayAmount((ids.length * c.fee_per_delivery).toFixed(2).replace(".", ","));
  }

  async function confirmPay() {
    if (!payFor || !openReg) return;
    if (!(await requireApproval(`Pagar motoboy ${payFor.c.name}`))) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("pay_courier", {
      p_courier_id: payFor.c.id, p_sale_ids: payFor.ids, p_register_id: openReg.id, p_method: payMethod,
      p_amount: parseFloat(payAmount.replace(",", ".")) >= 0 && payAmount.trim() !== "" ? parseFloat(payAmount.replace(",", ".")) : null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const r = data as { amount: number };
    setPayFor(null);
    setOk(`${payFor.c.name}: ${fmt(Number(r.amount))} pago em ${payMethod === "pix" ? "PIX" : "dinheiro"} e lançado no caixa.`);
    setTimeout(() => setOk(null), 6000);
    loadDeliveries();
  }

  const summarize = (ds: Delivery[]) => list.map(c => {
    const mine = ds.filter(d => d.courier_id === c.id);
    const pending = mine.filter(d => !d.courier_payment_id);
    return {
      c, count: mine.length, pendingIds: pending.map(d => d.id),
      toPay: pending.length * c.fee_per_delivery, paid: payments.filter(p => p.courier_id === c.id).reduce((s, p) => s + p.amount, 0),
      fees: mine.reduce((s, d) => s + d.delivery_fee, 0), sales: mine.reduce((s, d) => s + d.total_amount, 0),
    };
  });
  const byCourier = summarize(deliveries);
  const oldByCourier = summarize(pendingOld).filter(x => x.pendingIds.length > 0);
  const canPay = mode === "current";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div className="rounded-2xl p-5 space-y-3" style={card}>
        <h3 className="text-sm font-black flex items-center gap-2"><Bike className="w-4 h-4" style={{ color: "#315DFB" }} /> Motoboys</h3>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome" autoComplete="off" className={inputCls} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Telefone" autoComplete="off" className={inputCls + " sm:w-36"} />
          <input value={fee} onChange={e => setFee(e.target.value)} placeholder="R$ por entrega" inputMode="decimal" autoComplete="off" className={inputCls + " sm:w-32"} />
          <button onClick={add} disabled={busy} className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40" style={{ background: "#315DFB", color: "#fff" }}>
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
        {list.length === 0 && <p className={`text-xs ${muted}`}>Nenhum motoboy cadastrado.</p>}
        <div className="space-y-1.5">
          {list.map(c => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ border }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                style={{ background: "#EFF3FF", border: "1px solid #C4D2FF", color: "#2547D6" }}>{c.name.charAt(0).toUpperCase()}</div>
              <div className="flex-1 min-w-[90px]">
                <p className="text-sm font-bold truncate">{c.name}</p>
                {c.phone && <p className={`text-[11px] ${muted}`}>{c.phone}</p>}
              </div>
              <span className={`text-[11px] flex-shrink-0 ${muted}`}>R$/entrega</span>
              <input defaultValue={String(c.fee_per_delivery).replace(".", ",")} onBlur={e => updateFee(c, e.target.value)}
                inputMode="decimal" className={inputBase + " w-20 flex-shrink-0 py-1.5"} />
              <button onClick={() => remove(c)} className="p-1.5 text-zinc-500 hover:text-red-400 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-5 space-y-3" style={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-black flex-1">Acerto</h3>
          <div className="flex gap-1">
            {([["current", "Caixa atual"], ["day", "Histórico por data"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
                style={mode === k ? { background: "#315DFB", color: "#fff" } : { border, color: isLight ? "#374151" : "#d4d4d8" }}>{l}</button>
            ))}
          </div>
          {mode === "day" && (
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className={inputBase + " w-44 flex-shrink-0 py-1.5"} />
          )}
        </div>
        {mode === "current" && (
          <p className={`text-[11px] ${muted}`}>
            {openReg
              ? `Caixa aberto em ${new Date(openReg.opened_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. Pague no fim do dia: as entregas vão somando em "A pagar ao motoboy". Entrega que não for paga continua aparecendo depois que o caixa fechar.`
              : "Nenhum caixa aberto. Abra o caixa para ver e pagar as entregas do turno."}
          </p>
        )}

        {byCourier.length === 0 && <p className={`text-xs ${muted}`}>Cadastre motoboys para ver o acerto.</p>}
        {byCourier.map(({ c, count, pendingIds, toPay, paid, fees, sales }) => (
          <div key={c.id} className="rounded-xl p-3 space-y-2" style={{ border }}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold flex-1">{c.name}</p>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(49,93,251,0.12)", color: "#315DFB" }}>{count} entrega{count === 1 ? "" : "s"}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div><p className={`text-[10px] ${muted}`}>A pagar ao motoboy</p><p className="text-sm font-black text-amber-500">{fmt(toPay)}</p></div>
              <div><p className={`text-[10px] ${muted}`}>{mode === "current" ? "Já pago neste caixa" : "Já pago no dia"}</p><p className="text-sm font-black text-emerald-500">{fmt(paid)}</p></div>
              <div><p className={`text-[10px] ${muted}`}>Taxa de entrega cobrada dos clientes</p><p className="text-sm font-bold">{fmt(fees)}</p></div>
              <div><p className={`text-[10px] ${muted}`}>Valor dos pedidos</p><p className="text-sm font-bold">{fmt(sales)}</p></div>
            </div>
            {canPay && pendingIds.length > 0 && (
              <button onClick={() => openPay(c, pendingIds)}
                className="w-full h-9 rounded-xl text-sm font-bold" style={{ color: "#fff", background: "#10b981" }}>
                Pagar {fmt(toPay)} ({pendingIds.length} entrega{pendingIds.length === 1 ? "" : "s"})
              </button>
            )}
          </div>
        ))}

        {mode === "current" && oldByCourier.length > 0 && (
          <div className="rounded-xl p-3 space-y-2" style={{ border: "2px solid #f59e0b" }}>
            <p className="text-sm font-bold text-amber-500">Pendentes de turnos anteriores</p>
            <p className={`text-[11px] ${muted}`}>Entregas de caixas já fechados que ainda não foram pagas.</p>
            {oldByCourier.map(({ c, pendingIds, toPay }) => (
              <div key={c.id} className="flex items-center gap-2">
                <p className="text-sm font-semibold flex-1">{c.name} · {pendingIds.length} entrega{pendingIds.length === 1 ? "" : "s"}</p>
                <button onClick={() => openPay(c, pendingIds)} className="px-3 h-8 rounded-lg text-xs font-bold" style={{ color: "#fff", background: "#f59e0b" }}>
                  Pagar {fmt(toPay)}
                </button>
              </div>
            ))}
          </div>
        )}

        {deliveries.length > 0 && (
          <div className="pt-1 space-y-1">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Entregas</p>
            {deliveries.map(d => {
              const c = list.find(x => x.id === d.courier_id);
              return (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  <span className={muted}>{new Date(d.dispatched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="font-semibold">#{d.id.slice(-6).toUpperCase()}</span>
                  <span className="flex-1 truncate">{c?.name ?? "—"}{d.customer_name ? ` · ${d.customer_name}` : ""}</span>
                  <span className={`hidden sm:inline ${muted}`}>pedido {fmt(d.total_amount)}</span>
                  <span className={`text-[10px] font-bold ${d.courier_payment_id ? "text-emerald-500" : "text-amber-500"}`}>{d.courier_payment_id ? "acertado" : "a pagar"}</span>
                  <span className="font-bold" title="Quanto o motoboy ganha por esta entrega">{c ? fmt(c.fee_per_delivery) : "—"}</span>
                </div>
              );
            })}
          </div>
        )}
        {payments.length > 0 && (
          <div className="pt-1 space-y-1">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Pagamentos</p>
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className={muted}>{new Date(p.paid_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="flex-1 truncate font-semibold">{list.find(c => c.id === p.courier_id)?.name ?? "—"}</span>
                <span className={muted}>{p.deliveries} entrega{p.deliveries === 1 ? "" : "s"} · {p.method === "pix" ? "PIX" : p.method === "cash" ? "Dinheiro" : (p.method ?? "—")}</span>
                <span className="font-bold text-emerald-500">{fmt(p.amount)}</span>
                {mode === "current" && (
                  <button onClick={() => reversePayment(p)} disabled={busy}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold text-red-500 hover:bg-red-500/10 disabled:opacity-40">Estornar</button>
                )}
              </div>
            ))}
          </div>
        )}
        {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}
        {ok && <p className="text-xs text-emerald-500 font-semibold">{ok}</p>}
      </div>

      {payFor && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={{ ...card, background: isLight ? "#fff" : "#18181b" }}>
            <div>
              <p className="text-lg font-black">Pagar {payFor.c.name}</p>
              <p className={`text-sm ${muted}`}>{payFor.ids.length} entrega{payFor.ids.length === 1 ? "" : "s"} × {fmt(payFor.c.fee_per_delivery)} = {fmt(payFor.amount)}</p>
              <p className="text-xs font-semibold text-amber-500 mt-1">Pagar agora? Se os motoboys recebem no fim do dia, deixe para pagar quando fechar o expediente.</p>
            </div>
            <div className="space-y-1">
              <p className={`text-xs font-semibold ${muted}`}>Valor a pagar (pode ajustar)</p>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-emerald-500">R$</span>
                <input value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal"
                  className={inputBase + " flex-1 text-2xl font-black py-2"} />
              </div>
              <p className={`text-[11px] ${muted}`}>Calculado: {fmt(payFor.amount)}</p>
            </div>
            <div className="space-y-1.5">
              <p className={`text-xs font-semibold ${muted}`}>Forma de pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {PAY_METHODS.map(m => (
                  <button key={m.key} onClick={() => setPayMethod(m.key)} className="h-11 rounded-xl text-xs font-bold px-2"
                    style={payMethod === m.key ? { background: "#315DFB", color: "#fff" } : { border, color: isLight ? "#374151" : "#d4d4d8" }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className={`text-[11px] ${muted}`}>Fica lançado como saída no caixa aberto, com a forma de pagamento escolhida.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmPay} disabled={busy} className="flex-1 h-11 rounded-xl text-sm font-bold disabled:opacity-40" style={{ color: "#fff", background: "#10b981" }}>
                {busy ? "Pagando..." : "Confirmar pagamento"}
              </button>
              <button onClick={() => setPayFor(null)} className={`px-4 rounded-xl text-sm ${muted}`}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Setores por categoria ────────────────────────────────────────────────────

function SectorsTab({ isLight, card }: { isLight: boolean; card: React.CSSProperties }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  // Produtos sem categoria (ex.: adicionais avulsos) usam este setor
  const [noCatSector, setNoCatSector] = useState<Sector | null>(null);
  const [noCatCount, setNoCatCount] = useState(0);
  const muted = isLight ? "text-gray-500" : "text-zinc-400";

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    const id = session?.user.id;
    if (!id) return;
    setUid(id);
    // categories/products têm leitura pública (cardápio): filtra pelo dono
    const [{ data, error }, { data: us }, { count }] = await Promise.all([
      supabase.from("categories").select("id,name,print_sector").eq("user_id", id).order("name"),
      supabase.from("user_settings").select("uncategorized_print_sector").eq("user_id", id).maybeSingle(),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", id).is("category_id", null),
    ]);
    if (error) setErr(error.message); else setCats((data ?? []) as Category[]);
    setNoCatSector(((us as any)?.uncategorized_print_sector ?? null) as Sector | null);
    setNoCatCount(count ?? 0);
  }
  useEffect(() => { load(); }, []);

  const flashSaved = () => { setSaved("Salvo"); setTimeout(() => setSaved(null), 1500); };

  async function setSector(ids: string[], sector: Sector | null) {
    setErr(null);
    const { error } = await supabase.from("categories").update({ print_sector: sector }).in("id", ids);
    if (error) { setErr(error.message); return; }
    setCats(prev => prev.map(c => ids.includes(c.id) ? { ...c, print_sector: sector } : c));
    flashSaved();
  }

  async function setNoCat(sector: Sector | null) {
    if (!uid) return;
    setErr(null);
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: uid, uncategorized_print_sector: sector, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { setErr(error.message); return; }
    setNoCatSector(sector);
    flashSaved();
  }

  const sectorButtons = (current: Sector | null, onPick: (s: Sector | null) => void) => (
    <div className="flex gap-1">
      {([null, ...SECTORS] as (Sector | null)[]).map(s => {
        const on = current === s;
        return (
          <button key={s ?? "none"} onClick={() => onPick(s)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
            style={on ? { background: "#315DFB", color: "#fff" } : { border: isLight ? "1px solid #e5e7eb" : "1px solid #3f3f46", color: isLight ? "#374151" : "#d4d4d8" }}>
            {s ? SECTOR_LABEL[s] : "Nenhum"}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="rounded-2xl p-5 space-y-3 max-w-2xl" style={card}>
      <h3 className="text-sm font-black">Para onde vai cada categoria</h3>
      <p className={`text-xs ${muted}`}>
        Ao lançar um produto (Mesas, Vendas ou Cardápio Digital), ele vai para a estação do setor da categoria dele.
        Categorias em "Nenhum" não aparecem na cozinha nem são impressas.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={async () => { await setSector(cats.map(c => c.id), "kitchen"); await setNoCat("kitchen"); }} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "#315DFB", color: "#fff" }}>
          Tudo para a Cozinha (uma impressora só)
        </button>
        {saved && <span className="text-xs text-emerald-500 font-semibold self-center flex items-center gap-1"><Save className="w-3.5 h-3.5" />{saved}</span>}
      </div>
      <div className="space-y-1.5">
        {cats.map(c => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
            <p className="text-sm font-semibold flex-1 truncate">{c.name}</p>
            {sectorButtons(c.print_sector, s => setSector([c.id], s))}
          </div>
        ))}
        <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ border: isLight ? "1px dashed #d1d5db" : "1px dashed #3f3f46" }}>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">Produtos sem categoria</p>
            <p className={`text-[11px] ${muted}`}>{noCatCount} produto{noCatCount === 1 ? "" : "s"} sem categoria (ex.: adicionais)</p>
          </div>
          {sectorButtons(noCatSector, setNoCat)}
        </div>
        {cats.length === 0 && <p className={`text-xs ${muted}`}>Nenhuma categoria cadastrada.</p>}
      </div>
      {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}
    </div>
  );
}
