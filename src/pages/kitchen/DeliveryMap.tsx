// Mapa de entregas (aba Cozinha → Pedidos → Mapa).
// Grátis: mapa do OpenStreetMap (Leaflet carregado da CDN só quando o mapa abre).
// Os pontos aparecem sozinhos: GPS do cliente no Cardápio → venda → cadastro do
// cliente → memória de endereços → busca automática do endereço perto da loja.
// Montar rota: tocar nos alfinetes (1, 2, 3…) → conferir a lista ao lado
// (número da comanda, cliente, endereço, pagamento/troco) → tocar no motoboy
// despacha todos de uma vez.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { loadLeaflet, addressKey, geocodeDelivery, TILE_URL, TILE_ATTR, type LatLng } from "../../lib/geo";
import { printHtml } from "../../lib/kitchen";
import { Bike, MapPin, Store, Crosshair, X, Loader2, Settings, Route, Printer, ChevronUp, ChevronDown, Check, Plus } from "lucide-react";

export interface MapOrder {
  saleId: string; label: string; address: string | null; mins: number; ready: boolean; ids: string[];
  lat: number | null; lng: number | null; custLat: number | null; custLng: number | null;
  customerId: string | null; total: number | null;
  num: string;              // número da comanda impressa (#A1B2C3)
  payText: string | null;   // "Dinheiro · troco p/ R$ 100,00"
}
interface Courier { id: string; name: string }
type Spot = LatLng & { approx?: boolean };

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Distância em km (para organizar a rota do mais perto ao mais longe)
function km(a: LatLng, b: LatLng) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Alfinete vermelho (estilo Google Maps). Na rota: número da ordem; pronto: ✓
function pinHtml(text: string, big: boolean) {
  const w = big ? 38 : 30, h = big ? 52 : 42;
  return `<svg width="${w}" height="${h}" viewBox="0 0 30 42" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">
    <path d="M15 1C7.3 1 1 7.3 1 15c0 10.6 14 26 14 26s14-15.4 14-26C29 7.3 22.7 1 15 1z" fill="#EA4335" stroke="#A50E0E" stroke-width="1.5"/>
    ${text ? `<circle cx="15" cy="15" r="9" fill="#fff"/><text x="15" y="19.5" text-anchor="middle" font-family="Arial" font-weight="700" font-size="${text.length > 1 ? 10 : 12}" fill="#A50E0E">${text}</text>`
      : `<circle cx="15" cy="15" r="5.5" fill="#7A0C0C"/>`}
  </svg>`;
}

