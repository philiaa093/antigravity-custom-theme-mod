# AntigravityTheme — Web Dashboard & Windows System Tray Operational Guide

> Historical design notes. Use [README](../README.md) for supported commands and [Architecture](../ARCHITECTURE.md) for current paths and boundaries. The current Dashboard is a single `web/index.html`; the endpoint examples and implementation claims in these notes are not the production API contract.

> **Current update:** For a theme that disappears after an Antigravity update, use the recovery procedure in §0 below. The recovery path restores the existing external CDP integration; it does not patch Antigravity binaries, run an installer, rewrite shortcuts, or manage a separate model patcher's backups.

## 0. Current Update — Recover the Theme After Antigravity Updates

Antigravity v2.33.0+ may start without creating `DevToolsActivePort`, and an updater restart may reuse the application without the debug flags that the theme daemon needs. The supported Windows recovery command is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-theme.ps1
```

The command:

1. Locates the per-user `Antigravity.exe` installation.
2. Refuses to run while the Antigravity updater installer is active.
3. Ignores renderer, utility, and `sidecar_sdk` processes when deciding whether the main app is running.
4. Starts a closed main app with loopback-only debugging (`127.0.0.1`, port `0`), if necessary.
5. Starts the daemon and tray, then waits up to 30 seconds for a renderer to confirm the saved theme.

Use `-OpenDashboard` to open the Dashboard only after the renderer confirms the saved theme:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-theme.ps1 -OpenDashboard
```

If the command says that Antigravity is already running without a usable debug port, save your work, choose **Quit/Exit** from the Antigravity System Tray, and run it again. The recovery script never forcibly terminates a working app. It also does not modify `theme_config.json`, preset catalogs, uploaded media, application files, or shortcuts.

The normal custom launcher (`launch-antigravity.vbs`) now requests the same renderer confirmation before opening the Dashboard. `scripts/start-all.ps1` supports the explicit readiness mode as well:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-all.ps1 -OpenDashboard -WaitForTheme
```

The daemon remains alive while the debug port file is missing, locked, unreadable, or malformed. It retries a renderer that is still loading, avoids overlapping slow evaluations, and reconnects when an update changes the debugging port. A status response is renderer-ready only when `sessionsCount` is greater than zero and `appliedTheme` contains the saved theme name.

An updater error can belong to a separate binary/model patcher. This theme project does not create, migrate, or reapply that tool's backups. Keep those backups outside the Antigravity program directory and follow that tool's own recovery instructions.

## 1. Overview & System Philosophy

**AntigravityTheme** is an ultra-lightweight, zero-npm-dependency custom theme and visual enhancement suite designed specifically for the Antigravity IDE on Windows.

### Core Architecture Principles
- **Zero External Dependencies**: The entire daemon, REST API backend, and local static server run on native Node.js standard libraries (`http`, `fs`, `path`, `child_process`). The Windows System Tray runs on pure PowerShell 5.1 and .NET WinForms. No `npm install`, `node_modules`, or vendor binary blobs required.
- **Microsecond In-Memory Hot-Reload**: Configuration changes dispatched from either the Web Dashboard or System Tray are instantly injected into active Antigravity IDE renderer windows via in-memory Chrome DevTools Protocol (CDP) WebSocket sessions (`window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__(config)`), without refreshing or restarting the editor.
- **Clean Lifecycle & Zero-Zombie Guarantee**: Unified PID management and single-instance Mutex protection prevent orphaned processes, duplicate tray icons, or port collisions.

---

## 2. Architecture & Components

```
+---------------------------------------------------------------------------------+
|                               WINDOWS USER SESSION                              |
+---------------------------------------------------------------------------------+
       |                                                         |
       | (Left-Click or Shortcut)                                | (Silent Startup)
       v                                                         v
+-------------------------------+             +-----------------------------------+
| Modern Web Browser            |             | Windows System Tray Host          |
| (Edge / Chrome / Firefox)     |             | (scripts/tray.ps1)                |
|                               |             |                                   |
| - Glassmorphism UI (web/)     |             | - NotifyIcon & Context Menu       |
| - Presets Grid Explorer       |             | - Dynamic Presets Submenu         |
| - 15-Parameter Config Editor  |             | - Left-Click -> Launches Browser  |
| - Palette Extraction & Upload |             | - Daemon Restart & Clean Exit     |
+-------------------------------+             +-----------------------------------+
       |                                                         |
       | HTTP / REST API (Port 47990+)                           | HTTP / REST / PID
       v                                                         v
