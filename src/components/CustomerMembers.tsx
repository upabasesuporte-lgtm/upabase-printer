// Pessoas da conta do cliente (ex.: Leandro marca e a esposa também marca na
// conta dele, mas cada um paga o seu). Pedido sem pessoa = titular.
// Cadastro das pessoas, quanto cada uma deve e a tela "Separar pedidos" para
// marcar de quem é cada pedido já lançado.
import { useEffect, useState } from "react";
import { Users, Plus, Trash2, Pencil, Check, X, RefreshCw, SplitSquareHorizontal } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/fetchAll";
import { computeMemberLedger, debitPerson, HOLDER, type MemberMov } from "../lib/fiado";

export interface CustomerMember { id: string; customer_id: string; name: string; phone: string | null }

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const phoneDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");

// Movimentos do fiado com a pessoa de cada um (venda → sales.member_id)
export async function fetchMemberMovs(customerId: string): Promise<MemberMov[]> {
  const { data, error } = await fetchAll(() => supabase.from("customer_movements")
    .select("id, type, amount, description, created_at, payment_methods, sale_id, member_id, member_holder, sales(member_id)")
    .eq("customer_id", customerId).in("type", ["debit", "payment"])
    .order("created_at", { ascending: true }));
  if (error) throw error;
  return (data ?? []) as unknown as MemberMov[];
}

// Pessoas + quanto cada uma deve hoje
export function useMemberLedger(customerId: string | null | undefined, reloadKey?: unknown) {
  const [members, setMembers] = useState<CustomerMember[]>([]);
  const [bal, setBal] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!customerId) { setMembers([]); setBal({}); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.from("customer_members").select("id, customer_id, name, phone")
        .eq("customer_id", customerId).order("created_at");
      const ms = (data ?? []) as CustomerMember[];
      if (!alive) return;
      setMembers(ms);
      if (ms.length === 0) { setBal({}); return; }
      try {
        const movs = await fetchMemberMovs(customerId);
        if (alive) setBal(computeMemberLedger(movs).bal);
      } catch { /* sem rede: mostra sem os valores */ }
    })();
    return () => { alive = false; };
  }, [customerId, reloadKey, tick]);
  return { members, bal, reload: () => setTick(t => t + 1) };
}

