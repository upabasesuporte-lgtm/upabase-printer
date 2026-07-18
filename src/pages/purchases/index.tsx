import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import {
  Plus, X, RefreshCw, Truck, ChevronDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimpleItem { id: string; name: string; }

interface POItem {
  id?: string; stock_item_id: string | null; product_id?: string | null; quantity: number; unit_cost: number;
  stock_items?: { name: string; unit: string } | null;
  products?: { name: string; unit: string } | null;
}

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedPO, setExpandedPO] = useState<string | null>(null);

  const [modal, setModal] = useState<Modal>("none");
  useEscapeKey(() => setModal("none"), modal !== "none");

  // Purchase form
  const [poSupplierId, setPOSupplierId] = useState("");
  const [poNotes, setPONotes] = useState("");
  const [poDueDate, setPODueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [poItems, setPOItems] = useState<{ ref_type: "ingredient" | "product"; item_id: string; quantity: string; unit_cost: string }[]>([]);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await Promise.all([loadPurchases(), loadStockItems(), loadLimitedProducts(), loadSuppliers()]);
      setLoading(false);
    })();
  }, []);

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
      .from("products").select("id, name")
      .or("unlimited_stock.eq.false,unlimited_stock.is.null")
      .eq("is_active", true).order("name");
    setLimitedProducts((data ?? []) as SimpleItem[]);
  }

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("id, name").order("name");
    setSuppliers((data ?? []) as SimpleItem[]);
  }

  function openPurchaseModal() {
    setPOSupplierId(""); setPONotes(""); setPurchaseError(null);
    setPODueDate(new Date().toISOString().split("T")[0]);
    setPOItems([{ ref_type: "ingredient", item_id: "", quantity: "", unit_cost: "" }]);
    setModal("purchase");
  }

  async function savePurchase() {
    const validItems = poItems.filter(i => i.item_id && i.quantity);
    if (validItems.length === 0 || saving) return;
    setSaving(true);
    setPurchaseError(null);
    // Etapa 3: compra + itens + estoque + conta a pagar rodam numa unica
    // transacao no banco (register_purchase) - se qualquer passo falhar,
    // tudo e desfeito automaticamente, nao fica compra sem financeiro nem
    // financeiro sem compra. A propria RPC valida os dados (quantidade,
    // custo, fornecedor, itens) antes de gravar qualquer coisa.
    const rpcParams = {
      p_supplier_id: poSupplierId || null,
      p_notes: poNotes || null,
      p_due_date: poDueDate,
      p_items: validItems.map(i => ({
        ref_type: i.ref_type,
        item_id: i.item_id,
        quantity: parseFloat(i.quantity),
        unit_cost: parseFloat(i.unit_cost) || 0,
      })),
    };
    // DIAG-ETAPA3: log temporario pra investigar a conta a pagar nao criada.
    // Remover depois que a causa for confirmada.
    console.log("[DIAG-ETAPA3] chamando register_purchase com:", rpcParams);
    const { data, error } = await supabase.rpc("register_purchase", rpcParams);
    console.log("[DIAG-ETAPA3] resposta da RPC:", { data, error });
    if (error) {
      console.error("[DIAG-ETAPA3] erro retornado pela RPC:", error);
      setPurchaseError(error.message);
      setSaving(false);
      return;
    }
    console.log("[DIAG-ETAPA3] RPC concluida sem erro, purchase_order_id retornado:", data);
    await loadPurchases();
    setSaving(false);
    setModal("none");
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
            <button onClick={openPurchaseModal}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${isLight ? "bg-blue-600 hover:bg-blue-700" : "bg-violet-600 hover:bg-violet-500 text-white"}`}
              style={isLight ? { color: "#ffffff" } : undefined}>
              <Plus className="w-4 h-4" /> Registrar Compra
            </button>
          </div>
        </div>

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
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Recebida
                        </span>
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
                  <button onClick={() => setPOItems(prev => [...prev, { ref_type: "ingredient", item_id: "", quantity: "", unit_cost: "" }])}
                    className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <Plus className="w-3 h-3" /> Adicionar linha
                  </button>
                </div>
                <div className="space-y-2">
                  {poItems.map((item, idx) => (
                    <div key={idx} className="space-y-1.5 pb-2 border-b border-zinc-800 last:border-0">
                      <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5 w-fit">
                        <button type="button" onClick={() => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, ref_type: "ingredient", item_id: "" } : p))}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${item.ref_type === "ingredient" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                          Insumo
                        </button>
                        <button type="button" onClick={() => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, ref_type: "product", item_id: "" } : p))}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${item.ref_type === "product" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"}`}>
                          Produto de revenda
                        </button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <select value={item.item_id}
                          onChange={e => setPOItems(prev => prev.map((p, i) => i === idx ? { ...p, item_id: e.target.value } : p))}
                          className={selectCls + " flex-1"}>
                          <option value="">Selecionar item...</option>
                          {(item.ref_type === "ingredient" ? stockItems : limitedProducts).map(si => <option key={si.id} value={si.id}>{si.name}</option>)}
                        </select>
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
                    </div>
                  ))}
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
    </>
  );
}
