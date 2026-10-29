// Painel do programa de impressão (Upabase Impressão, para Windows).
// O programa abre esta página escondida e ela faz o trabalho de estação:
// pega da fila os cupons/pré-contas e as comandas dos setores e manda para
// o programa imprimir direto na impressora escolhida — sem janela nenhuma.
// Fora do programa, a página só explica e oferece o download.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  SECTORS, SECTOR_LABEL, deviceId, ticketsFromRows, ticketsDocument, thermalHtml,
  type ClaimRow, type Sector, type Ticket,
} from "../../lib/kitchen";
import { Printer, CheckCircle2, AlertTriangle, LogOut, Loader2, Download, Eye, EyeOff } from "lucide-react";

export const AGENT_DOWNLOAD_URL = "https://github.com/upabasesuporte-lgtm/upabase-printer/releases/latest/download/Upabase-Impressao-Setup.exe";

interface AgentApi {
  isAgent: true;
  info: () => Promise<{ version: string; url: string }>;
  getPrinters: () => Promise<{ name: string; displayName?: string; isDefault?: boolean }[]>;
  print: (html: string, printer: string, opts?: { paperMm: number }) => Promise<{ ok: boolean; error?: string }>;
  getAutoStart: () => Promise<boolean>;
  setLocalConfig?: (cfg: { enabled: boolean; printer: string; paperMm: number }) => Promise<boolean>;
  setAutoStart: (v: boolean) => Promise<boolean>;
}
const agentApi = (): AgentApi | null => (window as any).upabaseAgent?.isAgent ? (window as any).upabaseAgent as AgentApi : null;

// "" = impressora padrão do Windows; null = não imprime
interface AgentConfig { receipts: string | null; sectors: Record<Sector, string | null>; paperMm: number }
const CONFIG_KEY = "agent_config";
const defaultConfig = (): AgentConfig => ({ receipts: "", sectors: { kitchen: "", bar: "", counter: "" }, paperMm: 80 });
function loadConfig(): AgentConfig {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
    if (v && v.sectors) return { receipts: v.receipts ?? null, sectors: { ...defaultConfig().sectors, ...v.sectors }, paperMm: v.paperMm === 58 ? 58 : 80 };
  } catch { /* sem storage */ }
  return defaultConfig();
}
const agentDeviceId = () => "agent-" + deviceId();

interface LogRow { at: string; text: string; ok: boolean }

export default function PrintAgentPage() {
  const api = agentApi();
  const [session, setSession] = useState<{ email: string; uid: string } | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setSession(data.session ? { email: data.session.user.email ?? "", uid: data.session.user.id } : null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s ? { email: s.user.email ?? "", uid: s.user.id } : null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!api) return <NotInAgent />;
  if (session === undefined) return <Center><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></Center>;
  if (!session) return <AgentLogin />;
  return <AgentPanel api={api} email={session.email} uid={session.uid} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">{children}</div>;
}

function NotInAgent() {
  return (
    <Center>
      <div className="max-w-md bg-white border border-gray-200 rounded-2xl p-6 text-center space-y-3">
        <Printer className="w-10 h-10 mx-auto text-blue-600" />
        <h1 className="text-lg font-bold text-gray-900">Programa de impressão</h1>
        <p className="text-sm text-gray-600">Esta página é usada pelo programa <b>Upabase Impressão</b>, instalado no computador da impressora. Ele imprime cupons e comandas sozinho, sem janela.</p>
        <a href={AGENT_DOWNLOAD_URL} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700" style={{ color: "#fff" }}>
          <Download className="w-4 h-4" /> Baixar para Windows
        </a>
      </div>
    </Center>
  );
}

// Liga o programa à loja com o código de Configurações (sem e-mail/senha)
export async function pairWithCode(raw: string): Promise<string | null> {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) return "O código tem 8 letras e números.";
  const { data, error } = await supabase.functions.invoke("agent-pair", { body: { code } });
  if (error || !data?.token_hash) {
    let msg = "Código inválido ou vencido. Gere outro em Configurações.";
    try { const body = await (error as any)?.context?.json?.(); if (body?.error) msg = body.error; } catch { /* sem detalhe */ }
    return msg;
  }
  const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
  return vErr ? "Não foi possível conectar. Gere outro código e tente de novo." : null;
}

