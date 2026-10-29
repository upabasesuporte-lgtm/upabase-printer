import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { accentInsensitivePattern } from "../../lib/search";
import { useTheme } from "../../contexts/ThemeContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { PageHeader, btnPrimary, btnSecondary, WHITE_TEXT } from "../../components/PageHeader";
import { useBusinessType } from "../../lib/business";
import { newInternalEan } from "../../lib/barcode";
import { LabelsModal } from "../../components/LabelsModal";
import {
  Plus, Search, X, Edit2, Copy, Trash2, ChevronDown, ChevronUp,
  Package, Tag, Boxes, Monitor, UtensilsCrossed,
  ShoppingBag, Printer, RefreshCw, AlertTriangle, CheckCircle2,
  AlertCircle, ToggleLeft, ToggleRight, FolderOpen,
  BarChart2, Infinity, Upload, Camera, Grid3x3, Barcode,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface Category {
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

export interface Product {
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
  item_type: string;
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
const ITEM_TYPES = [
  { value: "principal", label: "Principal", hint: "Sai em destaque na impressão" },
  { value: "adicional", label: "Adicional", hint: "Sai menor e recuado, junto do item principal anterior" },
];

const DEFAULT_FORM: ProductForm = {
  name: "", description: null, sku: null, barcode: null, image_url: null,
  category_id: null, subcategory_id: null,
  sale_price: 0, cost_price: 0, promo_price: null, promo_price_until: null,
  unit: "unidade", stock: 0,
  stock_type: "controlled", stock_min: 0, stock_max: null,
  visible_pdv: true, visible_tables: true, visible_digital_menu: true,
  printer_destination: "balcao", item_type: "principal", status: "active", is_active: true,
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
        ? <ToggleRight className="w-8 h-8 text-brand-500" />
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

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/10 transition-all";
const selectCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all";

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
  useEscapeKey(onClose);

  async function save() {
    if (!name.trim()) return;
    const trimmed = name.trim();
    // Evita criar duas categorias com o mesmo nome no mesmo nível (raiz ou
    // dentro da mesma categoria-pai) — isso causava categorias duplicadas
    // aparecendo repetidas nas telas de Produtos e Cardápio Digital.
    const dup = categories.find(c =>
      c.name.trim().toLowerCase() === trimmed.toLowerCase() && (c.parent_id ?? "") === (parent || "")
    );
    if (dup) {
      setError(`Já existe uma categoria "${dup.name}" ${parent ? "dentro dessa categoria-pai" : "principal"}. Escolha outro nome.`);
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.from("categories").insert({ name: trimmed, parent_id: parent || null, color });
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
            <FolderOpen className="w-5 h-5 text-brand-600" />
            <h3 className="font-semibold">Gerenciar Categorias</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Formulário de criação */}
        <div className="p-5 border-b border-zinc-800 flex-shrink-0">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wider mb-3">+ Nova Categoria</p>
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
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap"
              style={{ color: "#fff" }}>
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

const TABS = ["Geral", "Preços", "Estoque", "Variações", "Fiscal", "Canais"] as const;
// Loja/varejo: "Grade" (tamanho × cor) no lugar das variações antigas
const RETAIL_TABS = ["Geral", "Preços", "Grade", "Estoque", "Fiscal", "Canais"] as const;
type TabName = typeof TABS[number] | typeof RETAIL_TABS[number];

// ── Grade (varejo) ──
// Cada tamanho/cor vira um produto "filho" (variant_of = produto principal) com
// código de barras, preço e estoque próprios: vende, baixa estoque e aparece nos
// relatórios como qualquer produto.
interface VariantRow { id?: string; size: string; color: string; barcode: string; price: number; stock: number }
const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: "PP ao GG", sizes: ["PP", "P", "M", "G", "GG"] },
  { label: "P ao XGG", sizes: ["P", "M", "G", "GG", "XG", "XGG"] },
  { label: "Roupa 34–48", sizes: ["34", "36", "38", "40", "42", "44", "46", "48"] },
  { label: "Calçado 33–44", sizes: ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44"] },
  { label: "Infantil 1–16", sizes: ["1", "2", "3", "4", "6", "8", "10", "12", "14", "16"] },
  { label: "Único", sizes: ["U"] },
];
const variantKey = (size: string, color: string) => `${size.trim().toLowerCase()}|${color.trim().toLowerCase()}`;
export const variantName = (base: string, size: string | null, color: string | null) =>
  [size, color].filter(x => x && x.trim()).length ? `${base} - ${[size, color].filter(x => x && x.trim()).join(" / ")}` : base;
const uniq = (arr: string[]) => { const seen = new Set<string>(); return arr.map(x => x.trim()).filter(x => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())); };

// Campos novos (marca, coleção, fiscais) — guardados à parte para não mexer no formulário antigo
interface ExtraForm { brand: string; collection: string; ncm: string; cest: string; cfop: string; origem: string; csosn: string }
const extraFrom = (p: any): ExtraForm => ({
  brand: p?.brand ?? "", collection: p?.collection ?? "", ncm: p?.ncm ?? "", cest: p?.cest ?? "",
  cfop: p?.cfop ?? "", origem: p?.origem != null ? String(p.origem) : "", csosn: p?.csosn ?? "",
});

export function ProductModal({ product, categories, onClose, onSave, initialName }: {
  product: Product | null; categories: Category[]; onClose: () => void; onSave: (id?: string) => void; initialName?: string;
}) {
  const isEdit = !!product;
  const [tab, setTab] = useState<TabName>("Geral");
  const [form, setForm] = useState<ProductForm>(product
    ? { name: product.name, description: product.description, sku: product.sku, barcode: product.barcode, image_url: product.image_url, category_id: product.category_id, subcategory_id: product.subcategory_id, sale_price: product.sale_price, cost_price: product.cost_price ?? 0, promo_price: product.promo_price, promo_price_until: product.promo_price_until, unit: product.unit ?? "unidade", stock: product.stock ?? 0, stock_type: product.stock_type ?? "controlled", stock_min: product.stock_min ?? 0, stock_max: product.stock_max, visible_pdv: product.visible_pdv ?? true, visible_tables: product.visible_tables ?? true, visible_digital_menu: product.visible_digital_menu ?? true, printer_destination: product.printer_destination ?? "balcao", item_type: product.item_type ?? "principal", status: product.status ?? "active", is_active: product.is_active ?? true }
    : { ...DEFAULT_FORM, name: initialName ?? "" });
  const [variations, setVariations] = useState<Variation[]>([]);
  const [newVar, setNewVar] = useState<Variation>({ type: "tamanho", name: "", additional_price: 0, stock: 1, is_active: true });
  const retail = useBusinessType() === "retail";
  const tabs: readonly TabName[] = retail ? RETAIL_TABS : TABS;
  const [extra, setExtra] = useState<ExtraForm>(() => extraFrom(null));
  // Edição: só grava marca/fiscais depois de lê-los do banco (outras telas abrem com o produto parcial)
  const [extraLoaded, setExtraLoaded] = useState(!product);
  const setX = (k: keyof ExtraForm, v: string) => setExtra(prev => ({ ...prev, [k]: v }));
  // Grade
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [removedRows, setRemovedRows] = useState<VariantRow[]>([]);
  const [sizeInput, setSizeInput] = useState("");
  const [colorInput, setColorInput] = useState("");

  useEffect(() => {
    if (!product) return;
    supabase.from("products").select("brand, collection, ncm, cest, cfop, origem, csosn").eq("id", product.id).maybeSingle()
      .then(({ data, error: e }) => { if (!e && data) { setExtra(extraFrom(data)); setExtraLoaded(true); } });
    supabase.from("products").select("id, variant_size, variant_color, barcode, sale_price, stock")
      .eq("variant_of", product.id).neq("is_active", false).order("created_at")
      .then(({ data }) => {
        const list = ((data ?? []) as any[]).map(r => ({ id: r.id, size: r.variant_size ?? "", color: r.variant_color ?? "", barcode: r.barcode ?? "", price: Number(r.sale_price ?? 0), stock: Number(r.stock ?? 0) }));
        setRows(list); setRemovedRows([]);
        setSizes(uniq(list.map(r => r.size))); setColors(uniq(list.map(r => r.color)));
      });
  }, [product]);

  // Monta uma linha para cada tamanho × cor (mantém o que já existia)
  function syncGrid(nextSizes: string[], nextColors: string[]) {
    setSizes(nextSizes); setColors(nextColors);
    const combos: [string, string][] = [];
    if (nextSizes.length && nextColors.length) nextColors.forEach(c => nextSizes.forEach(z => combos.push([z, c])));
    else if (nextSizes.length) nextSizes.forEach(z => combos.push([z, ""]));
    else nextColors.forEach(c => combos.push(["", c]));
    const pool = [...rows, ...removedRows];
    const next: VariantRow[] = combos.map(([z, c]) => pool.find(r => variantKey(r.size, r.color) === variantKey(z, c))
      ?? { size: z, color: c, barcode: newInternalEan(), price: form.sale_price, stock: 0 });
    const keep = new Set(next.map(r => variantKey(r.size, r.color)));
    setRemovedRows(pool.filter(r => r.id && !keep.has(variantKey(r.size, r.color))));
    setRows(next);
  }
  const addSizes = (list: string[]) => syncGrid(uniq([...sizes, ...list]), colors);
  const addColors = (list: string[]) => syncGrid(sizes, uniq([...colors, ...list]));
  const splitInput = (v: string) => v.split(/[,;]/).map(x => x.trim()).filter(Boolean);
  const setRow = (i: number, patch: Partial<VariantRow>) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEscapeKey(onClose);

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
      setForm({
        name: product.name,
        description: product.description,
        sku: product.sku,
        barcode: product.barcode,
        image_url: product.image_url,
        category_id: product.category_id,
        subcategory_id: product.subcategory_id,
        sale_price: product.sale_price,
        cost_price: product.cost_price ?? 0,
        promo_price: product.promo_price,
        promo_price_until: product.promo_price_until,
        unit: product.unit ?? "unidade",
        stock: product.stock ?? 0,
        stock_type: product.stock_type ?? "controlled",
        stock_min: product.stock_min ?? 0,
        stock_max: product.stock_max,
        visible_pdv: product.visible_pdv ?? true,
        visible_tables: product.visible_tables ?? true,
        visible_digital_menu: product.visible_digital_menu ?? true,
        printer_destination: product.printer_destination ?? "balcao",
        item_type: product.item_type ?? "principal",
        status: product.status ?? "active",
        is_active: product.is_active ?? true,
      });
      supabase.from("product_variations").select("*").eq("product_id", product.id).then(({ data }) => setVariations(data ?? []));
    }
  }, [product]);

  function addVariation() {
    if (!newVar.name.trim()) return;
    setVariations(prev => [...prev, { ...newVar, id: undefined }]);
    setNewVar({ type: newVar.type, name: "", additional_price: 0, stock: 1, is_active: true });
  }

  function removeVariation(idx: number) {
    setVariations(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("Nome do produto é obrigatório."); setTab("Geral"); return; }
    const hasGrid = retail && rows.length > 0;
    if (hasGrid) {
      const codes = rows.map(r => r.barcode.trim()).filter(Boolean);
      const dup = codes.find((c, i) => codes.indexOf(c) !== i);
      if (dup) { setError(`O código de barras ${dup} está repetido na grade.`); setTab("Grade"); return; }
      if (codes.length) {
        const own = new Set(rows.map(r => r.id).filter(Boolean));
        const { data: used } = await supabase.from("products").select("id, name, barcode").in("barcode", codes).neq("is_active", false);
        const clash = ((used ?? []) as any[]).find(u => !own.has(u.id) && u.id !== product?.id);
        if (clash) { setError(`O código ${clash.barcode} já é usado em "${clash.name}".`); setTab("Grade"); return; }
      }
    }
    setSaving(true); setError(null);

    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        sku: form.sku?.trim() || null,
        barcode: form.barcode?.trim() || null,
        image_url: form.image_url?.trim() || null,
        category_id: form.category_id,
        subcategory_id: form.subcategory_id,
        sale_price: form.sale_price,
        cost_price: form.cost_price,
        promo_price: form.promo_price,
        promo_price_until: form.promo_price_until,
        unit: form.unit,
        stock: form.stock,
        stock_type: form.stock_type,
        stock_min: form.stock_min,
        stock_max: form.stock_max,
        visible_pdv: form.visible_pdv,
        visible_tables: form.visible_tables,
        visible_digital_menu: form.visible_digital_menu,
        printer_destination: form.printer_destination,
        item_type: form.item_type,
        status: form.status,
        is_active: form.status === "active",
        ...(extraLoaded ? {
          brand: extra.brand.trim() || null,
          collection: extra.collection.trim() || null,
          ncm: extra.ncm.replace(/\D/g, "") || null,
          cest: extra.cest.replace(/\D/g, "") || null,
          cfop: extra.cfop.replace(/\D/g, "") || null,
          origem: extra.origem !== "" ? Number(extra.origem) : null,
          csosn: extra.csosn.trim() || null,
        } : {}),
        // Com grade, o estoque fica em cada tamanho/cor; o principal não bloqueia venda
        ...(hasGrid ? { stock_type: "unlimited", stock: 0 } : {}),
      };

      let savedId = product?.id;

      if (isEdit && product) {
        console.log("🔧 UPDATE - Tentando atualizar:", {
          id: product.id,
          oldPrice: product.sale_price,
          newPrice: form.sale_price,
        });
        const { data, error: err } = await supabase.from("products").update(payload).eq("id", product.id).select();
        console.log("✅ Result:", { success: !err, linhasAfetadas: data?.length, erro: err });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.from("products").insert(payload).select("id").single();
        if (err || !data) throw err || new Error("Sem dados retornados");
        savedId = data.id;
      }

      if (savedId && retail && (rows.length > 0 || removedRows.length > 0)) {
        const base = {
          variant_of: savedId, cost_price: form.cost_price, category_id: form.category_id, subcategory_id: form.subcategory_id,
          unit: form.unit, image_url: payload.image_url, stock_type: "controlled", stock_min: form.stock_min,
          visible_pdv: true, visible_tables: false, visible_digital_menu: false, printer_destination: "nenhuma", item_type: "principal",
          status: payload.status, is_active: payload.is_active, description: payload.description,
          ...(extraLoaded ? {
            brand: (payload as any).brand, collection: (payload as any).collection, ncm: (payload as any).ncm, cest: (payload as any).cest,
            cfop: (payload as any).cfop, origem: (payload as any).origem, csosn: (payload as any).csosn,
          } : {}),
        };
        const rowData = (r: VariantRow) => ({
          ...base, name: variantName(payload.name, r.size, r.color), variant_size: r.size.trim() || null, variant_color: r.color.trim() || null,
          barcode: r.barcode.trim() || null, sale_price: r.price, stock: r.stock,
        });
        const fresh = rows.filter(r => !r.id);
        if (fresh.length) {
          const { error: insErr } = await supabase.from("products").insert(fresh.map(rowData));
          if (insErr) throw insErr;
        }
        for (const r of rows.filter(r => r.id)) {
          const { error: upErr } = await supabase.from("products").update(rowData(r)).eq("id", r.id!);
          if (upErr) throw upErr;
        }
        for (const r of removedRows) {
          const { error: delErr } = await supabase.from("products").delete().eq("id", r.id!);
          // Já vendido: some da grade mas fica no histórico
          if (delErr) await supabase.from("products").update({ is_active: false, status: "inactive" }).eq("id", r.id!);
        }
      }

      if (savedId) {
        if (isEdit) await supabase.from("product_variations").delete().eq("product_id", savedId);
        if (variations.length > 0) {
          const { error: varErr } = await supabase.from("product_variations").insert(variations.map(v => ({
            product_id: savedId, type: v.type, name: v.name,
            additional_price: v.additional_price, stock: v.stock, is_active: v.is_active,
          })));
          if (varErr) throw varErr;
        }
      }

      setSaving(false);
      onSave(savedId);
      onClose();
    } catch (e: any) {
      setError(`Erro ao salvar: ${e?.message || String(e)}`);
      setSaving(false);
    }
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
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${tab === t ? "border-brand-500 text-brand-600" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>
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
                {retail && (
                  <>
                    <Field label="Marca">
                      <input value={extra.brand} onChange={e => setX("brand", e.target.value)} placeholder="Ex: Nike, Hering..." className={inputCls} />
                    </Field>
                    <Field label="Coleção">
                      <input value={extra.collection} onChange={e => setX("collection", e.target.value)} placeholder="Ex: Verão 2026" className={inputCls} />
                    </Field>
                  </>
                )}
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
                        className="w-24 h-24 rounded-xl border-2 border-dashed border-zinc-700 hover:border-brand-500 bg-zinc-950 flex flex-col items-center justify-center cursor-pointer transition-colors flex-shrink-0 overflow-hidden group"
                      >
                        {uploading ? (
                          <RefreshCw className="w-5 h-5 text-brand-600 animate-spin" />
                        ) : form.image_url ? (
                          <img src={form.image_url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <>
                            <Camera className="w-6 h-6 text-zinc-600 group-hover:text-brand-600 transition-colors" />
                            <span className="text-xs text-zinc-600 group-hover:text-brand-600 mt-1 transition-colors">Adicionar</span>
                          </>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                          className="flex items-center gap-2 px-4 py-2.5 border border-zinc-700 hover:border-brand-500 hover:text-brand-600 rounded-xl text-sm font-medium transition-colors w-full justify-center disabled:opacity-50">
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
          {tab === "Estoque" && retail && rows.length > 0 && (
            <div className="flex items-start gap-2 bg-brand-500/10 border border-brand-500/20 text-sm p-3 rounded-xl">
              <Grid3x3 className="w-4 h-4 flex-shrink-0 mt-0.5 text-brand-600" />
              <span>Este produto tem grade: a quantidade fica em cada tamanho/cor, na aba <b>Grade</b>. Entradas e balanço pela tela Estoque.</span>
            </div>
          )}
          {tab === "Estoque" && !(retail && rows.length > 0) && (
            <div className="space-y-5">
              {/* Tipo de estoque */}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => set("stock_type", "controlled")}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${form.stock_type === "controlled" ? "border-brand-500 bg-brand-500/10" : "border-zinc-800 hover:border-zinc-700"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Boxes className="w-4 h-4 text-brand-600" />
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
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-end">
                  <Field label="Tipo">
                    <select value={newVar.type} onChange={e => setNewVar(v => ({ ...v, type: e.target.value }))} className={`${selectCls} w-28`}>
                      {VAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Nome / Valor">
                    <input value={newVar.name} onChange={e => setNewVar(v => ({ ...v, name: e.target.value }))} placeholder="Ex: G, Vermelho, Grande..." className={inputCls} />
                  </Field>
                  <Field label="Quantidade">
                    <input type="number" min="0" step="1" value={newVar.stock || ""} onChange={e => setNewVar(v => ({ ...v, stock: parseInt(e.target.value) || 0 }))}
                      placeholder="1" className={`${inputCls} w-20`} />
                  </Field>
                  <Field label="+ Preço (R$)">
                    <input type="number" step="0.01" value={newVar.additional_price || ""} onChange={e => setNewVar(v => ({ ...v, additional_price: parseFloat(e.target.value) || 0 }))}
                      placeholder="0,00" className={`${inputCls} w-24`} />
                  </Field>
                  <button type="button" onClick={addVariation} disabled={!newVar.name.trim()}
                    className="h-10 px-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors self-end">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-zinc-600">Já lançando 3 unidades do mesmo tamanho? Cadastre uma vez com Quantidade = 3.</p>
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
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Qtd</span>
                            <input type="number" min="0" value={v.stock || ""}
                              onChange={e => setVariations(prev => prev.map((p, i) => i === v._idx ? { ...p, stock: parseInt(e.target.value) || 0 } : p))}
                              className="w-14 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white text-center" />
                          </div>
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

          {/* ── Tab Grade (varejo) ── */}
          {tab === "Grade" && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-500">Escolha os tamanhos e as cores: o sistema cria uma linha para cada combinação, com código de barras próprio (já gerado — pode trocar pelo código da etiqueta de fábrica), preço e quantidade.</p>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Tamanhos</p>
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_PRESETS.map(pr => (
                    <button key={pr.label} type="button" onClick={() => addSizes(pr.sizes)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium border border-zinc-700 hover:border-brand-500 hover:text-brand-600 transition-colors">
                      + {pr.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={sizeInput} onChange={e => setSizeInput(e.target.value)} placeholder="Outro tamanho (ex.: 50, XXG)"
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSizes(splitInput(sizeInput)); setSizeInput(""); } }} className={inputCls} />
                  <button type="button" onClick={() => { addSizes(splitInput(sizeInput)); setSizeInput(""); }} disabled={!sizeInput.trim()}
                    className="px-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl" style={{ color: "#fff" }}><Plus className="w-4 h-4" /></button>
                </div>
                {sizes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sizes.map(z => (
                      <span key={z} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-bold bg-brand-500/10 text-brand-600 border border-brand-500/20">
                        {z}
                        <button type="button" onClick={() => syncGrid(sizes.filter(x => x !== z), colors)} className="p-0.5 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Cores <span className="normal-case font-normal text-zinc-500">(opcional)</span></p>
                <div className="flex gap-2">
                  <input value={colorInput} onChange={e => setColorInput(e.target.value)} placeholder="Ex.: Preto, Branco, Azul (separe por vírgula)"
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addColors(splitInput(colorInput)); setColorInput(""); } }} className={inputCls} />
                  <button type="button" onClick={() => { addColors(splitInput(colorInput)); setColorInput(""); }} disabled={!colorInput.trim()}
                    className="px-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl" style={{ color: "#fff" }}><Plus className="w-4 h-4" /></button>
                </div>
                {colors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {colors.map(c => (
                      <span key={c} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        {c}
                        <button type="button" onClick={() => syncGrid(sizes, colors.filter(x => x !== c))} className="p-0.5 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {rows.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-zinc-500">{rows.length} combinaç{rows.length === 1 ? "ão" : "ões"} · {rows.reduce((n, r) => n + (r.stock || 0), 0)} peças</p>
                    <button type="button" onClick={() => setRows(prev => prev.map(r => ({ ...r, price: form.sale_price })))}
                      className="text-xs font-semibold text-brand-600 hover:text-brand-700">Usar {fmt(form.sale_price)} em todos</button>
                  </div>
                  <div className="border border-zinc-800 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[1fr_1.6fr_0.9fr_0.7fr] gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-950">
                      <span>Tamanho / Cor</span><span>Código de barras</span><span>Preço</span><span>Qtd</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-zinc-800/60">
                      {rows.map((r, i) => (
                        <div key={variantKey(r.size, r.color)} className="grid grid-cols-[1fr_1.6fr_0.9fr_0.7fr] gap-2 px-3 py-1.5 items-center">
                          <span className="text-sm font-semibold truncate">{[r.size, r.color].filter(Boolean).join(" / ")}</span>
                          <input value={r.barcode} onChange={e => setRow(i, { barcode: e.target.value.trim() })} className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono" />
                          <input type="number" step="0.01" min="0" value={r.price || ""} onChange={e => setRow(i, { price: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs" />
                          <input type="number" min="0" value={r.stock || ""} placeholder="0" onChange={e => setRow(i, { stock: parseInt(e.target.value) || 0 })} className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-center" />
                        </div>
                      ))}
                    </div>
                  </div>
                  {removedRows.length > 0 && (
                    <p className="text-[11px] text-amber-500">{removedRows.length} combinação(ões) sairá(ão) da grade ao salvar. Se já tiver venda, fica guardada no histórico.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 text-center py-4">Sem grade: o produto é vendido como item único. Adicione tamanhos e/ou cores para criar a grade.</p>
              )}
            </div>
          )}

          {/* ── Tab Fiscal (preparado para a NFC-e) ── */}
          {tab === "Fiscal" && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-500">Opcional por enquanto. São os dados que a nota fiscal (NFC-e) vai usar quando o emissor for ligado — se tiver dúvida, peça ao seu contador. {retail && rows.length > 0 && "Valem para todos os tamanhos/cores da grade."}</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="NCM" hint="8 dígitos — classificação do produto (ex.: camiseta 6109.10.00)">
                  <input inputMode="numeric" value={extra.ncm} onChange={e => setX("ncm", e.target.value)} placeholder="00000000" className={inputCls} />
                </Field>
                <Field label="CEST" hint="Só para produtos com substituição tributária">
                  <input inputMode="numeric" value={extra.cest} onChange={e => setX("cest", e.target.value)} placeholder="Opcional" className={inputCls} />
                </Field>
                <Field label="CFOP" hint="Venda dentro do estado: normalmente 5102">
                  <input inputMode="numeric" value={extra.cfop} onChange={e => setX("cfop", e.target.value)} placeholder="5102" className={inputCls} />
                </Field>
                <Field label="Origem da mercadoria">
                  <select value={extra.origem} onChange={e => setX("origem", e.target.value)} className={selectCls}>
                    <option value="">Não informado</option>
                    <option value="0">0 — Nacional</option>
                    <option value="1">1 — Estrangeira (importação direta)</option>
                    <option value="2">2 — Estrangeira (comprada no Brasil)</option>
                  </select>
                </Field>
                <Field label="CSOSN / CST" hint="Simples Nacional: normalmente 102">
                  <input value={extra.csosn} onChange={e => setX("csosn", e.target.value)} placeholder="102" className={inputCls} />
                </Field>
              </div>
            </div>
          )}

          {/* ── Tab Canais ── */}
          {tab === "Canais" && (
            <div className="space-y-5">
              <p className="text-xs text-zinc-500">Controle em quais canais de venda este produto aparece. O estoque é sempre unificado.</p>

              <div className="space-y-3">
                {[
                  { key: "visible_pdv" as const, icon: Monitor, label: "PDV (Ponto de Venda)", desc: "Aparece na tela de vendas do operador", color: "text-brand-600" },
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

              <div className="border-t border-zinc-800 pt-4 space-y-4">
                <Field label="Impressora de destino" hint="Para onde vai a comanda quando este produto for pedido">
                  <select value={form.printer_destination} onChange={e => set("printer_destination", e.target.value)} className={selectCls}>
                    {PRINTERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label="Tipo do item" hint={ITEM_TYPES.find(t => t.value === form.item_type)?.hint}>
                  <select value={form.item_type} onChange={e => set("item_type", e.target.value)} className={selectCls}>
                    {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-brand-900/10">
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
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from("categories").select("*").order("name");
    setCategories(data ?? []);
  }, []);

  const retailMode = useBusinessType() === "retail";
  const [gridInfo, setGridInfo] = useState<Record<string, { count: number; stock: number }>>({});
  const [showLabels, setShowLabels] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    // Tamanhos/cores (filhos da grade) não aparecem soltos: ficam dentro do produto principal
    let q = supabase.from("products").select("*", { count: "exact" }).is("variant_of", null);

    if (search.trim()) {
      // Nome sem diferença de acento ("oleo" acha "Óleo"); SKU e código de barras como digitado
      const raw = search.trim().replace(/[,()"\\]/g, " ");
      q = q.or(`name.imatch."${accentInsensitivePattern(search)}",sku.ilike.%${raw}%,barcode.ilike.%${raw}%`);
    }
    if (filterCat) q = q.eq("category_id", filterCat);
    if (filterStatus) q = q.eq("status", filterStatus);
    if (filterStock === "low") q = q.gt("stock_min", 0).lte("stock", supabase.rpc as any);
    if (filterStock === "empty") q = q.eq("stock", 0).eq("stock_type", "controlled");
    if (filterStock === "unlimited") q = q.eq("stock_type", "unlimited");

    q = q.order(sortBy, { ascending: sortAsc }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count } = await q;
    let list = (data ?? []) as Product[];
    // Busca pelo código de barras de um tamanho/cor: mostra o produto principal
    if (search.trim()) {
      const raw = search.trim().replace(/[,()"\\]/g, " ");
      const { data: kids } = await supabase.from("products").select("variant_of").not("variant_of", "is", null).ilike("barcode", `%${raw}%`).limit(20);
      const parentIds = [...new Set(((kids ?? []) as any[]).map(k => k.variant_of))].filter(id => !list.some(p => p.id === id));
      if (parentIds.length) {
        const { data: parents } = await supabase.from("products").select("*").in("id", parentIds);
        list = [...list, ...((parents ?? []) as Product[])];
      }
    }
    setProducts(list);
    setTotal(count ?? 0);
    setLoading(false);
    const ids = list.map(p => p.id);
    if (ids.length) {
      const { data: kids } = await supabase.from("products").select("variant_of, stock").in("variant_of", ids).neq("is_active", false);
      const info: Record<string, { count: number; stock: number }> = {};
      for (const k of (kids ?? []) as any[]) {
        const it = (info[k.variant_of] ??= { count: 0, stock: 0 });
        it.count++; it.stock += Number(k.stock ?? 0);
      }
      setGridInfo(info);
    } else setGridInfo({});
  }, [search, filterCat, filterStatus, filterStock, sortBy, sortAsc, page]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { setPage(0); }, [search, filterCat, filterStatus, filterStock, sortBy, sortAsc]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  function openCreate() { setEditProduct(null); setShowModal(true); }
  function openEdit(p: Product) { setEditProduct(p); setShowModal(true); }

  async function duplicate(p: Product) {
    try {
      const { id, created_at, ...rest } = p;
      const { error } = await supabase.from("products").insert({ ...rest, name: `${p.name} (cópia)`, sku: null, barcode: null, stock: 0 });
      if (error) throw error;
      await loadProducts();
    } catch (e: any) {
      setActionError(`Erro ao duplicar: ${e?.message || String(e)}`);
      setTimeout(() => setActionError(null), 4000);
    }
  }

  async function toggleActive(p: Product) {
    const newStatus = p.status === "active" ? "inactive" : "active";
    console.log("🔄 Toggle de", p.status, "para", newStatus, "-", p.id, p.name);

    const { error, status } = await supabase
      .from("products")
      .update({ status: newStatus, is_active: newStatus === "active" })
      .eq("id", p.id);
    // Grade: os tamanhos/cores acompanham o principal
    if (!error && gridInfo[p.id]) await supabase.from("products").update({ status: newStatus, is_active: newStatus === "active" }).eq("variant_of", p.id);

    console.log("Toggle resultado:", { error, status });

    if (error) {
      console.error("❌ ERRO:", error);
      setActionError(`Erro: ${error.message || JSON.stringify(error)}`);
      setTimeout(() => setActionError(null), 5000);
      return;
    }

    console.log("✓ Toggle ok, recarregando...");
    await loadProducts();
  }

  async function remove(p: Product) {
    if (!confirm(`Excluir "${p.name}"? Esta ação não pode ser desfeita.`)) return;

    try {
      // Se o produto tem vendas vinculadas, só desativa ao invés de deletar
      const { error: delError } = await supabase.from("products").delete().eq("id", p.id);

      if (delError) {
        // Se é erro de FK, desativa o produto como alternativa
        if (delError.code === "23503") {
          const { error: updateError } = await supabase
            .from("products")
            .update({ status: "inactive", is_active: false })
            .eq("id", p.id);

          if (updateError) throw updateError;
          await supabase.from("products").update({ status: "inactive", is_active: false }).eq("variant_of", p.id);

          setActionError("Produto desativado e removido do Estoque (tem compras, vendas ou movimentações vinculadas - não pode ser totalmente excluído, pra não corromper o histórico)");
          setTimeout(() => setActionError(null), 4000);
          await loadProducts();
          return;
        }

        throw delError;
      }

      await loadProducts();
    } catch (e: any) {
      setActionError(`Erro: ${e?.message || String(e)}`);
      setTimeout(() => setActionError(null), 5000);
    }
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
      {actionError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl flex gap-2 items-center">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {actionError}
        </div>
      )}
      <PageHeader title="Produtos" actions={<>
        {retailMode && (
          <button onClick={() => setShowLabels(true)} className={btnSecondary}>
            <Barcode className="w-4 h-4" /> Etiquetas
          </button>
        )}
        <button onClick={() => setShowCatModal(true)} className={btnSecondary}>
          <FolderOpen className="w-4 h-4" /> Categorias
        </button>
        <button onClick={openCreate} className={btnPrimary} style={WHITE_TEXT}>
          <Plus className="w-4 h-4" /> Novo Produto
        </button>
      </>} />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input placeholder="Buscar por nome, SKU ou código..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm placeholder-zinc-500 focus:outline-none focus:border-brand-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }} />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>}
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm focus:outline-none focus:border-brand-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}>
          <option value="">Todas categorias</option>
          {rootCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm focus:outline-none focus:border-brand-500 transition-colors"
          style={{ background: card.bg, border: card.border, color: isLight ? "#111" : "#fff" }}>
          <option value="">Todos status</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterStock} onChange={e => setFilterStock(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm focus:outline-none focus:border-brand-500 transition-colors"
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
          <div className="flex justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-brand-600" /></div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
            <Package className="w-10 h-10" />
            <p className="text-sm font-medium">Nenhum produto encontrado</p>
            <button onClick={openCreate} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
              + Criar primeiro produto
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs uppercase tracking-wider"
                  style={{ background: isLight ? "#F8FAFC" : "rgba(24,24,27,0.8)", borderBottom: isLight ? "1px solid #e5e7eb" : "1px solid rgba(39,39,42,0.6)" }}>
                  <th className="text-left px-4 py-3 w-12" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}></th>
                  <th className="text-left px-4 py-3 cursor-pointer transition-colors" style={{ color: isLight ? "#9CA3AF" : "#52525b" }} onClick={() => toggleSort("name")}>
                    <span className="flex items-center gap-1">Produto <SortIcon col="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Categoria</th>
                  <th className="text-left px-4 py-3 cursor-pointer transition-colors" style={{ color: isLight ? "#9CA3AF" : "#52525b" }} onClick={() => toggleSort("sale_price")}>
                    <span className="flex items-center gap-1">Preço <SortIcon col="sale_price" /></span>
                  </th>
                  <th className="text-left px-4 py-3" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Margem</th>
                  <th className="text-left px-4 py-3 cursor-pointer transition-colors" style={{ color: isLight ? "#9CA3AF" : "#52525b" }} onClick={() => toggleSort("stock")}>
                    <span className="flex items-center gap-1">Estoque <SortIcon col="stock" /></span>
                  </th>
                  <th className="text-left px-4 py-3" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Canais</th>
                  <th className="text-left px-4 py-3" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Status</th>
                  <th className="text-right px-4 py-3" style={{ color: isLight ? "#9CA3AF" : "#52525b" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.id} className="transition-colors group"
                    style={{
                      background: isLight
                        ? (i % 2 === 0 ? "#ffffff" : "#FAFBFC")
                        : "transparent",
                      borderBottom: isLight ? "1px solid #F3F4F6" : "1px solid rgba(39,39,42,0.3)",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = isLight ? "#F5F3FF" : "rgba(139,92,246,0.06)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isLight ? (i % 2 === 0 ? "#ffffff" : "#FAFBFC") : "transparent"; }}>
                    {/* Imagem */}
                    <td className="px-4 py-3">
                      {p.image_url
                        ? <img src={p.image_url} alt="" className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-md object-cover border border-zinc-700 flex-shrink-0 block" style={{aspectRatio:"1/1"}} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : <div className="w-10 h-10 min-w-[40px] rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4 text-zinc-600" /></div>}
                    </td>
                    {/* Nome */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white">{p.name}</p>
                        {p.item_type === "adicional" && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400 bg-amber-500/10 uppercase tracking-wide">Adicional</span>
                        )}
                        {gridInfo[p.id] && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-brand-500/30 text-brand-600 bg-brand-500/10 uppercase tracking-wide">Grade · {gridInfo[p.id].count}</span>
                        )}
                      </div>
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
                    <td className="px-4 py-3">
                      {gridInfo[p.id]
                        ? <span className="text-xs font-semibold">{gridInfo[p.id].stock} peças</span>
                        : <StockBadge product={p} />}
                    </td>
                    {/* Canais */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {p.visible_pdv !== false && <span title="PDV"><Monitor className="w-3.5 h-3.5 text-brand-600" /></span>}
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
                    className={`w-8 h-7 text-xs rounded-lg transition-colors ${pg === page ? "bg-brand-600 text-white" : "border border-zinc-700 hover:border-zinc-600 text-zinc-400"}`}>
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
      {showLabels && <LabelsModal onClose={() => setShowLabels(false)} />}
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