+---------------------------------------------------------------------------------+
| Unified Node.js Daemon (daemon/theme_daemon.js + daemon/web_server.js)          |
|                                                                                 |
| - HTTP Server (port written to daemon.webport)                                  |
| - REST API Endpoints (/api/config, /api/presets, /api/themes/from-image)        |
| - Static File Delivery (web/index.html, web/style.css, web/app.js)              |
| - PID Lockfile (daemon.pid)                                                     |
+---------------------------------------------------------------------------------+
       |
       | Chrome DevTools Protocol (CDP WebSocket)
       v
+---------------------------------------------------------------------------------+
| Antigravity IDE Renderer Windows                                                |
|                                                                                 |
| - Evaluates window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__(config) (<5ms latency)    |
| - Injected styles, wallpapers, avatars, and fonts rendered dynamically          |
+---------------------------------------------------------------------------------+
```

### Component Breakdown
1. **Node.js Unified Daemon (`daemon/theme_daemon.js`, `daemon/web_server.js`)**:
   - Manages connection to Antigravity's active CDP port (`DevToolsActivePort`).
   - Hosts the built-in HTTP server on `127.0.0.1:47990` (dynamically falls back to `47991+` if port 47990 is bound).
   - Writes the bound port to `daemon.webport` and its process ID to `daemon.pid`.
   - Handles static dashboard assets and REST API requests with atomic file persistence on Windows NTFS.
2. **Web Dashboard Frontend (`web/index.html`, `web/style.css`, `web/app.js`)**:
   - Zero-build vanilla HTML5, CSS3, and modern JavaScript.
   - Designed with an ultra-responsive dark glassmorphism theme (`backdrop-filter: blur`, neon glows).
   - Real-time swatch previews, full configuration editor, and drag-and-drop palette extraction.
3. **Windows System Tray (`scripts/tray.ps1`)**:
   - Implemented via PowerShell 5.1 and .NET `System.Windows.Forms.NotifyIcon` + `System.Windows.Forms.ContextMenuStrip`.
   - Protected by named Mutex (`Global\AntigravityTheme_Tray_Mutex`) to prevent duplicate instances.
   - Uses Antigravity's native application icon with multi-tier fallback to system application icons.

---

## 3. Launching & Operation

The AntigravityTheme suite supports two modes of operation: **Interactive Mode** (for development, debugging, and terminal logging) and **Silent Mode** (for day-to-day background running on Windows startup).

### 3.1 Silent Mode (Recommended for Daily Use)
Runs both the Theme Daemon and the System Tray silently in the background with zero flashing console windows.

- **Unified Launcher (Daemon + Tray)**:
  Double-click or run:
  ```cmd
  wscript silent-start-all.vbs
  ```
- **Daemon Only (Silent)**:
  ```cmd
  wscript silent-start.vbs
  ```

### 3.2 Interactive Mode (Command Line & Testing)
Displays output and errors directly in your terminal.

- **Unified Launcher (Daemon + Tray)**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1
  ```
- **Daemon Only**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/start-daemon.ps1
  ```
- **System Tray Only**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/tray.ps1
  ```

### 3.3 Confirmed Renderer Startup

