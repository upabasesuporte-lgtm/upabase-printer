import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft, Search, Plus, Pencil, X, FileUp, RefreshCw, Check, AlertCircle, TrendingUp, TrendingDown, Package,
} from "lucide-react";

// Tela cheia de lançamento de compra — usada só no computador. O celular
// continua com o modal antigo. Não grava nada sozinha: tudo passa pelas
// mesmas funções de salvar da página (register_purchase).

export interface ScreenItem {
  id: string; name: string; barcode?: string | null; unit?: string | null;
  current_qty?: number; cost_price?: number; sale_price?: number;
  controlled?: boolean;
}

export interface POLine {
  ref_type: "ingredient" | "product"; item_id: string; itemName: string; quantity: string; unit_cost: string;
}

interface Props {
  suppliers: { id: string; name: string }[];
  stockItems: ScreenItem[];
  products: ScreenItem[];
  supplierId: string; setSupplierId: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  dueDate: string; setDueDate: (v: string) => void;
  installments: string; setInstallments: (v: string) => void;
  payMethod: string; setPayMethod: (v: string) => void;
  paid: boolean; setPaid: (v: boolean) => void;
  paidDate: string; setPaidDate: (v: string) => void;
  items: POLine[]; setItems: React.Dispatch<React.SetStateAction<POLine[]>>;
  salePrices: Record<string, string>; setSalePrices: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  error: string | null;
  saving: boolean;
  xmlParsing: boolean;
  onImportXml: () => void;
  onClose: () => void;
  onSaveReceive: () => void;
  onCreateProduct: (name: string) => void;
  onCreateIngredient: (name: string) => void;
  onEditProduct: (idx: number, id: string) => void;
}

// Mesmas chaves usadas em Contas a Pagar
export const PURCHASE_PAY_METHODS = [
  { key: "pix", label: "Pix", paidByDefault: true },
  { key: "cash", label: "Dinheiro", paidByDefault: true },
  { key: "debit_card", label: "Débito", paidByDefault: true },
  { key: "credit_card", label: "Crédito", paidByDefault: false },
  { key: "boleto", label: "Boleto", paidByDefault: false },
  { key: "transfer", label: "Transferência", paidByDefault: true },
  { key: "check", label: "Cheque", paidByDefault: false },
];

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: string | undefined) => parseFloat((v ?? "").replace(",", ".")) || 0;

const fieldCls = "w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition-all";
const cellInputCls = "w-full px-2 py-1.5 bg-white border border-gray-200 rounded-md text-sm text-gray-900 text-right tabular-nums focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition-all";

