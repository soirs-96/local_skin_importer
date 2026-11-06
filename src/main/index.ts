import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc';
import { installMainConsoleBridge } from './devLogger';
import { registerIconProtocol, registerIconScheme } from './match/iconAssets';

// 自定义协议要先登记成特权协议,这一步必须发生在 app ready 之前
registerIconScheme();

// 尽早接管 console —— 启动阶段的报错也得进日志。
installMainConsoleBridge();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 920,
    height: 640,
    title: 'LOL 皮肤助手',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox is Electron's default; the renderer here uses only the
      // small `window.api` surface exposed by the preload bridge, so we
      // don't need Node integration or a non-sandboxed renderer process.
      sandbox: true
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Navigation hardening: deny window.open and block top-level navigations
  // to anything other than the dev server origin or local file URLs.
  // This prevents a malicious link/redirect from stranding the user
  // outside the Electron shell.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.origin !== 'http://localhost:5173' && parsed.origin !== 'file://') {
      event.preventDefault();
    }
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // 启动信息也进日志:开发日志控制台开着的时候,一眼就能看出
  // 对方手上是哪个版本、是不是打包版 —— 顺带保证它永远不是空的。
  console.info(
    '[app] 启动 · 版本 ' +
      app.getVersion() +
      ' · Electron ' +
      (process.versions.electron ?? 'unknown') +
      ' · Node ' +
      process.versions.node +
      ' · ' +
      process.platform +
      '/' +
      process.arch +
      (app.isPackaged ? ' · 已打包' : ' · 开发模式')
  );
  registerIconProtocol();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
