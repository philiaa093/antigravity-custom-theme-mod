# `themes/themes.json` Schema & Antigravity DOM Reference

`themes/themes.json` is a JSON object keyed by display preset name (e.g. `"WLOP Cosmic"`, `"Midnight Obsidian"`). The first entry becomes the default fallback theme when no `theme_config.json` selection is stored.

## Preset Fields

| Key | Type | Required | Purpose |
| :--- | :--- | :--- | :--- |
| `concept` | string | Yes | Short subtitle shown in the theme selector modal |
| `primary` | hex/css color | Yes | Primary accent color (composer focus border, active highlights, accents) |
| `secondary` | hex/css color | Yes | Secondary accent color (paired gradient highlight) |
| `glow` | rgba string | Yes | Primary ambient glow behind active composer / bubbles |
| `secondaryGlow` | rgba string | Yes | Secondary ambient glow |
| `bg` | css background | Yes | User chat bubble gradient/background |
| `frameBg` | css background | Yes | Border/frame gradient around user message / composer frame |
| `textColor` | hex string | Yes | Foreground text inside user bubble (`#f8fafc` recommended) |
| `borderColor` | rgba string | Yes | Subtle border color for composer & interactive cards |
| `innerBorder` | css border | Yes | Inner border shorthand for cards/frames |
| `clearBackdrop` | boolean | Yes | Removes heavy default opaque panels so wallpaper / pureBg breathes |
| `overlayRgb` | `"R, G, B"` | Yes | Base RGB triplet for wallpaper tint/scrim and unified glass overlay |
| `bgPosition` | css background-position | Optional | Focal point alignment (`"center center"`, `"center 20%"`, etc.) |
| `bubbleStyle` | string | Optional | Import preview label (`glass`, `ink`, or `ribbon`); `bg` and `frameBg` set the actual rendering |
| `bubbleRadius` | number | Optional | User bubble outer corner radius in pixels |
| `inputStyle` | string | Optional | Composer mode applied when the preset is selected (`glass`, `minimal`, `sync`, or `double_gold`) |
| `inputRadius` | number | Optional | Composer outer corner radius in pixels for the preset's selected `inputStyle` |
| `inputFrameBg`, `inputShellBg` | CSS background, CSS color | Optional | Separate composer border and shell tint, independent of the bubble frame |
| `pureBg` | css background | Optional | Pure-CSS multi-layer gradient used when `wallpaper` is `""` |
| `wallpaper` | string | Yes | Relative asset path (`"assets/foo.webp"`), `data:` URI, or `""` for CSS-only |
| `wallpaperVideo` | string | Optional | Local video in `themes/assets/` (`mp4`, `webm`, `mov`, or `m4v`). Use `wallpaper` for its poster. |
| `sidebarBg` | rgba string | Yes | Left navigation rail tint |
| `sidebarBlur` | string | Optional | Passed only to offscreen pre-baked texture sampler (`syncPrebakedGlass`) — never applied as live CSS `backdrop-filter` |
| `sidebarHoverBg` | rgba string | Yes | Hover highlight on sidebar conversation rows |
| `sidebarEnhanceText` | boolean | Optional | Adds crisp text-shadow contrast boost on bright/detailed wallpapers |
| `aiCardBg` | rgba string | Yes | Scrim over AI response cards & markdown panels |
| `aiCardBorder` | rgba string | Yes | Border tint for AI response cards |
| `headerBg` | rgba string | Yes | Top bar tint matching the L-shaped unified glass frame |
| `headerBlur` | string | Optional | Pre-bake blur hint for top header glass |
| `headerBorder` | rgba string | Yes | Bottom hairline border of the top bar |
| `unifiedGlass` | boolean | Yes | Enables seamless unified L-glass spanning sidebar + top header |
| `btnBg` | rgba string | Yes | Composer pill/button dark surface (`rgba(15, 30, 58, 0.56)` etc.) |
| `inputGlassBg` | CSS color | Yes | Composer glass backdrop |
| `inputCardBg` | css background | Yes | Composer container gradient |
| `modalBg` | rgba string | Yes | Settings modal surface (`rgba(..., 0.96)` keeps text razor sharp) |
| `modalHeaderBg` | rgba string | Yes | Settings modal header gradient/color |
| `cardBg` | rgba string | Yes | Theme card background inside settings modal |
| `cardSelectedBg` | rgba string | Yes | Active theme card background inside settings modal |
| `isOrnament` | boolean | Optional | True when decorative SVG flourishes (`cornerSvg` / `sticker`) are used |
| `cornerSvg` | string | Optional | Asset path (`"assets/corner.svg"`) or `data:image/svg+xml,...` for corner badges |
| `sticker` | string | Optional | Asset path (`"assets/ornament.svg"`) or `data:image/svg+xml,...` above composer |
| `stickerW`, `stickerH` | number | Optional | Rendered px width & height for `sticker` |
| `stickerTop`, `stickerRight` | number | Optional | Offset px above/right of the composer box |
| `userAvatar` | string | Optional | Circular avatar (`assets/...` or `data:`) rendered next to `[data-testid="user-message"]` |
| `agentAvatar` | string | Optional | Circular avatar (`assets/...` or `data:`) rendered top-left of `[data-testid="agent-response"]` |
| `isLight` | boolean | Optional | Enables Light Mode Glass typography (`#0f172a` ink, frosted light pills, dark window controls) |
| `uiTextColor`, `uiMutedColor` | css color | Optional | Override header/sidebar/body primary and muted ink (defaults adapt to `isLight`) |
| `pillBg`, `pillHoverBg`, `pillTextColor`, `pillBorder` | css color | Optional | Custom styling for composer strip pills (`No Project`, `Local Checkout`, branch trigger) |
| `fontFamily` | string | Optional | Primary UI & chat font family override stack (e.g. `"Inter, sans-serif"` or `"Geist, sans-serif"`) |
| `codeFontFamily` | string | Optional | Code block & monospace font family override stack (e.g. `"'JetBrains Mono', monospace"` or `"'Fira Code', monospace"`) |