export default function DeliveryMap({ orders, couriers, isLight, card, onDispatch }: {
  orders: MapOrder[]; couriers: Courier[]; isLight: boolean; card: React.CSSProperties;
  onDispatch: (saleId: string, ids: string[], courierId?: string) => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const muted = isLight ? "text-gray-500" : "text-zinc-400";
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const fitted = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [store, setStore] = useState<LatLng | null>(null);
  const [storeCity, setStoreCity] = useState<{ city: string | null; state: string | null }>({ city: null, state: null });
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [cache, setCache] = useState<Record<string, Spot>>({});     // memória de endereços
  const [placed, setPlaced] = useState<Record<string, LatLng>>({}); // marcados agora (antes do próximo recarregar)
  const [searching, setSearching] = useState<Set<string>>(new Set()); // endereços sendo procurados agora
  const tried = useRef<Set<string>>(new Set());
  const [route, setRoute] = useState<string[]>([]);                  // pedidos da rota, na ordem de entrega
  const [confirmNotReady, setConfirmNotReady] = useState<Courier | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [pick, setPick] = useState<{ kind: "order"; saleId: string } | { kind: "store" } | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // Loja (Configurações → Localização da loja)
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user.id ?? null;
      setUserId(uid);
      if (!uid) { setStoreLoaded(true); return; }
      const { data } = await supabase.from("store_settings").select("lat,lng,city,state").eq("user_id", uid).maybeSingle();
      if (data?.lat != null && data?.lng != null) setStore({ lat: data.lat, lng: data.lng });
      setStoreCity({ city: data?.city ?? null, state: data?.state ?? null });
      setStoreLoaded(true);
    })();
  }, []);

  // Pedido despachado (ou que saiu da tela) sai da rota sozinho
  useEffect(() => {
    setRoute(prev => { const n = prev.filter(id => orders.some(o => o.saleId === id)); return n.length === prev.length ? prev : n; });
  }, [orders]);

  // Memória de endereços já localizados
  const keys = useMemo(() => [...new Set(orders.map(o => o.address ? addressKey(o.address) : "").filter(Boolean))], [orders]);
  const [cacheLoaded, setCacheLoaded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const missing = keys.filter(k => !cacheLoaded.has(k));
    if (!missing.length) return;
    supabase.from("delivery_locations").select("address_key,lat,lng,approx").in("address_key", missing.slice(0, 200))
      .then(({ data }) => {
        setCache(prev => { const n = { ...prev }; for (const r of (data ?? []) as any[]) n[r.address_key] = { lat: r.lat, lng: r.lng, approx: !!r.approx }; return n; });
        setCacheLoaded(prev => new Set([...prev, ...missing.slice(0, 200)]));
      });
  }, [keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Onde fica cada entrega: marcado agora → GPS/venda → cadastro do cliente → memória/busca
  const located = useMemo(() => orders.map(o => {
    const k = o.address ? addressKey(o.address) : "";
    const pos: Spot | null = placed[o.saleId]
      ?? (o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null)
      ?? (o.custLat != null && o.custLng != null ? { lat: o.custLat, lng: o.custLng } : null)
      ?? (k && cache[k] ? cache[k] : null);
    return { o, pos, key: k };
  }), [orders, placed, cache]);
  const byId = useMemo(() => new Map(located.map(x => [x.o.saleId, x])), [located]);

  async function remember(key: string, pos: LatLng, approx: boolean) {
    setCache(prev => ({ ...prev, [key]: { ...pos, approx } }));
    if (userId) await supabase.from("delivery_locations").upsert(
      { user_id: userId, address_key: key, lat: pos.lat, lng: pos.lng, approx, updated_at: new Date().toISOString() },
      { onConflict: "user_id,address_key" });
  }

  // Pedido com GPS: guarda o endereço na memória (próximo pedido do mesmo endereço já vem no mapa)
  useEffect(() => {
    if (!userId) return;
    for (const o of orders) {
      if (!o.address || o.lat == null || o.lng == null) continue;
      const k = addressKey(o.address);
      if (cacheLoaded.has(k) && (!cache[k] || cache[k].approx)) remember(k, { lat: o.lat, lng: o.lng }, false);
    }
  }, [orders, userId, cacheLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Busca automática dos endereços que ainda não têm ponto (um por vez, perto da loja)
  useEffect(() => {
    if (!storeLoaded || !userId) return;
    const todo = located.filter(x => !x.pos && x.key && cacheLoaded.has(x.key) && !tried.current.has(x.key));
    if (!todo.length) return;
    for (const x of todo) tried.current.add(x.key);
    setSearching(prev => new Set([...prev, ...todo.map(x => x.key)]));
    (async () => {
      for (const x of todo) {
        const hit = await geocodeDelivery(x.o.address!, { pos: store, city: storeCity.city, state: storeCity.state });
        if (hit) await remember(x.key, hit.pos, !hit.exact);
        setSearching(prev => { const n = new Set(prev); n.delete(x.key); return n; });
      }
    })();
  }, [located, storeLoaded, userId, cacheLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleRoute(saleId: string) {
    setRoute(prev => prev.includes(saleId) ? prev.filter(x => x !== saleId) : [...prev, saleId]);
  }
  const toggleRef = useRef(toggleRoute);
  toggleRef.current = toggleRoute;

  // Cria o mapa uma vez
  useEffect(() => {
    let off = false;
    loadLeaflet().then(L => {
      if (off || !boxRef.current || mapRef.current) return;
      const map = L.map(boxRef.current, { zoomControl: true }).setView([-15.78, -47.93], 4);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", (e: any) => { const p = pickRef.current; if (p) savePointRef.current(p, { lat: e.latlng.lat, lng: e.latlng.lng }); });
      mapRef.current = map;
      setReady(true);
    }).catch(e => setErr(e.message));
    return () => { off = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Desenha os alfinetes
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const layer = layerRef.current;
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const { o, pos } of located) {
      if (!pos) continue;
      pts.push([pos.lat, pos.lng]);
      const seq = route.indexOf(o.saleId);
      const big = seq >= 0;
      const w = big ? 38 : 30, h = big ? 52 : 42;
      const m = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({ className: "", iconSize: [w, h], iconAnchor: [w / 2, h], html: pinHtml(big ? String(seq + 1) : o.ready ? "✓" : "", big) }),
        zIndexOffset: big ? 1000 : 0,
      });
      m.bindTooltip(`#${o.num} · ${o.label}`, { direction: "top", offset: [0, -h + 4] });
      m.on("click", () => toggleRef.current(o.saleId));
      layer.addLayer(m);
    }
    // Linha ligando a rota na ordem (loja → 1 → 2 → …)
    const line = route.map(id => byId.get(id)?.pos).filter(Boolean).map(p => [p!.lat, p!.lng] as [number, number]);
    if (line.length) layer.addLayer(L.polyline(store ? [[store.lat, store.lng], ...line] : line, { color: "#315DFB", weight: 3, opacity: 0.7, dashArray: "6 6" }));
    if (store) layer.addLayer(L.marker([store.lat, store.lng], {
      zIndexOffset: -100,
      icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
        html: '<div style="width:30px;height:30px;border-radius:50%;background:#315DFB;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:14px">🏠</div>' }),
    }));
    // Primeira vez: mostra a cidade (loja + entregas)
    if (!fitted.current && (pts.length || store)) {
      fitted.current = true;
      const all = store ? [...pts, [store.lat, store.lng] as [number, number]] : pts;
      if (all.length === 1) map.setView(all[0], 14); else map.fitBounds(all, { padding: [40, 40], maxZoom: 15 });
    }
  }, [ready, located, store, route, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  function recenter() {
    const map = mapRef.current;
    const pts = located.filter(x => x.pos).map(x => [x.pos!.lat, x.pos!.lng] as [number, number]);
    if (store) pts.push([store.lat, store.lng]);
    if (!map || !pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 14); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  }

  // Organiza do mais perto da loja ao mais longe, sempre indo ao próximo mais perto
  function organize() {
    const withPos = route.filter(id => byId.get(id)?.pos);
    const without = route.filter(id => !byId.get(id)?.pos);
    let cur: LatLng | null = store ?? (withPos.length ? byId.get(withPos[0])!.pos! : null);
    const left = [...withPos], out: string[] = [];
    while (left.length && cur) {
      let bi = 0, bd = Infinity;
      left.forEach((id, i) => { const d = km(cur!, byId.get(id)!.pos!); if (d < bd) { bd = d; bi = i; } });
      const [id] = left.splice(bi, 1);
      out.push(id);
      cur = byId.get(id)!.pos!;
    }
    setRoute([...out, ...without]);
  }

  function move(idx: number, dir: -1 | 1) {
    setRoute(prev => { const n = [...prev]; const j = idx + dir; if (j < 0 || j >= n.length) return prev; [n[idx], n[j]] = [n[j], n[idx]]; return n; });
  }

  function printRoute(courierName?: string) {
    const list = route.map(id => byId.get(id)?.o).filter(Boolean) as MapOrder[];
    if (!list.length) return;
    const now = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const total = list.reduce((s, o) => s + Number(o.total ?? 0), 0);
    printHtml(`<div class="t">
      <div class="c big">ROTA DE ENTREGA</div>
      <div class="c s">${now}${courierName ? ` · ${esc(courierName)}` : ""} · ${list.length} pedido${list.length === 1 ? "" : "s"}</div>
      <div class="sep"></div>
      ${list.map((o, i) => `<div class="it">
        <div class="r"><b>${i + 1}. #${esc(o.num)}</b><b>${o.total != null ? fmt(Number(o.total)) : ""}</b></div>
        <div>${esc(o.label.replace(/^DELIVERY\s*—\s*/, ""))}</div>
        ${o.address ? `<div class="s">${esc(o.address)}</div>` : ""}
        ${o.payText ? `<div class="s"><b>${esc(o.payText)}</b></div>` : ""}
      </div>`).join("")}
      <div class="sep"></div>
      <div class="r"><b>TOTAL</b><b>${fmt(total)}</b></div>
    </div>`, `
      .t { padding: 8px 10px 14px; font-size: 13px; }
      .c { text-align: center; } .big { font-size: 17px; font-weight: 900; } .s { font-size: 11px; }
      .r { display: flex; justify-content: space-between; gap: 8px; }
      .it { padding: 5px 0; border-bottom: 1px dashed #000; }
      .sep { border-top: 1px dashed #000; margin: 6px 0; }
    `);
  }

  async function dispatchRoute(c: Courier, force = false) {
    const list = route.map(id => byId.get(id)?.o).filter(Boolean) as MapOrder[];
    if (!list.length || dispatching) return;
    if (!force && list.some(o => !o.ready)) { setConfirmNotReady(c); return; }
    setConfirmNotReady(null);
    setDispatching(true);
    try {
      for (const o of list) await onDispatch(o.saleId, o.ids, c.id);
      setRoute([]);
    } finally { setDispatching(false); }
  }

  async function savePoint(p: NonNullable<typeof pick>, pos: LatLng) {
    setPick(null);
    if (!userId) return;
    if (p.kind === "store") {
      setStore(pos);
      await supabase.from("store_settings").upsert({ user_id: userId, lat: pos.lat, lng: pos.lng, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      return;
    }
    const o = orders.find(x => x.saleId === p.saleId);
    if (!o) return;
    setPlaced(prev => ({ ...prev, [o.saleId]: pos }));
    // Guarda na venda, no cadastro do cliente e na memória do endereço
    await supabase.from("sales").update({ delivery_lat: pos.lat, delivery_lng: pos.lng }).eq("id", o.saleId);
    if (o.customerId) await supabase.from("customers").update({ lat: pos.lat, lng: pos.lng }).eq("id", o.customerId);
    if (o.address) await remember(addressKey(o.address), pos, false);
  }
  // O clique do mapa sempre chama a versão atual (com os pedidos de agora)
  const savePointRef = useRef(savePoint);
  savePointRef.current = savePoint;

  const missing = located.filter(x => !x.pos);
  const routeList = route.map(id => byId.get(id)).filter(Boolean) as typeof located;
  const notReady = routeList.filter(x => !x.o.ready).length;
  const routeTotal = routeList.reduce((s, x) => s + Number(x.o.total ?? 0), 0);
  const pickLabel = pick?.kind === "store" ? "Toque no mapa onde fica a sua loja"
    : pick ? `Toque no mapa onde fica a entrega #${orders.find(o => o.saleId === pick.saleId)?.num ?? ""}` : null;
  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff" });

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}

      {storeLoaded && (!store || !storeCity.city) && !pick && (
        <div className="rounded-2xl p-3 flex flex-wrap items-center gap-3" style={{ ...card, border: "2px solid #315DFB" }}>
          <Store className="w-5 h-5" style={{ color: "#315DFB" }} />
          <p className="flex-1 min-w-[200px] text-sm">Informe o <b>CEP e a cidade da loja</b> em Configurações para os pedidos aparecerem sozinhos no mapa.</p>
          <button onClick={() => navigate("/settings")} className="px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5" style={btn("#315DFB")}>
            <Settings className="w-4 h-4" /> Configurar
          </button>
        </div>
      )}

      {pickLabel && (
        <div className="rounded-2xl p-3 flex items-center gap-3" style={{ ...card, border: "2px solid #f59e0b" }}>
          <Crosshair className="w-5 h-5 text-amber-500" />
          <p className="flex-1 text-sm font-semibold">{pickLabel}</p>
          <button onClick={() => setPick(null)} className={`p-1.5 rounded-lg ${muted}`}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3 items-start">
        {/* Mapa */}
        <div className="relative rounded-2xl overflow-hidden" style={{ ...card, cursor: pick ? "crosshair" : undefined, isolation: "isolate" }}>
          <div ref={boxRef} className="w-full h-[50vh] lg:h-[68vh] min-h-[320px]" style={{ zIndex: 0 }} />
          <div className="absolute top-2 right-2 z-[500] flex flex-wrap justify-end gap-2">
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold shadow" style={{ background: "#fff", color: "#111827" }}>✓ = pronto</span>
            <button onClick={recenter} className="px-2.5 py-1 rounded-lg text-[11px] font-bold shadow" style={{ background: "#fff", color: "#111827" }}>Centralizar</button>
          </div>
          {searching.size > 0 && (
            <div className="absolute bottom-2 left-2 z-[500] px-2.5 py-1 rounded-lg text-[11px] font-bold shadow flex items-center gap-1.5" style={{ background: "#fff", color: "#111827" }}>
              <Loader2 className="w-3 h-3 animate-spin" /> Localizando {searching.size} endereço{searching.size === 1 ? "" : "s"}…
            </div>
          )}
          {route.length === 0 && orders.length > 0 && (
            <div className="absolute bottom-2 right-2 z-[500] px-2.5 py-1 rounded-lg text-[11px] font-bold shadow" style={{ background: "#315DFB", color: "#fff" }}>
              Toque nos alfinetes para montar a rota
            </div>
          )}
        </div>

        {/* Rota em montagem */}
        <div className="rounded-2xl p-4 space-y-3" style={card}>
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4" style={{ color: "#315DFB" }} />
            <p className="text-sm font-black flex-1">Rota em montagem {route.length > 0 && `(${route.length})`}</p>
            {route.length > 0 && <button onClick={() => setRoute([])} className={`text-xs underline ${muted}`}>Limpar</button>}
          </div>

          {route.length === 0 ? (
            <p className={`text-xs ${muted}`}>
              {orders.length === 0 ? "Nenhuma entrega em andamento." : "Toque nos alfinetes vermelhos do mapa (ou em + Rota na lista abaixo) na ordem da entrega. Eles aparecem aqui com o número da comanda para separar na bag."}
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <button onClick={organize} className="flex-1 h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                  style={{ ...card, color: isLight ? "#111827" : "#f4f4f5" }}>
                  <Route className="w-3.5 h-3.5" /> Organizar ordem
                </button>
                <button onClick={() => printRoute()} className="flex-1 h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                  style={{ ...card, color: isLight ? "#111827" : "#f4f4f5" }}>
                  <Printer className="w-3.5 h-3.5" /> Imprimir rota
                </button>
              </div>
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {routeList.map((x, i) => (
                  <div key={x.o.saleId} className="flex gap-2 rounded-xl p-2.5" style={{ border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0" style={{ background: "#EA4335", color: "#fff" }}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black">#{x.o.num}</span>
                        {x.o.total != null && <span className="text-xs font-bold ml-auto">{fmt(Number(x.o.total))}</span>}
                      </div>
                      <p className="text-xs font-semibold truncate">{x.o.label.replace(/^DELIVERY\s*—\s*/, "")}</p>
                      {x.o.address && <p className={`text-xs ${muted}`}>{x.o.address}</p>}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        {x.o.payText && <span className="text-[11px] font-bold" style={{ color: /troco/.test(x.o.payText) ? "#d97706" : isLight ? "#374151" : "#d4d4d8" }}>{x.o.payText}</span>}
                        <span className="text-[11px] font-bold" style={{ color: x.o.ready ? "#10b981" : "#ef4444" }}>{x.o.ready ? "pronto" : `em preparo · ${x.o.mins} min`}</span>
                        {!x.pos && <span className="text-[11px] font-semibold text-amber-500">sem ponto no mapa</span>}
                        {x.pos?.approx && <span className="text-[11px] font-semibold text-amber-500">local aproximado</span>}
                        <button onClick={() => setPick({ kind: "order", saleId: x.o.saleId })} className={`text-[11px] underline ${muted}`}>{x.pos ? "mover ponto" : "marcar no mapa"}</button>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className={`p-0.5 rounded disabled:opacity-30 ${muted}`}><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => toggleRoute(x.o.saleId)} title="Tirar da rota" className={`p-0.5 rounded hover:text-red-500 ${muted}`}><X className="w-4 h-4" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === routeList.length - 1} className={`p-0.5 rounded disabled:opacity-30 ${muted}`}><ChevronDown className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm font-bold">
                <span>Total da rota</span><span>{fmt(routeTotal)}</span>
              </div>

              {confirmNotReady ? (
                <div className="rounded-xl p-3 space-y-2" style={{ border: "2px solid #ef4444" }}>
                  <p className="text-sm font-bold">{notReady} pedido{notReady === 1 ? " ainda está" : "s ainda estão"} em preparo.</p>
                  <p className={`text-xs ${muted}`}>Despachar mesmo assim com {confirmNotReady.name}?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setConfirmNotReady(null)} className="h-9 rounded-xl text-sm font-semibold" style={{ ...card, color: isLight ? "#111827" : "#f4f4f5" }}>Voltar</button>
                    <button onClick={() => dispatchRoute(confirmNotReady, true)} className="h-9 rounded-xl text-sm font-bold" style={btn("#ef4444")}>Despachar</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className={`text-xs font-semibold ${muted}`}>Despachar {route.length} pedido{route.length === 1 ? "" : "s"} com:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {couriers.map(c => (
                      <button key={c.id} onClick={() => dispatchRoute(c)} disabled={dispatching}
                        className="h-11 rounded-xl text-sm font-bold truncate px-2 flex items-center justify-center gap-1.5 disabled:opacity-50" style={btn("#315DFB")}>
                        {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bike className="w-4 h-4" />} {c.name}
                      </button>
                    ))}
                    {couriers.length === 0 && <p className={`col-span-2 text-xs ${muted}`}>Cadastre motoboys na aba Motoboys.</p>}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Pedidos fora da rota (inclusive os sem ponto no mapa) */}
          {located.filter(x => !route.includes(x.o.saleId)).length > 0 && (
            <div className="pt-3 space-y-1.5" style={{ borderTop: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
              <p className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>Fora da rota</p>
              {located.filter(x => !route.includes(x.o.saleId)).map(({ o, pos, key }) => (
                <div key={o.saleId} className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: pos ? "#EA4335" : "#9ca3af" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">#{o.num} · {o.label.replace(/^DELIVERY\s*—\s*/, "")} {o.ready && <Check className="inline w-3 h-3 text-emerald-500" />}</p>
                    <p className={`text-[11px] truncate ${muted}`}>{o.address ?? "Sem endereço"}</p>
                  </div>
                  {!pos && (searching.has(key)
                    ? <Loader2 className={`w-3.5 h-3.5 animate-spin ${muted}`} />
                    : <button onClick={() => setPick({ kind: "order", saleId: o.saleId })} className="px-2 py-1 rounded-lg text-[11px] font-bold flex-shrink-0" style={btn("#f59e0b")}>Marcar</button>)}
                  <button onClick={() => toggleRoute(o.saleId)} className="px-2 py-1 rounded-lg text-[11px] font-bold flex-shrink-0 flex items-center gap-0.5" style={btn("#315DFB")}>
                    <Plus className="w-3 h-3" /> Rota
                  </button>
                </div>
              ))}
              {missing.length > 0 && <p className={`text-[11px] ${muted}`}>Sem ponto no mapa: marque uma vez e o sistema guarda para os próximos pedidos desse endereço.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