export default function PurchaseScreen(p: Props) {
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [supplierWarn, setSupplierWarn] = useState(false);
  const [payWarn, setPayWarn] = useState(false);
  const supplierRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const q = search.trim().toLowerCase();
  const matches = q === "" ? [] : [
    ...p.products.filter(x => x.name.toLowerCase().includes(q) || (!!x.barcode && x.barcode === search.trim())).map(x => ({ ...x, ref_type: "product" as const })),
    ...p.stockItems.filter(x => x.name.toLowerCase().includes(q)).map(x => ({ ...x, ref_type: "ingredient" as const })),
  ].slice(0, 8);

  const lookup = (line: POLine) =>
    (line.ref_type === "product" ? p.products : p.stockItems).find(x => x.id === line.item_id);

  function addItem(m: ScreenItem & { ref_type: "ingredient" | "product" }) {
    p.setItems(prev => {
      const existing = prev.findIndex(l => l.item_id === m.id && l.ref_type === m.ref_type);
      if (existing >= 0) {
        return prev.map((l, i) => i === existing ? { ...l, quantity: String(num(l.quantity) + 1) } : l);
      }
      return [...prev, {
        ref_type: m.ref_type, item_id: m.id, itemName: m.name, quantity: "1",
        unit_cost: m.cost_price ? String(m.cost_price) : "",
      }];
    });
    setSearch(""); setHighlight(0);
    searchRef.current?.focus();
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(matches.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      // Código de barras exato tem prioridade
      const byBarcode = p.products.find(x => !!x.barcode && x.barcode === search.trim());
      if (byBarcode) addItem({ ...byBarcode, ref_type: "product" });
      else if (matches[highlight]) addItem(matches[highlight]);
      else if (search.trim()) { p.onCreateProduct(search.trim()); setSearch(""); }
    } else if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); }
  }

  const updateLine = (idx: number, patch: Partial<POLine>) =>
    p.setItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const removeLine = (idx: number) => p.setItems(prev => prev.filter((_, i) => i !== idx));

  const lines = p.items.map((l, idx) => ({ l, idx })).filter(({ l }) => !!l.item_id);
  const total = lines.reduce((s, { l }) => s + num(l.quantity) * num(l.unit_cost), 0);
  const canSave = lines.some(({ l }) => num(l.quantity) > 0) && !p.saving;
  const inst = Math.max(parseInt(p.installments) || 1, 1);

  // O fornecedor é obrigatório para gravar a compra — avisa antes de enviar
  function guardSave(save: () => void) {
    if (!p.supplierId) { setSupplierWarn(true); supplierRef.current?.focus(); return; }
    if (!p.payMethod) { setPayWarn(true); return; }
    save();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] p-3">
      <div className="h-full w-full flex gap-3">
        {/* ── Coluna principal ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
          {/* Topo */}
          <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={p.onClose} title="Voltar (Esc)"
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-gray-900 leading-tight">Nova compra</h2>
                <p className="text-xs text-gray-500">Entrada de mercadoria do fornecedor</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
            <button onClick={() => p.onCreateProduct(search.trim())}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 transition-colors"
              style={{ color: "#fff" }}>
              <Plus className="w-4 h-4" /> Cadastrar produto novo
            </button>
            <button onClick={p.onImportXml} disabled={p.xmlParsing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
              {p.xmlParsing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
              Importar XML da NFe
            </button>
            </div>
          </div>

          {/* Dados da nota */}
          <div className="grid grid-cols-[2fr_1fr] gap-3 px-6 pb-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Fornecedor *</label>
              <select ref={supplierRef} value={p.supplierId} onChange={e => { p.setSupplierId(e.target.value); setSupplierWarn(false); }}
                className={fieldCls + " cursor-pointer" + (supplierWarn ? " border-red-400 ring-2 ring-red-500/15" : "")}>
                <option value="">Selecione o fornecedor...</option>
                {p.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {supplierWarn && <p className="text-xs text-red-600 mt-1">Selecione o fornecedor para salvar a compra.</p>}
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Nº da nota / pedido</label>
              <input value={p.notes} onChange={e => p.setNotes(e.target.value)} placeholder="Opcional" className={fieldCls} />
            </div>
          </div>

          {/* Busca */}
          <div className="relative px-6 pb-4">
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15 focus-within:bg-white transition-all">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input ref={searchRef} value={search}
                onChange={e => { setSearch(e.target.value); setHighlight(0); }}
                onKeyDown={onSearchKey}
                placeholder="Bipe o código de barras ou digite o nome do produto e aperte Enter"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none" />
              {search && (
                <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
              )}
            </div>
            {q !== "" && (
              <div className="absolute left-6 right-6 top-full -mt-2 z-10 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  {matches.map((m, i) => (
                    <button key={`${m.ref_type}-${m.id}`} type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => addItem(m)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm border-b border-gray-100 last:border-0 transition-colors ${i === highlight ? "bg-brand-50" : "bg-white"}`}>
                      <span className="flex-1 min-w-0 truncate text-gray-900 font-medium">{m.name}</span>
                      <span className="text-xs text-gray-500 tabular-nums">{m.controlled === false ? "Sem controle de estoque" : `Estoque: ${Number(m.current_qty ?? 0).toLocaleString("pt-BR")}`}</span>
                      {m.cost_price ? <span className="text-xs text-gray-500 tabular-nums w-24 text-right">Custo {fmt(m.cost_price)}</span> : <span className="w-24" />}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600`}>
                        {m.ref_type === "ingredient" ? "Insumo" : "Produto"}
                      </span>
                    </button>
                  ))}
                  {matches.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-500">Nenhum produto encontrado com "{search.trim()}".</p>
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 border-t border-gray-100 bg-gray-50">
                  <button type="button" onClick={() => { p.onCreateProduct(search.trim()); setSearch(""); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-brand-700 hover:bg-brand-100 transition-colors">
                    <Plus className="w-4 h-4" /> Cadastrar produto "{search.trim()}"
                  </button>
                  <button type="button" onClick={() => { p.onCreateIngredient(search.trim()); setSearch(""); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors">
                    <Plus className="w-4 h-4" /> Cadastrar como insumo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Itens */}
          <div className="flex-1 min-h-0 flex flex-col border-t border-gray-100">
            <div className="grid grid-cols-[minmax(0,1fr)_72px_100px_100px_92px_56px] xl:grid-cols-[minmax(0,1fr)_88px_124px_124px_110px_64px] gap-2 xl:gap-3 px-4 xl:px-6 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <span>Produto</span>
              <span className="text-right">Qtd</span>
              <span className="text-right">Custo un.</span>
              <span className="text-right">Preço venda</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>
            <div className="flex-1 overflow-y-auto">
              {lines.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16 px-6">
                  <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
                    <Package className="w-6 h-6 text-gray-300" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">Nenhum item na compra</p>
                  <p className="text-xs text-gray-500 mt-1">Use a busca acima para adicionar produtos que já existem, ou cadastre um produto novo.</p>
                  <button onClick={() => p.onCreateProduct("")}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 transition-colors">
                    <Plus className="w-4 h-4" /> Cadastrar produto novo
                  </button>
                </div>
              ) : lines.map(({ l, idx }) => {
                const ref = lookup(l);
                const prevCost = ref?.cost_price ?? 0;
                const cost = num(l.unit_cost);
                const isProduct = l.ref_type === "product";
                const saleStr = salePriceOf(l, ref, p.salePrices);
                const sale = num(saleStr);
                const margin = isProduct && sale > 0 && cost > 0 ? ((sale - cost) / sale) * 100 : null;
                const costUp = prevCost > 0 && cost > 0 && cost > prevCost + 0.0001;
                const costDown = prevCost > 0 && cost > 0 && cost < prevCost - 0.0001;
                return (
                  <div key={idx} className="grid grid-cols-[minmax(0,1fr)_72px_100px_100px_92px_56px] xl:grid-cols-[minmax(0,1fr)_88px_124px_124px_110px_64px] gap-2 xl:gap-3 items-start px-4 xl:px-6 py-2.5 border-b border-gray-100 hover:bg-gray-50/60 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{l.itemName}</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        <span className="text-gray-600">{isProduct ? "Produto" : "Insumo"}</span>
                        {ref && (ref.controlled === false
                          ? <> · Sem controle de estoque</>
                          : <> · Estoque atual {Number(ref.current_qty ?? 0).toLocaleString("pt-BR")}{ref.unit ? ` ${ref.unit}` : ""}</>)}
                      </p>
                    </div>
                    <input value={l.quantity} onChange={e => updateLine(idx, { quantity: e.target.value })}
                      type="number" min="0" step="0.001" placeholder="Qtd"
                      className={cellInputCls + (num(l.quantity) > 0 ? "" : " border-red-300 bg-red-50/40")} />
                    <div>
                      <input value={l.unit_cost} onChange={e => updateLine(idx, { unit_cost: e.target.value })}
                        type="number" min="0" step="0.01" placeholder="0,00" className={cellInputCls} />
                      <p className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] tabular-nums ${costUp ? "text-red-600" : costDown ? "text-emerald-600" : "text-gray-400"}`}>
                        {costUp && <TrendingUp className="w-3 h-3" />}
                        {costDown && <TrendingDown className="w-3 h-3" />}
                        {prevCost > 0 ? `antes ${fmt(prevCost)}` : "sem custo anterior"}
                      </p>
                    </div>
                    {isProduct ? (
                      <div>
                        <input value={saleStr} onChange={e => p.setSalePrices(prev => ({ ...prev, [l.item_id]: e.target.value }))}
                          type="number" min="0" step="0.01" placeholder="0,00" title="Alterar o preço de venda do produto"
                          className={cellInputCls + (p.salePrices[l.item_id] !== undefined && num(p.salePrices[l.item_id]) !== (ref?.sale_price ?? 0) ? " border-brand-400 bg-brand-50/40" : "")} />
                        <p className={`mt-0.5 text-right text-[11px] font-semibold tabular-nums ${margin === null ? "text-gray-400" : margin < 0 ? "text-red-600" : margin < 20 ? "text-amber-600" : "text-emerald-600"}`}>
                          {margin === null ? "margem —" : `margem ${margin.toFixed(0)}%`}
                        </p>
                      </div>
                    ) : <span className="text-right text-gray-300 text-sm pt-1.5">—</span>}
                    <span className="text-right text-sm font-bold text-gray-900 tabular-nums pt-1.5">{fmt(num(l.quantity) * cost)}</span>
                    <div className="flex items-center justify-end gap-0.5 pt-0.5">
                      {isProduct && (
                        <button type="button" onClick={() => p.onEditProduct(idx, l.item_id)} title="Editar cadastro do produto"
                          className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button type="button" onClick={() => removeLine(idx)} title="Remover item"
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Painel de resumo ── */}
        <div className="w-[260px] xl:w-[320px] flex-shrink-0 flex flex-col bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Resumo</p>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-500">Itens</span>
                <span className="font-semibold text-gray-900 tabular-nums">{lines.length}</span>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">Total da compra</p>
                <p className="text-3xl font-black text-gray-900 tabular-nums tracking-tight mt-0.5">{fmt(total)}</p>
              </div>
            </div>

            <div className="pt-5 border-t border-gray-100">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pagamento</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Forma de pagamento *</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PURCHASE_PAY_METHODS.map(m => (
                      <button key={m.key} type="button"
                        onClick={() => { p.setPayMethod(m.key); p.setPaid(m.paidByDefault); setPayWarn(false); }}
                        className={`px-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${p.payMethod === m.key
                          ? "bg-brand-600 border-brand-600"
                          : payWarn ? "bg-white border-red-300 text-gray-700 hover:bg-red-50" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                        style={p.payMethod === m.key ? { color: "#fff" } : undefined}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {payWarn && <p className="text-xs text-red-600 mt-1">Escolha a forma de pagamento.</p>}
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Situação</label>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg">
                    <button type="button" onClick={() => p.setPaid(true)}
                      className={`py-1.5 rounded-md text-xs font-semibold transition-colors ${p.paid ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                      Já está paga
                    </button>
                    <button type="button" onClick={() => p.setPaid(false)}
                      className={`py-1.5 rounded-md text-xs font-semibold transition-colors ${!p.paid ? "bg-white text-amber-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                      A pagar
                    </button>
                  </div>
                </div>

                {p.paid ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Data do pagamento</label>
                    <input type="date" value={p.paidDate} onChange={e => p.setPaidDate(e.target.value)} className={fieldCls} />
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_72px] gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{inst > 1 ? "1º vencimento" : "Vencimento"}</label>
                      <input type="date" value={p.dueDate} onChange={e => p.setDueDate(e.target.value)} className={fieldCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Parcelas</label>
                      <input type="number" min="1" max="60" value={p.installments} onChange={e => p.setInstallments(e.target.value)} className={fieldCls} />
                    </div>
                  </div>
                )}

                {total > 0 && (
                  <p className={`text-xs rounded-lg px-3 py-2 border ${p.paid ? "text-emerald-800 bg-emerald-50 border-emerald-100" : "text-gray-600 bg-gray-50 border-gray-100"}`}>
                    {p.paid
                      ? <>Vai para Contas a Pagar como <span className="font-semibold">paga</span>{p.payMethod ? ` via ${PURCHASE_PAY_METHODS.find(m => m.key === p.payMethod)?.label}` : ""}.</>
                      : <>{inst}x de <span className="font-semibold text-gray-900">{fmt(total / inst)}</span> pendente{inst > 1 ? "s" : ""} em Contas a Pagar{inst > 1 ? ", uma por mês" : ""}.</>}
                  </p>
                )}
              </div>
            </div>

            {p.error && (
              <div className="flex gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {p.error}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-100">
            <button onClick={() => guardSave(p.onSaveReceive)} disabled={!canSave}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ color: "#fff" }}>
              {p.saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Dar entrada no estoque
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function salePriceOf(l: POLine, ref: ScreenItem | undefined, edits: Record<string, string>) {
  if (l.ref_type !== "product") return "";
  if (edits[l.item_id] !== undefined) return edits[l.item_id];
  return ref?.sale_price ? String(ref.sale_price) : "";
}
