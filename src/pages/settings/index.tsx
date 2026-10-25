import { useState, useEffect } from "react";
import { Store, Phone, CreditCard, Save, CheckCircle2, Receipt, Plus, Trash2, Users, Settings, Loader2, KeyRound } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { loadOperators, setCurrentOperator, TAB_OPTIONS, PRESETS, describeOperator, operatorRoutes, operatorCanApprove, type Operator } from "../../lib/operators";
import { PageHeader } from "../../components/PageHeader";
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

interface OpDraft { id: string | null; name: string; pin: string; routes: string[]; canApprove: boolean }
const emptyDraft = (): OpDraft => ({ id: null, name: "", pin: "", routes: [], canApprove: false });

function PermissionPicker({ draft, setDraft, isLight }: { draft: OpDraft; setDraft: (d: OpDraft) => void; isLight: boolean }) {
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
        {TAB_OPTIONS.map(t => {
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
  const [ops, setOps] = useState<Operator[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  // Formulário aberto: novo (id null) ou edição de um cadastrado
  const [draft, setDraft] = useState<OpDraft | null>(null);
  const [ownerEdit, setOwnerEdit] = useState<{ id: string; name: string; pin: string } | null>(null);

  const owner = ops.find(o => o.role === "owner") ?? null;
  const staff = ops.filter(o => o.role !== "owner");
  const rowStyle = { background: isLight ? "#f9fafb" : "#09090b", border: isLight ? "1px solid #e5e7eb" : "1px solid #27272a" };

  async function refresh() {
    const { data, error } = await supabase.from("operators").select("id,name,role,active,allowed_routes,can_approve").eq("active", true).order("created_at");
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
    const { error } = await supabase.rpc("save_operator", { p_id: ownerEdit.id, p_name: n, p_role: "owner", p_pin: ownerEdit.pin || null });
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
      p_routes: TAB_OPTIONS.map(t => t.path).filter(p => draft.routes.includes(p)), p_can_approve: draft.canApprove,
    });
    if (error) { setErr(error.message); setBusy(false); return; }
    setDraft(null);
    await refresh();
    flash(draft.id ? "Alterações salvas."
      : `${n} cadastrado(a). Para entrar como ${n}, clique em "Trocar operador" no menu lateral (ou no topo, à direita) e digite o PIN.`);
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
                </div>
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
              </div>
              <button onClick={() => { setErr(null); setOwnerEdit(null); setDraft({ id: o.id, name: o.name, pin: "", routes: operatorRoutes(o) ?? TAB_OPTIONS.map(t => t.path), canApprove: operatorCanApprove(o) }); }}
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
    </SectionCard>
  );
}
