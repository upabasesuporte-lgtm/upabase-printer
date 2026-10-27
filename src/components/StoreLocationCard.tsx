// Configurações → Localização da loja: CEP preenche rua/bairro/cidade (ViaCEP),
// o sistema acha a loja no mapa e dá para arrastar o ponto para o lugar exato.
// É daqui que o Mapa de entregas da Cozinha sabe a cidade e de onde começar.
import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { loadLeaflet, lookupCep, geocodeStore, TILE_URL, TILE_ATTR, type LatLng } from "../lib/geo";

export interface StoreGeo { cep: string; city: string; state: string; lat: number | null; lng: number | null }

export function StoreLocationCard({ value, onChange, inputCls, isLight, onAddressSuggestion }: {
  value: StoreGeo; onChange: (v: StoreGeo) => void; inputCls: string; isLight: boolean;
  onAddressSuggestion: (addr: string) => void; // endereço do comprovante, se estiver vazio
}) {
  const [street, setStreet] = useState("");
  const [district, setDistrict] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const muted = isLight ? "text-gray-500" : "text-zinc-500";

  async function onCep(cep: string) {
    onChange({ ...value, cep });
    if (cep.replace(/\D/g, "").length !== 8) return;
    setBusy(true); setMsg(null);
    const r = await lookupCep(cep);
    setBusy(false);
    if (!r) { setMsg("CEP não encontrado. Preencha cidade e UF."); return; }
    setStreet(r.street); setDistrict(r.district);
    onChange({ ...value, cep, city: r.city, state: r.state });
  }

  async function locate() {
    setBusy(true); setMsg(null);
    const hit = await geocodeStore({ street, number, district, city: value.city, state: value.state });
    setBusy(false);
    if (!hit) { setMsg("Não achei no mapa. Confira a cidade, ou toque no mapa onde fica a loja."); return; }
    onChange({ ...value, lat: hit.pos.lat, lng: hit.pos.lng });
    setMsg(hit.exact ? "Loja encontrada. Se precisar, arraste o ponto para o lugar exato." : "Local aproximado: arraste o ponto até a porta da loja.");
    if (street) onAddressSuggestion(`${street}${number ? `, ${number}` : ""}${district ? ` - ${district}` : ""} - ${value.city}/${value.state}`);
  }

  return (
    <div className="space-y-3">
      <p className={`text-xs ${muted}`}>Usado no <b>Mapa de entregas</b> da Cozinha: os pedidos com endereço aparecem sozinhos no mapa da sua cidade.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-1">
          <label className={`block text-xs font-semibold mb-1.5 ${muted}`}>CEP</label>
          <input value={value.cep} onChange={e => onCep(e.target.value)} inputMode="numeric" placeholder="00000-000" className={inputCls} />
        </div>
        <div className="col-span-1">
          <label className={`block text-xs font-semibold mb-1.5 ${muted}`}>Número</label>
          <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Ex: 25" className={inputCls} />
        </div>
        <div className="col-span-1">
          <label className={`block text-xs font-semibold mb-1.5 ${muted}`}>Cidade *</label>
          <input value={value.city} onChange={e => onChange({ ...value, city: e.target.value })} placeholder="Cidade" className={inputCls} />
        </div>
        <div className="col-span-1">
          <label className={`block text-xs font-semibold mb-1.5 ${muted}`}>UF *</label>
          <input value={value.state} onChange={e => onChange({ ...value, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="SP" className={inputCls} />
        </div>
      </div>
      {(street || district) && <p className={`text-xs ${muted}`}>{[street, district].filter(Boolean).join(" - ")}</p>}
      <button type="button" onClick={locate} disabled={busy || !value.city}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
        style={{ background: "#315DFB", color: "#fff" }}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />} Achar minha loja no mapa
      </button>
      {msg && <p className={`text-xs ${muted}`}>{msg}</p>}
      <PinMap pos={value.lat != null && value.lng != null ? { lat: value.lat, lng: value.lng } : null}
        onChange={p => onChange({ ...value, lat: p.lat, lng: p.lng })} />
      <p className={`text-[11px] ${muted}`}>Toque no mapa ou arraste o ponto para ajustar. Clique em <b>Salvar configurações</b> no fim da página.</p>
    </div>
  );
}

function PinMap({ pos, onChange }: { pos: LatLng | null; onChange: (p: LatLng) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let off = false;
    loadLeaflet().then(L => {
      if (off || !box.current || map.current) return;
      const m = L.map(box.current).setView(pos ? [pos.lat, pos.lng] : [-15.78, -47.93], pos ? 16 : 4);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(m);
      m.on("click", (e: any) => cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.current = m;
      setReady(true);
    }).catch(() => { /* sem mapa: os campos continuam funcionando */ });
    return () => { off = true; map.current?.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !map.current || !pos) return;
    if (!marker.current) {
      marker.current = L.marker([pos.lat, pos.lng], {
        draggable: true,
        icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
          html: '<div style="width:30px;height:30px;border-radius:50%;background:#315DFB;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:14px">🏠</div>' }),
      }).addTo(map.current);
      marker.current.on("dragend", () => { const p = marker.current.getLatLng(); cb.current({ lat: p.lat, lng: p.lng }); });
      map.current.setView([pos.lat, pos.lng], 16);
    } else {
      marker.current.setLatLng([pos.lat, pos.lng]);
      if (!map.current.getBounds().contains([pos.lat, pos.lng])) map.current.setView([pos.lat, pos.lng], 16);
    }
  }, [ready, pos?.lat, pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="w-full h-64 rounded-xl overflow-hidden" style={{ isolation: "isolate" }} />;
}
