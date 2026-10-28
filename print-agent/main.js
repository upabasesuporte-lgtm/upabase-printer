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

// No Windows a leitura precisa dos mesmos args da gravação, senão sempre volta "desligado"
const AUTOSTART_ARGS = ["--hidden"];
const isAutoStart = () => app.getLoginItemSettings({ args: AUTOSTART_ARGS }).openAtLogin;
function setAutoStart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: AUTOSTART_ARGS });
  return isAutoStart();
}

// ── Impressão silenciosa ──────────────────────────────────────────────────────
// Uma de cada vez, numa janela invisível que nunca aparece (reaproveitada: imprime mais rápido).
let printWin = null;
// Largura do papel vem do painel (80 ou 58 mm); padrão 80 mm
const DEFAULT_PAPER_MM = 80;
const mmToPx = mm => Math.round(mm / 25.4 * 96);
const PX_TO_MICRONS = 25400 / 96;
function getPrintWindow() {
  if (!printWin || printWin.isDestroyed()) {
    // Janela na largura do rolo: o cupom é montado já no tamanho do papel
    printWin = new BrowserWindow({ show: false, width: mmToPx(DEFAULT_PAPER_MM), height: 200, useContentSize: true, webPreferences: { sandbox: true } });
    printWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    printWin.webContents.on("will-navigate", e => e.preventDefault());
  }
  return printWin;
}
let printChain = Promise.resolve();
let printing = 0;        // impressões em andamento
let lastPrintAt = 0;     // última impressão (para atualizar só com a impressora parada)
function printHtml(html, deviceName, paperMm) {
  printing++;
  lastPrintAt = Date.now();
  const widthMm = Number(paperMm) >= 40 && Number(paperMm) <= 120 ? Math.round(Number(paperMm)) : DEFAULT_PAPER_MM;
  const job = printChain.then(() => new Promise(resolve => {
    const file = path.join(os.tmpdir(), `upabase-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    try { fs.writeFileSync(file, html, "utf8"); } catch (e) { resolve({ ok: false, error: "Não foi possível preparar a impressão" }); return; }
    const pw = getPrintWindow();
    pw.setContentSize(mmToPx(widthMm), 200);
    const wc = pw.webContents;
    let finished = false;
    const cleanup = () => { wc.removeListener("did-finish-load", onLoad); wc.removeListener("did-fail-load", onFail); };
    const done = r => { if (finished) return; finished = true; clearTimeout(timer); cleanup(); fs.unlink(file, () => {}); resolve(r); };
    // Travou: descarta a janela e a próxima impressão cria outra
    const timer = setTimeout(() => { try { pw.destroy(); } catch { /* já fechada */ } done({ ok: false, error: "Tempo esgotado" }); }, 30_000);
    const onLoad = async () => {
      cleanup();
      // Página do tamanho exato do conteúdo: 80 mm de largura e a altura do cupom
      // (sem isso o Windows usa uma página larga, o cupom centralizado cai fora do
      // rolo e sai papel em branco)
      let heightPx = 1200;
      try { heightPx = await wc.executeJavaScript("Math.ceil(document.body.getBoundingClientRect().bottom + 12)"); } catch { /* usa o padrão */ }
      const height = Math.max(40000, Math.ceil(Number(heightPx) * PX_TO_MICRONS) + 6000);
      wc.print({
        silent: true, printBackground: true, deviceName: deviceName || "",
        margins: { marginType: "none" },
        pageSize: { width: widthMm * 1000, height },
      }, (ok, reason) => done(ok ? { ok: true } : { ok: false, error: reason || "Falha na impressora" }));
    };
    const onFail = (_e, code) => { if (code !== -3) done({ ok: false, error: "Documento inválido" }); };
    wc.on("did-finish-load", onLoad);
    wc.on("did-fail-load", onFail);
    pw.loadFile(file);
  }));
  printChain = job.catch(() => {});
  job.finally(() => { printing--; lastPrintAt = Date.now(); }).catch(() => {});
  return job;
}

// Só o painel do sistema pode pedir impressão
const fromPanel = e => {
  try { return win && e.sender === win.webContents && new URL(e.senderFrame.url).origin === appOrigin(); } catch { return false; }
};

ipcMain.handle("agent:info", e => fromPanel(e) ? { version: app.getVersion(), url: readConfig().url } : null);
ipcMain.handle("agent:printers", async e => fromPanel(e) ? (await win.webContents.getPrintersAsync()).map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault })) : []);
ipcMain.handle("agent:print", (e, html, printer, opts) => {
  if (!fromPanel(e)) return { ok: false, error: "Não autorizado" };
  if (typeof html !== "string" || html.length > 500_000) return { ok: false, error: "Documento inválido" };
  return printHtml(html, typeof printer === "string" ? printer : "", opts && opts.paperMm);
});
// Código recebido pelo link antes do painel carregar
ipcMain.handle("agent:takePairCode", e => { if (!fromPanel(e)) return null; const c = pendingCode; pendingCode = null; return c; });
ipcMain.handle("agent:getAutoStart", e => fromPanel(e) ? isAutoStart() : false);
ipcMain.handle("agent:setAutoStart", (e, on) => fromPanel(e) ? setAutoStart(on) : false);

// ── Início ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const firstRun = !fs.existsSync(configFile());
  if (firstRun) writeConfig({ url: DEFAULT_URL });
  // Programa de impressão: sempre liga junto com o computador
  if (app.isPackaged) setAutoStart(true);
  // Abre pelo link das Configurações (registra o endereço upabase-impressao://)
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  pendingCode = codeFromArgs(process.argv);
  // Reaberto por uma atualização automática: volta escondido, como estava
  const cfg = readConfig();
  const afterUpdate = !!cfg.hiddenAfterUpdate;
  if (afterUpdate) { delete cfg.hiddenAfterUpdate; writeConfig(cfg); }
  createTray();
  createWindow((process.argv.includes("--hidden") || afterUpdate) && !pendingCode);

  // Atualização automática pelo GitHub (só no programa instalado)
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      // Versão nova baixada: instala sozinha assim que a impressora estiver parada
      // (20 s sem imprimir) e o programa reabre escondido — ninguém precisa fazer nada
      autoUpdater.on("update-downloaded", () => {
        const tryInstall = () => {
          if (printing || Date.now() - lastPrintAt < 20_000) { setTimeout(tryInstall, 10_000); return; }
          writeConfig({ ...readConfig(), hiddenAfterUpdate: true });
          quitting = true;
          autoUpdater.quitAndInstall(true, true);
        };
        setTimeout(tryInstall, 5_000);
      });
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      check();
      setInterval(check, 60 * 60 * 1000); // a cada hora
    } catch { /* sem atualizador */ }
  }
});

// Não fecha ao esconder a janela: continua na bandeja
app.on("window-all-closed", () => { /* fica na bandeja */ });
app.on("before-quit", () => { quitting = true; });
