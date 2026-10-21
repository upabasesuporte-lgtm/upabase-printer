import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import {
  Plus, X, RefreshCw, Truck, ChevronDown, Ban, Search, FileUp, Check, AlertCircle, Trash2, Clock, Pencil,
} from "lucide-react";
import { ProductModal, type Category, type Product } from "../products";
import PurchaseScreen, { PURCHASE_PAY_METHODS } from "./PurchaseScreen";
import { PageHeader, btnPrimary, btnSecondary, WHITE_TEXT } from "../../components/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimpleItem {
  id: string; name: string; barcode?: string | null; unit?: string | null;
  current_qty?: number; min_qty?: number; max_qty?: number | null; cost_price?: number; sale_price?: number;
  controlled?: boolean; // produto com controle de estoque (insumo sempre controla)
}

// Computador (1024px+) usa a tela cheia de lançamento; celular mantém o modal antigo
function useIsDesktop() {
  const query = "(min-width: 1024px)";
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

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

type Modal = "none" | "purchase" | "receive";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtQty = (v: number, unit: string) =>
  `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;

const inputCls = "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/10 transition-all";
const selectCls = inputCls + " cursor-pointer";
// Data de hoje no fuso do navegador (toISOString usa UTC e vira o dia a partir das 21h)
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
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
  const isDesktop = useIsDesktop();
  const purchaseScreenOpen = modal === "purchase" && isDesktop;
  useEscapeKey(() => setModal("none"), modal !== "none" && !purchaseScreenOpen);

  // Purchase form
  const [poSupplierId, setPOSupplierId] = useState("");
  const [poNotes, setPONotes] = useState("");
  const [poDueDate, setPODueDate] = useState(() => localToday());
  const [poInstallments, setPOInstallments] = useState("1");
  // Forma de pagamento / situação — vão completos para Contas a Pagar
  const [poPayMethod, setPOPayMethod] = useState("");
  const [poPaid, setPOPaid] = useState(false);
  const [poPaidDate, setPOPaidDate] = useState(() => localToday());
  const [poItems, setPOItems] = useState<{ ref_type: "ingredient" | "product"; item_id: string; itemName: string; quantity: string; unit_cost: string }[]>([]);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // Preço de venda editado na tela de compra (computador) — só é gravado no
  // produto depois que a compra for salva com sucesso.
  const [salePrices, setSalePrices] = useState<Record<string, string>>({});
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [receiveDueDate, setReceiveDueDate] = useState(() => localToday());
  const [receiveInstallments, setReceiveInstallments] = useState("1");
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

  // Editar produto já selecionado numa linha da compra (corrigir algo digitado errado)
  const [editProductTarget, setEditProductTarget] = useState<Product | null>(null);
  const [editProductIdx, setEditProductIdx] = useState<number | null>(null);
  const [editProductBaseline, setEditProductBaseline] = useState<{ stock: number; cost_price: number } | null>(null);
  useEscapeKey(() => { setEditProductTarget(null); setEditProductIdx(null); setEditProductBaseline(null); }, !!editProductTarget);

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
    const { data } = await supabase.from("stock_items")
      .select("id, name, unit, current_qty, min_qty, max_qty, cost_price").eq("is_active", true).order("name");
    setStockItems((data ?? []) as SimpleItem[]);
  }

  async function loadLimitedProducts() {
    const { data } = await supabase
      .from("products").select("id, name, barcode, unit, unlimited_stock, stock_type, stock, stock_min, stock_max, cost_price, sale_price")
      .or("unlimited_stock.eq.false,unlimited_stock.is.null")
      .eq("is_active", true).order("name");
    setLimitedProducts(((data ?? []) as any[]).map(p => ({
      id: p.id, name: p.name, barcode: p.barcode, unit: p.unit,
      current_qty: p.stock, min_qty: p.stock_min, max_qty: p.stock_max, cost_price: p.cost_price, sale_price: p.sale_price,
      controlled: p.stock_type !== "unlimited" && p.unlimited_stock !== true,
    })) as SimpleItem[]);
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
      setPODueDate(localToday()); setPOInstallments("1");
      setPOPayMethod(""); setPOPaid(false); setPOPaidDate(localToday());
      setPurchaseError(null);
      setPOItems(finalItems); setSalePrices({});
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
    setPODueDate(localToday()); setPOInstallments("1");
    setPOPayMethod(""); setPOPaid(false); setPOPaidDate(localToday());
    setPOItems([{ ref_type: "ingredient", item_id: "", itemName: "", quantity: "", unit_cost: "" }]);
    setSalePrices({});
    setModal("purchase");
  }

  // Fechar a tela cheia (computador) pede confirmação se já tem item lançado
  function closePurchaseScreen() {
    if (saving) return;
    if (poItems.some(i => i.item_id) && !confirm("Sair sem salvar? Os itens lançados nesta compra serão perdidos.")) return;
    setModal("none");
  }
  useEscapeKey(closePurchaseScreen, purchaseScreenOpen && quickCreateIdx === null && !editProductTarget && !xmlItems);

  // Cadastro de item novo a partir da busca da tela cheia: cria uma linha
  // vazia e reaproveita o mesmo fluxo de cadastro rápido já existente.
  function createFromScreen(type: "ingredient" | "product", name: string) {
    const idx = poItems.length;
    setPOItems(prev => [...prev, { ref_type: type, item_id: "", itemName: "", quantity: "1", unit_cost: "" }]);
    openQuickCreate(idx, type, name);
  }

  // Grava no produto o preço de venda que foi alterado na tela de compra
  async function applySalePrices(items: { ref_type: string; item_id: string }[]) {
    const ids = new Set(items.filter(i => i.ref_type === "product").map(i => i.item_id));
    const updates = Object.entries(salePrices).filter(([id, v]) => {
      if (!ids.has(id)) return false;
      const val = parseFloat(v);
      const current = limitedProducts.find(p => p.id === id)?.sale_price ?? 0;
      return val > 0 && Math.abs(val - current) > 0.0001;
    });
    await Promise.all(updates.map(([id, v]) => supabase.from("products").update({ sale_price: parseFloat(v) }).eq("id", id)));
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
    if (quickCreateIdx !== null && id) {
      const idx = quickCreateIdx;
      const { data } = await supabase.from("products").select("id, name, stock, cost_price").eq("id", id).single();
      const name = data?.name ?? "";
      const qty  = data?.stock ?? 0;
      const cost = data?.cost_price ?? 0;
      // Quantidade/custo digitados na criação do produto viram a quantidade
      // desta compra — zera o estoque aqui pra "Confirmar Recebimento" não
      // somar esse valor de novo e duplicar o estoque.
      if (qty > 0) await supabase.from("products").update({ stock: 0 }).eq("id", id);
      setPOItems(prev => prev.map((p, i) => i === idx ? {
        ...p, ref_type: "product", item_id: id, itemName: name,
        quantity: qty > 0 ? String(qty) : p.quantity,
        unit_cost: cost > 0 ? String(cost) : p.unit_cost,
      } : p));
    }
    await loadLimitedProducts();
  }

  // Editar produto já lançado na compra (corrigir algo digitado errado sem sair da tela)
  async function openEditProductFromRow(idx: number, id: string) {
    const { data } = await supabase.from("products").select("*").eq("id", id).single();
    if (data) {
      setEditProductTarget(data as Product);
      setEditProductIdx(idx);
      setEditProductBaseline({ stock: data.stock ?? 0, cost_price: data.cost_price ?? 0 });
    }
  }

  async function handleEditProductSaved(id?: string) {
    if (editProductIdx !== null && id) {
      const idx = editProductIdx;
      const { data } = await supabase.from("products").select("name, stock, cost_price").eq("id", id).single();
      if (data) {
        const baseline = editProductBaseline ?? { stock: 0, cost_price: 0 };
        const deltaQty = (data.stock ?? 0) - baseline.stock;
        const newCost = data.cost_price ?? 0;
        const costChanged = newCost > 0 && newCost !== baseline.cost_price;
        // So consome a diferenca de estoque como quantidade desta compra quando
        // ela aumentou (edicao usada pra completar o que faltou preencher) —
        // devolve o estoque pro valor original pra "Confirmar Recebimento"
        // somar certo, sem duplicar nem mexer no estoque real ja existente.
        if (deltaQty > 0) await supabase.from("products").update({ stock: baseline.stock }).eq("id", id);
        setPOItems(prev => prev.map((p, i) => i === idx ? {
          ...p, itemName: data.name,
          quantity: deltaQty > 0 ? String(deltaQty) : p.quantity,
          unit_cost: costChanged ? String(newCost) : p.unit_cost,
        } : p));
      }
      // O cadastro completo pode ter mudado o preço de venda — passa a valer o salvo
      setSalePrices(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
    await loadLimitedProducts();
    setEditProductTarget(null); setEditProductIdx(null); setEditProductBaseline(null);
  }

  async function savePurchase() {
    const validItems = poItems.filter(i => i.item_id && i.quantity);
    if (validItems.length === 0 || saving) return;
    if (!poPayMethod) { setPurchaseError("Escolha a forma de pagamento."); return; }
    setSaving(true);
    setPurchaseError(null);
    // Compra + itens + estoque + conta a pagar rodam numa unica transacao
    // no banco (register_purchase) - se qualquer passo falhar, tudo e
    // desfeito automaticamente, nao fica compra sem financeiro nem
    // financeiro sem compra. A propria RPC valida os dados (quantidade,
    // custo, fornecedor, itens) antes de gravar qualquer coisa.
    const { data: poId, error } = await supabase.rpc("register_purchase", {
      p_supplier_id: poSupplierId || null,
      p_notes: poNotes || null,
      p_due_date: poPaid ? poPaidDate : poDueDate,
      p_installments: poPaid ? 1 : (parseInt(poInstallments) || 1),
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
    // Completa a conta a pagar criada pela compra com a forma de pagamento
    // e, se ja foi paga, marca como paga (mesmos campos que Contas a Pagar usa).
    if (poId) {
      const { data: bills, error: billsErr } = await supabase.from("accounts_payable")
        .select("id, amount").eq("purchase_order_id", poId as string);
      let payErr = billsErr;
      for (const b of bills ?? []) {
        const { error: upErr } = await supabase.from("accounts_payable").update(poPaid
          ? { payment_method: poPayMethod, status: "paid", paid_date: poPaidDate, paid_amount: b.amount, updated_at: new Date().toISOString() }
          : { payment_method: poPayMethod, updated_at: new Date().toISOString() }).eq("id", b.id);
        if (upErr) payErr = upErr;
      }
      if (payErr) alert("A compra foi lançada e o estoque atualizado, mas não foi possível registrar a forma de pagamento em Contas a Pagar. Ajuste por lá. (" + payErr.message + ")");
    }
    if (poId) await logPurchaseMovements(poId as string, validItems.map(i => ({
      ref_type: i.ref_type, item_id: i.item_id, quantity: parseFloat(i.quantity), unit_cost: parseFloat(i.unit_cost) || 0,
    })), "purchase", suppliers.find(s => s.id === poSupplierId)?.name ?? null);
    await applySalePrices(validItems);
    await Promise.all([loadPurchases(), loadStockItems(), loadLimitedProducts()]);
    setSaving(false);
    setModal("none");
  }

  // Histórico de estoque da compra (aparece na aba Estoque). Roda depois que a
  // compra já foi gravada e nunca a desfaz: se falhar, só fica sem o registro.
  // Produtos "sem controle de estoque" não entram — o saldo deles não é acompanhado.
  async function logPurchaseMovements(
    poId: string,
    items: { ref_type: "ingredient" | "product"; item_id: string; quantity: number; unit_cost: number }[],
    type: "purchase" | "purchase_cancel",
    supplierName: string | null,
  ) {
    const tracked = items.filter(i => i.ref_type === "ingredient" || limitedProducts.find(p => p.id === i.item_id)?.controlled !== false);
    if (tracked.length === 0) return;
    const prodIds = tracked.filter(i => i.ref_type === "product").map(i => i.item_id);
    const ingIds = tracked.filter(i => i.ref_type === "ingredient").map(i => i.item_id);
    const [prodRes, ingRes] = await Promise.all([
      prodIds.length ? supabase.from("products").select("id, stock").in("id", prodIds) : Promise.resolve({ data: [] as any[] }),
      ingIds.length ? supabase.from("stock_items").select("id, current_qty").in("id", ingIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const balance: Record<string, number> = {};
    for (const p of (prodRes.data ?? []) as any[]) balance[p.id] = Number(p.stock);
    for (const s of (ingRes.data ?? []) as any[]) balance[s.id] = Number(s.current_qty);
    const label = type === "purchase" ? `Compra${supplierName ? " - " + supplierName : ""}` : `Compra cancelada${supplierName ? " - " + supplierName : ""}`;
    await supabase.from("inventory_movements").insert(tracked.map(i => ({
      product_id: i.ref_type === "product" ? i.item_id : null,
      stock_item_id: i.ref_type === "ingredient" ? i.item_id : null,
      type,
      quantity: type === "purchase" ? i.quantity : -i.quantity,
      balance_after: balance[i.item_id] ?? null,
      unit_cost: i.unit_cost || null,
      reference_type: "purchase", reference_id: poId,
      notes: label,
    })));
  }

  const poItemsForLog = (po: PurchaseOrder) => (po.purchase_order_items ?? []).map(i => ({
    ref_type: (i.product_id ? "product" : "ingredient") as "product" | "ingredient",
    item_id: (i.product_id ?? i.stock_item_id) as string,
    quantity: Number(i.quantity), unit_cost: Number(i.unit_cost),
  })).filter(i => !!i.item_id);

  // Confirma que a mercadoria de uma compra pendente chegou: só agora estoque
  // e conta a pagar são atualizados.
  async function confirmReceivePurchase(po: PurchaseOrder, dueDate: string, installments: string) {
    if (receivingId) return;
    setReceivingId(po.id);
    const { error } = await supabase.rpc("receive_purchase_order", {
      p_purchase_order_id: po.id,
      p_due_date: dueDate,
      p_installments: parseInt(installments) || 1,
    });
    if (error) {
      alert(error.message);
      setReceivingId(null);
      return;
    }
    await logPurchaseMovements(po.id, poItemsForLog(po), "purchase", po.suppliers?.name ?? null);
    await Promise.all([loadPurchases(), loadStockItems(), loadLimitedProducts()]);
    setReceivingId(null);
    setModal("none");
  }

  // Cancela um pedido pendente — como ainda não mexeu em estoque/financeiro,
  // não precisa reverter nada, só marca como cancelado.
  async function cancelPendingPurchase(po: PurchaseOrder) {
    if (po.status !== "pending" || cancellingId) return;
    if (!confirm("Cancelar este pedido? Ele ainda não afetou estoque nem financeiro.")) return;
    setCancellingId(po.id);
    const { error } = await supabase.from("purchase_orders").update({ status: "cancelled" }).eq("id", po.id).eq("status", "pending");
    if (error) { alert(error.message); setCancellingId(null); return; }
    await loadPurchases();
    setCancellingId(null);
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
    await logPurchaseMovements(po.id, poItemsForLog(po), "purchase_cancel", po.suppliers?.name ?? null);
    await Promise.all([loadPurchases(), loadStockItems(), loadLimitedProducts()]);
    setCancellingId(null);
  }

  async function deletePurchase(po: PurchaseOrder) {
    if (po.status !== "cancelled" || deletingId) return;
    if (!confirm("Excluir definitivamente esta compra cancelada? Essa ação não pode ser desfeita.")) return;
    setDeletingId(po.id);
    await supabase.from("accounts_payable").delete().eq("purchase_order_id", po.id);
    await supabase.from("purchase_order_items").delete().eq("purchase_order_id", po.id);
    const { error } = await supabase.from("purchase_orders").delete().eq("id", po.id);
    if (error) { alert(error.message); setDeletingId(null); return; }
    setPurchases(prev => prev.filter(p => p.id !== po.id));
    setDeletingId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <PageHeader title="Compras" actions={<>
          <input ref={xmlInputRef} type="file" accept=".xml,text/xml" className="hidden" onChange={handleXmlFile} />
          <button onClick={() => xmlInputRef.current?.click()} disabled={xmlParsing} className={btnSecondary}>
            {xmlParsing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            Importar XML da NFe
          </button>
          <button onClick={openPurchaseModal} className={btnPrimary} style={WHITE_TEXT}>
            <Plus className="w-4 h-4" /> Registrar Compra
          </button>
        </>} />

        {xmlError && !xmlItems && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {xmlError}
          </div>
        )}

        {purchases.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-zinc-800 rounded-2xl">
            <Truck className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-400 font-semibold">Nenhuma compra registrada</p>
            <button onClick={openPurchaseModal} className="mt-5 text-brand-700 text-sm font-semibold hover:underline">
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
                    style={{ WebkitTapHighlightColor: "transparent" }}
                    className="w-full flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-5 py-4 text-left transition-colors">
                    <div className="flex items-center gap-4 min-w-0 sm:flex-1">
                      <div className="w-10 h-10 bg-brand-50 border border-brand-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Truck className="w-4 h-4 text-brand-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="text-sm font-semibold text-white truncate max-w-full">
                            {po.suppliers?.name ?? "Fornecedor não informado"}
                          </span>
                          {po.status === "cancelled" ? (
                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                              Cancelada
                            </span>
                          ) : po.status === "pending" ? (
                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                              Aguardando entrega
                            </span>
                          ) : (
                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
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
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0 pl-14 sm:pl-0">
                      <p className="text-base font-bold text-white">{fmt(total)}</p>
                      <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-zinc-800">
                      <div className="hidden sm:grid grid-cols-[1fr_100px_100px_100px] gap-x-4 px-5 py-2 text-xs text-zinc-500 font-medium">
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
                                {isProduct && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Revenda</span>}
                              </span>
                              <span className="hidden sm:block text-sm text-zinc-400">{fmtQty(item.quantity, itemUnit)}</span>
                              <span className="hidden sm:block text-sm text-zinc-400">{fmt(item.unit_cost)}</span>
                              <span className="text-sm font-bold text-white sm:text-right">{fmt(item.quantity * item.unit_cost)}</span>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between px-5 py-3">
                          <span className="text-xs text-zinc-500">Total da compra</span>
                          <span className="text-base font-black text-white">{fmt(total)}</span>
                        </div>
                        {po.status === "pending" ? (
                          <div className="px-5 py-3 flex flex-wrap items-center gap-4">
                            <button onClick={() => { setReceiveTarget(po); setReceiveDueDate(localToday()); setReceiveInstallments("1"); setModal("receive"); }}
                              disabled={receivingId === po.id}
                              className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors">
                              {receivingId === po.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                              Confirmar Recebimento
                            </button>
                            <button onClick={() => cancelPendingPurchase(po)} disabled={cancellingId === po.id}
                              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors">
                              {cancellingId === po.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                              Cancelar pedido
                            </button>
                          </div>
                        ) : po.status !== "cancelled" ? (
                          <div className="px-5 py-3">
                            <button onClick={() => cancelPurchase(po)} disabled={cancellingId === po.id}
                              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors">
                              {cancellingId === po.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                              Cancelar compra
                            </button>
                          </div>
                        ) : (
                          <div className="px-5 py-3">
                            <button onClick={() => deletePurchase(po)} disabled={deletingId === po.id}
                              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors">
                              {deletingId === po.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              Excluir compra
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

      {/* Confirmar Recebimento (pedido pendente) */}
      {modal === "receive" && receiveTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold">Confirmar Recebimento</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{receiveTarget.suppliers?.name ?? "Fornecedor não informado"}</p>
              </div>
              <button onClick={() => setModal("none")} className="p-1.5 text-zinc-400 hover:text-white rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-zinc-400">
                Isso vai somar os itens dessa compra no estoque e criar a conta a pagar. Confere o vencimento antes de confirmar:
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Vencimento (Contas a Pagar)</label>
                  <input type="date" value={receiveDueDate} onChange={e => setReceiveDueDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Número de parcelas</label>
                  <input type="number" min="1" max="60" value={receiveInstallments} onChange={e => setReceiveInstallments(e.target.value)} className={inputCls} />
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="sm:flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={() => confirmReceivePurchase(receiveTarget, receiveDueDate, receiveInstallments)} disabled={receivingId === receiveTarget.id}
                className="sm:flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
                style={{ color: "#fff" }}>
                {receivingId === receiveTarget.id ? <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" /> : <Check className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate">Confirmar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tela cheia de lançamento de compra (computador) */}
      {purchaseScreenOpen && (
        <PurchaseScreen
          suppliers={suppliers}
          stockItems={stockItems}
          products={limitedProducts}
          supplierId={poSupplierId} setSupplierId={setPOSupplierId}
          notes={poNotes} setNotes={setPONotes}
          dueDate={poDueDate} setDueDate={setPODueDate}
          installments={poInstallments} setInstallments={setPOInstallments}
          payMethod={poPayMethod} setPayMethod={setPOPayMethod}
          paid={poPaid} setPaid={setPOPaid}
          paidDate={poPaidDate} setPaidDate={setPOPaidDate}
          items={poItems} setItems={setPOItems}
          salePrices={salePrices} setSalePrices={setSalePrices}
          error={purchaseError ?? (!xmlItems ? xmlError : null)}
          saving={saving}
          xmlParsing={xmlParsing}
          onImportXml={() => xmlInputRef.current?.click()}
          onClose={closePurchaseScreen}
          onSaveReceive={savePurchase}
          onCreateProduct={name => createFromScreen("product", name)}
          onCreateIngredient={name => createFromScreen("ingredient", name)}
          onEditProduct={openEditProductFromRow}
        />
      )}

      {/* Purchase Modal (celular) */}
      {modal === "purchase" && !isDesktop && (
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
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Forma de pagamento *</label>
                  <select value={poPayMethod}
                    onChange={e => { const m = PURCHASE_PAY_METHODS.find(x => x.key === e.target.value); setPOPayMethod(e.target.value); if (m) setPOPaid(m.paidByDefault); }}
                    className={selectCls}>
                    <option value="">Selecionar...</option>
                    {PURCHASE_PAY_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Situação</label>
                  <select value={poPaid ? "paid" : "pending"} onChange={e => setPOPaid(e.target.value === "paid")} className={selectCls}>
                    <option value="paid">Já está paga</option>
                    <option value="pending">A pagar</option>
                  </select>
                </div>
                {poPaid ? (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Data do pagamento</label>
                    <input type="date" value={poPaidDate} onChange={e => setPOPaidDate(e.target.value)} className={inputCls} />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Vencimento (Contas a Pagar)</label>
                      <input type="date" value={poDueDate} onChange={e => setPODueDate(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Número de parcelas</label>
                      <input type="number" min="1" max="60" value={poInstallments} onChange={e => setPOInstallments(e.target.value)} className={inputCls} />
                    </div>
                  </>
                )}
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
                    className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 transition-colors">
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
                        {!item.item_id && !isSearching ? (
                          <div className="space-y-1.5">
                            <div className="flex gap-2">
                              <button type="button" onClick={() => openQuickCreate(idx, "product", "")}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors">
                                <Plus className="w-3.5 h-3.5 flex-shrink-0" /> Criar Produto Novo
                              </button>
                              <button type="button" onClick={() => { setItemSearchText(""); setOpenSearchIdx(idx); }}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-white text-xs font-semibold transition-colors">
                                <Search className="w-3.5 h-3.5 flex-shrink-0" /> Usar Produto Existente
                              </button>
                              {poItems.length > 1 && (
                                <button onClick={() => setPOItems(prev => prev.filter((_, i) => i !== idx))}
                                  className="p-1.5 text-zinc-600 hover:text-red-400 rounded-lg flex-shrink-0 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            <button type="button" onClick={() => openQuickCreate(idx, "ingredient", "")}
                              className="w-full text-center text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors py-0.5">
                              Não é produto de venda, é insumo/ingrediente de receita? Cadastre aqui
                            </button>
                          </div>
                        ) : !isSearching ? (
                          <div className="flex gap-2 items-center">
                            <button type="button" onClick={() => { setItemSearchText(""); setOpenSearchIdx(idx); }}
                              className="flex-1 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-xl text-sm text-left transition-colors">
                              <span className="text-white truncate">{item.itemName}</span>
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.ref_type === "ingredient" ? "bg-gray-100 text-gray-600 border border-gray-200" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>
                                {item.ref_type === "ingredient" ? "Insumo" : "Produto"}
                              </span>
                            </button>
                            {item.ref_type === "product" && item.item_id && (
                              <button type="button" onClick={() => openEditProductFromRow(idx, item.item_id!)}
                                title="Editar produto" className="p-1.5 text-zinc-500 hover:text-brand-600 rounded-lg flex-shrink-0 transition-colors">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
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
                          <div className="bg-zinc-900 border border-brand-500/40 rounded-xl overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
                              <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                              <input autoFocus value={itemSearchText} onChange={e => setItemSearchText(e.target.value)}
                                placeholder="Buscar produto existente..."
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
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${m.ref_type === "ingredient" ? "bg-gray-100 text-gray-600 border border-gray-200" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>
                                    {m.ref_type === "ingredient" ? "Insumo" : "Produto"}
                                  </span>
                                </button>
                              ))}
                              {matches.length === 0 && (
                                <p className="px-3 py-3 text-xs text-zinc-500 text-center">Nenhum item encontrado</p>
                              )}
                            </div>
                            <div className="border-t border-zinc-800 p-2">
                              <button type="button" onClick={() => openQuickCreate(idx, "product", itemSearchText.trim())}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors">
                                <Plus className="w-3.5 h-3.5 flex-shrink-0" /> Cadastrar {itemSearchText ? `"${itemSearchText}"` : "produto novo"}
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
            <div className="flex flex-col gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
              <button onClick={() => setModal("none")} className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={savePurchase}
                disabled={poItems.every(i => !i.item_id || !i.quantity) || saving}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
                style={{ color: "#fff" }}>
                {saving ? <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" /> : <Truck className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate">Dar entrada no estoque</span>
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
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
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

      {/* Editar produto já selecionado numa linha da compra */}
      {editProductTarget && (
        <ProductModal
          product={editProductTarget}
          categories={categories}
          onClose={() => { setEditProductTarget(null); setEditProductIdx(null); }}
          onSave={handleEditProductSaved}
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
                        className="text-zinc-500 hover:text-brand-600 transition-colors">Não é esse, criar novo</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-amber-400 flex-shrink-0">Será cadastrado como novo:</span>
                      <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5">
                        <button type="button" onClick={() => updateXmlItem(idx, { refType: "ingredient" })}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${it.refType === "ingredient" ? "bg-brand-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                          Insumo
                        </button>
                        <button type="button" onClick={() => updateXmlItem(idx, { refType: "product" })}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${it.refType === "product" ? "bg-brand-600 text-white" : "text-zinc-400 hover:text-white"}`}>
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
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
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