function AgentLogin() {
  const api = agentApi();
  const [mode, setMode] = useState<"code" | "password">("password");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect(c: string) {
    setBusy(true); setErr(null);
    const e = await pairWithCode(c);
    setBusy(false);
    if (e) setErr(e);
  }

  // Código vindo do botão "Conectar este computador" (abre o programa pelo link)
  useEffect(() => {
    const anyApi = api as any;
    anyApi?.takePairCode?.().then((c: string | null) => { if (c) { setCode(c); connect(c); } }).catch(() => {});
    anyApi?.onPairCode?.((c: string) => { setCode(c); connect(c); });
  }, []);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (!error) return;
    const m = error.message.toLowerCase();
    setErr(m.includes("invalid login") ? "E-mail ou senha incorretos. Confira tocando no olho."
      : m.includes("not confirmed") ? "Este e-mail ainda não foi confirmado."
      : m.includes("fetch") || m.includes("network") ? "Sem conexão com a internet."
      : "Não foi possível entrar: " + error.message);
  }

  const field = "w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm";
  return (
    <Center>
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-6 space-y-3">
        <Printer className="w-10 h-10 text-blue-600" />
        <h1 className="text-lg font-bold text-gray-900">Ligar o programa à sua loja</h1>
        {mode === "code" ? (
          <form onSubmit={e => { e.preventDefault(); connect(code); }} className="space-y-3">
            <p className="text-sm text-gray-600">
              No sistema, abra <b>Configurações → Impressão automática</b> e clique em <b>Conectar este computador</b>.
              Ele conecta sozinho. Se pedir, digite aqui o código que aparecer:
            </p>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" maxLength={9} autoFocus
              className={field + " text-center text-xl font-bold tracking-[0.3em] uppercase"} />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length !== 8}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50" style={{ color: "#fff" }}>
              {busy ? "Conectando..." : "Conectar"}
            </button>
            <button type="button" onClick={() => { setMode("password"); setErr(null); }} className="w-full text-xs text-gray-500 underline">
              Prefiro entrar com e-mail e senha
            </button>
          </form>
        ) : (
          <form onSubmit={submitPassword} className="space-y-3">
            <p className="text-sm text-gray-600">Use o mesmo e-mail e senha do sistema. É só uma vez.</p>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail" className={field} />
            <div className="relative">
              <input type={showPass ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha"
                className={field + " pr-10"} />
              <button type="button" onClick={() => setShowPass(v => !v)} title={showPass ? "Esconder senha" : "Mostrar senha"}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button disabled={busy} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50" style={{ color: "#fff" }}>
              {busy ? "Entrando..." : "Entrar"}
            </button>
          </form>
        )}
      </div>
    </Center>
  );
}

