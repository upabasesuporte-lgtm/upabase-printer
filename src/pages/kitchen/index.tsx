// Cozinha (KDS + estação de impressão + despacho + motoboys).
// Os itens chegam aqui quando são lançados (Mesas, PDV, Cardápio Digital) e a
// categoria do produto tem setor (Cozinha/Bar/Balcão) — ver aba "Setores".
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { PageHeader } from "../../components/PageHeader";
import { playAlertBeep } from "../../lib/audio";
import {
  SECTOR_LABEL, SECTORS, printTickets, getStationPrefs, setStationPrefs,
  type Sector, type Ticket, type StationPrefs,
} from "../../lib/kitchen";
import {
  ChefHat, Printer, Clock, Bike, Store, UtensilsCrossed, CheckCircle2, Flame,
  Plus, Trash2, Save, Loader2, Info, Tags,
} from "lucide-react";

type KdsState = "new" | "preparing" | "ready";

interface KItem {
  id: string; sale_id: string; sector: Sector; quantity: number; notes: string | null;
  kds_state: KdsState; kds_created_at: string; product_name: string;
}
interface KSale {
  id: string; origin: string | null; notes: string | null; customer_name: string | null;
  delivery_address: string | null; table_id: string | null; customer: string | null; table: string | null;
}
interface Courier { id: string; name: string; phone: string | null; fee_per_delivery: number; active: boolean }
interface Category { id: string; name: string; print_sector: Sector | null }

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Base sem largura: campos de largura fixa usam inputBase (com w-full o tamanho fixo era ignorado)
const inputBase = "px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-all";
const inputCls = "w-full " + inputBase;

function originOf(s: KSale | undefined): { label: string; kind: "table" | "delivery" | "counter" } {
  if (!s) return { label: "Pedido", kind: "counter" };
  const who = s.customer_name || s.customer;
  if (s.origin === "mesa" || s.table_id) return { label: `MESA ${s.table ?? ""}`.trim(), kind: "table" };
  if (s.delivery_address) return { label: `DELIVERY${who ? ` — ${who}` : ""}`, kind: "delivery" };
  if (s.origin === "ifood") return { label: `IFOOD${who ? ` — ${who}` : ""}`, kind: "delivery" };
  if (s.origin === "cardapio_digital" || s.origin === "digital_menu") return { label: `CARDÁPIO${who ? ` — ${who}` : ""}`, kind: "counter" };
  return { label: `BALCÃO${who ? ` — ${who}` : ""}`, kind: "counter" };
}

