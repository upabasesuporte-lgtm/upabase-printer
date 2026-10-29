// Guarda o sistema neste aparelho para abrir mesmo sem internet.
// - Páginas: busca sempre a versão nova na internet; sem internet, usa a guardada.
// - Arquivos do sistema (/assets, com nome único por versão): guardados na primeira vez.
// - Banco de dados e qualquer outro endereço: nunca passam por aqui.
const CACHE = "upabase-app-v2";

// Na instalação já guarda a tela inicial e os arquivos que ela usa (a primeira
// abertura acontece antes do guardador estar ativo)
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      const res = await fetch("/index.html", { cache: "no-store" });
      if (res.ok) {
        const html = await res.clone().text();
        await c.put("/index.html", res);
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
        await Promise.all(assets.map(a => c.add(a).catch(() => {})));
      }
    } catch { /* sem internet na instalação: guarda na próxima abertura */ }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("upabase-app-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir/recarregar qualquer tela): internet primeiro, guardada se cair
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(CACHE); c.put("/index.html", res.clone()); }
        return res;
      } catch {
        const cached = await caches.match("/index.html");
        return cached || new Response("<h1>Sem internet</h1><p>Abra o sistema uma vez com internet para usar sem conexão.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // Arquivos do sistema: o nome muda a cada versão, então o guardado nunca fica velho
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    })());
  }
});