function AgentPanel({ api, email, uid }: { api: AgentApi; email: string; uid: string }) {
  const [config, setConfig] = useState<AgentConfig>(loadConfig);
  const configRef = useRef(config);
  const [printers, setPrinters] = useState<{ name: string; label: string; isDefault: boolean }[]>([]);
  const [version, setVersion] = useState("");
  const [log, setLog] = useState<LogRow[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const busy = useRef(false);
  const lastBeat = useRef(0);

  const addLog = (text: string, ok = true) =>
    setLog(l => [{ at: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), text, ok }, ...l].slice(0, 30));

  useEffect(() => {
    api.getPrinters().then(list => setPrinters(list.map(p => ({ name: p.name, label: p.displayName || p.name, isDefault: !!p.isDefault })))).catch(() => {});
    api.info().then(i => setVersion(i.version)).catch(() => {});
  }, []);

  // Cupons enviados direto deste computador (sem internet) usam a mesma impressora/papel
  useEffect(() => {
    api.setLocalConfig?.({ enabled: config.receipts !== null, printer: config.receipts ?? "", paperMm: config.paperMm }).catch(() => {});
  }, [config.receipts, config.paperMm]);

  function updateConfig(c: AgentConfig) {
    setConfig(c); configRef.current = c;
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch { /* sem storage */ }
    lastBeat.current = 0; // avisa a mudança no próximo ciclo
  }

  async function print(html: string, printer: string, what: string) {
    const r = await api.print(html, printer, { paperMm: configRef.current.paperMm }).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    addLog(r.ok ? `${what} → ${printer || "impressora padrão"}` : `Falhou: ${what} (${r.error ?? "erro"})`, r.ok);
  }

  // Ciclo de impressão: na hora, pelo aviso do banco (canal print-<loja>), e a cada 3 s de garantia
  useEffect(() => {
    let again = false;
    async function tick() {
      if (busy.current) { again = true; return; }
      busy.current = true;
      const c = configRef.current;
      const sectors = SECTORS.filter(s => c.sectors[s] !== null);
      try {
        if (Date.now() - lastBeat.current > 10_000) {
          lastBeat.current = Date.now();
          const { error } = await supabase.from("print_stations").upsert(
            { user_id: uid, device_id: agentDeviceId(), sectors, receipts: c.receipts !== null, is_agent: true, agent_version: version || null, seen_at: new Date().toISOString() },
            { onConflict: "user_id,device_id" });
          setOnline(!error);
        }

        if (c.receipts !== null) {
          const { data } = await supabase.rpc("claim_print_queue", { p_device: agentDeviceId() });
          for (const row of (data ?? []) as { kind: string; html: string }[]) {
            await print(row.html, c.receipts, row.kind === "prebill" ? "Pré-conta" : row.kind === "order" ? "Pedido" : "Cupom");
          }
        }

        if (sectors.length) {
          const { data, error } = await supabase.rpc("claim_kitchen_print", { p_sectors: sectors });
          if (!error && data?.length) {
            const rows = data as ClaimRow[];
            // Uma impressora para cupom e comanda: venda de PDV/Cardápio já sai no cupom
            // (um papel por pedido). Mesa não tem cupom ao enviar, então a comanda sai.
            const shared = SECTORS.filter(sec => c.receipts !== null && c.sectors[sec] === c.receipts);
            let skip = new Set<string>();
            if (shared.length) {
              const saleIds = [...new Set(rows.map(r => r.sale_id).filter(Boolean))] as string[];
              const { data: ss } = await supabase.from("sales").select("id, table_id").in("id", saleIds);
              skip = new Set(((ss ?? []) as { id: string; table_id: string | null }[])
                .filter(x => !x.table_id).map(x => x.id.slice(-6).toUpperCase()));
            }
            const tickets = (await ticketsFromRows(rows)).filter(t => !(shared.includes(t.sector) && skip.has(t.orderNum)));
            if (tickets.length) await printTickets(tickets, c, "Comanda");
          }

          const { data: cx } = await supabase.rpc("claim_kitchen_cancellations", { p_sectors: sectors });
          const rows = (cx ?? []) as { sale_id: string | null; origin_label: string | null; sector: Sector; product_name: string | null; quantity: number }[];
          if (rows.length) await printTickets(rows.map(r => ({
            sector: r.sector, origin: r.origin_label ?? "Pedido", orderNum: (r.sale_id ?? "").slice(-6).toUpperCase(),
            lines: [{ quantity: Number(r.quantity), product_name: r.product_name, notes: null }], cancelled: true,
          })), c, "Cancelamento");
        }
      } catch {
        setOnline(false); // sem internet: tenta de novo no próximo ciclo
      } finally {
        busy.current = false;
        // Chegou aviso enquanto imprimia: roda de novo já
        if (again) { again = false; setTimeout(tick, 0); }
      }
    }
    async function printTickets(tickets: Ticket[], c: AgentConfig, what: string) {
      for (const s of SECTORS) {
        const group = tickets.filter(t => t.sector === s);
        // Um ticket por impressão: cada um sai com o tamanho certo e corte próprio
        if (c.sectors[s] !== null) for (const t of group) await print(ticketsDocument([t]), c.sectors[s]!, `${what} ${SECTOR_LABEL[s]}`);
      }
    }
    tick();
    const t = setInterval(tick, 3000);
    const ch = supabase.channel(`print-${uid}`).on("broadcast", { event: "ping" }, () => { tick(); }).subscribe();
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [uid, version]);

  async function testPrint(printer: string) {
    const now = new Date().toLocaleString("pt-BR");
    await print(thermalHtml(`<div style="padding:10px;text-align:center">
      <div style="font-size:18px;font-weight:900">TESTE DE IMPRESSÃO</div>
      <div style="font-size:12px;margin-top:4px">Upabase Impressão ${version}</div>
      <div style="font-size:12px">${now}</div>
      <div style="border-top:1px dashed #000;margin:8px 0"></div>
      <div style="font-size:13px">Se você está lendo isto, está tudo certo!</div>
    </div>`, ""), printer, "Teste");
  }

  async function logout() {
    await supabase.from("print_stations").delete().eq("device_id", agentDeviceId());
    await supabase.auth.signOut();
  }

  const PrinterSelect = ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <select value={value === null ? "__off" : value} onChange={e => onChange(e.target.value === "__off" ? null : e.target.value)}
      className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
      <option value="">Impressora padrão do Windows</option>
      {printers.map(p => <option key={p.name} value={p.name}>{p.label}{p.isDefault ? " (padrão)" : ""}</option>)}
      <option value="__off">Não imprimir neste computador</option>
    </select>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Printer className="w-8 h-8 text-blue-600" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900">Upabase Impressão {version && <span className="text-xs font-normal text-gray-400">v{version}</span>}</h1>
            <p className="text-xs text-gray-500 truncate">Conectado como {email}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${online === false ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
            {online === false ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {online === false ? "Sem conexão" : "Imprimindo automaticamente"}
          </span>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-gray-900">O que sai em cada impressora</p>
            <span className="text-[11px] text-emerald-600 font-semibold">Salva sozinho ao escolher</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-gray-700">Cupons, pré-contas e pedidos</span>
            <PrinterSelect value={config.receipts} onChange={v => updateConfig({ ...config, receipts: v })} />
            {config.receipts !== null && <button onClick={() => testPrint(config.receipts!)} className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 hover:bg-gray-50">Testar</button>}
          </div>
          {SECTORS.map(s => (
            <div key={s} className="flex items-center gap-2">
              <span className="w-40 shrink-0 text-sm text-gray-700">Comandas: {SECTOR_LABEL[s]}</span>
              <PrinterSelect value={config.sectors[s]} onChange={v => updateConfig({ ...config, sectors: { ...config.sectors, [s]: v } })} />
              {config.sectors[s] !== null && <button onClick={() => testPrint(config.sectors[s]!)} className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 hover:bg-gray-50">Testar</button>}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm text-gray-700">Largura do papel</span>
            <select value={config.paperMm} onChange={e => updateConfig({ ...config, paperMm: Number(e.target.value) })}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
              <option value={80}>80 mm (mais comum)</option>
              <option value={58}>58 mm (bobina pequena)</option>
            </select>
          </div>
          <p className="text-xs text-gray-500">Só uma impressora? Deixe tudo em "Impressora padrão do Windows". Pode fechar esta janela: o programa continua imprimindo perto do relógio e liga sozinho junto com o computador.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-gray-900 mb-2">Últimas impressões</p>
          {log.length === 0 ? <p className="text-xs text-gray-500">Nada impresso ainda. Use "Testar" acima.</p> : (
            <div className="space-y-1">
              {log.map((l, i) => (
                <p key={i} className={`text-xs ${l.ok ? "text-gray-700" : "text-red-600 font-semibold"}`}>
                  <span className="text-gray-400 tabular-nums">{l.at}</span> · {l.text}
                </p>
              ))}
            </div>
          )}
        </div>

        <button onClick={logout} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600">
          <LogOut className="w-3.5 h-3.5" /> Desconectar esta loja
        </button>
      </div>
    </div>
  );
}