`-OpenDashboard` only waits for the daemon by default. Add `-WaitForTheme` when a browser window must not open until a renderer has confirmed the saved theme:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-all.ps1 -OpenDashboard -WaitForTheme
```

The confirmed mode keeps the existing daemon PID and port checks, requires at least one applied renderer session, compares `appliedTheme` with `theme_config.json` when a theme name is saved, and times out after 30 seconds. Use it when Antigravity is already running with local debugging; otherwise use `scripts/restore-theme.ps1`. Calls without `-WaitForTheme` keep their existing behavior: daemon/tray-only startup returns after launch, while `-OpenDashboard` alone retains its 10-second daemon readiness limit.

---

## 4. Windows System Tray Guide

When `scripts/tray.ps1` is running, an Antigravity icon appears in the Windows Notification Area (Taskbar System Tray).

```
+---------------------------------------+
|  Open Web Dashboard (Bold / Default)  |
+---------------------------------------+
|  -----------------------------------  |
+---------------------------------------+
|  Theme Presets                     >  | ---> [x] WLOP Cosmic
+---------------------------------------+      [ ] Midnight Obsidian
|  Restart Daemon                       |      [ ] Cyberpunk Neon
+---------------------------------------+      [ ] Warm Sakura
|  -----------------------------------  |      [ ] Minimal Dark
+---------------------------------------+      [ ] Glass Frost
|  Exit                                 |
+---------------------------------------+
```

### 4.1 Left-Click Action
- **Behavior**: Clicking the tray icon with the left mouse button immediately resolves the active web server port from `daemon.webport` (default `47990`) and launches the Web Dashboard in your system's default browser (Microsoft Edge, Google Chrome, Mozilla Firefox, Brave, etc.).
- **Windows Integration**: Uses native Windows `ShellExecuteEx` (`[System.Diagnostics.Process]::Start("http://localhost:<port>")`) without spawning any command prompt window.

### 4.2 Right-Click Context Menu Actions

#### 1. Open Web Dashboard (Bold)
- Launches the Web Dashboard in your default browser, identical to the left-click action.

#### 2. Theme Presets Submenu
- **Dynamic Loading**: On every right-click opening (`ContextMenuStrip.Opening`), the submenu reads `themes/themes.json` and `theme_config.json`. Any new theme added via the Web Dashboard or image generator immediately shows up in the tray menu without restarting the tray.
- **Checkmark Indicator**: A checkmark (`[x]`) is displayed next to the currently active theme preset according to `theme_config.json`.
- **Instant Activation**: Clicking a preset name:
  1. Issues an asynchronous HTTP request `POST /api/presets/activate` with `{ "themeName": "..." }`.
  2. If the daemon web server is running, the theme is pushed instantly to Antigravity sessions via CDP.
  3. If the daemon web server is offline, the tray falls back gracefully to updating `theme_config.json` directly on disk.
  4. Displays a Windows Notification Balloon Tip:
     `Antigravity Theme: Switched to '<PresetName>'`

#### 3. Restart Daemon
- Cleanly stops the running daemon process by reading its PID from `daemon.pid` and terminating it.
- Deletes the stale `daemon.pid` lockfile.
- Spawns a fresh instance of `scripts/start-daemon.ps1` in the background.
- Displays a Windows Notification Balloon Tip confirming restart.

#### 4. Exit
- **Clean Shutdown Protocol**:
  1. Reads `daemon.pid` and terminates the daemon process.
  2. Deletes `daemon.pid` and `daemon.webport`.
  3. Sets tray visibility to false (`$tray.Visible = $false`) and disposes tray icon and context menu resources. This prevents "ghost" icons from lingering in the taskbar.
  4. Releases and closes the single-instance named Mutex.
  5. Exits PowerShell with exit code 0, leaving **zero zombie processes**.

---

## 5. Web Dashboard Guide

The Web Dashboard is accessible at `http://localhost:47990` (or the port specified in `daemon.webport`).

### 5.1 Preset Explorer
- Displays visual cards for all curated presets defined in `themes/themes.json`.
- Shows color swatches for Primary color, Secondary color, and Background glow.
- The currently active preset has a glowing border and an "Active" badge.
- Clicking any card applies the preset instantly to the editor.

### 5.2 Configuration Editor (15 Parameters)
Provides granular real-time controls for all theme parameters:
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `themeName` | `string` | Name of the active theme preset |
| `bubbleName` | `string` | Name of the chat message bubble style |
| `inputStyle` | `enum` | Chat prompt input box styling (`sync`, `double_gold`, `glass`, `minimal`) |
| `dimming` | `number` (0–100) | Editor background dimming percentage |
| `wpEnabled` | `boolean` | Enable or disable custom background wallpaper |
| `customWp` | `string` | Path or URL to a custom wallpaper image |
| `userAvatar` | `string` | Path or URL to the user chat avatar icon |
| `agentAvatar` | `string` | Path or URL to the AI assistant avatar icon |
| `glassBlur` | `number` (0–50) | Backdrop glassmorphism blur radius in pixels |
| `avatarSize` | `number` (16–128)| Diameter of chat avatar icons in pixels |
| `avatarRadius`| `number` (0–50) | Border radius percentage of avatar icons (50% = circular) |
| `soundEnabled`| `boolean` | Enable or disable audio effects on generation |
| `fontFamily` | `string` | Primary UI typography font family |
| `codeFontFamily`| `string` | Code block and editor typography font family |

### 5.3 Image Palette Extraction (`Theme from Image`)
- Drag and drop or upload any image (`PNG`, `JPEG`, `WEBP`).
- Enter a custom Theme Name.
- The backend executes `theme_from_image.py` using k-means color quantization, extracts dominant colors, automatically balances contrast for dark mode, generates the preset in `themes/themes.json`, and rebuilds `dist/theme_payload.js`.
- The new theme is immediately activated and appears across the Web Dashboard and System Tray menu.

---

