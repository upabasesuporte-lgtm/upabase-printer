// Produtos → Promoções: criar, pausar e encerrar promoções (desconto em %).
import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, RefreshCw, BadgePercent, Search, Pause, Play } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { matchesSearch } from "../lib/search";
import { promoStatus, WEEKDAYS, localIso, type Promotion } from "../lib/promotions";
import { useEscapeKey } from "../hooks/useEscapeKey";

const fmtDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const STATUS: Record<ReturnType<typeof promoStatus>, { t: string; c: string }> = {
  active: { t: "Valendo agora", c: "bg-emerald-500/10 text-emerald-600" },
  scheduled: { t: "Agendada", c: "bg-blue-500/10 text-blue-500" },
  otherday: { t: "Hoje não", c: "bg-zinc-500/10 text-zinc-500" },
  ended: { t: "Encerrada", c: "bg-zinc-500/10 text-zinc-500" },
  paused: { t: "Pausada", c: "bg-amber-500/10 text-amber-600" },
};
const SCOPES: { k: Promotion["scope"]; t: string }[] = [
  { k: "all", t: "Toda a loja" }, { k: "category", t: "Categoria" }, { k: "brand", t: "Marca" },
  { k: "collection", t: "Coleção" }, { k: "products", t: "Produtos escolhidos" },
];

interface Opt { id: string; name: string }
interface Prod { id: string; name: string; brand: string | null; collection: string | null; variant_of: string | null }

