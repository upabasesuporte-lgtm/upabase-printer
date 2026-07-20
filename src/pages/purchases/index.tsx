import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import {
  Plus, X, RefreshCw, Truck, ChevronDown, Ban, Search, FileUp, Check, AlertCircle,
} from "lucide-react";
import { ProductModal, type Category } from "../products";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimpleItem { id: string; name: string; barcode?: string | null; }

interface POItem {
  id?: string; stock_item_id: string | null; product_id?: string | null; quantity: number; unit_cost: number;
  stock_items?: { name: string; unit: string } | null;
  products?: { name: string; unit: string } | null;
}

interface XmlParsedItem {
  cProd: string; xProd: string; cEAN: string | null; uCom: string; qCom: number; vUnCom: number;
  matchType: "existing" | "new";
  matchedId: string | null;
  refType: "ingredient" | "product";
  newSalePrice: string;
}

const XML_UNIT_MAP: Record<string, string> = {
  UN: "unidade", UND: "unidade", PC: "unidade", PCT: "pacote", CX: "caixa",
  KG: "kg", G: "g", GR: "g", L: "litro", LT: "litro", ML: "ml", DZ: "dúzia",
  M: "metro", CM: "cm",
};
const normalizeXmlUnit = (u: string) => XML_UNIT_MAP[u.trim().toUpperCase()] ?? "unidade";

interface PurchaseOrder {
  id: string; supplier_id: string | null; status: string; notes: string | null;
  created_at: string; received_at: string | null;
  suppliers?: { name: string } | null;
  purchase_order_items?: POItem[];
}