## Asset Resolution (`scripts/build_payload.py`)

When compiling `dist/theme_payload.js`:
- Values under `wallpaper`, `sticker`, `cornerSvg`, `userAvatar`, and `agentAvatar` that point to local paths (relative to `themes/`) are inlined into `data:` URIs.
- `.svg` files become URL-encoded `data:image/svg+xml,...`.
- Raster images (`.png`, `.jpg`, `.jpeg`, `.webp`) are resized down to max `2560px` (`256px` for `userAvatar`/`agentAvatar`) and converted to WebP (`quality=88`) when Pillow is installed, keeping payload size ~200–600 KB.
- Leave `wallpaper` as `""` and supply `pureBg` for zero-image gradient presets (e.g. `Midnight Obsidian`).
- `wallpaperVideo` remains a relative path and is streamed by the loopback daemon, not embedded in `dist/theme_payload.js`.

## Studio Preferences (`theme_config.json`)

- `wallpaperMode`: `preset` (default), `image`, or `video`. `imageMedia` and `videoMedia` are independent local library IDs, not URLs. Older `customWp` image overrides still work.
- `bootIntro`, `sketchReveal`, `taskVoiceEnabled`: opt-in booleans, default `false`.
- `customGreetings`: up to 12 lines of plain text, up to 120 characters each. An empty list leaves the app greeting unchanged.
- `taskVoiceVolume`: `0` to `100`, default `80`. Completion sounds are picked from audio files in the local library.

## Antigravity UI Targets Handled by `engine/core.js`

- **Root Shell:** `.agy-shell` receives wallpaper/pureBg framing with `data-agy-hole-active="1"` + `clip-path: polygon(evenodd, ...)` whenever Antigravity opens the split embedded browser (`body[data-has-browser-hole="true"]`).
- **Pre-baked Glass:** Offscreen canvas generates blurred sidebar/header strips only when theme/wallpaper/dimensions change, avoiding per-frame `backdrop-filter: blur(...)` scroll jank.
- **Composer Top Strip Pills:** `[data-testid="project-selector-trigger"]`, `[aria-label="Select Environment"]`, `[data-testid="branch-pill-trigger"]` are given translucent dark badges for contrast over bright wallpapers.
- **Settings Entry & Persistence:** Sidebar trigger `#agy-custom-theme-sidebar-btn` opens the live customizer modal; choices persist across restarts via CDP binding `agySaveThemeConfig` -> `theme_config.json`.