async function loadSales(ids: string[]): Promise<Record<string, KSale>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from("sales")
    .select("id, origin, notes, customer_name, delivery_address, table_id, customers(name)")
    .in("id", ids);
  const rows = (data ?? []) as any[];
  const tableIds = [...new Set(rows.map(r => r.table_id).filter(Boolean))];
  const tables: Record<string, string> = {};
  if (tableIds.length) {
    const { data: t } = await supabase.from("tables").select("id, name").in("id", tableIds);
    for (const r of t ?? []) tables[(r as any).id] = (r as any).name;
  }
  const out: Record<string, KSale> = {};
  for (const r of rows) out[r.id] = {
    id: r.id, origin: r.origin, notes: r.notes, customer_name: r.customer_name,
    delivery_address: r.delivery_address, table_id: r.table_id,
    customer: r.customers?.name ?? null, table: r.table_id ? tables[r.table_id] ?? null : null,
  };
  return out;
}

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
      <button onClick={onGo} className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: "#f59e0b" }}>Configurar setores</button>
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
  const seen = useRef<Set<string> | null>(null);
  const printing = useRef(false);

  const updatePrefs = (p: StationPrefs) => { setPrefs(p); setStationPrefs(p); };

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

  // Impressão automática: pega os itens ainda não impressos dos setores desta estação
  const autoPrint = useCallback(async () => {
    if (!prefs.autoPrint || prefs.sectors.length === 0 || printing.current) return;
    printing.current = true;
    try {
      const { data, error } = await supabase.rpc("claim_kitchen_print", { p_sectors: prefs.sectors });
      if (error) { setErr("Impressão: " + error.message); return; }
      const rows = (data ?? []) as { item_id: string; sale_id: string; sector: Sector; quantity: number; notes: string | null; product_name: string | null }[];
      if (rows.length === 0) return;
      const info = await loadSales([...new Set(rows.map(r => r.sale_id))]);
      const groups = new Map<string, Ticket>();
      for (const r of rows) {
        const key = `${r.sale_id}|${r.sector}`;
        const s = info[r.sale_id];
        if (!groups.has(key)) groups.set(key, {
          sector: r.sector, origin: originOf(s).label, orderNum: r.sale_id.slice(-6).toUpperCase(), lines: [],
          extra: [s?.delivery_address, s?.notes].filter(Boolean).join(" · ") || null,
        });
        groups.get(key)!.lines.push({ quantity: Number(r.quantity), product_name: r.product_name, notes: r.notes });
      }
      printTickets([...groups.values()]);
    } finally { printing.current = false; }
  }, [prefs.autoPrint, prefs.sectors.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load(); autoPrint();
    const t = setInterval(() => { load(); autoPrint(); }, 5000);
    const c = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load, autoPrint]);

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
        <button onClick={() => setShowHelp(v => !v)} className={`flex items-center gap-1 text-xs underline ${muted}`}>
          <Info className="w-3.5 h-3.5" /> Como configurar a impressora
        </button>
      </div>

      {showHelp && (
        <div className="rounded-2xl p-4 text-sm space-y-2" style={card}>
          <p className="font-bold">Estação de impressão (uma por impressora)</p>
          <ol className={`list-decimal ml-5 space-y-1 ${muted}`}>
            <li>No computador ligado à impressora (cozinha, bar ou balcão), deixe essa impressora como <b>padrão</b> do Windows.</li>
            <li>Crie um atalho do Chrome e, em Propriedades → Destino, coloque no final: <code className="px-1 rounded bg-black/10">--kiosk-printing</code> (com um espaço antes). Abra o sistema por esse atalho.</li>
            <li>Entre na aba <b>Cozinha</b>, marque os setores dessa impressora (ex.: só Bar) e ligue <b>Imprimir automaticamente</b>.</li>
            <li>Deixe essa tela aberta. Cada pedido novo do setor sai sozinho, sem janela de impressão.</li>
          </ol>
          <p className={muted}>Só uma impressora? Marque Cozinha, Bar e Balcão na mesma estação e tudo sai nela. Duas estações do mesmo setor não imprimem o mesmo pedido duas vezes.</p>
          <p className={muted}>Os setores de cada categoria são definidos na aba <b>Setores</b>.</p>
        </div>
      )}

      {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}

      {loading ? (
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
                        <button onClick={() => setState(ids, "preparing")} className="flex-1 h-10 rounded-xl text-sm font-bold text-white" style={{ background: "#315DFB" }}>Iniciar preparo</button>
                      )}
                      {col.key !== "ready" && (
                        <button onClick={() => setState(ids, "ready")} className="flex-1 h-10 rounded-xl text-sm font-bold text-white" style={{ background: "#10b981" }}>Pronto</button>
                      )}
                      {col.key === "ready" && (o.kind === "table" ? (
                        <button onClick={() => dispatch(saleId, ids, "table")} className="flex-1 h-10 rounded-xl text-sm font-bold text-white" style={{ background: "#10b981" }}>Entregue na mesa</button>
                      ) : (
                        <>
                          <button onClick={() => dispatch(saleId, ids, "counter")} className="flex-1 h-10 rounded-xl text-sm font-bold text-white" style={{ background: "#10b981" }}>Balcão</button>
                          <select defaultValue="" onChange={e => { if (e.target.value) dispatch(saleId, ids, "delivery", e.target.value); }}
                            className="flex-1 h-10 rounded-xl text-sm font-bold px-2" style={{ background: "#f59e0b", color: "#fff", border: "none" }}>
                            <option value="" disabled>{couriers.length ? "Motoboy…" : "Cadastre motoboys"}</option>
                            {couriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </>
                      ))}
                      <button onClick={() => reprint(saleId, its)} title="Imprimir de novo"
                        className={`h-10 w-10 rounded-xl flex items-center justify-center ${muted}`} style={card}><Printer className="w-4 h-4" /></button>
                    </div>
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

function CouriersTab({ isLight, card }: { isLight: boolean; card: React.CSSProperties }) {
  const [list, setList] = useState<Courier[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const [day, setDay] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  const [deliveries, setDeliveries] = useState<{ id: string; courier_id: string; dispatched_at: string; total_amount: number; delivery_fee: number; customer_name: string | null }[]>([]);
  const muted = isLight ? "text-gray-500" : "text-zinc-400";

  async function loadList() {
    const { data, error } = await supabase.from("couriers").select("id,name,phone,fee_per_delivery,active").eq("active", true).order("name");
    if (error) setErr(error.message); else setList((data ?? []) as Courier[]);
  }
  async function loadDay() {
    const from = new Date(`${day}T00:00:00`).toISOString();
    const to = new Date(`${day}T23:59:59.999`).toISOString();
    const { data } = await supabase.from("sales")
      .select("id, courier_id, dispatched_at, total_amount, delivery_fee, customer_name")
      .not("courier_id", "is", null).gte("dispatched_at", from).lte("dispatched_at", to).order("dispatched_at");
    setDeliveries(((data ?? []) as any[]).map(r => ({ ...r, total_amount: Number(r.total_amount) || 0, delivery_fee: Number(r.delivery_fee) || 0 })));
  }
  useEffect(() => { loadList(); }, []);
  useEffect(() => { loadDay(); }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const byCourier = list.map(c => {
    const ds = deliveries.filter(d => d.courier_id === c.id);
    return { c, count: ds.length, pay: ds.length * c.fee_per_delivery, fees: ds.reduce((s, d) => s + d.delivery_fee, 0), sales: ds.reduce((s, d) => s + d.total_amount, 0) };
  });

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
            <div key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
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
        {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}
      </div>

      <div className="rounded-2xl p-5 space-y-3" style={card}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-black flex-1">Acerto do dia</h3>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} className={inputBase + " w-44 flex-shrink-0 py-1.5"} />
        </div>
        {byCourier.length === 0 && <p className={`text-xs ${muted}`}>Cadastre motoboys para ver o acerto.</p>}
        {byCourier.map(({ c, count, pay, fees, sales }) => (
          <div key={c.id} className="rounded-xl p-3" style={{ border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold flex-1">{c.name}</p>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(49,93,251,0.12)", color: "#315DFB" }}>{count} entrega{count === 1 ? "" : "s"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
              <div><p className={`text-[10px] ${muted}`}>A pagar ao motoboy</p><p className="text-sm font-black text-emerald-500">{fmt(pay)}</p></div>
              <div><p className={`text-[10px] ${muted}`}>Taxas cobradas</p><p className="text-sm font-bold">{fmt(fees)}</p></div>
              <div><p className={`text-[10px] ${muted}`}>Valor dos pedidos</p><p className="text-sm font-bold">{fmt(sales)}</p></div>
            </div>
          </div>
        ))}
        {deliveries.length > 0 && (
          <div className="pt-1 space-y-1">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Entregas</p>
            {deliveries.map(d => (
              <div key={d.id} className="flex items-center gap-2 text-xs">
                <span className={muted}>{new Date(d.dispatched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="font-semibold">#{d.id.slice(-6).toUpperCase()}</span>
                <span className="flex-1 truncate">{list.find(c => c.id === d.courier_id)?.name ?? "—"}{d.customer_name ? ` · ${d.customer_name}` : ""}</span>
                <span className="font-bold">{fmt(d.total_amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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