type Modal = "none" | "purchase";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtQty = (v: number, unit: string) =>
  `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";
const selectCls = inputCls + " cursor-pointer";
const UNITS = ["unidade","kg","g","litro","ml","metro","cm","caixa","dúzia","pacote","porção"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PurchasesPage() {
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

  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [stockItems, setStockItems] = useState<SimpleItem[]>([]);
  const [limitedProducts, setLimitedProducts] = useState<SimpleItem[]>([]);
  const [suppliers, setSuppliers] = useState<SimpleItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedPO, setExpandedPO] = useState<string | null>(null);

  const [modal, setModal] = useState<Modal>("none");
  useEscapeKey(() => setModal("none"), modal !== "none");

  // Purchase form
  const [poSupplierId, setPOSupplierId] = useState("");
  const [poNotes, setPONotes] = useState("");
  const [poDueDate, setPODueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [poItems, setPOItems] = useState<{ ref_type: "ingredient" | "product"; item_id: string; itemName: string; quantity: string; unit_cost: string }[]>([]);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [openSearchIdx, setOpenSearchIdx] = useState<number | null>(null);
  const [itemSearchText, setItemSearchText] = useState("");

  // Cadastro rápido de insumo/produto direto pela Compra
  const [quickCreateIdx, setQuickCreateIdx] = useState<number | null>(null);
  const [quickCreateType, setQuickCreateType] = useState<"ingredient" | "product">("ingredient");
  const [qcName, setQcName] = useState("");
  const [qcUnit, setQcUnit] = useState("unidade");
  const [qcCategory, setQcCategory] = useState("");
  const [qcMinQty, setQcMinQty] = useState("");
  const [qcSaving, setQcSaving] = useState(false);
  const [qcError, setQcError] = useState<string | null>(null);
  useEscapeKey(() => setQuickCreateIdx(null), quickCreateIdx !== null);

  // Importação de XML de NFe
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const [xmlItems, setXmlItems] = useState<XmlParsedItem[] | null>(null);
  const [xmlSupplierId, setXmlSupplierId] = useState<string | null>(null);
  const [xmlSupplierName, setXmlSupplierName] = useState("");
  const [xmlInvoiceRef, setXmlInvoiceRef] = useState("");
  const [xmlParsing, setXmlParsing] = useState(false);
  const [xmlImporting, setXmlImporting] = useState(false);
  const [xmlError, setXmlError] = useState<string | null>(null);
  useEscapeKey(() => setXmlItems(null), xmlItems !== null);

  useEffect(() => {
    (async () => {
      await Promise.all([loadPurchases(), loadStockItems(), loadLimitedProducts(), loadSuppliers(), loadCategories()]);
      setLoading(false);
    })();
  }, []);

  async function loadCategories() {
    const { data } = await supabase.from("categories").select("id, name, parent_id, color, description").order("name");
    setCategories((data ?? []) as Category[]);
  }

  async function loadPurchases() {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_items(*, stock_items(name, unit), products(name, unit))")
      .order("created_at", { ascending: false });
    setPurchases((data ?? []) as PurchaseOrder[]);
  }

  async function loadStockItems() {
    const { data } = await supabase.from("stock_items").select("id, name").eq("is_active", true).order("name");
    setStockItems((data ?? []) as SimpleItem[]);
  }

  async function loadLimitedProducts() {
    const { data } = await supabase
      .from("products").select("id, name, barcode, unlimited_stock, stock_type")
      .or("unlimited_stock.eq.false,unlimited_stock.is.null")
      .eq("is_active", true).order("name");
    setLimitedProducts((data ?? []) as SimpleItem[]);
  }

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("id, name").order("name");
    setSuppliers((data ?? []) as SimpleItem[]);
  }

  // ── Importação de XML de NFe ─────────────────────────────────────────────
  // So preenche a mesma tela/fluxo ja existente (poItems + Purchase Modal) -
  // nao cria nenhum caminho novo de gravacao, reaproveita o register_purchase.

  async function handleXmlFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlParsing(true);
    setXmlError(null);
    try {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, "application/xml");
      if (doc.querySelector("parsererror")) throw new Error("Arquivo XML inválido ou corrompido.");

      const infNFe = doc.querySelector("infNFe");
      if (!infNFe) throw new Error("Não encontrei os dados da nota nesse arquivo (isso é um XML de NFe?).");

      const getTag = (parent: Element, selector: string) => parent.querySelector(selector)?.textContent?.trim() ?? "";
      const nNF = getTag(infNFe, "ide > nNF");
      const serie = getTag(infNFe, "ide > serie");
      const emitCnpj = getTag(infNFe, "emit > CNPJ");
      const emitNome = getTag(infNFe, "emit > xNome");

      // Fornecedor: acha pelo CNPJ ou cadastra automaticamente
      let supplierId: string | null = null;
      if (emitCnpj) {
        const { data: existing } = await supabase.from("suppliers").select("id, name").eq("cnpj", emitCnpj).maybeSingle();
        if (existing) {
          supplierId = existing.id;
        } else {
          const { data: created, error } = await supabase.from("suppliers")
            .insert({ name: emitNome || emitCnpj, cnpj: emitCnpj }).select("id, name").single();
          if (error) throw new Error("Erro ao cadastrar fornecedor: " + error.message);
          if (created) { supplierId = created.id; await loadSuppliers(); }
        }
      }

      const detNodes = Array.from(infNFe.querySelectorAll("det"));
      if (detNodes.length === 0) throw new Error("Essa nota não tem itens.");

      const parsed: XmlParsedItem[] = detNodes.map(det => {
        const prod = det.querySelector("prod") ?? det;
        const xProd = getTag(prod, "xProd") || "Produto sem nome";
        const cEANRaw = getTag(prod, "cEAN");
        const cEAN = cEANRaw && cEANRaw.toUpperCase() !== "SEM GTIN" ? cEANRaw : null;
        const uCom = normalizeXmlUnit(getTag(prod, "uCom") || "UN");
        const qCom = parseFloat(getTag(prod, "qCom")) || 0;
        const vUnCom = parseFloat(getTag(prod, "vUnCom")) || 0;

        let matchType: "existing" | "new" = "new";
        let matchedId: string | null = null;
        let refType: "ingredient" | "product" = "product";
        if (cEAN) {
          const byBarcode = limitedProducts.find(p => p.barcode === cEAN);
          if (byBarcode) { matchType = "existing"; matchedId = byBarcode.id; refType = "product"; }
        }
        if (!matchedId) {
          const nameLower = xProd.trim().toLowerCase();
          const prodMatch = limitedProducts.find(p => p.name.trim().toLowerCase() === nameLower);
          const ingMatch = stockItems.find(s => s.name.trim().toLowerCase() === nameLower);
          if (prodMatch) { matchType = "existing"; matchedId = prodMatch.id; refType = "product"; }
          else if (ingMatch) { matchType = "existing"; matchedId = ingMatch.id; refType = "ingredient"; }
        }

        return { cProd: getTag(prod, "cProd"), xProd, cEAN, uCom, qCom, vUnCom, matchType, matchedId, refType, newSalePrice: "" };
      });

      setXmlSupplierId(supplierId);
      setXmlSupplierName(emitNome);
      setXmlInvoiceRef([nNF, serie ? `série ${serie}` : ""].filter(Boolean).join(" - "));
      setXmlItems(parsed);
    } catch (err: any) {
      setXmlError(err?.message ?? "Erro ao ler o arquivo XML.");
    } finally {
      setXmlParsing(false);
      if (xmlInputRef.current) xmlInputRef.current.value = "";
    }
  }

  function updateXmlItem(idx: number, updates: Partial<XmlParsedItem>) {
    setXmlItems(prev => prev ? prev.map((it, i) => i === idx ? { ...it, ...updates } : it) : prev);
  }

  async function confirmXmlImport() {
    if (!xmlItems || xmlImporting) return;
    setXmlImporting(true);
    setXmlError(null);
    try {
      const finalItems: { ref_type: "ingredient" | "product"; item_id: string; itemName: string; quantity: string; unit_cost: string }[] = [];
      for (const it of xmlItems) {
        if (it.matchType === "existing" && it.matchedId) {
          const name = it.refType === "ingredient"
            ? stockItems.find(s => s.id === it.matchedId)?.name ?? it.xProd
            : limitedProducts.find(p => p.id === it.matchedId)?.name ?? it.xProd;
          finalItems.push({ ref_type: it.refType, item_id: it.matchedId, itemName: name, quantity: String(it.qCom), unit_cost: String(it.vUnCom) });
        } else if (it.refType === "ingredient") {
          const { data, error } = await supabase.from("stock_items").insert({
            name: it.xProd, unit: it.uCom, current_qty: 0, min_qty: 0, cost_price: 0,
            supplier_id: xmlSupplierId,
          }).select("id, name").single();
          if (error || !data) throw new Error(error?.message ?? `Erro ao criar insumo "${it.xProd}".`);
          finalItems.push({ ref_type: "ingredient", item_id: data.id, itemName: data.name, quantity: String(it.qCom), unit_cost: String(it.vUnCom) });
        } else {
          const { data, error } = await supabase.from("products").insert({
            name: it.xProd, unit: it.uCom, sale_price: parseFloat(it.newSalePrice) || 0, cost_price: 0,
            stock: 0, stock_type: "controlled", unlimited_stock: false,
            barcode: it.cEAN, is_active: true, status: "active",
            visible_pdv: true, visible_tables: true, visible_digital_menu: true,
            printer_destination: "balcao", item_type: "principal",
          }).select("id, name").single();
          if (error || !data) throw new Error(error?.message ?? `Erro ao criar produto "${it.xProd}".`);
          finalItems.push({ ref_type: "product", item_id: data.id, itemName: data.name, quantity: String(it.qCom), unit_cost: String(it.vUnCom) });
        }
      }
      await Promise.all([loadStockItems(), loadLimitedProducts()]);
      setPOSupplierId(xmlSupplierId ?? "");
      setPONotes(xmlInvoiceRef);
      setPODueDate(new Date().toISOString().split("T")[0]);
      setPurchaseError(null);
      setPOItems(finalItems);
      setXmlItems(null);
      setModal("purchase");
    } catch (err: any) {
      setXmlError(err?.message ?? "Erro ao importar itens da nota.");
    } finally {
      setXmlImporting(false);
    }
  }

  function openPurchaseModal() {
    setPOSupplierId(""); setPONotes(""); setPurchaseError(null);
    setPODueDate(new Date().toISOString().split("T")[0]);
    setPOItems([{ ref_type: "ingredient", item_id: "", itemName: "", quantity: "", unit_cost: "" }]);
    setModal("purchase");
  }

  function openQuickCreate(idx: number, type: "ingredient" | "product", initialName: string) {
    setQuickCreateIdx(idx);
    setQuickCreateType(type);
    setQcName(initialName); setQcUnit("unidade");
    setQcCategory(""); setQcMinQty(""); setQcError(null);
    setOpenSearchIdx(null);
  }

  // Cadastro rapido de insumo (formulario reduzido - stock_items nao tem
  // um modal completo proprio ainda, entao mantemos essa versao enxuta).
  async function saveQuickCreateIngredient() {
    if (quickCreateIdx === null || qcSaving) return;
    const idx = quickCreateIdx;
    if (!qcName.trim()) { setQcError("Informe o nome."); return; }
    setQcSaving(true);
    setQcError(null);
    const { data, error } = await supabase.from("stock_items").insert({
      name: qcName.trim(), unit: qcUnit,
      current_qty: 0, min_qty: parseFloat(qcMinQty) || 0, cost_price: 0,
      category: qcCategory.trim() || null,
      supplier_id: poSupplierId || null,
    }).select("id, name").single();
    if (error || !data) { setQcError(error?.message ?? "Erro ao criar insumo."); setQcSaving(false); return; }
    setStockItems(prev => [...prev, data as SimpleItem].sort((a, b) => a.name.localeCompare(b.name)));
    setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, ref_type: "ingredient", item_id: data.id, itemName: data.name } : p));
    setQcSaving(false);
    setQuickCreateIdx(null);
  }

  // Cadastro de produto de revenda: reaproveita o mesmo ProductModal
  // completo da tela de Produtos (mesmos campos, mesma logica de salvar).
  async function handleNewProductSaved(id?: string) {
    await loadLimitedProducts();
    if (quickCreateIdx !== null && id) {
      const idx = quickCreateIdx;
      const created = await supabase.from("products").select("id, name").eq("id", id).single();
      const name = created.data?.name ?? "";
      setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, ref_type: "product", item_id: id, itemName: name } : p));
    }
  }

  async function savePurchase() {
    const validItems = poItems.filter(i => i.item_id && i.quantity);
    if (validItems.length === 0 || saving) return;
    setSaving(true);
    setPurchaseError(null);
    // Compra + itens + estoque + conta a pagar rodam numa unica transacao
    // no banco (register_purchase) - se qualquer passo falhar, tudo e
    // desfeito automaticamente, nao fica compra sem financeiro nem
    // financeiro sem compra. A propria RPC valida os dados (quantidade,
    // custo, fornecedor, itens) antes de gravar qualquer coisa.
    const { error } = await supabase.rpc("register_purchase", {
      p_supplier_id: poSupplierId || null,
      p_notes: poNotes || null,
      p_due_date: poDueDate,
      p_items: validItems.map(i => ({
        ref_type: i.ref_type,
        item_id: i.item_id,
        quantity: parseFloat(i.quantity),
        unit_cost: parseFloat(i.unit_cost) || 0,
      })),
    });
    if (error) {
      setPurchaseError(error.message);
      setSaving(false);
      return;
    }
    await loadPurchases();
    setSaving(false);
    setModal("none");
  }

  async function cancelPurchase(po: PurchaseOrder) {
    if (po.status === "cancelled" || cancellingId) return;
    if (!confirm("Cancelar esta compra? O estoque somado por ela será revertido e a conta a pagar vinculada será cancelada.")) return;
    setCancellingId(po.id);
    const { error } = await supabase.rpc("cancel_purchase", { p_purchase_order_id: po.id });
    if (error) {
      alert(error.message);
      setCancellingId(null);
      return;
    }
    await Promise.all([loadPurchases(), loadStockItems(), loadLimitedProducts()]);
    setCancellingId(null);
  }

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
                <span className="text-[11px] font-semibold uppercase tracking-widest" style={{color:"#3b82f6"}}>Fornecedores</span>
              </div>
              <h1 className="text-2xl font-black g-text g-text-blue">
                Compras
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                {purchases.length} compra{purchases.length !== 1 ? "s" : ""} registrada{purchases.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input ref={xmlInputRef} type="file" accept=".xml,text/xml" className="hidden" onChange={handleXmlFile} />
              <button onClick={() => xmlInputRef.current?.click()} disabled={xmlParsing}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors disabled:opacity-50">
                {xmlParsing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                Importar XML da NFe
              </button>
              <button onClick={openPurchaseModal}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${isLight ? "bg-blue-600 hover:bg-blue-700" : "bg-violet-600 hover:bg-violet-500 text-white"}`}
                style={isLight ? { color: "#ffffff" } : undefined}>
                <Plus className="w-4 h-4" /> Registrar Compra
              </button>
            </div>
          </div>
        </div>

        {xmlError && !xmlItems && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {xmlError}
          </div>
        )}

        {purchases.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
            <Truck className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-400 font-semibold">Nenhuma compra registrada</p>
            <button onClick={openPurchaseModal} className="mt-5 text-violet-400 text-sm hover:underline">
              Registrar primeira compra
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {purchases.map(po => {
              const total = (po.purchase_order_items ?? []).reduce((s, i) => s + i.quantity * i.unit_cost, 0);
              const isExpanded = expandedPO === po.id;
              const itemCount = (po.purchase_order_items ?? []).length;
              return (
                <div key={po.id} className="rounded-2xl overflow-hidden" style={{ background: card.bg, border: card.border, boxShadow: card.shadow }}>
                  <button onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors">
                    <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Truck className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {po.suppliers?.name ?? "Fornecedor não informado"}
                        </span>
                        {po.status === "cancelled" ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                            Cancelada
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Recebida
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {new Date(po.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                        {" · "}{itemCount} ite{itemCount !== 1 ? "ns" : "m"}
                        {po.notes && ` · ${po.notes}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 mr-2">
                      <p className="text-base font-bold text-white">{fmt(total)}</p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                  {isExpanded && (
                    <div className="border-t border-zinc-800">
                      <div className="hidden sm:grid grid-cols-[1fr_100px_100px_100px] gap-x-4 px-5 py-2 bg-zinc-950/40 text-xs text-zinc-500 font-medium">
                        <span>Item</span><span>Quantidade</span><span>Custo Unit.</span><span className="text-right">Total</span>
                      </div>
                      <div className="divide-y divide-zinc-800/50">
                        {(po.purchase_order_items ?? []).map((item, idx) => {
                          const itemName = item.stock_items?.name ?? item.products?.name ?? "—";
                          const itemUnit = item.stock_items?.unit ?? item.products?.unit ?? "";
                          const isProduct = !!item.product_id;
                          return (
                            <div key={idx} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_100px_100px_100px] gap-x-4 px-5 py-2.5 items-center">
                              <span className="text-sm text-zinc-200 flex items-center gap-1.5">
                                {itemName}
                                {isProduct && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Revenda</span>}
                              </span>
                              <span className="hidden sm:block text-sm text-zinc-400">{fmtQty(item.quantity, itemUnit)}</span>
                              <span className="hidden sm:block text-sm text-zinc-400">{fmt(item.unit_cost)}</span>
                              <span className="text-sm font-bold text-white sm:text-right">{fmt(item.quantity * item.unit_cost)}</span>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between px-5 py-3 bg-zinc-950/40">
                          <span className="text-xs text-zinc-500">Total da compra</span>
                          <span className="text-base font-black text-white">{fmt(total)}</span>
                        </div>
                        {po.status !== "cancelled" && (
                          <div className="px-5 py-3">
                            <button onClick={() => cancelPurchase(po)} disabled={cancellingId === po.id}
                              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors">
                              {cancellingId === po.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                              Cancelar compra
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Purchase Modal */}
      {modal === "purchase" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Registrar Compra</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Entrada de mercadoria — estoque atualizado imediatamente</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Fornecedor</label>
                  <select value={poSupplierId} onChange={e => setPOSupplierId(e.target.value)} className={selectCls}>
                    <option value="">Selecionar...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Referência / NF</label>
                  <input value={poNotes} onChange={e => setPONotes(e.target.value)} placeholder="Número da nota, pedido..." className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Vencimento (Contas a Pagar)</label>
                  <input type="date" value={poDueDate} onChange={e => setPODueDate(e.target.value)} className={inputCls} />
                </div>
              </div>

              {purchaseError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl">
                  {purchaseError}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-zinc-400">Itens da compra *</label>
                  <button onClick={() => setPOItems(prev => [...prev, { ref_type: "ingredient", item_id: "", itemName: "", quantity: "", unit_cost: "" }])}
                    className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <Plus className="w-3 h-3" /> Adicionar linha
                  </button>
                </div>
                <div className="space-y-2">
                  {poItems.map((item, idx) => {
                    const isSearching = openSearchIdx === idx;
                    const q = itemSearchText.trim().toLowerCase();
                    const matches = [
                      ...stockItems.filter(s => q === "" || s.name.toLowerCase().includes(q)).map(s => ({ ...s, ref_type: "ingredient" as const })),
                      ...limitedProducts.filter(p => q === "" || p.name.toLowerCase().includes(q) || (!!p.barcode && p.barcode === itemSearchText.trim())).map(p => ({ ...p, ref_type: "product" as const })),
                    ].slice(0, 8);
                    return (
                      <div key={idx} className="pb-2 border-b border-zinc-800 last:border-0 space-y-1.5">
                        {!isSearching ? (
                          <div className="flex gap-2 items-center">
                            <button type="button" onClick={() => { setItemSearchText(""); setOpenSearchIdx(idx); }}
                              className="flex-1 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-xl text-sm text-left transition-colors">
                              <span className={item.item_id ? "text-white truncate" : "text-zinc-500"}>
                                {item.itemName || "Selecionar item..."}
                              </span>
                              {item.item_id && (
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.ref_type === "ingredient" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"}`}>
                                  {item.ref_type === "ingredient" ? "Insumo" : "Produto"}
                                </span>
                              )}
                            </button>
                            <input value={item.quantity} placeholder="Qtd"
                              onChange={e => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, quantity: e.target.value } : p))}
                              type="number" min="0" step="0.001" className={inputCls + " w-20"} />
                            <input value={item.unit_cost} placeholder="R$/un"
                              onChange={e => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, unit_cost: e.target.value } : p))}
                              type="number" min="0" step="0.01" className={inputCls + " w-24"} />
                            {poItems.length > 1 && (
                              <button onClick={() => setPOItems(prev => prev.filter((_, i) => i !== idx))}
                                className="p-1.5 text-zinc-600 hover:text-red-400 rounded-lg flex-shrink-0 transition-colors">
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="bg-zinc-900 border border-violet-500/40 rounded-xl overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
                              <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                              <input autoFocus value={itemSearchText} onChange={e => setItemSearchText(e.target.value)}
                                placeholder="Buscar insumo ou produto..."
                                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none" />
                              <button onClick={() => setOpenSearchIdx(null)} className="text-zinc-500 hover:text-white transition-colors flex-shrink-0">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                              {matches.map(m => (
                                <button key={`${m.ref_type}-${m.id}`} type="button"
                                  onClick={() => {
                                    setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, ref_type: m.ref_type, item_id: m.id, itemName: m.name } : p));
                                    setOpenSearchIdx(null);
                                  }}
                                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-zinc-800 transition-colors text-sm border-b border-zinc-800/50 last:border-0">
                                  <span className="text-white truncate">{m.name}</span>
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${m.ref_type === "ingredient" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"}`}>
                                    {m.ref_type === "ingredient" ? "Insumo" : "Produto"}
                                  </span>
                                </button>
                              ))}
                              {matches.length === 0 && (
                                <p className="px-3 py-3 text-xs text-zinc-500 text-center">Nenhum item encontrado</p>
                              )}
                            </div>
                            <div className="border-t border-zinc-800">
                              <button type="button" onClick={() => openQuickCreate(idx, "ingredient", itemSearchText.trim())}
                                className="w-full flex items-center gap-1.5 px-3 py-2.5 text-left text-xs text-violet-400 hover:bg-zinc-800 transition-colors">
                                <Plus className="w-3 h-3 flex-shrink-0" /> Cadastrar {itemSearchText ? `"${itemSearchText}"` : "novo item"} como Insumo
                              </button>
                              <button type="button" onClick={() => openQuickCreate(idx, "product", itemSearchText.trim())}
                                className="w-full flex items-center gap-1.5 px-3 py-2.5 text-left text-xs text-violet-400 hover:bg-zinc-800 transition-colors">
                                <Plus className="w-3 h-3 flex-shrink-0" /> Cadastrar {itemSearchText ? `"${itemSearchText}"` : "novo item"} como Produto de revenda
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-zinc-400">Total da compra</span>
                <span className="text-base font-bold text-white">
                  {fmt(poItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_cost) || 0), 0))}
                </span>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={savePurchase}
                disabled={poItems.every(i => !i.item_id || !i.quantity) || saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                Confirmar Recebimento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cadastro rápido de insumo, direto da Compra */}
      {quickCreateIdx !== null && quickCreateType === "ingredient" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-base font-semibold">Cadastrar novo insumo</h2>
              <button onClick={() => setQuickCreateIdx(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nome *</label>
                <input value={qcName} onChange={e => setQcName(e.target.value)} placeholder="Nome do item" className={inputCls} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Unidade</label>
                  <select value={qcUnit} onChange={e => setQcUnit(e.target.value)} className={selectCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Estoque mínimo</label>
                  <input value={qcMinQty} onChange={e => setQcMinQty(e.target.value)}
                    type="number" min="0" step="0.001" placeholder="0" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Categoria</label>
                <input value={qcCategory} onChange={e => setQcCategory(e.target.value)}
                  placeholder="Ex: Proteínas, Bebidas, Embalagens..." className={inputCls} />
              </div>
              <p className="text-xs text-zinc-500">O custo e a quantidade em estoque serão preenchidos por esta compra.</p>
              {qcError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl">{qcError}</div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800">
              <button onClick={() => setQuickCreateIdx(null)} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveQuickCreateIngredient} disabled={qcSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {qcSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Cadastrar e usar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cadastro de produto de revenda: mesmo formulario completo de Produtos */}
      {quickCreateIdx !== null && quickCreateType === "product" && (
        <ProductModal
          product={null}
          categories={categories}
          onClose={() => setQuickCreateIdx(null)}
          onSave={handleNewProductSaved}
          initialName={qcName}
        />
      )}

      {/* Conferência dos itens lidos do XML da NFe, antes de virar compra */}
      {xmlItems && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Conferir itens da nota</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {xmlSupplierName || "Fornecedor não identificado"}{xmlInvoiceRef && ` · ${xmlInvoiceRef}`} · {xmlItems.length} ite{xmlItems.length !== 1 ? "ns" : "m"}
                </p>
              </div>
              <button onClick={() => setXmlItems(null)} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {xmlError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl">{xmlError}</div>
              )}
              {xmlItems.map((it, idx) => (
                <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <input value={it.xProd} onChange={e => updateXmlItem(idx, { xProd: e.target.value })}
                      className={inputCls + " flex-1"} />
                    <input value={it.qCom} onChange={e => updateXmlItem(idx, { qCom: parseFloat(e.target.value) || 0 })}
                      type="number" min="0" step="0.001" className={inputCls + " w-20"} title="Quantidade" />
                    <input value={it.vUnCom} onChange={e => updateXmlItem(idx, { vUnCom: parseFloat(e.target.value) || 0 })}
                      type="number" min="0" step="0.01" className={inputCls + " w-24"} title="Custo unitário" />
                  </div>
                  {it.matchType === "existing" ? (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <Check className="w-3.5 h-3.5 flex-shrink-0" />
                        Vai atualizar {it.refType === "ingredient" ? "insumo" : "produto"} já cadastrado
                      </span>
                      <button type="button" onClick={() => updateXmlItem(idx, { matchType: "new", matchedId: null })}
                        className="text-zinc-500 hover:text-violet-400 transition-colors">Não é esse, criar novo</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-amber-400 flex-shrink-0">Será cadastrado como novo:</span>
                      <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5">
                        <button type="button" onClick={() => updateXmlItem(idx, { refType: "ingredient" })}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${it.refType === "ingredient" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                          Insumo
                        </button>
                        <button type="button" onClick={() => updateXmlItem(idx, { refType: "product" })}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${it.refType === "product" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                          Produto
                        </button>
                      </div>
                      {it.refType === "product" && (
                        <input value={it.newSalePrice} onChange={e => updateXmlItem(idx, { newSalePrice: e.target.value })}
                          type="number" min="0" step="0.01" placeholder="Preço de venda"
                          className={inputCls + " w-32 text-xs py-1.5"} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setXmlItems(null)} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={confirmXmlImport} disabled={xmlImporting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                {xmlImporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                Usar {xmlItems.length} ite{xmlItems.length !== 1 ? "ns" : "m"} na compra
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