export function PromotionsModal({ categories, isLight, onClose }: { categories: Opt[]; isLight: boolean; onClose: () => void }) {
  useEscapeKey(onClose);
  const [list, setList] = useState<Promotion[] | null>(null);
  const [prods, setProds] = useState<Prod[]>([]);
  const [editing, setEditing] = useState<Partial<Promotion> | null>(null);
  const [prodSearch, setProdSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = isLight ? "bg-gray-50 border-gray-200" : "bg-zinc-950 border-zinc-800";
  const field = `w-full px-3 py-2 rounded-xl border text-sm ${box}`;

  async function load() {
    const { data } = await supabase.from("promotions").select("*").order("created_at", { ascending: false });
    setList(((data ?? []) as any[]).map(p => ({ ...p, discount_pct: Number(p.discount_pct), weekdays: p.weekdays ?? [], product_ids: p.product_ids ?? [] })));
  }
  useEffect(() => {
    load();
    fetchAll(() => supabase.from("products").select("id, name, brand, collection, variant_of").neq("is_active", false).order("name"))
      .then(r => setProds((r.data ?? []) as Prod[]));
  }, []);

  const brands = useMemo(() => [...new Set(prods.map(p => p.brand?.trim()).filter(Boolean) as string[])].sort(), [prods]);
  const collections = useMemo(() => [...new Set(prods.map(p => p.collection?.trim()).filter(Boolean) as string[])].sort(), [prods]);
  const mainProds = prods.filter(p => !p.variant_of);
  const prodResults = prodSearch.trim() ? mainProds.filter(p => matchesSearch(p.name, prodSearch.trim())).slice(0, 12) : [];
  const nameOf = (id: string) => prods.find(p => p.id === id)?.name ?? "Produto";
  const describe = (p: Promotion) =>
    p.scope === "all" ? "Toda a loja"
      : p.scope === "category" ? `Categoria ${categories.find(c => c.id === p.target)?.name ?? ""}`
      : p.scope === "brand" ? `Marca ${p.target}` : p.scope === "collection" ? `Coleção ${p.target}`
      : `${p.product_ids.length} produto${p.product_ids.length === 1 ? "" : "s"}`;

  async function save() {
    const e = editing!;
    const pct = Number(String(e.discount_pct ?? "").replace(",", "."));
    if (!e.name?.trim()) { setErr("Dê um nome (ex.: Liquidação de verão)."); return; }
    if (!(pct > 0 && pct < 100)) { setErr("Desconto entre 1% e 99%."); return; }
    if ((e.scope === "category" || e.scope === "brand" || e.scope === "collection") && !e.target) { setErr("Escolha a que a promoção se aplica."); return; }
    if (e.scope === "products" && !(e.product_ids ?? []).length) { setErr("Escolha os produtos."); return; }
    if (e.starts_on && e.ends_on && e.ends_on < e.starts_on) { setErr("A data final é antes da inicial."); return; }
    setSaving(true); setErr(null);
    const row = {
      name: e.name.trim(), scope: e.scope ?? "all", target: e.scope === "all" || e.scope === "products" ? null : e.target,
      product_ids: e.scope === "products" ? e.product_ids : [], discount_pct: pct,
      starts_on: e.starts_on || null, ends_on: e.ends_on || null, weekdays: e.weekdays ?? [], active: e.active ?? true,
    };
    const { error } = e.id ? await supabase.from("promotions").update(row).eq("id", e.id) : await supabase.from("promotions").insert(row);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setEditing(null); load();
  }
  async function toggle(p: Promotion) { await supabase.from("promotions").update({ active: !p.active }).eq("id", p.id); load(); }
  async function remove(p: Promotion) { await supabase.from("promotions").delete().eq("id", p.id); load(); }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}
        style={{ background: isLight ? "#fff" : "#18181b" }}>
        <div className="flex items-center gap-2">
          <BadgePercent className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold flex-1">Promoções</h3>
          <button onClick={onClose} className="p-1 text-zinc-500"><X className="w-5 h-5" /></button>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-1">Nome</p>
                <input value={editing.name ?? ""} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Liquidação de verão" className={field} />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-1">Desconto (%)</p>
                <input inputMode="decimal" value={editing.discount_pct ?? ""} onChange={e => setEditing({ ...editing, discount_pct: e.target.value as any })} placeholder="20" className={field} />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-1">Vale para</p>
              <div className="flex flex-wrap gap-1.5">
                {SCOPES.map(s => (
                  <button key={s.k} onClick={() => setEditing({ ...editing, scope: s.k, target: null })} className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
                    style={(editing.scope ?? "all") === s.k ? { background: "#315DFB", borderColor: "#315DFB", color: "#fff" } : { borderColor: isLight ? "#d1d5db" : "#3f3f46" }}>{s.t}</button>
                ))}
              </div>
            </div>
            {editing.scope === "category" && (
              <select value={editing.target ?? ""} onChange={e => setEditing({ ...editing, target: e.target.value })} className={field}>
                <option value="">Escolha a categoria…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {(editing.scope === "brand" || editing.scope === "collection") && (
              (editing.scope === "brand" ? brands : collections).length ? (
                <select value={editing.target ?? ""} onChange={e => setEditing({ ...editing, target: e.target.value })} className={field}>
                  <option value="">Escolha…</option>
                  {(editing.scope === "brand" ? brands : collections).map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : <p className="text-xs text-zinc-500">Nenhum produto com {editing.scope === "brand" ? "marca" : "coleção"} cadastrada (preencha no cadastro do produto).</p>
            )}
            {editing.scope === "products" && (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input value={prodSearch} onChange={e => setProdSearch(e.target.value)} placeholder="Buscar produto..." className={field + " pl-9"} />
                </div>
                {prodResults.map(p => (
                  <button key={p.id} onClick={() => { setEditing({ ...editing, product_ids: [...new Set([...(editing.product_ids ?? []), p.id])] }); setProdSearch(""); }}
                    className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-zinc-800/30 flex items-center gap-2"><Plus className="w-3.5 h-3.5 text-brand-600" />{p.name}</button>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  {(editing.product_ids ?? []).map(id => (
                    <span key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-semibold bg-brand-500/10 text-brand-600">
                      {nameOf(id)}
                      <button onClick={() => setEditing({ ...editing, product_ids: (editing.product_ids ?? []).filter(x => x !== id) })} className="p-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-1">Começa em</p>
                <input type="date" value={editing.starts_on ?? ""} onChange={e => setEditing({ ...editing, starts_on: e.target.value || null })} className={field} />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 mb-1">Termina em</p>
                <input type="date" value={editing.ends_on ?? ""} onChange={e => setEditing({ ...editing, ends_on: e.target.value || null })} className={field} />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-1">Só nestes dias da semana <span className="font-normal">(nenhum marcado = todos)</span></p>
              <div className="flex gap-1">
                {WEEKDAYS.map((d, i) => {
                  const on = (editing.weekdays ?? []).includes(i);
                  return (
                    <button key={d} onClick={() => setEditing({ ...editing, weekdays: on ? (editing.weekdays ?? []).filter(x => x !== i) : [...(editing.weekdays ?? []), i].sort() })}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold border"
                      style={on ? { background: "#315DFB", borderColor: "#315DFB", color: "#fff" } : { borderColor: isLight ? "#d1d5db" : "#3f3f46" }}>{d}</button>
                  );
                })}
              </div>
            </div>
            {err && <p className="text-sm text-red-500">{err}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setEditing(null); setErr(null); }} className={`py-2.5 rounded-xl text-sm font-semibold border ${isLight ? "border-gray-300" : "border-zinc-700"}`}>Cancelar</button>
              <button onClick={save} disabled={saving} className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-brand-600 disabled:opacity-50" style={{ color: "#fff" }}>
                {saving && <RefreshCw className="w-4 h-4 animate-spin" />} Salvar promoção
              </button>
            </div>
          </div>
        ) : (
          <>
            <button onClick={() => { setEditing({ scope: "all", weekdays: [], product_ids: [], active: true, starts_on: localIso() }); setErr(null); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-brand-600" style={{ color: "#fff" }}>
              <Plus className="w-4 h-4" /> Nova promoção
            </button>
            {!list ? (
              <div className="flex justify-center py-6"><RefreshCw className="w-5 h-5 animate-spin text-brand-600" /></div>
            ) : list.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-4">Nenhuma promoção. Ex.: "Liquidação de verão — 30% na coleção Verão 2026" ou "Terça da marmita — 10% na categoria Marmitas, só às terças".</p>
            ) : (
              <div className="space-y-2">
                {list.map(p => {
                  const st = promoStatus(p);
                  return (
                    <div key={p.id} className={`rounded-xl border px-3 py-2.5 ${box}`}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setEditing({ ...p }); setErr(null); }} className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-bold truncate">{p.name} <span style={{ color: "#315DFB" }}>−{String(p.discount_pct).replace(".", ",")}%</span></p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            {describe(p)}
                            {p.starts_on || p.ends_on ? ` · ${p.starts_on ? fmtDate(p.starts_on) : "…"} até ${p.ends_on ? fmtDate(p.ends_on) : "sem fim"}` : ""}
                            {p.weekdays.length ? ` · ${p.weekdays.map(d => WEEKDAYS[d]).join(", ")}` : ""}
                          </p>
                        </button>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${STATUS[st].c}`}>{STATUS[st].t}</span>
                        <button onClick={() => toggle(p)} title={p.active ? "Pausar" : "Reativar"} className="p-1.5 text-zinc-500">{p.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
                        <button onClick={() => remove(p)} title="Excluir" className="p-1.5 text-zinc-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-zinc-500">O PDV aplica o menor preço válido (promoção ou o "preço promocional" do cadastro) e mostra o preço normal riscado. Preço combinado com cliente continua valendo. Reabra o PDV depois de criar uma promoção.</p>
          </>
        )}
      </div>
    </div>
  );
}
