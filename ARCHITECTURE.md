# Architecture

AntigravityTheme is a local Node.js process plus a compiled renderer script. There is no npm dependency, frontend bundler, or hosted service.

| Area | Responsibility and interface |
| --- | --- |
| `engine/core.js` | Self-contained browser payload. Applies themes to Antigravity DOM, manages customizer and effects, and exposes live apply/cleanup hooks for the daemon. Keep scroll panes free of live backdrop blur and preserve the split-browser cutout. |
| `scripts/build_payload.py` | Combines `themes/*.json` and the engine into `dist/theme_payload.js`, validates referenced assets, and inlines raster/SVG images. Video remains served locally. |
| `daemon/theme_daemon.js` | Discovers `DevToolsActivePort`, manages the daemon and renderer sessions, injects the payload, and watches the payload for rebuilds. Passes a CDP controller to the HTTP server. |
| `daemon/web_server.js` | Runs the loopback Dashboard/API; validates configuration, saves designs and uploads, and serves media. Isolated tests pass a temporary `rootDir` and a CDP stub to `startWebServer`. |
| `web/index.html` | Single Dashboard page with inline CSS and JavaScript. Reads and writes local API state; the daemon reports whether any renderer applied it. |
| `theme_from_image.py` | Pillow palette extraction, image rendering, and optional Vision calls. Dashboard calls it with `--preview` and uses its JSON output; the CLI can also write a preset directly. `scripts/theme_from_image.py` is a compatibility launcher. |
| `scripts/*.ps1`, `*.vbs`, `scripts/install-unix.sh` | OS launchers and service management. The Windows tray shares the catalog and uses the local API without importing renderer code. |

## Data and lifecycle

- `themes/themes.json` is the shared catalog. `themes/themes.local.json`, when present, replaces it as a whole for the compiler, CLI, daemon, and tray. It is not a merge; changes to shared defaults do not flow into an existing local copy. Build the intended catalog and restart the daemon when switching files. Use `--themes themes/themes.json` for a release build.
- Settings live in `theme_config.json`; uploaded renderer media live in `themes/user_media/`. Saving a Dashboard image design writes the active catalog and creates generated WebPs under `themes/assets/`. Keep private presets and generated media out of commits. To contribute a reviewed image preset, give its assets stable names and update the shared catalog explicitly.
- The Dashboard binds to loopback by default. The daemon writes the selected port to `daemon.webport`; the tray reads it. Tokens and user-profile Vision settings are not part of the shared configuration. See `SECURITY.md` for operating limits.

## Extension points

- A new preset is data, not an engine change. Follow `references/theme-schema.md`, then check the shared build and renderer readability.
- Add Dashboard config validation in `web_server.js`, then update the Dashboard, renderer, and tests that consume that key. Keep optional entries and existing saved settings compatible.
- Add image design rules in `theme_from_image.py` and keep its JSON contract covered by `tests/test_image_design.js`. Test runtime HTTP behavior there or in `tests/test_studio_media.js`, not by expanding the duplicate Python server.
- Keep existing paths for installers and the skill. Extract a module only when it has a distinct responsibility and an independent test; avoid package splits or plugin interfaces until there is a second consumer.
