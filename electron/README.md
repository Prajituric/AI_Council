# AI Council — Electron Desktop App

Packages the AI Council web app into a native desktop installer (.exe / .dmg / .deb).
No backend code runs in Electron — everything still goes through your Netlify deployment.

## Quick start

```bash
cd electron
npm install
cp .env.example .env     # set SITE_URL to your Netlify deploy URL
npm start                # run in dev mode
```

## Build installers

```bash
npm run make
# outputs to electron/out/make/:
#   Windows: *.exe (Squirrel installer)
#   macOS:   *.dmg
#   Linux:   *.deb
```

## Configuration

Create `electron/.env`:
```
SITE_URL=https://your-site.netlify.app
```

Leave `SITE_URL` empty to default to `http://localhost:8888` (for local dev with `netlify dev`).

## macOS notarization (public distribution only)

`osxSign` is enabled by default (ad-hoc signing for local use). To distribute via Gatekeeper-approved channels, add the `osxNotarize` block back to `package.json` and export these before running `npm run make`:

```bash
export APPLE_ID=you@example.com
export APPLE_PASSWORD=app-specific-password   # from appleid.apple.com
export APPLE_TEAM_ID=XXXXXXXXXX
```

Then in `package.json` → `config.forge.packagerConfig`, add:
```json
"osxNotarize": {
  "tool": "notarytool",
  "appleId": "${APPLE_ID}",
  "appleIdPassword": "${APPLE_PASSWORD}",
  "teamId": "${APPLE_TEAM_ID}"
}
```

## Icons

Place icon files in `electron/assets/`:
- `icon.png` — 512×512 PNG (used as app icon on Linux and as fallback)
- `icon.icns` — macOS app icon
- `icon.ico`  — Windows app icon
- `tray-icon.png` — 16×16 or 32×32 PNG for system tray

## Desktop Agent integration

The tray menu has **Start Agent / Stop Agent** buttons that launch `desktop-agent/agent.py`
as a background process. No extra setup needed — it reads from `desktop-agent/.env`.

## Features

| Feature | Notes |
|---------|-------|
| System tray icon | Right-click for menu, left-click to show/hide |
| Auto-start on login | Toggle in tray menu |
| Native notifications | Fires when agent tasks complete (via `window.electronAPI.notify`) |
| Global shortcut | `Cmd/Ctrl+Shift+A` shows/hides the window from anywhere |
| Single instance | Second launch focuses the existing window |
| Deep links | `ai-council://open` opens the app |
| Mac behaviour | Closing window hides it; app stays in menu bar |

## Web app detection

The app sets `window.__ELECTRON__ = true` and exposes `window.electronAPI`.
Check `window.electronAPI?.isElectron` in the web app to conditionally show
native-only UI (e.g., the auto-start toggle in Settings).
