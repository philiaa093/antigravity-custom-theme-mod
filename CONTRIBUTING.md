# Contributing

## Local checks

Use Node.js 22+ and Python 3.12+ for development. From the repository root:

```sh
python -m venv .venv
# POSIX: source .venv/bin/activate
# PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python scripts/check_repo.py
python scripts/build_payload.py --themes themes/themes.json
node --check dist/theme_payload.js
python -m pytest tests -q
node --test tests/test_image_design.js tests/test_studio_media.js tests/test_daemon_reconnect.js
```

The Python suite tests the compiler, engine contracts, and an embedded reference server in a temporary checkout; it does not exercise the live daemon. The Node suites use the production HTTP server and a daemon smoke test in temporary directories. No live Antigravity window, API key, or model provider is required. Do not use a shared working session to run mutation tests against the real Dashboard.

The explicit build above writes `dist/theme_payload.js`. If the daemon is using your local catalog, build in a separate checkout or pass `--out` with a temporary file and point `node --check` at that file.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/test_start_all.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/test_restore_theme.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File tests/test_tray_headless.ps1
```

The Windows scripts check daemon/renderer readiness, recovery process selection, and WinForms/tray contracts without opening a real app or installing shortcuts. The daemon reconnect suite uses an isolated local CDP transport to test an early empty DOM, slow evaluations, port-file failures, and an updater restart. On Unix run `bash -n scripts/install-unix.sh`. Test installer changes on the target OS and renderer changes with an open Antigravity window (`node scripts/verify_cdp.js`). Record what was not tested.

## Changes and PRs

- Start from the updated stable `main`. Use `feature/`, `fix/`, `refactor/`, `docs/`, or `chore/` branches with short kebab-case names.
- Use Conventional Commits: `feat(studio): ...`, `fix(tray): ...`, `refactor: ...`, `docs: ...`, `test: ...`, `chore: ...`. Keep each commit reviewable.
- Follow neighboring code: JavaScript `camelCase`, Python `snake_case`, PowerShell `Verb-Noun`, preset keys as documented in `references/theme-schema.md`. Use `.editorconfig`; do not reformat unrelated code.
- Add one regression check at the boundary changed. Test the real Node server for production API behavior. Describe compatibility, checks, and asset rights in the PR. Update `CHANGELOG.md` for user-visible changes.
- Stage reviewed paths and inspect `git diff --cached`, `git status --short`, and `git ls-files -ci --exclude-standard`. Do not stage generated media, private catalogs, logs, keys, or the compiled payload. For a personal preset use the local catalog; see `ARCHITECTURE.md`.

## Releases

Use SemVer: patch for compatible fixes, minor for compatible features, major for breaking changes. Choose the initial version after confirming the public scope; do not infer it from Antigravity's version. Release only from a reviewed `main` commit with green CI. Move the release notes out of `Unreleased`, tag the matching commit with an annotated `vMAJOR.MINOR.PATCH` tag, and publish a GitHub Release. See `docs/REPOSITORY_AUDIT.md` for the exact commands and first-publication checks.