// Botões "Quem pediu? / Quem está pagando?"
export function PersonChips({ holderName, members, value, onChange, allLabel, isLight, bal }: {
  holderName: string; members: CustomerMember[]; value: string | null; onChange: (v: string | null) => void;
  allLabel?: string; isLight: boolean; bal?: Record<string, number>;
}) {
  const opts: { v: string | null; l: string; key: string }[] = [
    ...(allLabel ? [{ v: null, l: allLabel, key: "__all" }] : []),
    { v: HOLDER, l: holderName.split(" ")[0] || holderName, key: HOLDER },
    ...members.map(m => ({ v: m.id, l: m.name, key: m.id })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map(o => {
        const on = value === o.v;
        const owes = o.v && bal ? bal[o.v] ?? 0 : null;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${on ? "bg-brand-600 border-brand-600" : isLight ? "border-gray-300 hover:bg-gray-100" : "border-zinc-700 hover:bg-zinc-800"}`}
            style={on ? { color: "#fff" } : undefined}>
            {o.l}
            {owes != null && owes > 0.009 && <span className="ml-1 font-normal opacity-80">· {fmt(owes)}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface DebitRow { movId: string; saleId: string | null; at: string; amount: number; items: string; person: string }

export function CustomerMembersCard({ customer, card, isLight, members, bal, onChanged }: {
  customer: { id: string; name: string };
  card: { bg: string; border: string; shadow: string }; isLight: boolean;
  members: CustomerMember[]; bal: Record<string, number>; onChanged: () => void;
}) {
  const box = { background: card.bg, border: card.border, boxShadow: card.shadow };
  const field = `px-3 py-2 rounded-xl text-sm border ${isLight ? "bg-white border-gray-200" : "bg-zinc-950 border-zinc-800"}`;
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [rows, setRows] = useState<DebitRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const holderFirst = customer.name.split(" ")[0] || customer.name;
  const nameOf = (p: string) => (p === HOLDER ? `${holderFirst} (titular)` : members.find(m => m.id === p)?.name ?? "—");

  function startAdd() { setAdding(true); setEditId(null); setName(""); setPhone(""); setMsg(null); }
  function startEdit(m: CustomerMember) { setEditId(m.id); setAdding(false); setName(m.name); setPhone(m.phone ?? ""); setMsg(null); }

  async function save() {
    const n = name.trim();
    if (!n) { setMsg("Digite o nome."); return; }
    setBusy(true); setMsg(null);
    const payload = { name: n, phone: phone.trim() || null };
    const { error } = editId
      ? await supabase.from("customer_members").update(payload).eq("id", editId)
      : await supabase.from("customer_members").insert({ ...payload, customer_id: customer.id });
    setBusy(false);
    if (error) { setMsg("Erro: " + error.message); return; }
    setAdding(false); setEditId(null);
    onChanged();
  }

  async function remove(id: string) {
    setBusy(true);
    // Os pedidos dela voltam para o titular (o total da conta não muda)
    const { error } = await supabase.from("customer_members").delete().eq("id", id);
    setBusy(false); setConfirmDel(null);
    if (error) { setMsg("Erro: " + error.message); return; }
    onChanged();
  }

  async function loadRows() {
    setRowsLoading(true);
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data } = await fetchAll(() => supabase.from("customer_movements")
      .select("id, type, amount, description, created_at, sale_id, member_id, member_holder, sales(member_id, sale_items(quantity, products(name)))")
      .eq("customer_id", customer.id).eq("type", "debit").gte("created_at", since)
      .order("created_at", { ascending: false }));
    setRows(((data ?? []) as any[])
      .filter(m => !String(m.description ?? "").toLowerCase().startsWith("saldo usado"))
      .map(m => ({
        movId: m.id, saleId: m.sale_id ?? null, at: m.created_at, amount: Number(m.amount) || 0,
        items: ((m.sales?.sale_items ?? []) as any[]).map(i => `${Number(i.quantity)}x ${i.products?.name ?? "Produto"}`).join(", ") || (m.description ?? ""),
        person: debitPerson(m as MemberMov),
      })));
    setRowsLoading(false);
  }
  useEffect(() => { if (splitOpen) loadRows(); }, [splitOpen, customer.id]);

  async function setPerson(r: DebitRow, person: string) {
    if (person === r.person) return;
    setSavingRow(r.movId);
    const member = person === HOLDER ? null : person;
    const { error } = r.saleId
      ? await supabase.from("sales").update({ member_id: member }).eq("id", r.saleId)
      : await supabase.from("customer_movements").update({ member_id: member }).eq("id", r.movId);
    setSavingRow(null);
    if (error) { setMsg("Erro: " + error.message); return; }
    setRows(rs => rs.map(x => x.movId === r.movId ? { ...x, person } : x));
    onChanged();
  }

  const people = [HOLDER, ...members.map(m => m.id)];
  const dayTxt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <div className="rounded-2xl p-5 space-y-3" style={box}>
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-brand-600" />
        <h2 className="text-sm font-semibold flex-1">Pessoas desta conta</h2>
        {!adding && !editId && (
          <button onClick={startAdd} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            <Plus className="w-3.5 h-3.5" /> Adicionar pessoa
          </button>
        )}
      </div>
      {members.length === 0 && !adding && (
        <p className="text-xs text-zinc-500">Mais alguém marca nesta conta e paga separado (ex.: a esposa)? Adicione a pessoa: no PDV você escolhe quem pediu, e no fim do mês sai a conta de cada um.</p>
      )}

      {members.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {people.map(p => {
            const m = members.find(x => x.id === p);
            const owes = bal[p] ?? 0;
            return (
              <div key={p} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${isLight ? "bg-gray-50" : "bg-zinc-950"}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{nameOf(p)}</p>
                  {m?.phone && <p className="text-[11px] text-zinc-500">{m.phone}</p>}
                </div>
                <span className={`text-sm font-bold tabular-nums ${owes > 0.009 ? "text-amber-500" : "text-emerald-500"}`}>{owes > 0.009 ? fmt(owes) : "em dia"}</span>
                {m && (confirmDel === m.id ? (
                  <span className="flex items-center gap-1 text-[11px]">
                    <button onClick={() => remove(m.id)} disabled={busy} className="px-2 py-1 rounded-lg bg-red-600 font-semibold" style={{ color: "#fff" }}>Remover</button>
                    <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg border border-zinc-700">Não</button>
                  </span>
                ) : (
                  <>
                    <button onClick={() => startEdit(m)} title="Editar" className="p-1.5 text-zinc-500 hover:text-brand-500"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setConfirmDel(m.id)} title="Remover (os pedidos dela voltam para o titular)" className="p-1.5 text-zinc-500 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {(adding || editId) && (
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome (ex.: Ana, esposa)" className={field + " flex-1 min-w-[160px]"} />
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="WhatsApp (opcional)" className={field + " w-44"} />
          <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-50" style={{ color: "#fff" }}>
            <Check className="w-4 h-4" /> Salvar
          </button>
          <button onClick={() => { setAdding(false); setEditId(null); }} className="p-2 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
      )}
      {msg && <p className="text-xs text-red-500">{msg}</p>}

      {members.length > 0 && (
        <>
          <button onClick={() => setSplitOpen(o => !o)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border ${isLight ? "border-gray-300 hover:bg-gray-100" : "border-zinc-700 hover:bg-zinc-800/40"}`}>
            <SplitSquareHorizontal className="w-4 h-4" /> {splitOpen ? "Fechar" : "Separar pedidos já lançados"}
          </button>
          {splitOpen && (
            <div className={`rounded-xl border ${isLight ? "border-gray-200" : "border-zinc-800"}`}>
              <p className="px-3 pt-3 text-[11px] text-zinc-500">Últimos 90 dias. Toque em quem pediu cada um; o total da conta não muda.</p>
              {rowsLoading ? (
                <div className="flex justify-center py-6"><RefreshCw className="w-4 h-4 animate-spin text-brand-600" /></div>
              ) : rows.length === 0 ? (
                <p className="px-3 py-4 text-xs text-zinc-500">Nenhum pedido no fiado nesse período.</p>
              ) : (
                <div className="divide-y divide-zinc-800/40">
                  {rows.map(r => (
                    <div key={r.movId} className="px-3 py-2.5 space-y-1.5">
                      <div className="flex items-start gap-2 text-sm">
                        <span className="font-bold w-11 shrink-0">{dayTxt(r.at)}</span>
                        <span className="flex-1 text-xs text-zinc-500 line-clamp-2">{r.items}</span>
                        <span className="font-bold tabular-nums">{fmt(r.amount)}</span>
                      </div>
                      <div className="flex items-center gap-2 pl-[52px]">
                        <PersonChips holderName={customer.name} members={members} value={r.person} isLight={isLight}
                          onChange={v => v && setPerson(r, v)} />
                        {savingRow === r.movId && <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
