// O Supabase devolve no máximo 1000 linhas por consulta — sem paginar, totais de
// períodos longos (ano, ranking, histórico) saíam cortados sem aviso.
// fetchAll busca página por página até acabar e devolve o mesmo { data, error }.
// `build` deve criar a consulta do zero a cada chamada (cada página é uma nova
// requisição); "id" entra como desempate da ordem para nenhuma linha repetir/sumir.

const PAGE = 1000;

export async function fetchAll<T = any>(build: () => any): Promise<{ data: T[]; error: any }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return { data: out, error: null };
  }
}

// Para filtros `.in(coluna, ids)` com muitos ids: divide em lotes (URL não
// estoura) e pagina cada lote. Mantém a ordem dos lotes.
export async function fetchAllIn<T = any>(
  ids: string[],
  build: (chunk: string[]) => any,
  chunkSize = 100,
): Promise<{ data: T[]; error: any }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(c => fetchAll<T>(() => build(c))));
  const out: T[] = [];
  for (const r of results) {
    if (r.error) return { data: out, error: r.error };
    out.push(...r.data);
  }
  return { data: out, error: null };
}
