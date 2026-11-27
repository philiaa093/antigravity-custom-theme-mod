---
name: antigravity-custom-theme
description: Use when the user wants to design, customize, install, update, or troubleshoot an Antigravity IDE or Manager visual theme from a wallpaper image, color palette, aesthetic mood, or preset.
---

# Antigravity Custom Theme Skill

Creates and applies custom glassmorphic themes (wallpapers, cohesive palettes, custom composer ornaments, pre-baked glass panels, and split-browser-safe overlays) to Antigravity without modifying application binaries.

## Repository Layout

- `themes/themes.json` — Theme presets (colors, wallpaper path, SVG ornaments, glass alpha/saturation defaults).
- `themes/assets/` — Raster wallpapers (`.webp`/`.png`/`.jpg`) and SVG stickers/corner flourishes.
- `engine/core.js` — Standalone DOM + CSS injection engine (Zero Live Blur, L-glass layout, split-browser hole cutout, composer pill contrast, live theme settings modal).
- `scripts/build_payload.py` — Compiles `themes/themes.json` + `engine/core.js` into gitignored `dist/theme_payload.js` (auto-downscales >2560px rasters to WebP when Pillow is installed).
- `daemon/theme_daemon.js` — Cross-platform Node.js (>= 22) CDP daemon watching `DevToolsActivePort` and `dist/theme_payload.js`.
- `scripts/install-win.ps1`, `scripts/install-unix.sh`, `scripts/uninstall.js`, `scripts/restore-theme.ps1`, `scripts/verify_cdp.js` — OS setup, update recovery, removal, and live CDP verification.
- `references/theme-schema.md` — Exact `themes.json` schema, contrast rules, and Antigravity selector notes.

## Workflow

1. **Gather aesthetic & inspect image**
   - Ask briefly for any missing intent only if ambiguous (mood: cozy warm, cyberpunk neon, anime cel, cosmic gold, minimalist pure-CSS gradient, etc.).
   - If the user provides an image with an unwanted corner watermark/signature, clean/crop it cleanly before staging.
2. **Design cohesive tokens (Dark or Light Glass)**
   - Read `references/theme-schema.md` for every `themes.json` key.
   - Extract dominant & accent colors from the image to populate `primary`, `secondary`, `overlayRgb`, `bg`, `frameBg`, `sidebarBg`, `aiCardBg`, `headerBg`, `inputCardBg`, and `modalBg` with crisp readable contrast.
   - For bright/daytime/pastel wallpapers, set `"isLight": true` with high-contrast dark ink (`uiTextColor`, `pillTextColor`) and light frosted `aiCardBg`/`overlayRgb`.
   - When the user wants matching chat avatars (or provides character/themed artwork), also craft or crop square `userAvatar` & `agentAvatar` assets (PNG/WebP or bespoke SVG emblems) and custom `sticker`/`cornerSvg` flourishes.
3. **Stage assets & edit `themes/themes.json`**
   - Save wallpaper under `themes/assets/<slug>.webp` (or `.png`), optional SVG stickers/corners, and optional `userAvatar` / `agentAvatar` files under `themes/assets/`.
    - Add a new entry in `themes/themes.json` referencing `"assets/<filename>"` (keep existing sample presets unless asked to remove them).
    - For private artwork, use an ignored `themes/themes.local.json` copy instead of modifying the shared catalog. Keep private assets out of Git; see `ARCHITECTURE.md`.
   - Never hardcode personal OS paths (`C:\Users\...`, `/Users/...`, `/home/...`) in JSON, JS, or scripts.
4. **Compile & syntax-check payload**
   - Run `python scripts/build_payload.py` (or `python3 scripts/build_payload.py`).
   - Run `node --check dist/theme_payload.js` to ensure zero syntax issues.
5. **Run / hot-reload daemon**
   - **Windows:** `powershell -ExecutionPolicy Bypass -File scripts/install-win.ps1`
   - **macOS / Linux:** `bash scripts/install-unix.sh` (or `--foreground` for interactive testing)
   - If the daemon is already running, rebuilding `dist/theme_payload.js` triggers automatic hot-reload via `fs.watch`.
6. **Verify live via CDP**
   - Run `node scripts/verify_cdp.js` while Antigravity is open.
   - Confirm `themeActive: true`, `hasLiveBlurRule: false`, valid `.agy-shell` background, and readable composer pills before reporting success.

## Non-Negotiable Architecture Rules

- **Zero Live Blur:** Never add CSS `backdrop-filter: blur(...)` to `.agy-shell`, `.agy-chat-frame`, or scrollable panes — Electron scrolling drops frames badly under live blur. `engine/core.js` pre-bakes blurred canvas textures (`syncPrebakedGlass`) instead.
- **Data-Only Theme Authoring:** Add themes in `themes/themes.json` + `themes/assets/`. Leave `engine/core.js` untouched unless Antigravity changes its upstream DOM selectors.
- **Split Browser Cutout:** Never paint opaque overlays over the right-side browser pane; keep `data-has-browser-hole` + `evenodd` `clip-path` behavior intact so embedded Chromium views stay sharp.
- **No Personal Data Leakage:** Check modified files for absolute user paths or personal `theme_config.json` state before committing.

## Troubleshooting: Theme Disappeared After Antigravity Update

Antigravity v2.33.0+ no longer opens `DevToolsActivePort` by default when launched without `--remote-debugging-port=0`, and its auto-updater relaunches `Antigravity.exe --updated` directly (which can also reset shortcuts).

- **Windows:**
  1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-theme.ps1`.
  2. The recovery command starts a closed Antigravity with `--remote-debugging-address=127.0.0.1 --remote-debugging-port=0`, starts the daemon and tray, and waits for the saved theme to be confirmed by a renderer. Add `-OpenDashboard` when the Dashboard should open after confirmation.
  3. If it reports that an existing instance has no usable debug port, **Quit Antigravity completely** using its System Tray **Quit/Exit** action and run the command again. The recovery command never forcibly closes a working app, runs the installer, changes shortcuts, or modifies application files.
  4. If a custom Desktop or Taskbar launcher was replaced by the update, inspect the change and then run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-autostart.ps1` to restore the launcher integration. Do not use this step when only the saved theme needs recovery.
- **macOS / Linux:**
  - Launch Antigravity with `--remote-debugging-port=0` (e.g., `open -a Antigravity --args --remote-debugging-port=0` on macOS, or add `--remote-debugging-port=0` to the `Exec=` line in your `.desktop` launcher on Linux).

The daemon treats a missing, unreadable, or malformed `DevToolsActivePort` as disconnected instead of exiting. It retries a renderer that is still loading, coalesces slow CDP evaluations, and reconnects when an update publishes a new debugging port. A separate binary/model patcher is outside this skill: keep that tool's backups outside the Antigravity program directory and use its own supported recovery procedure.
