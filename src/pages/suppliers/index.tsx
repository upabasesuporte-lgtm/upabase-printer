import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import {
  Plus, Search, X, Edit2, Trash2, RefreshCw, AlertTriangle,
  Building2, Phone, Mail, Save,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string; name: string; cnpj: string | null; phone: string | null;
  email: string | null; contact_name: string | null; address: string | null;
  notes: string | null; is_active: boolean; created_at: string;
}

type Modal = "none" | "supplier" | "delete";

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";

// ─── Component ────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
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

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState<Modal>("none");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  useEscapeKey(() => {
    if (modal === "delete") { setDeleteTarget(null); setModal("none"); return; }
    setModal("none");
  }, modal !== "none");

  // Supplier form
  const [sName, setSName] = useState("");
  const [sCnpj, setSCnpj] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sEmail, setSEmail] = useState("");
  const [sContact, setSContact] = useState("");
  const [sAddress, setSAddress] = useState("");
  const [sNotes, setSNotes] = useState("");

  useEffect(() => {
    (async () => {
      await loadSuppliers();
      setLoading(false);
    })();
  }, []);

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers((data ?? []) as Supplier[]);
  }

  function openSupplierModal(s?: Supplier) {
    if (s) {
      setEditingSupplier(s);
      setSName(s.name); setSCnpj(s.cnpj ?? ""); setSPhone(s.phone ?? "");
      setSEmail(s.email ?? ""); setSContact(s.contact_name ?? "");
      setSAddress(s.address ?? ""); setSNotes(s.notes ?? "");
    } else {
      setEditingSupplier(null);
      setSName(""); setSCnpj(""); setSPhone(""); setSEmail(""); setSContact(""); setSAddress(""); setSNotes("");
    }
    setModal("supplier");
  }

  async function saveSupplier() {
    if (!sName.trim() || saving) return;
    setSaving(true);
    const payload = {
      name: sName.trim(), cnpj: sCnpj || null, phone: sPhone || null,
      email: sEmail || null, contact_name: sContact || null,
      address: sAddress || null, notes: sNotes || null,
    };
    if (editingSupplier) {
      await supabase.from("suppliers").update(payload).eq("id", editingSupplier.id);
    } else {
      await supabase.from("suppliers").insert(payload);
    }
    await loadSuppliers();
    setSaving(false);
    setModal("none");
  }

  async function deleteConfirmed() {
    if (!deleteTarget || saving) return;
    setSaving(true);
    await supabase.from("suppliers").update({ is_active: false }).eq("id", deleteTarget.id);
    await loadSuppliers();
    setDeleteTarget(null);
    setSaving(false);
    setModal("none");
  }

  const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl p-5"
          style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
            backgroundImage:"radial-gradient(rgba(59,130,246,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 to-transparent pointer-events-none" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{background:"#3b82f6",boxShadow:"0 0 6px #3b82f6"}} />
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#3b82f6"}}>Cadastro</span>
              </div>
              <h1 className="text-2xl font-black g-text g-text-blue">
                Fornecedores
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                {suppliers.length} fornecedor{suppliers.length !== 1 ? "es" : ""} cadastrado{suppliers.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button onClick={() => openSupplierModal()}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${isLight ? "bg-blue-600 hover:bg-blue-700" : "bg-violet-600 hover:bg-violet-500 text-white"}`}
              style={isLight ? { color: "#ffffff" } : undefined}>
              <Plus className="w-4 h-4" /> Novo Fornecedor
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar fornecedor..."
            style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-all" />
        </div>

        {filteredSuppliers.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
            <Building2 className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-400 font-semibold">Nenhum fornecedor cadastrado</p>
            <button onClick={() => openSupplierModal()}
              className="mt-5 text-violet-400 text-sm hover:underline">Cadastrar primeiro fornecedor</button>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden divide-y divide-zinc-800" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
            {filteredSuppliers.map(s => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800/30 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{s.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {s.contact_name && <span className="text-xs text-zinc-500">{s.contact_name}</span>}
                    {s.phone && <span className="flex items-center gap-1 text-xs text-zinc-500"><Phone className="w-3 h-3" />{s.phone}</span>}
                    {s.email && <span className="flex items-center gap-1 text-xs text-zinc-500"><Mail className="w-3 h-3" />{s.email}</span>}
                    {s.cnpj && <span className="text-xs text-zinc-600">CNPJ: {s.cnpj}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openSupplierModal(s)}
                    className="p-1.5 text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setDeleteTarget(s); setModal("delete"); }}
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supplier Modal */}
      {modal === "supplier" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <h2 className="text-base font-semibold">{editingSupplier ? "Editar Fornecedor" : "Novo Fornecedor"}</h2>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome / Razão Social *</label>
                <input value={sName} onChange={e => setSName(e.target.value)}
                  placeholder="Nome do fornecedor" className={inputCls} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">CNPJ / CPF</label>
                  <input value={sCnpj} onChange={e => setSCnpj(e.target.value)} placeholder="00.000.000/0001-00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Contato / Vendedor</label>
                  <input value={sContact} onChange={e => setSContact(e.target.value)} placeholder="Nome do representante" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Telefone / WhatsApp</label>
                  <input value={sPhone} onChange={e => setSPhone(e.target.value)} placeholder="(99) 99999-9999" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">E-mail</label>
                  <input value={sEmail} onChange={e => setSEmail(e.target.value)} placeholder="email@fornecedor.com" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Endereço</label>
                <input value={sAddress} onChange={e => setSAddress(e.target.value)} placeholder="Rua, número, cidade, UF" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Observações</label>
                <input value={sNotes} onChange={e => setSNotes(e.target.value)} placeholder="Prazo de entrega, condições de pagamento..." className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveSupplier} disabled={!sName.trim() || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingSupplier ? "Salvar" : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {modal === "delete" && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">Excluir fornecedor?</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  <span className="text-white font-medium">{deleteTarget.name}</span> será desativado do sistema.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setModal("none"); }}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={deleteConfirmed} disabled={saving}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
