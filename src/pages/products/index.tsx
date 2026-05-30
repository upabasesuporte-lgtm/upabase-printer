import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import {
  Plus, Search, X, Edit2, Copy, Trash2, ChevronDown, ChevronUp,
  Package, Tag, Boxes, Monitor, UtensilsCrossed,
  ShoppingBag, Printer, RefreshCw, AlertTriangle, CheckCircle2,
  AlertCircle, ToggleLeft, ToggleRight, FolderOpen,
  Image, BarChart2, Infinity, Upload, Camera,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  description: string | null;
}

interface Variation {
  id?: string;
  type: string;
  name: string;
  additional_price: number;
  stock: number;
  is_active: boolean;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  sale_price: number;
  cost_price: number;
  promo_price: number | null;
  promo_price_until: string | null;
  unit: string;
  stock: number;
  stock_type: string;
  stock_min: number;
  stock_max: number | null;
  visible_pdv: boolean;
  visible_tables: boolean;
  visible_digital_menu: boolean;
  printer_destination: string;
  status: string;
  is_active: boolean;
  created_at: string;
}

type ProductForm = Omit<Product, "id" | "created_at">;

// ─── Constantes ───────────────────────────────────────────────────────────────

const UNITS = ["unidade", "kg", "g", "litro", "ml", "metro", "cm", "caixa", "dúzia", "pacote"];
const PRINTERS = [
  { value: "balcao", label: "Balcão" },
  { value: "cozinha", label: "Cozinha" },
  { value: "bar", label: "Bar" },
  { value: "nenhuma", label: "Sem impressão" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "Ativo", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  { value: "inactive", label: "Inativo", color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
  { value: "draft", label: "Rascunho", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
];
const VAR_TYPES = ["tamanho", "cor", "sabor", "adicional", "outro"];
const PAGE_SIZE = 20;

const DEFAULT_FORM: ProductForm = {
  name: "", description: null, sku: null, barcode: null, image_url: null,
  category_id: null, subcategory_id: null,
  sale_price: 0, cost_price: 0, promo_price: null, promo_price_until: null,
  unit: "unidade", stock: 0,
  stock_type: "controlled", stock_min: 0, stock_max: null,
  visible_pdv: true, visible_tables: true, visible_digital_menu: true,
  printer_destination: "balcao", status: "active", is_active: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (cost: number, sale: number) => sale > 0 ? (((sale - cost) / sale) * 100).toFixed(1) : "0.0";

function StockBadge({ product }: { product: Product }) {
  if (product.stock_type === "unlimited")
    return <span className="flex items-center gap-1 text-xs text-blue-400"><Infinity className="w-3 h-3" /> Ilimitado</span>;
  const low = product.stock_min > 0 && product.stock <= product.stock_min;
  const empty = product.stock === 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${empty ? "text-red-400" : low ? "text-amber-400" : "text-emerald-400"}`}>
      {empty ? <AlertCircle className="w-3 h-3" /> : low ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
      {product.stock} {product.unit}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${s.color}`}>{s.label}</span>;
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex-shrink-0">
      {value
        ? <ToggleRight className="w-8 h-8 text-violet-500" />
        : <ToggleLeft className="w-8 h-8 text-zinc-600" />}
    </button>
  );
}

// ─── Input Field ──────────────────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";
const selectCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500 transition-all";

// ─── Modal de categorias ──────────────────────────────────────────────────────

function CategoryModal({ categories, onClose, onRefresh }: {
  categories: Category[]; onClose: () => void; onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [color, setColor] = useState("#6d28d9");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roots = categories.filter(c => !c.parent_id);

  async function save() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.from("categories").insert({ name: name.trim(), parent_id: parent || null, color });
    if (err) { setError("Erro ao criar categoria. Tente novamente."); setLoading(false); return; }
    setName(""); setParent(""); setColor("#6d28d9");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onRefresh();
    setLoading(false);
  }

  async function remove(id: string) {
    const hasSubs = categories.some(c => c.parent_id === id);
    if (hasSubs && !confirm("Esta categoria tem subcategorias. Excluir mesmo assim?")) return;
    if (!hasSubs && !confirm("Excluir esta categoria?")) return;
    await supabase.from("categories").delete().eq("id", id);
    onRefresh();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold">Gerenciar Categorias</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Formulário de criação */}
        <div className="p-5 border-b border-zinc-800 flex-shrink-0 bg-zinc-950/50">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-3">+ Nova Categoria</p>
          {error && (
            <div className="mb-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg flex gap-2 items-center">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
            </div>
          )}
          {saved && (
            <div className="mb-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-2.5 rounded-lg flex gap-2 items-center">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Categoria criada com sucesso!
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Nome da categoria (ex: Bebidas, Roupas, Lanches...)"
              className={inputCls}
              autoFocus
            />
            <button onClick={save} disabled={loading || !name.trim()}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors whitespace-nowrap">
              <Plus className="w-4 h-4" />
              {loading ? "Criando..." : "Criar"}
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Subcategoria de (opcional)</label>
              <select value={parent} onChange={e => setParent(e.target.value)} className={selectCls}>
                <option value="">— Categoria principal (raiz) —</option>
                {roots.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Cor</label>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-zinc-800 bg-zinc-950 cursor-pointer p-1" />
            </div>
          </div>
        </div>

        {/* Lista de categorias */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Categorias cadastradas ({categories.length})
          </p>

          {categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-zinc-600">
              <FolderOpen className="w-10 h-10" />
              <p className="text-sm">Nenhuma categoria ainda.</p>
              <p className="text-xs text-center">Use o formulário acima para criar sua primeira categoria.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {roots.map(cat => (
                <div key={cat.id}>
                  <div className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-zinc-800 group transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color ?? "#6d28d9" }} />
                      <span className="text-sm font-semibold text-white">{cat.name}</span>
                      <span className="text-xs text-zinc-600">
                        ({categories.filter(c => c.parent_id === cat.id).length} subcategorias)
                      </span>
                    </div>
                    <button onClick={() => remove(cat.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {categories.filter(c => c.parent_id === cat.id).map(sub => (
                    <div key={sub.id} className="flex items-center justify-between py-2 px-3 pl-9 rounded-xl hover:bg-zinc-800 group transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full border border-zinc-600 flex-shrink-0" />
                        <span className="text-sm text-zinc-400">{sub.name}</span>
                      </div>
                      <button onClick={() => remove(sub.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 border border-zinc-700 hover:border-zinc-600 rounded-xl text-sm font-medium transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de produto ─────────────────────────────────────────────────────────

const TABS = ["Geral", "Preços", "Estoque", "Variações", "Canais"] as const;
type TabName = typeof TABS[number];

function ProductModal({ product, categories, onClose, onSave }: {
  product: Product | null; categories: Category[]; onClose: () => void; onSave: () => void;
}) {
  const isEdit = !!product;
  const [tab, setTab] = useState<TabName>("Geral");
  const [form, setForm] = useState<ProductForm>(product
    ? { name: product.name, description: product.description, sku: product.sku, barcode: product.barcode, image_url: product.image_url, category_id: product.category_id, subcategory_id: product.subcategory_id, sale_price: product.sale_price, cost_price: product.cost_price ?? 0, promo_price: product.promo_price, promo_price_until: product.promo_price_until, unit: product.unit ?? "unidade", stock: product.stock ?? 0, stock_type: product.stock_type ?? "controlled", stock_min: product.stock_min ?? 0, stock_max: product.stock_max, visible_pdv: product.visible_pdv ?? true, visible_tables: product.visible_tables ?? true, visible_digital_menu: product.visible_digital_menu ?? true, printer_destination: product.printer_destination ?? "balcao", status: product.status ?? "active", is_active: product.is_active ?? true }
    : { ...DEFAULT_FORM });
  const [variations, setVariations] = useState<Variation[]>([]);
  const [newVar, setNewVar] = useState<Variation>({ type: "tamanho", name: "", additional_price: 0, stock: 0, is_active: true });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(file: File) {
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("products").upload(path, file, { upsert: true });
    if (upErr) { setError("Erro ao enviar imagem. Verifique o bucket 'products' no Supabase Storage."); setUploading(false); return; }
    const { data } = supabase.storage.from("products").getPublicUrl(path);
    set("image_url", data.publicUrl);
    setUploading(false);
  }

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setForm(prev => ({ ...prev, [k]: v }));
  const margin = pct(form.cost_price, form.sale_price);
  const rootCats = categories.filter(c => !c.parent_id);
  const subCats = categories.filter(c => c.parent_id === form.category_id);

  useEffect(() => {
    if (product) {
      supabase.from("product_variations").select("*").eq("product_id", product.id).then(({ data }) => setVariations(data ?? []));
    }
  }, [product]);

  function addVariation() {
    if (!newVar.name.trim()) return;
    setVariations(prev => [...prev, { ...newVar, id: undefined }]);
    setNewVar({ type: newVar.type, name: "", additional_price: 0, stock: 0, is_active: true });
  }

  function removeVariation(idx: number) {
    setVariations(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("Nome do produto é obrigatório."); setTab("Geral"); return; }
    setSaving(true); setError(null);

    const payload = {
      ...form,
      name: form.name.trim(),
      sku: form.sku?.trim() || null,
      barcode: form.barcode?.trim() || null,
      description: form.description?.trim() || null,
      image_url: form.image_url?.trim() || null,
      is_active: form.status === "active",
    };

    let savedId = product?.id;

    if (isEdit && product) {
      const { error: err } = await supabase.from("products").update(payload).eq("id", product.id);
      if (err) { setError("Erro ao salvar produto."); setSaving(false); return; }
    } else {
      const { data, error: err } = await supabase.from("products").insert(payload).select("id").single();
      if (err || !data) { setError("Erro ao criar produto."); setSaving(false); return; }
      savedId = data.id;
    }

    if (savedId) {
      // Salvar variações: deletar antigas e recriar
      if (isEdit) await supabase.from("product_variations").delete().eq("product_id", savedId);
      if (variations.length > 0) {
        await supabase.from("product_variations").insert(variations.map(v => ({
          product_id: savedId, type: v.type, name: v.name,
          additional_price: v.additional_price, stock: v.stock, is_active: v.is_active,
        })));
      }
    }

    setSaving(false);
    onSave();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
          <h3 className="font-semibold text-base">{isEdit ? "Editar Produto" : "Novo Produto"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-6 pt-3 border-b border-zinc-800 flex-shrink-0">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${tab === t ? "border-violet-500 text-violet-400" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {/* ── Tab Geral ── */}
          {tab === "Geral" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Field label="Nome do produto *">
                    <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Ex: X-Burguer Especial" className={inputCls} />
                  </Field>
                </div>
                <Field label="SKU (código interno)">
                  <input value={form.sku ?? ""} onChange={e => set("sku", e.target.value || null)} placeholder="Ex: BURG-001" className={inputCls} />
                </Field>
                <Field label="Código de barras (EAN/GTIN)">
                  <input value={form.barcode ?? ""} onChange={e => set("barcode", e.target.value || null)} placeholder="Ex: 7891234567890" className={inputCls} />
                </Field>
                <Field label="Categoria">
                  <select value={form.category_id ?? ""} onChange={e => { set("category_id", e.target.value || null); set("subcategory_id", null); }} className={selectCls}>
                    <option value="">Sem categoria</option>
                    {rootCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Subcategoria">
                  <select value={form.subcategory_id ?? ""} onChange={e => set("subcategory_id", e.target.value || null)} className={selectCls} disabled={subCats.length === 0}>
                    <option value="">Sem subcategoria</option>
                    {subCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Unidade de medida">
                  <select value={form.unit} onChange={e => set("unit", e.target.value)} className={selectCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={e => set("status", e.target.value)} className={selectCls}>
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <div className="col-span-2">
                  <Field label="Descrição">
                    <textarea value={form.description ?? ""} onChange={e => set("description", e.target.value || null)} placeholder="Descreva o produto, ingredientes, composição..." rows={3}
                      className={`${inputCls} resize-none`} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Foto do produto">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }}
                    />
                    <div className="flex gap-3 items-center">
                      {/* Preview ou placeholder */}
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="w-24 h-24 rounded-xl border-2 border-dashed border-zinc-700 hover:border-violet-500 bg-zinc-950 flex flex-col items-center justify-center cursor-pointer transition-colors flex-shrink-0 overflow-hidden group"
                      >
                        {uploading ? (
                          <RefreshCw className="w-5 h-5 text-violet-400 animate-spin" />
                        ) : form.image_url ? (
                          <img src={form.image_url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <>
                            <Camera className="w-6 h-6 text-zinc-600 group-hover:text-violet-400 transition-colors" />
                            <span className="text-xs text-zinc-600 group-hover:text-violet-400 mt-1 transition-colors">Adicionar</span>
                          </>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                          className="flex items-center gap-2 px-4 py-2.5 border border-zinc-700 hover:border-violet-500 hover:text-violet-400 rounded-xl text-sm font-medium transition-colors w-full justify-center disabled:opacity-50">
                          <Upload className="w-4 h-4" />
                          {uploading ? "Enviando..." : form.image_url ? "Trocar foto" : "Selecionar do dispositivo"}
                        </button>
                        {form.image_url && (
                          <button type="button" onClick={() => set("image_url", null)}
                            className="flex items-center gap-2 px-4 py-2 text-xs text-red-400 hover:text-red-300 transition-colors w-full justify-center">
                            <X className="w-3.5 h-3.5" /> Remover foto
                          </button>
                        )}
                        <p className="text-xs text-zinc-600 text-center">JPG, PNG, WEBP até 5MB</p>
                      </div>
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* ── Tab Preços ── */}
          {tab === "Preços" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Field label="Preço de custo (R$)">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">R$</span>
                    <input type="number" step="0.01" min="0" value={form.cost_price || ""} onChange={e => set("cost_price", parseFloat(e.target.value) || 0)}
                      placeholder="0,00" className={`${inputCls} pl-9`} />
                  </div>
                </Field>
                <Field label="Preço de venda (R$) *">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">R$</span>
                    <input type="number" step="0.01" min="0" value={form.sale_price || ""} onChange={e => set("sale_price", parseFloat(e.target.value) || 0)}
                      placeholder="0,00" className={`${inputCls} pl-9`} />
                  </div>
                </Field>
                <Field label="Margem de lucro">
                  <div className={`px-3.5 py-2.5 rounded-xl border text-sm font-bold flex items-center gap-2 ${parseFloat(margin) >= 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
                    <BarChart2 className="w-4 h-4" /> {margin}%
                  </div>
                </Field>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide mb-3">Preço Promocional</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Preço promocional (R$)">
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">R$</span>
                      <input type="number" step="0.01" min="0" value={form.promo_price ?? ""} onChange={e => set("promo_price", e.target.value ? parseFloat(e.target.value) : null)}
                        placeholder="Deixe vazio para desativar" className={`${inputCls} pl-9`} />
                    </div>
                  </Field>
                  <Field label="Válido até">
                    <input type="date" value={form.promo_price_until ?? ""} onChange={e => set("promo_price_until", e.target.value || null)} className={inputCls} />
                  </Field>
                </div>
                {form.promo_price && form.sale_price > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <Tag className="w-3.5 h-3.5" />
                    Desconto de {(((form.sale_price - form.promo_price) / form.sale_price) * 100).toFixed(1)}% sobre o preço normal
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tab Estoque ── */}
          {tab === "Estoque" && (
            <div className="space-y-5">
              {/* Tipo de estoque */}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => set("stock_type", "controlled")}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${form.stock_type === "controlled" ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 hover:border-zinc-700"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Boxes className="w-4 h-4 text-violet-400" />
                    <span className="text-sm font-semibold">Estoque Controlado</span>
                  </div>
                  <p className="text-xs text-zinc-500">Controla quantidade, bloqueia venda quando zerado. Ideal para produtos físicos.</p>
                </button>
                <button type="button" onClick={() => set("stock_type", "unlimited")}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${form.stock_type === "unlimited" ? "border-blue-500 bg-blue-500/10" : "border-zinc-800 hover:border-zinc-700"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Infinity className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-semibold">Estoque Ilimitado</span>
                  </div>
                  <p className="text-xs text-zinc-500">Nunca bloqueia venda. Ideal para insumos, produção própria e serviços.</p>
                </button>
              </div>

              {form.stock_type === "controlled" && (
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Quantidade atual">
                    <input type="number" min="0" value={form.stock || ""} onChange={e => set("stock", parseInt(e.target.value) || 0)} placeholder="0" className={inputCls} />
                  </Field>
                  <Field label="Estoque mínimo (alerta)" hint="Alerta quando atingir este valor">
                    <input type="number" min="0" value={form.stock_min || ""} onChange={e => set("stock_min", parseInt(e.target.value) || 0)} placeholder="0" className={inputCls} />
                  </Field>
                  <Field label="Estoque máximo" hint="Opcional — para controle de capacidade">
                    <input type="number" min="0" value={form.stock_max ?? ""} onChange={e => set("stock_max", e.target.value ? parseInt(e.target.value) : null)} placeholder="Sem limite" className={inputCls} />
                  </Field>
                </div>
              )}

              {form.stock_type === "controlled" && form.stock_min > 0 && form.stock <= form.stock_min && (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm p-3 rounded-xl">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Estoque atual está no limite mínimo ou abaixo. Considere repor.
                </div>
              )}
            </div>
          )}

          {/* ── Tab Variações ── */}
          {tab === "Variações" && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-500">Adicione variações como tamanho, cor, sabor. Cada variação pode ter preço extra e estoque próprio.</p>

              {/* Adicionar variação */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-medium text-zinc-400">Nova variação</p>
                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 items-end">
                  <Field label="Tipo">
                    <select value={newVar.type} onChange={e => setNewVar(v => ({ ...v, type: e.target.value }))} className={`${selectCls} w-28`}>
                      {VAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Nome / Valor">
                    <input value={newVar.name} onChange={e => setNewVar(v => ({ ...v, name: e.target.value }))} placeholder="Ex: G, Vermelho, Grande..." className={inputCls} />
                  </Field>
                  <Field label="+ Preço (R$)">
                    <input type="number" step="0.01" value={newVar.additional_price || ""} onChange={e => setNewVar(v => ({ ...v, additional_price: parseFloat(e.target.value) || 0 }))}
                      placeholder="0,00" className={`${inputCls} w-24`} />
                  </Field>
                  <button type="button" onClick={addVariation} disabled={!newVar.name.trim()}
                    className="h-10 px-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors self-end">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Lista de variações */}
              {variations.length > 0 ? (
                <div className="space-y-1.5">
                  {Object.entries(
                    variations.reduce((acc, v, i) => { (acc[v.type] = acc[v.type] || []).push({ ...v, _idx: i }); return acc; }, {} as Record<string, (Variation & { _idx: number })[]>)
                  ).map(([type, vars]) => (
                    <div key={type}>
                      <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide px-1 mb-1">{type}</p>
                      {vars.map(v => (
                        <div key={v._idx} className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5">
                          <span className="text-sm font-medium flex-1">{v.name}</span>
                          {v.additional_price > 0 && <span className="text-xs text-emerald-400">+{fmt(v.additional_price)}</span>}
                          <Toggle value={v.is_active} onChange={val => setVariations(prev => prev.map((p, i) => i === v._idx ? { ...p, is_active: val } : p))} />
                          <button type="button" onClick={() => removeVariation(v._idx)} className="text-red-400 hover:text-red-300 transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 text-center py-6">Nenhuma variação adicionada. Adicione acima.</p>
              )}
            </div>
          )}

          {/* ── Tab Canais ── */}
          {tab === "Canais" && (
            <div className="space-y-5">
              <p className="text-xs text-zinc-500">Controle em quais canais de venda este produto aparece. O estoque é sempre unificado.</p>

              <div className="space-y-3">
                {[
                  { key: "visible_pdv" as const, icon: Monitor, label: "PDV (Ponto de Venda)", desc: "Aparece na tela de vendas do operador", color: "text-violet-400" },
                  { key: "visible_tables" as const, icon: UtensilsCrossed, label: "Mesas", desc: "Disponível para pedidos em mesa pelo garçom", color: "text-emerald-400" },
                  { key: "visible_digital_menu" as const, icon: ShoppingBag, label: "Cardápio Digital", desc: "Visível no cardápio online para clientes", color: "text-blue-400" },
                ].map(({ key, icon: Icon, label, desc, color }) => (
                  <div key={key} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></div>
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-zinc-500">{desc}</p>
                      </div>
                    </div>
                    <Toggle value={form[key]} onChange={v => set(key, v)} />
                  </div>
                ))}
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <Field label="Impressora de destino" hint="Para onde vai a comanda quando este produto for pedido">
                  <select value={form.printer_destination} onChange={e => set("printer_destination", e.target.value)} className={selectCls}>
                    {PRINTERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2.5 border border-zinc-700 hover:border-zinc-600 rounded-xl text-sm font-medium transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-violet-900/20">
            {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Criar Produto"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ProductsPage() {
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
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  // Filtros
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStock, setFilterStock] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);

  // Modais
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [showCatModal, setShowCatModal] = useState(false);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from("categories").select("*").order("name");
    setCategories(data ?? []);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("products").select("*", { count: "exact" });

    if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`);
    if (filterCat) q = q.eq("category_id", filterCat);
    if (filterStatus) q = q.eq("status", filterStatus);
    if (filterStock === "low") q = q.gt("stock_min", 0).lte("stock", supabase.rpc as any);
    if (filterStock === "empty") q = q.eq("stock", 0).eq("stock_type", "controlled");
    if (filterStock === "unlimited") q = q.eq("stock_type", "unlimited");

    q = q.order(sortBy, { ascending: sortAsc }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count } = await q;
    setProducts(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, filterCat, filterStatus, filterStock, sortBy, sortAsc, page]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { setPage(0); }, [search, filterCat, filterStatus, filterStock, sortBy, sortAsc]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  function openCreate() { setEditProduct(null); setShowModal(true); }
  function openEdit(p: Product) { setEditProduct(p); setShowModal(true); }

  async function duplicate(p: Product) {
    const { id, created_at, ...rest } = p;
    await supabase.from("products").insert({ ...rest, name: `${p.name} (cópia)`, sku: null, barcode: null, stock: 0 });
    loadProducts();
  }

  async function toggleActive(p: Product) {
    const newStatus = p.status === "active" ? "inactive" : "active";
    await supabase.from("products").update({ status: newStatus, is_active: newStatus === "active" }).eq("id", p.id);
    loadProducts();
  }

  async function remove(p: Product) {
    if (!confirm(`Excluir "${p.name}"? Esta ação não pode ser desfeita.`)) return;
    await supabase.from("products").delete().eq("id", p.id);
    loadProducts();
  }

  function toggleSort(col: string) {
    if (sortBy === col) setSortAsc(v => !v);
    else { setSortBy(col); setSortAsc(true); }
  }

  const SortIcon = ({ col }: { col: string }) =>
    sortBy === col ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null;

  const rootCats = categories.filter(c => !c.parent_id);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const catName = (id: string | null) => id ? categories.find(c => c.id === id)?.name ?? "—" : "—";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-5"
        style={{ background: card.bg, border: card.border, boxShadow: card.shadow,
          backgroundImage:"radial-gradient(rgba(16,185,129,0.07) 1px,transparent 1px)", backgroundSize:"24px 24px" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/10 to-transparent pointer-events-none" />
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{background:"#10b981",boxShadow:"0 0 6px #10b981"}} />
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#10b981"}}>Catálogo</span>
            </div>
            <h1 className="text-2xl font-black"
              style={{background: isLight ? "linear-gradient(135deg,#059669,#10b981)" : "linear-gradient(135deg,#6ee7b7,#34d399)", WebkitBackgroundClip:"text", display:"inline-block",WebkitTextFillColor:"transparent", backgroundClip:"text"}}>
              Produtos
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">{total} produto{total !== 1 ? "s" : ""} cadastrado{total !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCatModal(true)}
              className="flex items-center gap-2 px-3 py-2 border border-zinc-700 hover:border-zinc-600 bg-zinc-900 rounded-xl text-sm font-medium transition-all hover:bg-zinc-800">
              <FolderOpen className="w-4 h-4" /> Categorias
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",boxShadow:"0 0 16px rgba(16,185,129,0.35)"}}>
              <Plus className="w-4 h-4" /> Novo Produto
            </button>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input placeholder="Buscar por nome, SKU ou código..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }} />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>}
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm focus:outline-none focus:border-violet-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}>
          <option value="">Todas categorias</option>
          {rootCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm focus:outline-none focus:border-violet-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}>
          <option value="">Todos status</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterStock} onChange={e => setFilterStock(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm focus:outline-none focus:border-violet-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}>
          <option value="">Todo estoque</option>
          <option value="empty">Zerado</option>
          <option value="unlimited">Ilimitado</option>
        </select>
        <button onClick={loadProducts} className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Tabela */}
      <div className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
        {loading ? (
          <div className="flex justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-violet-400" /></div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
            <Package className="w-10 h-10" />
            <p className="text-sm font-medium">Nenhum produto encontrado</p>
            <button onClick={openCreate} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
              + Criar primeiro produto
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 w-12"></th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => toggleSort("name")}>
                    <span className="flex items-center gap-1">Produto <SortIcon col="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3">Categoria</th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => toggleSort("sale_price")}>
                    <span className="flex items-center gap-1">Preço <SortIcon col="sale_price" /></span>
                  </th>
                  <th className="text-left px-4 py-3">Margem</th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => toggleSort("stock")}>
                    <span className="flex items-center gap-1">Estoque <SortIcon col="stock" /></span>
                  </th>
                  <th className="text-left px-4 py-3">Canais</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {products.map(p => (
                  <tr key={p.id} className="hover:bg-zinc-800/30 transition-colors group">
                    {/* Imagem */}
                    <td className="px-4 py-3">
                      {p.image_url
                        ? <img src={p.image_url} alt="" className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-md object-cover border border-zinc-700 flex-shrink-0 block" style={{aspectRatio:"1/1"}} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : <div className="w-10 h-10 min-w-[40px] rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4 text-zinc-600" /></div>}
                    </td>
                    {/* Nome */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{p.name}</p>
                      <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                        {p.sku && <span>SKU: {p.sku}</span>}
                        {p.barcode && <span>EAN: {p.barcode}</span>}
                      </div>
                    </td>
                    {/* Categoria */}
                    <td className="px-4 py-3 text-zinc-400 text-xs">{catName(p.category_id)}</td>
                    {/* Preço */}
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{fmt(p.sale_price)}</p>
                      {p.promo_price && (!p.promo_price_until || new Date(p.promo_price_until) >= new Date()) && (
                        <p className="text-xs text-amber-400">{fmt(p.promo_price)} promo</p>
                      )}
                      {p.cost_price > 0 && <p className="text-xs text-zinc-500">Custo: {fmt(p.cost_price)}</p>}
                    </td>
                    {/* Margem */}
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${parseFloat(pct(p.cost_price ?? 0, p.sale_price)) > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                        {p.cost_price > 0 ? `${pct(p.cost_price, p.sale_price)}%` : "—"}
                      </span>
                    </td>
                    {/* Estoque */}
                    <td className="px-4 py-3"><StockBadge product={p} /></td>
                    {/* Canais */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {p.visible_pdv !== false && <span title="PDV"><Monitor className="w-3.5 h-3.5 text-violet-400" /></span>}
                        {p.visible_tables !== false && <span title="Mesas"><UtensilsCrossed className="w-3.5 h-3.5 text-emerald-400" /></span>}
                        {p.visible_digital_menu !== false && <span title="Cardápio Digital"><ShoppingBag className="w-3.5 h-3.5 text-blue-400" /></span>}
                        {p.printer_destination && p.printer_destination !== "nenhuma" && (
                          <span title={`Impressora: ${p.printer_destination}`}><Printer className="w-3.5 h-3.5 text-zinc-500" /></span>
                        )}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3"><StatusBadge status={p.status ?? "active"} /></td>
                    {/* Ações */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(p)} title="Editar"
                          className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => duplicate(p)} title="Duplicar"
                          className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleActive(p)} title={p.status === "active" ? "Desativar" : "Ativar"}
                          className={`p-1.5 hover:bg-zinc-700 rounded-lg transition-colors ${p.status === "active" ? "text-emerald-400 hover:text-emerald-300" : "text-zinc-500 hover:text-zinc-300"}`}>
                          {p.status === "active" ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button onClick={() => remove(p)} title="Excluir"
                          className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
            <span className="text-xs text-zinc-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 text-xs border border-zinc-700 hover:border-zinc-600 disabled:opacity-40 rounded-lg transition-colors">
                Anterior
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = page < 3 ? i : page - 2 + i;
                if (pg >= totalPages) return null;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`w-8 h-7 text-xs rounded-lg transition-colors ${pg === page ? "bg-violet-600 text-white" : "border border-zinc-700 hover:border-zinc-600 text-zinc-400"}`}>
                    {pg + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-xs border border-zinc-700 hover:border-zinc-600 disabled:opacity-40 rounded-lg transition-colors">
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modais */}
      {showModal && (
        <ProductModal
          product={editProduct}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSave={loadProducts}
        />
      )}
      {showCatModal && (
        <CategoryModal
          categories={categories}
          onClose={() => setShowCatModal(false)}
          onRefresh={loadCategories}
        />
      )}
    </div>
  );
}
