import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 920,
    height: 640,
    title: 'LOL Skin Importer',
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