## 6. REST API Reference

The daemon web server exposes a full REST API for programmatic control. All requests and responses use JSON format (`application/json; charset=utf-8`).

### 6.1 `GET /api/config`
Retrieves the current active configuration from `theme_config.json`.
- **Response `200 OK`**:
  ```json
  {
    "themeName": "WLOP Cosmic",
    "bubbleName": "WLOP Cosmic",
    "inputStyle": "glass",
    "dimming": 92,
    "wpEnabled": true,
    "customWp": "",
    "userAvatar": "",
    "agentAvatar": "",
    "glassBlur": 3,
    "avatarSize": 38,
    "avatarRadius": 50,
    "soundEnabled": true,
    "fontFamily": "",
    "codeFontFamily": ""
  }
  ```

### 6.2 `POST /api/config`
Updates one or more configuration fields. Fields are validated and clamped to safe ranges.
- **Request Body**:
  ```json
  {
    "dimming": 85,
    "glassBlur": 5
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "config": { ...updatedConfig }
  }
  ```

### 6.3 `GET /api/presets`
Retrieves all available theme presets and the name of the active preset.
- **Response `200 OK`**:
  ```json
  {
    "active": "WLOP Cosmic",
    "presets": {
      "WLOP Cosmic": { "concept": "...", "primary": "#fbbf24", ... },
      "Midnight Obsidian": { "concept": "...", "primary": "#a78bfa", ... }
    }
  }
  ```

### 6.4 `POST /api/presets/activate`
Activates an existing theme preset by name.
- **Request Body**:
  ```json
  {
    "themeName": "Midnight Obsidian"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "themeName": "Midnight Obsidian"
  }
  ```

### 6.5 `POST /api/themes/from-image`
Uploads an image, extracts color palette, builds payload, and adds a new preset.
- **Request Body** (JSON Base64 or Multipart):
  ```json
  {
    "themeName": "Emerald Forest",
    "imageName": "forest.png",
    "imageBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "themeName": "Emerald Forest",
    "preset": { ...themeValues }
  }
  ```

### 6.6 `GET /api/status`
Returns runtime status and diagnostic information.
- **Response `200 OK`**:
  ```json
  {
    "running": true,
    "pid": 14220,
    "port": 47990,
    "sessionsCount": 1,
    "appliedTheme": "WLOP Cosmic",
    "imagePreview": true,
    "imageStudio": true,
    "version": "1.0.0"
  }
  ```

### 6.7 `POST /api/daemon/reload`
Triggers an immediate hot-reload of active Antigravity CDP sessions.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Theme payload reloaded across all active sessions"
  }
  ```

---

## 7. Verification & Troubleshooting Guide

### 7.1 Automated Headless Verification
To verify the System Tray host without displaying interactive windows or requiring mouse clicks:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/test_tray_headless.ps1
```
**Expected Output**:
```
==========================================================
 AntigravityTheme - System Tray Headless Test Suite       
==========================================================
[TEST 1] Loading .NET WinForms and Drawing assemblies...
  -> [PASS] System.Windows.Forms classes verified.
[TEST 2] Testing Mutex acquisition and release...
  -> [PASS] Mutex correctly acquired and disposed.
[TEST 3] Testing Icon extraction and fallback...
  -> [PASS] Tray icon resolved successfully from: Executable: ...
[TEST 4] Testing Dashboard port discovery...
  -> [PASS] Port discovery fallback (47990) and dynamic discovery (48999) verified.
[TEST 5] Testing Context Menu construction and styling...
  -> [PASS] Context menu structure (6 items), bold font, and separators verified.
[TEST 6] Testing Dynamic Presets submenu loading and checkmark...
  -> [PASS] Active theme 'WLOP Cosmic' is correctly checkmarked in submenu.
[TEST 7] Testing Direct Config update fallback...
  -> [PASS] Offline config update fallback verified.
[TEST 8] Testing Clean Teardown & Resource Disposal...
  -> [PASS] Tray and ContextMenuStrip cleanly disposed with zero leaking handles.
==========================================================
TRAY_TEST_PASS: All headless System Tray tests completed successfully.
==========================================================
```

To run the REST API automated test suite:
```powershell
pytest tests/test_web_api.py -v
```

For the update/recovery boundaries, run:
```powershell
node --test tests/test_daemon_reconnect.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/test_start_all.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/test_restore_theme.ps1
```

