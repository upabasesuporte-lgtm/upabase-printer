import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ChevronRight, X, Rocket, PartyPopper } from "lucide-react";
import { supabase } from "../lib/supabase";
import { supportWhatsAppUrl } from "../lib/support";

// Guia "Comece por aqui" no Dashboard: cada passo se marca sozinho quando a
// loja faz aquilo de verdade. Só lê contagens; o que fica gravado (ocultar,
// pular passo) mora no navegador. Conta que já fez tudo nunca vê o guia.

interface Step {
  key: string; title: string; hint: string; to: string;
  check: (uid: string) => Promise<boolean>;
  optional?: boolean;
}

const has = async (q: any) => { const { count, error } = await q; return !error && (count ?? 0) > 0; };

const STEPS: Step[] = [
  {
    key: "store", title: "Dados da loja", hint: "Nome, endereço e telefone saem no cupom e no cardápio.", to: "/settings",
    check: async uid => {
      const { data } = await supabase.from("store_settings").select("name, address, phone, cep").eq("user_id", uid).maybeSingle();
      return !!(data?.name && (data.address || data.phone || data.cep));
    },
  },
  {
    key: "products", title: "Cadastrar os produtos", hint: "Suas marmitas, bebidas e adicionais, com preço.", to: "/products",
    check: async () => has(supabase.from("products").select("id", { count: "exact", head: true })),
  },
  {
    key: "cash", title: "Abrir o caixa", hint: "Informe o troco do começo do dia.", to: "/cash",
    check: async () => has(supabase.from("cash_registers").select("id", { count: "exact", head: true })),
  },
  {
    key: "sale", title: "Fazer a primeira venda", hint: "No PDV: escolha os produtos, a forma de pagamento e finalize.", to: "/pdv",
    check: async () => has(supabase.from("sales").select("id", { count: "exact", head: true }).eq("status", "paid")),
  },
  {
    key: "printer", title: "Ligar a impressão de pedidos", hint: "Na Cozinha, escolha o que este aparelho imprime e ligue a impressão automática.", to: "/kitchen",
    check: async () => has(supabase.from("print_stations").select("device_id", { count: "exact", head: true })),
    optional: true,
  },
  {
    key: "menu", title: "Publicar o cardápio digital", hint: "Seu link para o cliente pedir pelo celular.", to: "/digital-menu",
    check: async uid => has(supabase.from("menu_store_settings").select("user_id", { count: "exact", head: true }).eq("user_id", uid)),
    optional: true,
  },
  {
    key: "costs", title: "Ver o custo e o lucro das marmitas", hint: "Diga quais produtos são pratos e lance as compras do dia.", to: "/costs",
    check: async () => has(supabase.from("cost_product_rules").select("id", { count: "exact", head: true })),
    optional: true,
  },
];

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem storage */ } };

export function GettingStarted() {
  const [uid, setUid] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean> | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id;
      if (!id || !alive) return;
      setUid(id);
      if (read(`onboarding_hidden_${id}`) === "1") return;
      setSkipped(JSON.parse(read(`onboarding_skipped_${id}`) ?? "[]"));
      const results = await Promise.all(STEPS.map(s => s.check(id).catch(() => false)));
      if (!alive) return;
      const map = Object.fromEntries(STEPS.map((s, i) => [s.key, results[i]]));
      // Loja que já usa tudo (cliente antigo): o guia nem aparece
      if (STEPS.every(s => map[s.key])) { write(`onboarding_hidden_${id}`, "1"); return; }
      setDone(map);
      setHidden(false);
    })();
    return () => { alive = false; };
  }, []);

  if (hidden || !done || !uid) return null;

  const isDone = (s: Step) => done[s.key] || skipped.includes(s.key);
  const total = STEPS.length, count = STEPS.filter(isDone).length;
  const allDone = count === total;
  const next = STEPS.find(s => !isDone(s));
  const hide = () => { write(`onboarding_hidden_${uid}`, "1"); setHidden(true); };
  const skip = (key: string) => {
    const list = [...skipped, key];
    setSkipped(list); write(`onboarding_skipped_${uid}`, JSON.stringify(list));
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-4 pt-4 pb-3 flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          {allDone ? <PartyPopper className="w-5 h-5" /> : <Rocket className="w-5 h-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900">{allDone ? "Tudo pronto! Sua loja está configurada." : "Comece por aqui"}</p>
          <p className="text-xs text-gray-500">
            {allDone ? "Se precisar de ajuda, é só chamar no WhatsApp." : `${count} de ${total} passos feitos. Cada passo se marca sozinho quando você fizer.`}
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(count / total) * 100}%` }} />
          </div>
        </div>
        <button onClick={hide} title="Ocultar guia" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      {!allDone && (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {STEPS.map(s => {
            const ok = isDone(s), isNext = next?.key === s.key;
            return (
              <div key={s.key} className={`flex items-center gap-3 px-4 py-2.5 ${isNext ? "bg-brand-50/50" : ""}`}>
                {ok ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <Circle className="w-5 h-5 text-gray-300 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${ok ? "text-gray-400 line-through" : "text-gray-900"}`}>
                    {s.title}{s.optional && !ok && <span className="ml-1.5 text-[10px] font-semibold text-gray-400 no-underline">opcional</span>}
                  </p>
                  {!ok && <p className="text-xs text-gray-500">{s.hint}</p>}
                </div>
                {!ok && s.optional && (
                  <button onClick={() => skip(s.key)} className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0">pular</button>
                )}
                {!ok && (
                  <Link to={s.to} className={`inline-flex items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 ${isNext ? "bg-brand-600 hover:bg-brand-700" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                    style={isNext ? { color: "#fff" } : undefined}>
                    {isNext ? "Fazer agora" : "Abrir"} <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            );
          })}
          <div className="px-4 py-2.5 text-xs text-gray-500">
            Travou em algum passo?{" "}
            <a href={supportWhatsAppUrl("Olá! Estou configurando o sistema e preciso de ajuda.")} target="_blank" rel="noopener noreferrer"
              className="font-semibold text-emerald-600 hover:underline">Chame o suporte no WhatsApp</a>
          </div>
        </div>
      )}
    </div>
  );
}
