// Upabase Impressão — programa de impressão automática para Windows.
// Abre o painel /agente-impressao do sistema numa janela (que pode ficar
// escondida perto do relógio) e imprime direto na impressora, sem janela de
// imprimir (como imagem, pelo Windows). Toda a lógica de fila fica no sistema;
// aqui só se imprime.
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
// O cupom vira uma imagem nítida (2x) e é impresso pelo caminho tradicional do
// Windows (GDI, o mesmo do Bloco de Notas). A impressão direta do Chromium saía
// em branco em térmicas como a Bematech MP-4000 TH; por imagem funciona em todas.
// Largura do papel vem do painel (80 ou 58 mm); padrão 80 mm.
const DEFAULT_PAPER_MM = 80;
const mmToPx = mm => Math.round(mm / 25.4 * 96);
// Pontos que a cabeça térmica imprime (203 dpi): 576 no rolo de 80 mm, 384 no de 58 mm.
// O cupom é desenhado já nessa resolução e em preto puro — letra firme, sem falhas.
const printDots = mm => mm >= 76 ? 576 : mm >= 56 ? 384 : Math.round(mm * 8 * 0.9);

// Converte para preto e branco puro (térmica não tem cinza: cinza vira pontilhado falhado)
function toBlackWhite(image, widthDots) {
  const { nativeImage } = require("electron");
  let img = image;
  if (img.getSize().width !== widthDots) img = img.resize({ width: widthDots, quality: "best" });
  const { width, height } = img.getSize();
  const buf = Buffer.from(img.toBitmap()); // BGRA
  for (let i = 0; i < buf.length; i += 4) {
    const lum = 0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2];
    const v = lum < 160 ? 0 : 255;
    buf[i] = buf[i + 1] = buf[i + 2] = v; buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width, height }).toPNG();
}

const PRINT_PS1 = `param([string]$Image, [string]$Printer, [int]$WidthMm = 80)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Image)
try {
  $pd = New-Object System.Drawing.Printing.PrintDocument
  if ($Printer) { $pd.PrinterSettings.PrinterName = $Printer }
  if (-not $pd.PrinterSettings.IsValid) { Write-Output "ERRO: impressora nao encontrada"; exit 2 }
  $pd.DocumentName = "Upabase"
  $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $w = [int]($WidthMm / 25.4 * 100)
  $h = [int]($w * $img.Height / $img.Width) + 20
  $pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Upabase", $w, $h)
  $pd.add_PrintPage({
    param($sender, $e)
    $dw = [single]$e.PageSettings.PrintableArea.Width
    $dh = [single]($dw * $img.Height / $img.Width)
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $e.Graphics.DrawImage($img, [single]0, [single]0, $dw, $dh)
    $e.HasMorePages = $false
  })
  $pd.Print()
  Write-Output "ok"
} catch { Write-Output ("ERRO: " + $_.Exception.Message); exit 1 }
finally { $img.Dispose() }
`;
const ps1File = () => path.join(app.getPath("userData"), "imprimir-imagem.ps1");
function ensurePs1() {
  try { if (!fs.existsSync(ps1File()) || fs.readFileSync(ps1File(), "utf8") !== PRINT_PS1) fs.writeFileSync(ps1File(), PRINT_PS1, "utf8"); } catch { /* tenta na hora de imprimir */ }
}

// Manda a imagem para a impressora pelo Windows
function printImage(pngFile, deviceName, widthMm) {
  return new Promise(resolve => {
    ensurePs1();
    const { execFile } = require("child_process");
    execFile("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1File(), "-Image", pngFile, "-Printer", deviceName || "", "-WidthMm", String(widthMm)],
      { windowsHide: true, timeout: 60_000 },
      (err, stdout) => {
        const out = String(stdout || "").trim();
        if (!err && out.endsWith("ok")) resolve({ ok: true });
        else resolve({ ok: false, error: (out.replace(/^ERRO:\s*/, "") || (err && err.message) || "Falha na impressora").slice(0, 200) });
      });
  });
}

// Janela invisível reaproveitada para montar o cupom no tamanho do papel
let printWin = null;
function getPrintWindow() {
  if (!printWin || printWin.isDestroyed()) {
    printWin = new BrowserWindow({ show: false, width: printDots(DEFAULT_PAPER_MM), height: 200, useContentSize: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
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
  const job = printChain.then(async () => {
    const stamp = Date.now() + "-" + Math.random().toString(36).slice(2);
    const htmlFile = path.join(os.tmpdir(), "upabase-print-" + stamp + ".html");
    const pngFile = path.join(os.tmpdir(), "upabase-print-" + stamp + ".png");
    const cleanup = () => { fs.unlink(htmlFile, () => {}); fs.unlink(pngFile, () => {}); };
    try {
      fs.writeFileSync(htmlFile, html, "utf8");
      const pw = getPrintWindow();
      const wc = pw.webContents;
      const dots = printDots(widthMm);
      // Layout pensado na largura do rolo em px de tela, ampliado até os pontos da impressora
      const zoom = dots / mmToPx(widthMm);
      pw.setContentSize(dots, 200);
      await Promise.race([
        pw.loadFile(htmlFile),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Tempo esgotado ao montar o cupom")), 20_000)),
      ]);
      wc.setZoomFactor(zoom);
      // Como no papel: sem o botão "Imprimir" da tela e sem a margem de visualização
      await wc.insertCSS("button{display:none!important} body{max-width:none!important}");
      const h = await wc.executeJavaScript("Math.ceil(document.body.getBoundingClientRect().bottom + 8)");
      pw.setContentSize(dots, Math.max(60, Math.ceil(Number(h) * zoom)));
      await new Promise(r => setTimeout(r, 120));
      const img = await wc.capturePage();
      fs.writeFileSync(pngFile, toBlackWhite(img, dots));
      const r = await printImage(pngFile, deviceName, widthMm);
      cleanup();
      return r;
    } catch (e) {
      cleanup();
      try { printWin && printWin.destroy(); } catch { /* já fechada */ }
      printWin = null;
      return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
    }
  });
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
