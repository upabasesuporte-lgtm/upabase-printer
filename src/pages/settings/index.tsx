import { useState, useEffect } from "react";
import { Store, Phone, CreditCard, Save, CheckCircle2, Receipt, Plus, Trash2, Users, Settings, Loader2, KeyRound, Download, Printer } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { loadOperators, setCurrentOperator, saveLockMinutes, setDeviceNoLock, useOperators, TAB_OPTIONS, PRESETS, describeOperator, operatorRoutes, operatorCanApprove, type Operator } from "../../lib/operators";
import { PageHeader } from "../../components/PageHeader";
import { StoreLocationCard } from "../../components/StoreLocationCard";
import { DataExport } from "../../components/DataExport";
import { PrintAgentCard } from "../../components/PrintAgentCard";
import { useTheme } from "../../contexts/ThemeContext";
import { useBusinessType, saveBusinessType, routeFitsBusiness, type BusinessType } from "../../lib/business";
import { UtensilsCrossed, Shirt, FileText } from "lucide-react";

// ── Storage keys (cache local para impressão síncrona) ────────────────────────

const SETTINGS_KEY = "store_settings";
const SELLERS_KEY  = "sellers_list";

interface StoreSettings {
  name: string;
  cnpj: string;
  address: string;
  phone: string;
  pix: string;
  footer_message: string;
  show_cnpj: boolean;
  service_fee_pct: number;   // taxa de serviço das mesas (0 = desligada)
  blind_cash_close: boolean; // fechamento de caixa sem mostrar o valor esperado
  // Localização da loja (Mapa de entregas)
  cep: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
}

const DEFAULT: StoreSettings = {
  name: "Minha Loja",
  cnpj: "",
  address: "",
  phone: "",
  pix: "",
  footer_message: "Obrigado pela preferência! Volte sempre.",
  show_cnpj: true,
  service_fee_pct: 0,
  blind_cash_close: false,
  cep: "",
  city: "",
  state: "",
  lat: null,
  lng: null,
};

// Funções síncronas mantidas para compatibilidade com PDV / Mesas / Cardápio
export function getStoreSettings(): StoreSettings {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch { return DEFAULT; }
}

export function getSellers(): string[] {
  try { return JSON.parse(localStorage.getItem(SELLERS_KEY) || "[]"); } catch { return []; }
}

// Busca as configurações do Supabase e atualiza o cache local (chamado no carregamento de cada página com impressão)
export async function refreshStoreCache(userId: string): Promise<void> {
  try {
    const { data } = await supabase.from("store_settings").select("*").eq("user_id", userId).maybeSingle();
    if (data) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        name:           data.name           ?? DEFAULT.name,
        cnpj:           data.cnpj           ?? "",
        address:        data.address        ?? "",
        phone:          data.phone          ?? "",
        pix:            data.pix            ?? "",
        footer_message: data.footer_message ?? DEFAULT.footer_message,
        show_cnpj:      data.show_cnpj      ?? true,
        service_fee_pct:  Number(data.service_fee_pct ?? 0),
        blind_cash_close: !!data.blind_cash_close,
        cep: data.cep ?? "", city: data.city ?? "", state: data.state ?? "",
        lat: data.lat ?? null, lng: data.lng ?? null,
      }));
    }
  } catch { /* silently ignore — cache já existente será usado */ }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-all";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}

