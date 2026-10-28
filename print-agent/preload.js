// Ponte entre o painel do sistema e o programa: só estas funções ficam visíveis
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("upabaseAgent", {
  isAgent: true,
  info: () => ipcRenderer.invoke("agent:info"),
  getPrinters: () => ipcRenderer.invoke("agent:printers"),
  print: (html, printer) => ipcRenderer.invoke("agent:print", String(html), printer ? String(printer) : ""),
  getAutoStart: () => ipcRenderer.invoke("agent:getAutoStart"),
  setAutoStart: on => ipcRenderer.invoke("agent:setAutoStart", !!on),
});
