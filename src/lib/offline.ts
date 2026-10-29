// Modo sem internet do PDV.
// - Venda feita sem internet vai para uma fila neste computador (localStorage) com
//   o mesmo pacote que iria para o banco (finalize_sale). Quando a internet volta,
//   a fila é enviada sozinha. O id da venda é gerado no aparelho e o banco
//   reconhece repetição, então reenviar nunca duplica a venda.
// - Dados que o PDV precisa para abrir sem internet (produtos, clientes, caixa,
//   plano) ficam guardados da última vez que carregaram com internet.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Erro de rede (sem internet, servidor fora do ar), não erro de regra do banco
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((err as any)?.message ?? err ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timeout|timed out/i.test(msg);
}

// ── Cache simples (última versão que carregou com internet) ──────────────────
export function saveCache<T>(key: string, value: T) {
  try { localStorage.setItem("offline_cache_" + key, JSON.stringify({ at: Date.now(), value })); } catch { /* sem espaço */ }
}
export function readCache<T>(key: string): T | null {
  try { const v = JSON.parse(localStorage.getItem("offline_cache_" + key) ?? "null"); return v ? (v.value as T) : null; } catch { return null; }
}

// ── Fila de vendas guardadas ─────────────────────────────────────────────────
export interface QueuedSale {
  id: string;                 // id da venda (o mesmo que vai para o banco)
  userId: string;             // loja dona da venda: só sobe com o login dela
  orderNum: string;
  total: number;
  createdAt: string;
  payload: unknown;           // parâmetro p do finalize_sale
  status: "pending" | "error";
  error?: string | null;
  attempts: number;
}

const QUEUE_KEY = "offline_sales_queue";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export function readQueue(): QueuedSale[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedSale[]; } catch { return []; }
}
function writeQueue(q: QueuedSale[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  notify();
}

export function enqueueSale(s: Omit<QueuedSale, "status" | "attempts" | "error">) {
  const q = readQueue().filter(x => x.id !== s.id);
  q.push({ ...s, status: "pending", attempts: 0, error: null });
  writeQueue(q); // se não couber, o erro sobe e o PDV avisa que não guardou
}

let syncing = false;
// Envia as vendas guardadas, na ordem em que foram feitas. Para na primeira falha de rede.
export async function syncQueue(): Promise<{ sent: number; failed: number }> {
  if (syncing) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0, failed = 0;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { sent, failed };
    for (const item of readQueue().filter(x => x.status === "pending" && x.userId === session.user.id)) {
      const { data, error } = await supabase.rpc("finalize_sale", { p: item.payload as any });
      if (!error && (data as any)?.sale) {
        writeQueue(readQueue().filter(x => x.id !== item.id));
        sent++;
        continue;
      }
      if (isNetworkError(error)) break; // ainda sem internet: tenta depois
      // Erro de regra (ex.: produto excluído): fica marcado para revisar, não some
      failed++;
      writeQueue(readQueue().map(x => x.id === item.id
        ? { ...x, status: "error", attempts: x.attempts + 1, error: error?.message ?? "Erro ao enviar" } : x));
    }
  } finally { syncing = false; }
  return { sent, failed };
}

export function retryErrored(id?: string) {
  writeQueue(readQueue().map(x => (!id || x.id === id) && x.status === "error" ? { ...x, status: "pending", error: null } : x));
}

// Estado para a tela: se está online e quantas vendas estão guardadas
export function useOfflineQueue() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [queue, setQueue] = useState<QueuedSale[]>(() => readQueue());
  useEffect(() => {
    const refresh = () => setQueue(readQueue());
    listeners.add(refresh);
    const onStorage = (e: StorageEvent) => { if (e.key === QUEUE_KEY) refresh(); };
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      listeners.delete(refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return { online, queue, setOnline };
}
