// Upabase Impressão — programa de impressão automática para Windows.
// Abre o painel /agente-impressao do sistema numa janela (que pode ficar
// escondida perto do relógio) e imprime direto na impressora, sem janela de
// imprimir. Toda a lógica de fila fica no sistema; aqui só se imprime.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DEFAULT_URL = "https://upabase-printer.vercel.app";
const PANEL_PATH = "/agente-impressao";
const ICON = path.join(__dirname, "icon.png");
const PROTOCOL = "upabase-impressao"; // link "Conectar este computador" das Configurações

let win = null;
let tray = null;
let quitting = false;
let pendingCode = null;

// upabase-impressao://conectar?codigo=XXXXXXXX
function codeFromArgs(argv) {
  const link = (argv || []).find(a => typeof a === "string" && a.startsWith(PROTOCOL + "://"));
  if (!link) return null;
  try { const c = new URL(link).searchParams.get("codigo"); return c ? c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) : null; } catch { return null; }
}
function deliverCode(code) {
  if (!code) return;
  pendingCode = code;
  if (win && !win.isDestroyed()) { win.webContents.send("agent:pair", code); showWindow(); }
}

// ── Configuração (endereço do sistema) ────────────────────────────────────────
const configFile = () => path.join(app.getPath("userData"), "config.json");
function readConfig() {
  try { return { url: DEFAULT_URL, ...JSON.parse(fs.readFileSync(configFile(), "utf8")) }; } catch { return { url: DEFAULT_URL }; }
}
function writeConfig(c) {
  try { fs.writeFileSync(configFile(), JSON.stringify(c, null, 2)); } catch { /* sem disco */ }
}
const appOrigin = () => { try { return new URL(readConfig().url).origin; } catch { return DEFAULT_URL; } };

// Identificação só com letras sem acento: o "ã" de "Impressão" no User-Agent
// fazia o login falhar no servidor (invalid byte sequence for encoding UTF8)
app.userAgentFallback = app.userAgentFallback.replace(/Upabase Impress\S*/g, "UpabaseImpressao/" + app.getVersion()).replace(/[^\x20-\x7E]/g, "");

// ── Uma cópia só ──────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => { showWindow(); deliverCode(codeFromArgs(argv)); });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(startHidden) {
  win = new BrowserWindow({
    width: 760,
    height: 720,
    show: !startHidden,
    title: "Upabase Impressão",
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // continua imprimindo com a janela escondida
    },
  });
  win.loadURL(appOrigin() + PANEL_PATH);

  // Fica só no sistema: links de fora abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    try { if (new URL(url).origin !== appOrigin()) { e.preventDefault(); if (/^https:\/\//i.test(url)) shell.openExternal(url); } }
    catch { e.preventDefault(); }
  });
  // Sem internet ao ligar o computador: tenta de novo
  win.webContents.on("did-fail-load", (_e, code) => {
    if (code === -3) return; // navegação cancelada
    setTimeout(() => { if (win && !win.isDestroyed()) win.loadURL(appOrigin() + PANEL_PATH); }, 10_000);
  });

  // Fechar a janela só esconde: continua imprimindo
  win.on("close", e => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Upabase Impressão — imprimindo automaticamente");
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir painel", click: showWindow },
    { type: "separator" },
    {
      label: "Ligar junto com o computador", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: item => { setAutoStart(item.checked); rebuild(); },
    },
    {
      label: "Endereço do sistema...", click: async () => {
        const cur = readConfig().url;
        const r = await dialog.showMessageBox({
          type: "info", title: "Endereço do sistema",
          message: `O programa usa: ${cur}\n\nPara trocar, edite o arquivo de configuração e reinicie o programa.`,
          buttons: ["OK", "Abrir pasta da configuração"],
        });
        if (r.response === 1) { writeConfig(readConfig()); shell.showItemInFolder(configFile()); }
      },
    },
    { type: "separator" },
    { label: "Sair (para de imprimir)", click: () => { quitting = true; app.quit(); } },
  ]));
  rebuild();
  tray.on("double-click", showWindow);
}

function setAutoStart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ["--hidden"] });
  return app.getLoginItemSettings().openAtLogin;
}

// ── Impressão silenciosa ──────────────────────────────────────────────────────
// Uma de cada vez, numa janela invisível que nunca aparece.
let printChain = Promise.resolve();
function printHtml(html, deviceName) {
  const job = printChain.then(() => new Promise(resolve => {
    const file = path.join(os.tmpdir(), `upabase-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    try { fs.writeFileSync(file, html, "utf8"); } catch (e) { resolve({ ok: false, error: "Não foi possível preparar a impressão" }); return; }
    const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    const done = r => { try { pw.destroy(); } catch { /* já fechada */ } fs.unlink(file, () => {}); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: "Tempo esgotado" }), 30_000);
    pw.webContents.once("did-finish-load", () => {
      pw.webContents.print({
        silent: true, printBackground: true, deviceName: deviceName || "",
        margins: { marginType: "none" },
      }, (ok, reason) => { clearTimeout(timer); done(ok ? { ok: true } : { ok: false, error: reason || "Falha na impressora" }); });
    });
    pw.webContents.once("did-fail-load", () => { clearTimeout(timer); done({ ok: false, error: "Documento inválido" }); });
    pw.loadFile(file);
  }));
  printChain = job.catch(() => {});
  return job;
}

// Só o painel do sistema pode pedir impressão
const fromPanel = e => {
  try { return win && e.sender === win.webContents && new URL(e.senderFrame.url).origin === appOrigin(); } catch { return false; }
};

ipcMain.handle("agent:info", e => fromPanel(e) ? { version: app.getVersion(), url: readConfig().url } : null);
ipcMain.handle("agent:printers", async e => fromPanel(e) ? (await win.webContents.getPrintersAsync()).map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault })) : []);
ipcMain.handle("agent:print", (e, html, printer) => {
  if (!fromPanel(e)) return { ok: false, error: "Não autorizado" };
  if (typeof html !== "string" || html.length > 500_000) return { ok: false, error: "Documento inválido" };
  return printHtml(html, typeof printer === "string" ? printer : "");
});
// Código recebido pelo link antes do painel carregar
ipcMain.handle("agent:takePairCode", e => { if (!fromPanel(e)) return null; const c = pendingCode; pendingCode = null; return c; });
ipcMain.handle("agent:getAutoStart", e => fromPanel(e) ? app.getLoginItemSettings().openAtLogin : false);
ipcMain.handle("agent:setAutoStart", (e, on) => fromPanel(e) ? setAutoStart(on) : false);

// ── Início ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const firstRun = !fs.existsSync(configFile());
  if (firstRun) { writeConfig({ url: DEFAULT_URL }); setAutoStart(true); }
  // Abre pelo link das Configurações (registra o endereço upabase-impressao://)
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  pendingCode = codeFromArgs(process.argv);
  createTray();
  createWindow(process.argv.includes("--hidden") && !pendingCode);

  // Atualização automática pelo GitHub (só no programa instalado)
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      check();
      setInterval(check, 6 * 60 * 60 * 1000);
    } catch { /* sem atualizador */ }
  }
});

// Não fecha ao esconder a janela: continua na bandeja
app.on("window-all-closed", () => { /* fica na bandeja */ });
app.on("before-quit", () => { quitting = true; });
