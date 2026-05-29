import { useState, useEffect } from "react";
import { Store, Phone, CreditCard, Save, CheckCircle2, Receipt, Plus, Trash2, Users, Settings, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";

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
}

const DEFAULT: StoreSettings = {
  name: "Minha Loja",
  cnpj: "",
  address: "",
  phone: "",
  pix: "",
  footer_message: "Obrigado pela preferência! Volte sempre.",
  show_cnpj: true,
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
      }));
    }
  } catch { /* silently ignore — cache já existente será usado */ }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 transition-all";

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
      const { data: { user } } = await supabase.auth.getUser();
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
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="ml-3 text-sm text-zinc-500">Carregando configurações...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-6"
        style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
          backgroundImage:"radial-gradient(rgba(139,92,246,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-violet-900/10 to-transparent pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <div className="p-2.5 rounded-xl" style={{background:"rgba(139,92,246,0.15)",border:"1px solid rgba(139,92,246,0.3)"}}>
            <Settings className="w-5 h-5" style={{color:"#8b5cf6"}} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-500" style={{boxShadow:"0 0 6px #8b5cf6"}} />
              <span className="text-[11px] font-semibold text-violet-400 uppercase tracking-widest">Sistema</span>
            </div>
            <h1 className="text-2xl font-black"
              style={{background: isLight ? "linear-gradient(135deg,#7B2FBE,#00B4D8)" : "linear-gradient(135deg,#c4b5fd,#67e8f9)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text"}}>
              Configurações
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">Dados da sua loja usados no comprovante e no sistema</p>
          </div>
        </div>
      </div>

      {/* Dados da loja */}
      <SectionCard icon={<Store className="w-4 h-4" />} title="Dados da Loja" color="#8b5cf6">
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

      {/* Vendedores / Garçons */}
      <SectionCard icon={<Users className="w-4 h-4" />} title="Vendedores / Garçons" color="#d946ef">
        <p className="text-xs text-zinc-500">Cadastre os vendedores e garçons para seleção rápida no PDV e nas Mesas.</p>
        <div className="flex gap-2">
          <input value={newSeller} onChange={e=>setNewSeller(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSeller();}}}
            placeholder="Nome do vendedor ou garçom..." className={inputCls+" flex-1"} />
          <button onClick={addSeller} disabled={!newSeller.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex-shrink-0"
            style={{background:"linear-gradient(135deg,#d946ef,#8b5cf6)",color:"#fff",boxShadow:"0 0 16px rgba(217,70,239,0.3)"}}>
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
                    style={{background:"linear-gradient(135deg,rgba(217,70,239,0.2),rgba(139,92,246,0.2))",border:"1px solid rgba(217,70,239,0.3)",color:"#d946ef"}}>
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

      {/* Chave PIX */}
      <SectionCard icon={<CreditCard className="w-4 h-4" />} title="Chave PIX" color="#10b981">
        <Field label="Chave PIX" hint="Aparece no comprovante quando o pagamento for via PIX">
          <input value={form.pix} onChange={e=>set("pix",e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória" className={inputCls} />
        </Field>
      </SectionCard>

      {/* Comprovante */}
      <SectionCard icon={<Receipt className="w-4 h-4" />} title="Comprovante" color="#f59e0b">
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
            style={{background:form.show_cnpj?"linear-gradient(135deg,#7c3aed,#4f46e5)":"#27272a",boxShadow:form.show_cnpj?"0 0 10px rgba(124,58,237,0.4)":"none"}}>
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
          style={{background:"linear-gradient(135deg,#7c3aed,#4f46e5)",color:"#fff",boxShadow:"0 0 20px rgba(124,58,237,0.4)"}}>
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
    </div>
  );
}
