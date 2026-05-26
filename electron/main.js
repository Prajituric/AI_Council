/**
 * AI Council — Electron main process
 * ====================================
 * Wraps the existing Netlify-hosted web app in a native desktop window.
 * No backend code runs here — everything still goes through Netlify functions.
 *
 * Features:
 *   - Native window with transparent title bar
 *   - System tray icon with quick-access menu
 *   - Auto-start on login (opt-in via Settings)
 *   - Native notifications when desktop agent tasks complete
 *   - Deep link handler: ai-council:// opens the app
 *   - Offline detection — shows "reconnecting" banner
 *   - Keyboard shortcut: Cmd/Ctrl+Shift+A to show/hide window
 *
 * Config:
 *   Set SITE_URL in a .env file next to this file to override the default.
 *   Default: reads from VITE_SITE_URL or falls back to http://localhost:8888
 */

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  shell, ipcMain, Notification, globalShortcut,
  nativeTheme,
} = require('electron');
const path    = require('path');
const fs      = require('fs');
const { execFile } = require('child_process');

// ── Load .env from electron directory ────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim();
  });
}

const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';
const IS_MAC   = process.platform === 'darwin';
const IS_WIN   = process.platform === 'win32';

// ── State ─────────────────────────────────────────────────────
let mainWindow = null;
let tray       = null;
let agentProc  = null; // optional: local Python agent child process

// ── Helpers ───────────────────────────────────────────────────
function getIconPath(name = 'icon') {
  const exts  = IS_WIN ? ['.ico'] : IS_MAC ? ['.icns', '.png'] : ['.png'];
  const base  = path.join(__dirname, 'assets', name);
  for (const ext of exts) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  // Fallback: generate a simple 32×32 SVG-derived nativeImage
  return null;
}

function makeFallbackIcon(size = 32) {
  // Simple colored circle as tray icon when no asset file is found
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="#6366f1"/>
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
      font-family="system-ui" font-size="${size*0.45}" fill="white">AI</text>
  </svg>`;
  return nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  );
}

// ── Create main window ────────────────────────────────────────
function createWindow() {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  800,
    minHeight: 560,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f13',
    icon: iconPath || undefined,
    webPreferences: {
      preload:            path.join(__dirname, 'preload.js'),
      contextIsolation:   true,
      nodeIntegration:    false,
      spellcheck:         true,
    },
  });

  mainWindow.loadURL(SITE_URL);

  // Open external links in the system browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Inject offline/online detection
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      window.addEventListener('offline',  () => document.title = '⚠ Offline — AI Council');
      window.addEventListener('online',   () => document.title = 'AI Council');
      // Expose isElectron flag so the web app can detect and adjust UI
      window.__ELECTRON__ = true;
    `);
  });

  mainWindow.on('close', (e) => {
    // On macOS, closing the window hides it (standard Mac behaviour)
    if (IS_MAC && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── System tray ───────────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath('tray-icon') || getIconPath();
  const icon     = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : makeFallbackIcon(16);

  tray = new Tray(icon);
  tray.setToolTip('AI Council');
  rebuildTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    } else {
      createWindow();
    }
  });
}

function rebuildTrayMenu(agentRunning = false) {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open AI Council',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      },
    },
    { type: 'separator' },
    {
      label: agentRunning ? '🟢 Desktop Agent: Running' : '⚪ Desktop Agent: Stopped',
      enabled: false,
    },
    {
      label: agentRunning ? 'Stop Agent' : 'Start Agent',
      click: () => agentRunning ? stopAgent() : startAgent(),
    },
    { type: 'separator' },
    {
      label: 'Launch on Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    {
      label: 'Open DevTools',
      click: () => mainWindow?.webContents?.openDevTools(),
      visible: !app.isPackaged,
    },
    { type: 'separator' },
    {
      label: 'Quit AI Council',
      click: () => {
        app.isQuitting = true;
        stopAgent();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// ── Desktop agent lifecycle (optional) ───────────────────────
// If a desktop-agent/.env exists next to the electron folder,
// the tray menu can start/stop the Python agent automatically.
function getAgentDir() {
  // electron/ sits inside ai-council/, agent is at ai-council/desktop-agent/
  return path.join(__dirname, '..', 'desktop-agent');
}

function startAgent() {
  if (agentProc) return;
  const agentDir = getAgentDir();
  const script   = path.join(agentDir, 'agent.py');
  if (!fs.existsSync(script)) {
    showNotification('Agent not found', `${script} does not exist`);
    return;
  }

  // Resolve Python binary: try python3 first (Mac/Linux), fall back to python (Windows)
  const pythonBin = (() => {
    const { execFileSync } = require('child_process');
    for (const bin of ['python3', 'python']) {
      try { execFileSync(bin, ['--version'], { timeout: 2000, stdio: 'pipe' }); return bin; }
      catch { /* try next */ }
    }
    return 'python3'; // last resort — will surface a clear error in stderr
  })();

  agentProc = execFile(pythonBin, [script], {
    cwd: agentDir,
    env: { ...process.env },
  });

  agentProc.stdout?.on('data', d => console.log('[agent]', d.toString().trim()));
  agentProc.stderr?.on('data', d => console.error('[agent]', d.toString().trim()));
  agentProc.on('exit', (code) => {
    agentProc = null;
    rebuildTrayMenu(false);
    if (code && code !== 0) {
      showNotification('Agent stopped', `Exited with code ${code}`);
    }
  });

  rebuildTrayMenu(true);
  showNotification('Desktop Agent started', 'Listening for commands from AI Council');
}

function stopAgent() {
  if (!agentProc) return;
  agentProc.kill('SIGTERM');
  agentProc = null;
  rebuildTrayMenu(false);
}

// ── Native notifications ──────────────────────────────────────
function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: false }).show();
}

// IPC: web app can trigger native notifications
// (e.g., when an agent task completes in the background)
ipcMain.on('notify', (_event, { title, body }) => {
  showNotification(title || 'AI Council', body || '');
});

// IPC: query / set auto-start
ipcMain.handle('get-login-item', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-login-item', (_e, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable });
});

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Register global shortcut to show/hide window from anywhere
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  // On Windows/Linux, quit when all windows are closed.
  // On macOS, keep the app alive in the menu bar.
  if (!IS_MAC) {
    stopAgent();
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  stopAgent();
});

// Handle deep links: ai-council://open
app.on('open-url', (_event, url) => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Single instance lock — focus existing window if app launched again
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
