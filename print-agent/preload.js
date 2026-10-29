// Ponte entre o painel do sistema e o programa: só estas funções ficam visíveis
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("upabaseAgent", {
  isAgent: true,
  info: () => ipcRenderer.invoke("agent:info"),
  getPrinters: () => ipcRenderer.invoke("agent:printers"),
  print: (html, printer, opts) => ipcRenderer.invoke("agent:print", String(html), printer ? String(printer) : "", { paperMm: Number(opts && opts.paperMm) || 80 }),
  getAutoStart: () => ipcRenderer.invoke("agent:getAutoStart"),
  setAutoStart: on => ipcRenderer.invoke("agent:setAutoStart", !!on),
  // Impressora/papel dos cupons para a impressão direta (sem internet)
  setLocalConfig: cfg => ipcRenderer.invoke("agent:setLocalConfig", { enabled: !!(cfg && cfg.enabled), printer: String((cfg && cfg.printer) || ""), paperMm: Number(cfg && cfg.paperMm) || 80 }),
  // Código para ligar à loja (vindo do link "Conectar este computador")
  takePairCode: () => ipcRenderer.invoke("agent:takePairCode"),
  onPairCode: cb => { ipcRenderer.removeAllListeners("agent:pair"); ipcRenderer.on("agent:pair", (_e, code) => cb(String(code))); },
});