function SectionCard({ icon, title, color, children }: {
  icon: React.ReactNode; title: string; color: string; children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const card = isLight ? {
    bg: "#ffffff",
    border: "1px solid #e5e7eb",
    shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    bg: "#18181b",
    border: "1px solid rgba(39,39,42,0.8)",
    shadow: `0 0 20px ${color}10`,
  };
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/60"
        style={{ background:`${color}08` }}>
        <div className="p-2 rounded-xl border border-zinc-700" style={{ background:`${color}18` }}>
          <span style={{ color }}>{icon}</span>
        </div>
        <h2 className="text-sm font-bold" style={{ color: isLight ? "#111" : "#fff" }}>{title}</h2>
        <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background:color, boxShadow:`0 0 6px ${color}` }} />
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const card = isLight ? {
    bg: "#ffffff",
    border: "1px solid #e5e7eb",
    shadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
  } : {
    bg: "#18181b",
    border: "1px solid rgba(39,39,42,0.8)",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
  const [form,      setForm]      = useState<StoreSettings>(DEFAULT);
  const [sellers,   setSellers]   = useState<string[]>([]);
  const [newSeller, setNewSeller] = useState("");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [userId,    setUserId]    = useState<string | null>(null);

  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // ── Carregar do Supabase ao montar
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession(); // sessão local; RLS protege no banco
      const user = session?.user ?? null;
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data } = await supabase
        .from("store_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        const settings: StoreSettings = {
          name:           data.name           ?? DEFAULT.name,
          cnpj:           data.cnpj           ?? "",
          address:        data.address        ?? "",
          phone:          data.phone          ?? "",
          pix:            data.pix            ?? "",
          footer_message: data.footer_message ?? DEFAULT.footer_message,
          show_cnpj:      data.show_cnpj      ?? true,
          service_fee_pct:  Number(data.service_fee_pct ?? 0),
          blind_cash_close: !!data.blind_cash_close,
          cep: data.cep ?? "", city: data.city ?? "", state: data.state ?? "",
          lat: data.lat ?? null, lng: data.lng ?? null,
        };
        const sellersList: string[] = data.sellers ?? [];

        setForm(settings);
        setSellers(sellersList);

        // Atualiza cache local para impressão síncrona (PDV, Mesas, Cardápio)
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        localStorage.setItem(SELLERS_KEY,  JSON.stringify(sellersList));
      } else {
        // Sem registro no Supabase — tenta aproveitar cache local se existir
        const cached = getStoreSettings();
        const cachedSellers = getSellers();
        setForm(cached);
        setSellers(cachedSellers);
      }

      setLoading(false);
    }
    load();
  }, []);

  // ── Salvar no Supabase + cache local
  async function handleSave() {
    if (!userId) return;
    setSaving(true);

    const payload = {
      user_id:        userId,
      name:           form.name,
      cnpj:           form.cnpj,
      address:        form.address,
      phone:          form.phone,
      pix:            form.pix,
      footer_message: form.footer_message,
      show_cnpj:      form.show_cnpj,
      service_fee_pct:  Math.max(0, Math.min(30, Number(form.service_fee_pct) || 0)),
      blind_cash_close: form.blind_cash_close,
      cep:            form.cep || null,
      city:           form.city || null,
      state:          form.state || null,
      lat:            form.lat,
      lng:            form.lng,
      sellers,
      updated_at:     new Date().toISOString(),
    };

    const { error } = await supabase
      .from("store_settings")
      .upsert(payload, { onConflict: "user_id" });

    if (!error) {
      // Mantém cache local atualizado para impressão síncrona
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(form));
      localStorage.setItem(SELLERS_KEY,  JSON.stringify(sellers));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }

    setSaving(false);
  }

  // ── Vendedores — salva imediatamente ao adicionar/remover
  async function persistSellers(list: string[]) {
    localStorage.setItem(SELLERS_KEY, JSON.stringify(list));
    if (userId) {
      await supabase.from("store_settings")
        .upsert({ user_id: userId, sellers: list, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    }
  }

  function addSeller() {
    const name = newSeller.trim();
    if (!name || sellers.includes(name)) return;
    const updated = [...sellers, name];
    setSellers(updated);
    persistSellers(updated);
    setNewSeller("");
  }

  function removeSeller(name: string) {
    const updated = sellers.filter(s => s !== name);
    setSellers(updated);
    persistSellers(updated);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        <span className="ml-3 text-sm text-zinc-500">Carregando configurações...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">

      <PageHeader title="Configurações" subtitle="Dados da sua loja usados no comprovante e no sistema" />

      {/* Dados da loja */}
      <SectionCard icon={<Store className="w-4 h-4" />} title="Dados da Loja" color="#315DFB">
        <Field label="Nome da loja *">
          <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Ex: Restaurante Bom Sabor" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="CNPJ" hint="Aparece no comprovante quando preenchido">
            <input value={form.cnpj} onChange={e=>set("cnpj",e.target.value)} placeholder="00.000.000/0001-00" className={inputCls} />
          </Field>
          <Field label="Telefone / WhatsApp">
            <input value={form.phone} onChange={e=>set("phone",e.target.value)} placeholder="(99) 99999-9999" className={inputCls} />
          </Field>
        </div>
        <Field label="Endereço completo">
          <input value={form.address} onChange={e=>set("address",e.target.value)} placeholder="Rua Exemplo, 123 – Bairro – Cidade/UF" className={inputCls} />
        </Field>
      </SectionCard>

      {/* Tipo de negócio: muda as abas e o cadastro de produtos */}
      {userId && <BusinessTypeCard userId={userId} isLight={isLight} />}
      {userId && <CrediarioRulesCard userId={userId} />}

      {/* Localização da loja (Mapa de entregas) */}
      <SectionCard icon={<Store className="w-4 h-4" />} title="Localização da Loja (Mapa de Entregas)" color="#315DFB">
        <StoreLocationCard isLight={isLight} inputCls={inputCls}
          value={{ cep: form.cep, city: form.city, state: form.state, lat: form.lat, lng: form.lng }}
          onChange={v => setForm(prev => ({ ...prev, ...v }))}
          onAddressSuggestion={addr => setForm(prev => (prev.address.trim() ? prev : { ...prev, address: addr }))} />
      </SectionCard>

      {/* Vendedores / Garçons */}
      <SectionCard icon={<Users className="w-4 h-4" />} title="Vendedores / Garçons" color="#315DFB">
        <p className="text-xs text-zinc-500">Cadastre os vendedores e garçons para seleção rápida no PDV e nas Mesas.</p>
        <div className="flex gap-2">
          <input value={newSeller} onChange={e=>setNewSeller(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSeller();}}}
            placeholder="Nome do vendedor ou garçom..." className={inputCls+" flex-1"} />
          <button onClick={addSeller} disabled={!newSeller.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex-shrink-0"
            style={{background:"#315DFB",color:"#fff"}}>
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
        {sellers.length===0 ? (
          <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl text-xs text-zinc-600">
            Nenhum vendedor cadastrado. Adicione acima.
          </div>
        ) : (
          <div className="space-y-1.5">
            {sellers.map(name=>(
              <div key={name} className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                    style={{background:"#EFF3FF",border:"1px solid #C4D2FF",color:"#2547D6"}}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-white">{name}</span>
                </div>
                <button onClick={()=>removeSeller(name)}
                  className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Funcionários com PIN */}
      {userId && <OperatorsSection userId={userId} isLight={isLight} />}

      {/* Chave PIX */}
      <SectionCard icon={<CreditCard className="w-4 h-4" />} title="Chave PIX" color="#315DFB">
        <Field label="Chave PIX" hint="Aparece no comprovante quando o pagamento for via PIX">
          <input value={form.pix} onChange={e=>set("pix",e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória" className={inputCls} />
        </Field>
      </SectionCard>

      {/* Programa de impressão */}
      <SectionCard icon={<Printer className="w-4 h-4" />} title="Impressão automática" color="#315DFB">
        <PrintAgentCard isLight={isLight} />
      </SectionCard>

      {/* Mesas e Caixa */}
      <SectionCard icon={<Settings className="w-4 h-4" />} title="Mesas e Caixa" color="#315DFB">
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
          <div>
            <p className="text-sm font-medium">Taxa de serviço nas mesas</p>
            <p className="text-xs text-zinc-500">Somada ao fechar a conta da mesa; dá para tirar se o cliente não quiser pagar</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {form.service_fee_pct > 0 && (
              <div className="flex items-center gap-1">
                <input type="number" min="1" max="30" step="1" value={form.service_fee_pct}
                  onChange={e => set("service_fee_pct", Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                  className={inputCls + " !w-16 !px-2 text-center"} />
                <span className="text-sm text-zinc-500">%</span>
              </div>
            )}
            <button type="button" onClick={() => set("service_fee_pct", form.service_fee_pct > 0 ? 0 : 10)}
              className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
              style={{ background: form.service_fee_pct > 0 ? "#315DFB" : "#d1d5db", boxShadow: "none" }}>
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.service_fee_pct > 0 ? "left-6" : "left-1"}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
          <div>
            <p className="text-sm font-medium">Fechamento de caixa cego</p>
            <p className="text-xs text-zinc-500">Quem fecha o caixa digita o que contou sem ver o valor esperado; a diferença aparece só depois</p>
          </div>
          <button type="button" onClick={() => set("blind_cash_close", !form.blind_cash_close)}
            className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
            style={{ background: form.blind_cash_close ? "#315DFB" : "#d1d5db", boxShadow: "none" }}>
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.blind_cash_close ? "left-6" : "left-1"}`} />
          </button>
        </div>
        <p className="text-xs text-zinc-500">Clique em <b>Salvar configurações</b> no fim da página para aplicar.</p>
      </SectionCard>

      {/* Comprovante */}
      <SectionCard icon={<Receipt className="w-4 h-4" />} title="Comprovante" color="#315DFB">
        <Field label="Mensagem de rodapé">
          <input value={form.footer_message} onChange={e=>set("footer_message",e.target.value)} placeholder="Ex: Obrigado pela preferência!" className={inputCls} />
        </Field>

        <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
          <div>
            <p className="text-sm font-medium">Exibir CNPJ no comprovante</p>
            <p className="text-xs text-zinc-500">Quando marcado, o CNPJ aparece abaixo do nome da loja</p>
          </div>
          <button type="button" onClick={()=>set("show_cnpj",!form.show_cnpj)}
            className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
            style={{background:form.show_cnpj?"#315DFB":"#d1d5db",boxShadow:"none"}}>
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.show_cnpj?"left-6":"left-1"}`} />
          </button>
        </div>

        <div className="mt-2">
          <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-semibold">Prévia do comprovante</p>
          <div className="bg-white text-black rounded-xl p-4 font-mono text-xs leading-relaxed text-center space-y-0.5 border border-zinc-700">
            <div className="font-black text-base">{form.name||"Nome da Loja"}</div>
            {form.show_cnpj&&form.cnpj&&<div className="text-gray-500">CNPJ: {form.cnpj}</div>}
            {form.address&&<div className="text-gray-500 text-[10px]">{form.address}</div>}
            {form.phone&&<div className="text-gray-500">Tel: {form.phone}</div>}
            <div className="border-t border-dashed border-gray-300 my-1 pt-1 text-gray-400 text-[10px]">
              #A1B2C3 · {new Date().toLocaleDateString("pt-BR")} {new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Botão salvar */}
      <div className="flex items-center gap-3 pb-4">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-60"
          style={{background:"#315DFB",color:"#fff"}}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : "Salvar configurações"}
        </button>
        {saved && (
          <div className="flex items-center gap-1.5 text-sm font-semibold" style={{color:"#10b981"}}>
            <CheckCircle2 className="w-4 h-4" style={{filter:"drop-shadow(0 0 6px #10b981)"}} />
            Salvo com sucesso!
          </div>
        )}
      </div>

      {/* Dados para a nota fiscal (NFC-e) — preparado para quando ligar o emissor */}
      {userId && <FiscalCard userId={userId} />}

      {/* Exportar os dados da loja */}
      <SectionCard icon={<Download className="w-4 h-4" />} title="Seus dados" color="#315DFB">
        <DataExport isLight={isLight} />
      </SectionCard>
    </div>
  );
}

// ── Funcionários com PIN ──────────────────────────────────────────────────────
// Sem nenhum operador a conta funciona como sempre. O primeiro passo é o PIN do
// dono; depois disso o sistema passa a pedir "Quem está operando?" neste e nos
// outros aparelhos da loja. Cada funcionário tem as abas marcadas uma a uma.

// Campos sem type="password" e com autocomplete desligado: com um campo de senha
// na tela o navegador achava que era login e preenchia nome/PIN com o e-mail e a
// senha salvos. O PIN fica mascarado só visualmente.
const noAutofill = { autoComplete: "off", autoCorrect: "off", spellCheck: false, "data-lpignore": "true", "data-1p-ignore": "true" } as const;
const pinMask = { WebkitTextSecurity: "disc" } as React.CSSProperties;
const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

interface OpDraft { id: string | null; name: string; pin: string; routes: string[]; canApprove: boolean; lockMinutes: number | null }
const emptyDraft = (): OpDraft => ({ id: null, name: "", pin: "", routes: [], canApprove: false, lockMinutes: null });

function PermissionPicker({ draft, setDraft, isLight }: { draft: OpDraft; setDraft: (d: OpDraft) => void; isLight: boolean }) {
  const businessType = useBusinessType();
  const toggle = (path: string) => setDraft({
    ...draft,
    routes: draft.routes.includes(path) ? draft.routes.filter(r => r !== path) : [...draft.routes, path],
  });
  const chip = (on: boolean) => on
    ? { background: "rgba(49,93,251,0.12)", border: "1px solid #315DFB", color: isLight ? "#1d3fd1" : "#93a8ff" }
    : { background: isLight ? "#fff" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a", color: isLight ? "#374151" : "#d4d4d8" };
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-zinc-500 mr-1">Atalhos:</span>
        {PRESETS.map(p => (
          <button key={p.label} type="button" onClick={() => setDraft({ ...draft, routes: [...p.routes], canApprove: p.canApprove })}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors" style={chip(false)}>
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => setDraft({ ...draft, routes: TAB_OPTIONS.map(t => t.path) })}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={chip(false)}>Marcar todas</button>
        <button type="button" onClick={() => setDraft({ ...draft, routes: [] })}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={chip(false)}>Limpar</button>
      </div>
      <p className="text-xs font-semibold text-zinc-500">Abas que pode acessar</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {TAB_OPTIONS.filter(t => routeFitsBusiness(t.path, businessType)).map(t => {
          const on = draft.routes.includes(t.path);
          return (
            <label key={t.path} className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer select-none text-sm transition-colors" style={chip(on)}>
              <input type="checkbox" checked={on} onChange={() => toggle(t.path)} className="accent-[#315DFB] w-4 h-4" />
              {t.label}
            </label>
          );
        })}
      </div>
      <label className="flex items-start gap-2 px-3 py-2.5 rounded-xl cursor-pointer select-none text-sm" style={chip(draft.canApprove)}>
        <input type="checkbox" checked={draft.canApprove} onChange={() => setDraft({ ...draft, canApprove: !draft.canApprove })}
          className="accent-[#315DFB] w-4 h-4 mt-0.5" />
        <span>
          <span className="font-semibold">Pode autorizar</span>
          <span className="block text-[11px] text-zinc-500">Excluir venda, cancelar pagamento de fiado, sangria, fechar caixa e cancelar pedido de mesa — e o PIN dele libera essas ações para os outros.</span>
        </span>
      </label>
    </div>
  );
}

function OperatorsSection({ userId, isLight }: { userId: string; isLight: boolean }) {
  const opState = useOperators();
  const [ops, setOps] = useState<Operator[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  // Formulário aberto: novo (id null) ou edição de um cadastrado
  const [draft, setDraft] = useState<OpDraft | null>(null);
  const [ownerEdit, setOwnerEdit] = useState<{ id: string; name: string; pin: string } | null>(null);
  // PIN recém-gerado: mostrado uma única vez para o dono passar à pessoa
  const [revealed, setRevealed] = useState<{ name: string; pin: string } | null>(null);

  async function regenerate(op: Operator) {
    if (!confirm(`Gerar um PIN novo para ${op.name}? O PIN atual deixa de funcionar na hora.`)) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("regenerate_operator_pin", { p_id: op.id });
    setBusy(false);
    if (error || !data) { setErr(error?.message ?? "Não foi possível gerar o PIN."); return; }
    setRevealed({ name: op.name, pin: data as string });
  }

  const owner = ops.find(o => o.role === "owner") ?? null;
  const staff = ops.filter(o => o.role !== "owner");
  const rowStyle = { background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" };

  async function refresh() {
    const { data, error } = await supabase.from("operators").select("id,name,role,active,allowed_routes,can_approve,lock_minutes").eq("active", true).order("created_at");
    if (error) { setErr(error.message); return; }
    setOps((data ?? []) as Operator[]);
    await loadOperators(userId);
  }
  useEffect(() => { refresh(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinOk = (p: string) => /^[0-9]{4,6}$/.test(p);
  const flash = (m: string) => { setOk(m); setTimeout(() => setOk(null), 8000); };
  const badName = (n: string) => !n ? "Informe o nome." : n.includes("@") ? "Use o nome da pessoa, não o e-mail." : null;

  async function createOwner() {
    const n = ownerName.trim() || "Dono";
    const bad = badName(n); if (bad) { setErr(bad); return; }
    if (!pinOk(ownerPin)) { setErr("O PIN deve ter de 4 a 6 números."); return; }
    setBusy(true); setErr(null);
    const { data: id, error } = await supabase.rpc("save_operator", { p_id: null, p_name: n, p_role: "owner", p_pin: ownerPin });
    if (error) { setErr(error.message); setBusy(false); return; }
    // Quem está configurando já fica como dono neste aparelho
    if (id) setCurrentOperator({ id: id as string, name: n, role: "owner", active: true, allowed_routes: null, can_approve: true });
    setOwnerName(""); setOwnerPin("");
    await refresh();
    flash("PIN do dono ativado.");
    setBusy(false);
  }

  async function saveOwner() {
    if (!ownerEdit) return;
    const n = ownerEdit.name.trim();
    const bad = badName(n); if (bad) { setErr(bad); return; }
    if (ownerEdit.pin && !pinOk(ownerEdit.pin)) { setErr("O PIN deve ter de 4 a 6 números (ou deixe vazio para manter)."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("save_operator", { p_id: ownerEdit.id, p_name: n, p_role: "owner", p_pin: ownerEdit.pin || null, p_lock_minutes: owner?.lock_minutes ?? null });
    if (error) { setErr(error.message); setBusy(false); return; }
    setOwnerEdit(null);
    await refresh();
    flash("Alterações salvas.");
    setBusy(false);
  }

  async function saveDraft() {
    if (!draft) return;
    const n = draft.name.trim();
    const bad = badName(n); if (bad) { setErr(bad); return; }
    if (draft.id === null && !pinOk(draft.pin)) { setErr("O PIN deve ter de 4 a 6 números."); return; }
    if (draft.id !== null && draft.pin && !pinOk(draft.pin)) { setErr("O PIN deve ter de 4 a 6 números (ou deixe vazio para manter)."); return; }
    if (draft.routes.length === 0) { setErr("Marque pelo menos uma aba."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("save_operator", {
      p_id: draft.id, p_name: n, p_role: "staff", p_pin: draft.pin || null,
      p_routes: TAB_OPTIONS.map(t => t.path).filter(p => draft.routes.includes(p)), p_can_approve: draft.canApprove, p_lock_minutes: draft.lockMinutes,
    });
    if (error) { setErr(error.message); setBusy(false); return; }
    setDraft(null);
    await refresh();
    flash(draft.id ? "Alterações salvas."
      : `${n} cadastrado(a). Para entrar como ${n}, clique em "Trocar operador" no menu lateral e digite o PIN dele.`);
    setBusy(false);
  }

  async function remove(op: Operator) {
    if (op.role === "owner" && staff.length > 0) { setErr("Remova os funcionários antes de remover o PIN do dono."); return; }
    const msg = op.role === "owner"
      ? "Remover o PIN do dono? O sistema volta a funcionar sem tela de PIN."
      : `Remover ${op.name}?`;
    if (!confirm(msg)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("operators").delete().eq("id", op.id);
    if (error) setErr(error.message);
    await refresh();
    setBusy(false);
  }

  const avatar = (n: string) => (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
      style={{ background: "#EFF3FF", border: "1px solid #C4D2FF", color: "#2547D6" }}>{n.charAt(0).toUpperCase()}</div>
  );

  const draftForm = draft && (
    <div className="rounded-xl p-4 space-y-3" style={rowStyle}>
      <p className="text-sm font-semibold">{draft.id ? "Editar funcionário" : "Novo funcionário"}</p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <input autoFocus value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="Nome do funcionário" name="op-draft-name" {...noAutofill} className={inputCls} />
        <input value={draft.pin} onChange={e => setDraft({ ...draft, pin: onlyDigits(e.target.value) })} inputMode="numeric"
          name="op-draft-code" placeholder={draft.id ? "Novo PIN (opcional)" : "PIN (4 a 6 números)"} {...noAutofill} style={pinMask}
          className={inputCls + " sm:w-48"} />
      </div>
      <PermissionPicker draft={draft} setDraft={setDraft} isLight={isLight} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-500">Travar a tela desta pessoa após:</span>
        <select value={draft.lockMinutes == null ? "" : String(draft.lockMinutes)}
          onChange={e => setDraft({ ...draft, lockMinutes: e.target.value === "" ? null : Number(e.target.value) })}
          className={inputCls.replace("w-full ", "") + " w-44 py-1.5"}>
          <option value="">Padrão da loja</option>
          {[0, 2, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m === 0 ? "Nunca" : `${m} minutos`}</option>)}
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={saveDraft} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
          style={{ background: "#315DFB", color: "#fff" }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
        </button>
        <button onClick={() => { setDraft(null); setErr(null); }} className="px-3 rounded-xl text-sm text-zinc-500">Cancelar</button>
      </div>
    </div>
  );

  return (
    <SectionCard icon={<KeyRound className="w-4 h-4" />} title="Funcionários e PIN" color="#315DFB">
      <p className="text-xs text-zinc-500">
        Cada funcionário entra com o próprio PIN e vê só as abas que você marcar. Sem nenhum PIN cadastrado, o sistema funciona como hoje.
      </p>
      {!owner && (
        <p className="text-xs rounded-xl px-3 py-2" style={{ background: "rgba(49,93,251,0.08)", color: "#315DFB" }}>
          <b>Trabalha sozinho(a)?</b> Não precisa cadastrar PIN — o sistema funciona normalmente, sem tela de PIN e sem pedir autorização.
        </p>
      )}

      {!owner ? (
        <div className="rounded-xl p-4 space-y-3" style={rowStyle}>
          <p className="text-sm font-semibold">1º passo: crie o seu PIN de dono</p>
          <div className="grid grid-cols-2 gap-3">
            <input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Seu nome" name="op-owner-name" {...noAutofill} className={inputCls} />
            <input value={ownerPin} onChange={e => setOwnerPin(onlyDigits(e.target.value))} inputMode="numeric" name="op-owner-code"
              placeholder="PIN (4 a 6 números)" {...noAutofill} style={pinMask} className={inputCls} />
          </div>
          <button onClick={createOwner} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
            style={{ background: "#315DFB", color: "#fff" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Ativar PIN do dono
          </button>
        </div>
      ) : (
        <>
          {/* Trava automática */}
          <div className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={rowStyle}>
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-semibold">Travar automaticamente (padrão da loja)</p>
              <p className="text-[11px] text-zinc-500">Depois desse tempo sem uso, o aparelho volta para "Digite seu PIN". Vale só para funcionários: o dono e quem pode autorizar não são travados.</p>
            </div>
            <select value={opState.lockMinutes} disabled={busy}
              onChange={async e => {
                const m = Number(e.target.value);
                setBusy(true); setErr(null);
                try { await saveLockMinutes(userId, m); flash("Trava automática salva."); }
                catch (ex: any) { setErr(ex?.message ?? String(ex)); }
                setBusy(false);
              }}
              className={inputCls.replace("w-full ", "") + " w-40 flex-shrink-0"}>
              {[0, 2, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m === 0 ? "Nunca" : `${m} minutos`}</option>)}
            </select>
          </div>

          {/* Não travar este aparelho (vale só para o aparelho atual) */}
          <label className="rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer select-none" style={rowStyle}>
            <input type="checkbox" checked={opState.deviceNoLock} onChange={e => { setDeviceNoLock(e.target.checked); flash(e.target.checked ? "Este aparelho não trava mais sozinho." : "Este aparelho volta a travar sozinho."); }}
              className="w-4 h-4 accent-[#315DFB]" />
            <span className="flex-1">
              <span className="text-sm font-semibold block">Não travar este aparelho</span>
              <span className="text-[11px] text-zinc-500">Ex.: o computador do escritório do dono. Vale só para este aparelho — os outros continuam travando.</span>
            </span>
          </label>

          {/* Dono */}
          <div className="rounded-xl px-4 py-2.5" style={rowStyle}>
            {ownerEdit ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                  <input autoFocus value={ownerEdit.name} onChange={e => setOwnerEdit({ ...ownerEdit, name: e.target.value })}
                    placeholder="Seu nome" name="op-owner-edit-name" {...noAutofill} className={inputCls} />
                  <input value={ownerEdit.pin} onChange={e => setOwnerEdit({ ...ownerEdit, pin: onlyDigits(e.target.value) })}
                    inputMode="numeric" name="op-owner-edit-code" placeholder="Novo PIN (opcional)" {...noAutofill} style={pinMask}
                    className={inputCls + " sm:w-48"} />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveOwner} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40"
                    style={{ background: "#315DFB", color: "#fff" }}><Save className="w-4 h-4" /> Salvar</button>
                  <button onClick={() => { setOwnerEdit(null); setErr(null); }} className="px-3 rounded-xl text-sm text-zinc-500">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {avatar(owner.name)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{owner.name}</p>
                  <p className="text-[11px] text-zinc-500">Dono · acesso total</p>
                  <p className="text-[11px] text-emerald-600 font-semibold">PIN cadastrado ••••</p>
                </div>
                <button onClick={() => regenerate(owner)} disabled={busy}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-blue-500 hover:bg-blue-500/10 disabled:opacity-40">Gerar novo PIN</button>
                <button onClick={() => { setErr(null); setDraft(null); setOwnerEdit({ id: owner.id, name: owner.name, pin: "" }); }}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-blue-500 hover:bg-blue-500/10">Editar</button>
                <button onClick={() => remove(owner)} title="Remover"
                  className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>

          {/* Funcionários */}
          {staff.map(o => draft?.id === o.id ? <div key={o.id}>{draftForm}</div> : (
            <div key={o.id} className="rounded-xl px-4 py-2.5 flex items-center gap-3" style={rowStyle}>
              {avatar(o.name)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{o.name}</p>
                <p className="text-[11px] text-zinc-500">{describeOperator(o)}</p>
                <p className="text-[11px] text-emerald-600 font-semibold">PIN cadastrado ••••</p>
              </div>
              <button onClick={() => regenerate(o)} disabled={busy}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-blue-500 hover:bg-blue-500/10 disabled:opacity-40">Gerar novo PIN</button>
              <button onClick={() => { setErr(null); setOwnerEdit(null); setDraft({ id: o.id, name: o.name, pin: "", routes: operatorRoutes(o) ?? TAB_OPTIONS.map(t => t.path), canApprove: operatorCanApprove(o), lockMinutes: o.lock_minutes ?? null }); }}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-blue-500 hover:bg-blue-500/10">Editar</button>
              <button onClick={() => remove(o)} title="Remover"
                className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}

          {draft?.id === null ? draftForm : (
            <button onClick={() => { setErr(null); setOwnerEdit(null); setDraft(emptyDraft()); }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: "#315DFB", color: "#fff" }}>
              <Plus className="w-4 h-4" /> Novo funcionário
            </button>
          )}
        </>
      )}
      {err && <p className="text-xs text-red-500 font-semibold">{err}</p>}
      {ok && <p className="text-xs text-emerald-500 font-semibold">{ok}</p>}

      {revealed && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl"
            style={{ background: isLight ? "#fff" : "#18181b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" }}>
            <KeyRound className="w-6 h-6 mx-auto mb-2" style={{ color: "#315DFB" }} />
            <p className="text-sm text-zinc-500">Novo PIN de</p>
            <p className="text-lg font-black">{revealed.name}</p>
            <p className="my-4 text-5xl font-black tracking-[0.3em] tabular-nums" style={{ color: "#315DFB" }}>{revealed.pin}</p>
            <p className="text-xs text-zinc-500 mb-5">Anote ou passe agora para a pessoa. <b>Este número não aparece de novo</b> — se esquecer, é só gerar outro.</p>
            <button onClick={() => setRevealed(null)} className="w-full h-11 rounded-xl text-sm font-bold"
              style={{ color: "#fff", background: "#315DFB" }}>Já anotei</button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Tipo de negócio ───────────────────────────────────────────────────────────
function BusinessTypeCard({ userId, isLight }: { userId: string; isLight: boolean }) {
  const current = useBusinessType();
  const [saving, setSaving] = useState<BusinessType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function choose(t: BusinessType) {
    if (t === current || saving) return;
    setSaving(t); setErr(null);
    const e = await saveBusinessType(userId, t);
    setSaving(null);
    if (e) setErr("Não foi possível salvar: " + e);
  }
  const opts: { t: BusinessType; icon: React.ReactNode; title: string; desc: string }[] = [
    { t: "food", icon: <UtensilsCrossed className="w-5 h-5" />, title: "Restaurante / Marmitaria", desc: "Mesas, cozinha, cardápio digital e custo por prato." },
    { t: "retail", icon: <Shirt className="w-5 h-5" />, title: "Loja / Varejo", desc: "Roupas, calçados e varejo: grade de tamanho e cor, código de barras e etiquetas." },
  ];
  return (
    <SectionCard icon={<Store className="w-4 h-4" />} title="Tipo de negócio" color="#315DFB">
      <div className="grid sm:grid-cols-2 gap-3">
        {opts.map(o => {
          const on = current === o.t;
          return (
            <button key={o.t} onClick={() => choose(o.t)} disabled={!!saving}
              className="text-left rounded-xl p-4 border-2 transition-all disabled:opacity-60"
              style={{ borderColor: on ? "#315DFB" : (isLight ? "#e5e7eb" : "#3f3f46"), background: on ? "rgba(49,93,251,0.08)" : "transparent" }}>
              <div className="flex items-center gap-2 mb-1" style={{ color: on ? "#315DFB" : undefined }}>
                {saving === o.t ? <Loader2 className="w-5 h-5 animate-spin" /> : o.icon}
                <span className="text-sm font-bold">{o.title}</span>
                {on && <CheckCircle2 className="w-4 h-4 ml-auto" />}
              </div>
              <p className="text-xs text-zinc-500">{o.desc}</p>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">Dá para trocar quando quiser: nenhum produto, venda ou dado é apagado — só muda o que aparece no menu e no cadastro.</p>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </SectionCard>
  );
}

// ── Dados fiscais (NFC-e) ─────────────────────────────────────────────────────
interface FiscalForm {
  razao_social: string; inscricao_estadual: string; regime_tributario: string;
  nfce_ambiente: string; nfce_serie: string; nfce_proximo_numero: string; nfce_csc_id: string;
}
function FiscalCard({ userId }: { userId: string }) {
  const [f, setF] = useState<FiscalForm>({ razao_social: "", inscricao_estadual: "", regime_tributario: "simples", nfce_ambiente: "homologacao", nfce_serie: "1", nfce_proximo_numero: "1", nfce_csc_id: "" });
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    supabase.from("store_settings").select("razao_social, inscricao_estadual, regime_tributario, nfce_ambiente, nfce_serie, nfce_proximo_numero, nfce_csc_id")
      .eq("user_id", userId).maybeSingle().then(({ data }) => {
        if (!data) return;
        setF({
          razao_social: data.razao_social ?? "", inscricao_estadual: data.inscricao_estadual ?? "",
          regime_tributario: data.regime_tributario ?? "simples", nfce_ambiente: data.nfce_ambiente ?? "homologacao",
          nfce_serie: String(data.nfce_serie ?? 1), nfce_proximo_numero: String(data.nfce_proximo_numero ?? 1), nfce_csc_id: data.nfce_csc_id ?? "",
        });
      });
  }, [userId]);
  const set = (k: keyof FiscalForm, v: string) => setF(prev => ({ ...prev, [k]: v }));
  async function save() {
    setState("saving");
    const { error } = await supabase.from("store_settings").upsert({
      user_id: userId,
      razao_social: f.razao_social.trim() || null,
      inscricao_estadual: f.inscricao_estadual.trim() || null,
      regime_tributario: f.regime_tributario,
      nfce_ambiente: f.nfce_ambiente,
      nfce_serie: Math.max(1, parseInt(f.nfce_serie) || 1),
      nfce_proximo_numero: Math.max(1, parseInt(f.nfce_proximo_numero) || 1),
      nfce_csc_id: f.nfce_csc_id.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setState(error ? "error" : "saved");
    if (!error) setTimeout(() => setState("idle"), 2500);
  }
  return (
    <SectionCard icon={<FileText className="w-4 h-4" />} title="Nota fiscal (NFC-e)" color="#315DFB">
      <p className="text-xs text-zinc-500">
        Deixe estes dados prontos. A emissão da NFC-e será ligada quando você contratar um emissor de notas e tiver o
        certificado digital da loja — aí é só conectar, sem recadastrar nada. Os dados fiscais de cada produto (NCM, CFOP…)
        ficam na aba <b>Fiscal</b> do cadastro de produtos.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Preencher dados fiscais</button>
      ) : (
        <>
          <Field label="Razão social">
            <input value={f.razao_social} onChange={e => set("razao_social", e.target.value)} placeholder="Nome da empresa no CNPJ" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Inscrição estadual">
              <input value={f.inscricao_estadual} onChange={e => set("inscricao_estadual", e.target.value)} placeholder="Ex.: 123.456.789.110" className={inputCls} />
            </Field>
            <Field label="Regime tributário">
              <select value={f.regime_tributario} onChange={e => set("regime_tributario", e.target.value)} className={inputCls}>
                <option value="mei">MEI</option>
                <option value="simples">Simples Nacional</option>
                <option value="normal">Lucro Presumido / Real</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Série">
              <input inputMode="numeric" value={f.nfce_serie} onChange={e => set("nfce_serie", e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </Field>
            <Field label="Próximo nº">
              <input inputMode="numeric" value={f.nfce_proximo_numero} onChange={e => set("nfce_proximo_numero", e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </Field>
            <Field label="Ambiente">
              <select value={f.nfce_ambiente} onChange={e => set("nfce_ambiente", e.target.value)} className={inputCls}>
                <option value="homologacao">Teste</option>
                <option value="producao">Produção</option>
              </select>
            </Field>
          </div>
          <Field label="ID do CSC" hint="Código de segurança da NFC-e, gerado no site da Sefaz do seu estado. O token do CSC e o certificado são informados só no emissor.">
            <input value={f.nfce_csc_id} onChange={e => set("nfce_csc_id", e.target.value)} placeholder="Ex.: 000001" className={inputCls} />
          </Field>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={state === "saving"}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-sm font-semibold rounded-xl" style={{ color: "#fff" }}>
              {state === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar dados fiscais
            </button>
            {state === "saved" && <span className="text-sm font-semibold" style={{ color: "#10b981" }}>Salvo!</span>}
            {state === "error" && <span className="text-sm text-red-500">Erro ao salvar</span>}
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── Crediário (varejo): multa e juros das parcelas atrasadas ─────────────────
function CrediarioRulesCard({ userId }: { userId: string }) {
  const retail = useBusinessType() === "retail";
  const [multa, setMulta] = useState("2");
  const [juros, setJuros] = useState("1");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (!retail) return;
    supabase.from("store_settings").select("crediario_multa_pct, crediario_juros_mes_pct").eq("user_id", userId).maybeSingle()
      .then(({ data }) => {
        if (data?.crediario_multa_pct != null) setMulta(String(data.crediario_multa_pct).replace(".", ","));
        if (data?.crediario_juros_mes_pct != null) setJuros(String(data.crediario_juros_mes_pct).replace(".", ","));
      });
  }, [userId, retail]);
  if (!retail) return null;
  const num = (v: string) => Math.max(0, Math.min(20, parseFloat(v.replace(",", ".")) || 0));
  async function save() {
    setState("saving");
    const { error } = await supabase.from("store_settings").upsert({
      user_id: userId, crediario_multa_pct: num(multa), crediario_juros_mes_pct: num(juros), updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setState(error ? "error" : "saved");
    if (!error) setTimeout(() => setState("idle"), 2500);
  }
  return (
    <SectionCard icon={<CreditCard className="w-4 h-4" />} title="Crediário" color="#315DFB">
      <p className="text-xs text-zinc-500">Cobrados nas parcelas atrasadas (você escolhe na hora de receber se cobra ou não). Pelo Código de Defesa do Consumidor a multa máxima é 2%.</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Multa por atraso (%)">
          <input inputMode="decimal" value={multa} onChange={e => setMulta(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Juros ao mês (%)">
          <input inputMode="decimal" value={juros} onChange={e => setJuros(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={state === "saving"}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-sm font-semibold rounded-xl" style={{ color: "#fff" }}>
          {state === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
        </button>
        {state === "saved" && <span className="text-sm font-semibold" style={{ color: "#10b981" }}>Salvo!</span>}
        {state === "error" && <span className="text-sm text-red-500">Erro ao salvar</span>}
      </div>
    </SectionCard>
  );
}
