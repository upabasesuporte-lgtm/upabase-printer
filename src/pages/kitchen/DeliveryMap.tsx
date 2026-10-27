// Mapa de entregas (aba Cozinha → Pedidos → Mapa).
// Grátis: mapa do OpenStreetMap com a biblioteca Leaflet, carregada da CDN só
// quando o mapa é aberto (não pesa no resto do sistema). Os pontos vêm do GPS
// do cliente no Cardápio ou são marcados pela loja uma vez e ficam guardados
// (na venda, no cadastro do cliente e na memória de endereços).
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Bike, MapPin, Store, Crosshair, Clock, X } from "lucide-react";

export interface MapOrder {
  saleId: string; label: string; address: string | null; mins: number; ready: boolean; ids: string[];
  lat: number | null; lng: number | null; custLat: number | null; custLng: number | null;
  customerId: string | null; total: number | null;
}
interface Courier { id: string; name: string }
type LatLng = { lat: number; lng: number };

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Mesmo endereço escrito de jeitos diferentes vira a mesma chave
const addressKey = (a: string) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.async = true;
    js.onload = () => resolve(w.L);
    js.onerror = () => { leafletPromise = null; reject(new Error("Não foi possível carregar o mapa (sem internet?)")); };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

export default function DeliveryMap({ orders, couriers, isLight, card, onDispatch }: {
  orders: MapOrder[]; couriers: Courier[]; isLight: boolean; card: React.CSSProperties;
  onDispatch: (saleId: string, ids: string[], courierId?: string) => void;
}) {
  const muted = isLight ? "text-gray-500" : "text-zinc-400";
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const fitted = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [store, setStore] = useState<LatLng | null>(null);
  const [cache, setCache] = useState<Record<string, LatLng>>({});     // memória de endereços
  const [placed, setPlaced] = useState<Record<string, LatLng>>({});   // marcados agora (antes do próximo recarregar)
  const [selected, setSelected] = useState<string | null>(null);
  const [pick, setPick] = useState<{ kind: "order"; saleId: string } | { kind: "store" } | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // Loja e memória de endereços
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const { data } = await supabase.from("store_settings").select("lat,lng").eq("user_id", uid).maybeSingle();
      if (data?.lat != null && data?.lng != null) setStore({ lat: data.lat, lng: data.lng });
    })();
  }, []);

  const keys = useMemo(() => [...new Set(orders.map(o => o.address ? addressKey(o.address) : "").filter(Boolean))], [orders]);
  useEffect(() => {
    const missing = keys.filter(k => !(k in cache));
    if (!missing.length) return;
    supabase.from("delivery_locations").select("address_key,lat,lng").in("address_key", missing.slice(0, 200))
      .then(({ data }) => {
        if (!data?.length) return;
        setCache(prev => { const n = { ...prev }; for (const r of data as any[]) n[r.address_key] = { lat: r.lat, lng: r.lng }; return n; });
      });
  }, [keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Onde fica cada entrega: marcado agora → GPS/venda → cadastro do cliente → memória de endereços
  const located = useMemo(() => orders.map(o => {
    const k = o.address ? addressKey(o.address) : "";
    const pos = placed[o.saleId]
      ?? (o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null)
      ?? (o.custLat != null && o.custLng != null ? { lat: o.custLat, lng: o.custLng } : null)
      ?? (k && cache[k] ? cache[k] : null);
    return { o, pos };
  }), [orders, placed, cache]);

  // Pedido que chegou com GPS: guarda o endereço na memória para as próximas vezes
  useEffect(() => {
    if (!userId) return;
    const rows = orders.filter(o => o.address && o.lat != null && o.lng != null && !cache[addressKey(o.address)])
      .map(o => ({ user_id: userId, address_key: addressKey(o.address!), lat: o.lat!, lng: o.lng!, updated_at: new Date().toISOString() }));
    if (!rows.length) return;
    setCache(prev => { const n = { ...prev }; for (const r of rows) n[r.address_key] = { lat: r.lat, lng: r.lng }; return n; });
    supabase.from("delivery_locations").upsert(rows, { onConflict: "user_id,address_key" }).then(() => {});
  }, [orders, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cria o mapa uma vez
  useEffect(() => {
    let off = false;
    loadLeaflet().then(L => {
      if (off || !boxRef.current || mapRef.current) return;
      const map = L.map(boxRef.current, { zoomControl: true }).setView([-15.78, -47.93], 4);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", (e: any) => { const p = pickRef.current; if (p) savePointRef.current(p, { lat: e.latlng.lat, lng: e.latlng.lng }); });
      mapRef.current = map;
      setReady(true);
    }).catch(e => setErr(e.message));
    return () => { off = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Desenha os pontos
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const layer = layerRef.current;
    layer.clearLayers();
    const pts: [number, number][] = [];
    const dot = (bg: string, size: number, text: string, ring: boolean) => L.divIcon({
      className: "",
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;font:700 11px Arial;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)${ring ? ",0 0 0 4px rgba(49,93,251,.55)" : ""}">${text}</div>`,
    });
    located.forEach(({ o, pos }, idx) => {
      if (!pos) return;
      pts.push([pos.lat, pos.lng]);
      const m = L.marker([pos.lat, pos.lng], { icon: dot(o.ready ? "#10b981" : "#ef4444", selected === o.saleId ? 34 : 28, String(idx + 1), selected === o.saleId) });
      m.on("click", () => setSelected(o.saleId));
      layer.addLayer(m);
    });
    if (store) {
      pts.push([store.lat, store.lng]);
      layer.addLayer(L.marker([store.lat, store.lng], { icon: dot("#315DFB", 30, "🏠", false), zIndexOffset: -100 }));
    }
    if (!fitted.current && pts.length) {
      fitted.current = true;
      if (pts.length === 1) map.setView(pts[0], 15); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    }
  }, [ready, located, store, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  function recenter() {
    const map = mapRef.current;
    const pts = located.filter(x => x.pos).map(x => [x.pos!.lat, x.pos!.lng] as [number, number]);
    if (store) pts.push([store.lat, store.lng]);
    if (!map || !pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 15); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
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
    setSelected(o.saleId);
    // Guarda na venda, no cadastro do cliente e na memória do endereço
    await supabase.from("sales").update({ delivery_lat: pos.lat, delivery_lng: pos.lng }).eq("id", o.saleId);
    if (o.customerId) await supabase.from("customers").update({ lat: pos.lat, lng: pos.lng }).eq("id", o.customerId);
    if (o.address) {
      const k = addressKey(o.address);
      setCache(prev => ({ ...prev, [k]: pos }));
      await supabase.from("delivery_locations").upsert({ user_id: userId, address_key: k, lat: pos.lat, lng: pos.lng, updated_at: new Date().toISOString() }, { onConflict: "user_id,address_key" });
    }
  }

  // O clique do mapa sempre chama a versão atual (com os pedidos de agora)
  const savePointRef = useRef(savePoint);
  savePointRef.current = savePoint;

  const sel = located.find(x => x.o.saleId === selected) ?? null;
  const missing = located.filter(x => !x.pos);
  const pickLabel = pick?.kind === "store" ? "Toque no mapa onde fica a sua loja"
    : pick ? `Toque no mapa onde fica a entrega: ${orders.find(o => o.saleId === pick.saleId)?.label ?? ""}` : null;
  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff" });

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}

      {!store && !pick && (
        <div className="rounded-2xl p-3 flex flex-wrap items-center gap-3" style={{ ...card, border: "2px solid #315DFB" }}>
          <Store className="w-5 h-5" style={{ color: "#315DFB" }} />
          <p className="flex-1 min-w-[180px] text-sm">Marque onde fica a sua loja (só uma vez).</p>
          <button onClick={() => setPick({ kind: "store" })} className="px-3 py-2 rounded-xl text-sm font-bold" style={btn("#315DFB")}>Marcar minha loja</button>
        </div>
      )}

      {pickLabel && (
        <div className="rounded-2xl p-3 flex items-center gap-3" style={{ ...card, border: "2px solid #f59e0b" }}>
          <Crosshair className="w-5 h-5 text-amber-500" />
          <p className="flex-1 text-sm font-semibold">{pickLabel}</p>
          <button onClick={() => setPick(null)} className={`p-1.5 rounded-lg ${muted}`}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden" style={{ ...card, cursor: pick ? "crosshair" : undefined, isolation: "isolate" }}>
        <div ref={boxRef} className="w-full h-[55vh] min-h-[340px]" style={{ zIndex: 0 }} />
        <div className="absolute top-2 right-2 z-[500] flex gap-2">
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold shadow" style={{ background: "#fff", color: "#ef4444" }}>● Em preparo</span>
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold shadow" style={{ background: "#fff", color: "#10b981" }}>● Pronto</span>
          <button onClick={recenter} className="px-2.5 py-1 rounded-lg text-[11px] font-bold shadow" style={{ background: "#fff", color: "#111827" }}>Centralizar</button>
        </div>
      </div>

      {orders.length === 0 && <div className={`rounded-2xl p-6 text-center text-xs ${muted}`} style={card}>Nenhuma entrega em andamento</div>}

      {/* Pedido selecionado */}
      {sel && (
        <div className="rounded-2xl p-4 space-y-3" style={{ ...card, border: `2px solid ${sel.o.ready ? "#10b981" : "#ef4444"}` }}>
          <div className="flex items-start gap-2">
            <Bike className="w-4 h-4 mt-0.5" style={{ color: "#315DFB" }} />
            <div className="flex-1 min-w-0">
              <p className="text-base font-black leading-tight">{sel.o.label}</p>
              {sel.o.address && <p className={`text-xs ${muted}`}>{sel.o.address}</p>}
            </div>
            <span className={`text-xs font-bold flex items-center gap-1 ${muted}`}><Clock className="w-3.5 h-3.5" />{sel.o.mins} min</span>
            <button onClick={() => setSelected(null)} className={`p-1 rounded-lg ${muted}`}><X className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {sel.o.total != null && <span className="font-bold">{fmt(Number(sel.o.total))}</span>}
            <span className="font-bold" style={{ color: sel.o.ready ? "#10b981" : "#ef4444" }}>{sel.o.ready ? "Pronto para sair" : "Em preparo"}</span>
            <button onClick={() => setPick({ kind: "order", saleId: sel.o.saleId })} className={`ml-auto underline ${muted}`}>Mover ponto</button>
          </div>
          {sel.o.ready ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {couriers.map(c => (
                <button key={c.id} onClick={() => { setSelected(null); onDispatch(sel.o.saleId, sel.o.ids, c.id); }}
                  className="h-10 rounded-xl text-sm font-semibold truncate px-2" style={btn("#315DFB")}>{c.name}</button>
              ))}
              {couriers.length === 0 && <p className={`col-span-2 text-xs ${muted}`}>Cadastre motoboys na aba Motoboys.</p>}
            </div>
          ) : (
            <p className={`text-xs ${muted}`}>Quando ficar pronto, o ponto fica verde e aparecem os motoboys para despachar.</p>
          )}
        </div>
      )}

      {/* Entregas sem localização */}
      {missing.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={card}>
          <p className="text-sm font-bold">Sem localização ({missing.length})</p>
          <p className={`text-xs ${muted}`}>Marque uma vez: o sistema guarda e da próxima vez esse endereço já aparece no mapa.</p>
          {missing.map(({ o }) => (
            <div key={o.saleId} className="flex items-center gap-2">
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: o.ready ? "#10b981" : "#ef4444" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{o.label}</p>
                <p className={`text-xs truncate ${muted}`}>{o.address ?? "Sem endereço"}</p>
              </div>
              <button onClick={() => setPick({ kind: "order", saleId: o.saleId })}
                className="px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0" style={btn("#f59e0b")}>Marcar no mapa</button>
            </div>
          ))}
        </div>
      )}
      {store && !pick && (
        <button onClick={() => setPick({ kind: "store" })} className={`text-xs underline ${muted}`}>Mudar o local da loja</button>
      )}
    </div>
  );
}
