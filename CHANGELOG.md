# Changelog

## Unreleased

### Added

- Cross-platform CI for the shared payload, compiler and reference tests, real Node server integration, and Windows launcher checks.
- A private, optional `themes/themes.local.json` catalog; the shared catalog references only portable assets.
- Pinned Python setup and contribution, architecture, and disclosure guidance.

### Fixed

- Retry theme injection while a new Antigravity renderer is loading, coalesce slow evaluations, and keep the daemon responsive when update-time debug port files are missing or malformed.
- Confirm the saved theme in a renderer before the custom Windows launcher opens the Dashboard; add `scripts/restore-theme.ps1` for recovery after updates without modifying app files or forcing a working app to close.
- Run Python tests from disposable fixtures without reading or altering the live daemon's state.
- Handle Unicode theme names in CLI logs on narrow Windows code pages; refuse to overwrite a malformed catalog.
- Resolve the Windows tray icon without a hardcoded user path.