### 7.2 Interactive End-to-End Verification Checklist
| Step | Action | Expected Result |
| :--- | :--- | :--- |
| 1 | Run `wscript silent-start-all.vbs` | Both Daemon and Tray launch silently without any cmd console popups. |
| 2 | Check System Tray | Antigravity icon appears in the taskbar notification area. |
| 3 | Left-click tray icon | Default web browser opens `http://localhost:47990`. |
| 4 | Right-click tray icon | Context menu appears with 6 items: Bold "Open Web Dashboard", Presets submenu, Restart Daemon, Exit. |
| 5 | Hover over "Theme Presets" | Submenu lists all presets from `themes/themes.json`, with a checkmark on the currently active preset. |
| 6 | Click a different preset | Checkmark updates, notification balloon pops up, and editor theme changes instantly. |
| 7 | Click "Restart Daemon" | Notification balloon shows "Theme Daemon restarted.", old PID is replaced by new PID in `daemon.pid`. |
| 8 | Click "Exit" | Tray icon disappears immediately, daemon process terminates, and `daemon.pid` + `daemon.webport` are removed. |
| 9 | Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-theme.ps1 -OpenDashboard` after an update | Antigravity starts with loopback debugging when closed, the saved theme is confirmed by a renderer, and the Dashboard opens only afterward. |

### 7.3 Lifecycle & Zombie Process Check
Verify there are no lingering zombie processes after exiting:
```powershell
Get-Process -Name node, powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*Antigravity*" -or $_.CommandLine -like "*theme_daemon*" -or $_.CommandLine -like "*tray.ps1*"
}
```
If clean, this command returns zero results.

### 7.4 Common Troubleshooting Scenarios

1. **"Another tray instance is already running"**:
   - The single-instance Mutex detected an existing `tray.ps1` process.
   - If a previous instance hung, terminate it with:
     ```powershell
     Get-Process powershell | Where-Object { $_.MainWindowTitle -eq "" } | Stop-Process -Force
     ```
2. **Ghost Tray Icon Lingering**:
   - If PowerShell was forcefully terminated via `taskkill /F`, Windows may keep the tray icon until the mouse hovers over it.
   - Normal exit via the "Exit" menu item or script completion calls `$tray.Visible = $false` and `$tray.Dispose()`, avoiding ghost icons completely.
3. **Execution Policy Restriction**:
   - If Windows restricts script execution, always invoke scripts using `-ExecutionPolicy Bypass` as provided in `scripts/start-all.ps1` and `silent-start-all.vbs`.
4. **Port 47990 Already Bound**:
   - The daemon automatically detects port collisions and binds to `47991` through `47999`.
   - The tray icon automatically reads the allocated port from `daemon.webport`, ensuring smooth operation without manual configuration.
5. **Theme is not confirmed after an update**:
   - Check `daemon.log` and confirm Antigravity is fully quit before running `scripts/restore-theme.ps1` again.
   - If a running main app has no usable debug port, quit it from Antigravity's own **Quit/Exit** action; do not use Task Manager to force-close it as part of recovery.
   - A missing or malformed `DevToolsActivePort` does not mean the daemon crashed. Start Antigravity with loopback debugging and wait for the renderer to publish a valid port.

---

## 8. Tự động khởi chạy cùng Antigravity (Auto-Launch Integration)

Hệ thống hỗ trợ tự động mở toàn bộ (Theme Daemon, Web Server và System Tray) mỗi khi mở Antigravity hoặc khi khởi động Windows:

### 8.1 Cơ chế hoạt động
1. **Khởi chạy cùng Antigravity**:
   - Script wrapper `launch-antigravity.vbs` mở `Antigravity.exe` với tham số `--remote-debugging-port=0`, khởi chạy Theme Daemon & System Tray, rồi chỉ mở Dashboard sau khi renderer xác nhận theme đã áp dụng.
   - Các shortcut của Antigravity trên **Desktop** và **Start Menu** đã được liên kết với `launch-antigravity.vbs` trong khi giữ nguyên biểu tượng icon gốc của Antigravity.
2. **Khởi chạy cùng Windows (Startup)**:
   - Shortcut `AntigravityCustomTheme.lnk` trong thư mục `shell:startup` tự động gọi `silent-start-all.vbs` khi máy tính bật lên, đảm bảo khay hệ thống luôn sẵn sàng. Startup daemon không tự đóng hoặc tự khởi động lại một phiên Antigravity đang làm việc.
3. **Cấu hình hoặc Khôi phục**:
   - Áp dụng cấu hình tự động mở:
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts/setup-autostart.ps1
     ```
   - Khôi phục shortcut gốc nếu cần:
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts/setup-autostart.ps1 -Restore
     ```
