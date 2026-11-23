# Changelog

## Unreleased

### Added

- Cross-platform CI for the shared payload, compiler and reference tests, real Node server integration, and Windows launcher checks.
- A private, optional `themes/themes.local.json` catalog; the shared catalog references only portable assets.
- Pinned Python setup and contribution, architecture, and disclosure guidance.

### Fixed

- Run Python tests from disposable fixtures without reading or altering the live daemon's state.
- Handle Unicode theme names in CLI logs on narrow Windows code pages; refuse to overwrite a malformed catalog.
- Resolve the Windows tray icon without a hardcoded user path.
