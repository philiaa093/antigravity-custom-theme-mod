# Repository audit and publication checklist

## Before changes

- `main` at `9692a7b`: three commits ahead and two behind the local `origin/main` reference. The local `legacy-upstream/main` matched `main`. Remotes `origin`, `upstream`, and `legacy-upstream` exist; no tags or staged changes. Remote state was not fetched. Nine tracked files were modified and 84 files untracked. Preserve this work and reconcile the histories on a review branch.
- No npm dependencies or frontend build. Node runs the daemon and Dashboard HTTP server; Python compiles the injected renderer and uses Pillow for image design. Windows launchers and tray use PowerShell/VBScript; Bash installs the Unix service. Existing preset, renderer and launcher paths are interfaces, not candidates for a wholesale move.
- The tracked catalog was mixed with four personal presets, including an absolute image dependency. The working copy contained 24 unreferenced UUID media files, eight test-upload images, a scratch JS script, and a generated port file. The two largest videos are about 16 MB and 4.8 MB. Keep local files on disk, but keep them out of the proposed commit. Review redistribution rights before staging bundled media.
- Pattern scans of the working tree and 16 commits reachable from local refs found no matches for common GitHub, OpenAI, AWS and Google token formats or private-key headers. This is not proof of absence; ignored profile files, binary metadata and remote-only history were not covered. Commit authors used GitHub noreply email addresses. History includes a voice sample under `themes/user_media/`; ignoring that path now does not remove the old blob. `SKILL.md` contains generic example paths, not a private path.
- Baseline on Windows, Node 24 and Python 3.14: pytest **184 passed, 6 failed** (missing test config defaults, private preset incompatible with the strict fixture schema, Windows Unicode subprocess output, and an obsolete ban on every `Audio` constructor). Two Node suites and both PowerShell scripts completed successfully. The baseline ran in a copy, not the live workspace.
- The embedded Python HTTP server duplicates portions of the Node API, including defaults and validation. Its tests are reference contracts, not evidence that the real daemon implements those exact responses. Production coverage is in the Node suites. `TEST_INFRA.md` and `TEST_READY.md` describe an earlier milestone, not current test status.

## Priorities

1. Keep the original preset catalog and all assets; separate the local catalog from the shared catalog. Stop tests writing to the live checkout. Remove machine-specific paths from candidate code.
2. Reproduce the build with pinned dev dependencies. Run syntax checks, Python reference tests, Node production integration, and Windows launcher/tray checks. Fix or report baseline failures without suppressing them.
3. Add narrow GitHub Actions and Dependabot configuration. Document module boundaries, contribution and reporting rules, and release steps. Keep runtime entry points and npm-free setup.
4. Before public push: review every staged file and media license, check local plus fetched history, confirm the existing MIT license, and reconcile branches without rewriting history.

## Resulting layout

```text
.
|-- .github/                 CI, Dependabot, issue and PR templates
|-- daemon/                   CDP daemon and local HTTP server
|-- docs/                     Audit, design notes, and demo
|-- engine/core.js            Injected renderer
|-- references/theme-schema.md
|-- scripts/                  Build, syntax checks, install and launcher tooling
|-- tests/                    Python, Node and PowerShell checks
|-- themes/
|   |-- themes.json           Seven shared presets
|   |-- assets/               Bundled images, video, fonts and audio
|   `-- themes.local.json     Original local catalog (ignored)
|-- web/index.html            Dashboard
|-- theme_from_image.py       Image CLI and Dashboard worker
|-- *.vbs                     Windows launchers
`-- requirements*.txt         Runtime and development dependencies
```

- Added `.editorconfig`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `requirements.txt`, `requirements-dev.txt`, `scripts/check_repo.py`, `tests/__init__.py`, and this audit.
- Updated `.gitattributes`, `.gitignore`, `README.md`, `SKILL.md`, and `docs/DASHBOARD_AND_TRAY_GUIDE.md` for editor rules, public assets, and current operations.
- Updated `daemon/theme_daemon.js`, `daemon/web_server.js`, `scripts/build_payload.py`, `scripts/tray.ps1`, and `theme_from_image.py` for catalog selection and/or portability. Kept all entry points intact.
- Updated `tests/conftest.py`, `tests/embedded_server.py`, `tests/test_e2e_dashboard.py`, `tests/test_studio_media.js`, `tests/test_tier1_features.py`, `tests/test_tier2_boundaries.py`, `tests/test_tier4_scenarios.py`, `tests/test_tray_headless.ps1`, and `tests/test_web_api.py` for isolation or current contracts.
- Preserved the original `themes/themes.json` byte-for-byte as the ignored `themes/themes.local.json`; `themes/themes.json` retains the unchanged shared presets. No source file or media was deleted. Existing unstaged changes to the engine, Windows installer, and schema are not part of this normalization diff.

## Verification completed

- Windows, Node 24.19.0 and Python 3.14.5: local clone with the candidate files overlaid, without ignored state or build outputs. Fresh virtual environment installed `requirements-dev.txt`; `pip check` found no conflicts. Shared build and JS syntax passed; pytest **191 passed**; Node integration **2 passed**; both PowerShell scripts completed successfully.
- Ubuntu under WSL, Node 22.23.5 and Python 3.14.4: same candidate on the native Linux filesystem, with pinned wheels installed into a fresh venv. `pip check`, source/Bash syntax, shared build, pytest (**191 passed**) and Node integration (**2 passed**) passed.
- The current workspace built both the 7-preset shared catalog and the 11-preset local catalog without replacing its running payload. The shared build also passed without Pillow. `actionlint`, Bash syntax and `git diff --check` passed. No ignored file is tracked at the current `HEAD`.
- Gitleaks found no matches in the 16 commits reachable from local refs or in the candidate file snapshot. This does not cover unpublished remote refs, ignored state, or redistribution rights.
- GitHub Actions has not run on GitHub yet; the workflow's Python 3.12 job is not equivalent to the WSL 3.14 test. No live Antigravity/CDP, OS shortcut changes, or launchd/systemd service installation was exercised.

## Publish only after review

- Upstream provenance: `upstream` points to [furinamikuvn/antigravity-custom-theme-mod](https://github.com/furinamikuvn/antigravity-custom-theme-mod); `legacy-upstream` points to [giakiet22102006/antigravity-custom-theme-skill](https://github.com/giakiet22102006/antigravity-custom-theme-skill). Both declare MIT and have the same `LICENSE` blob as this project. The `origin` repository is a public fork of `furinamikuvn/antigravity-custom-theme-mod`. Preserve the license notice and credit both sources in `README.md`. The GitHub Contributors panel reflects commit history, not README credits.
- Confirm the existing MIT license for code. The bundled Mali files carry the SIL Open Font License. Upstream attribution alone does not clear the WLOP and other artwork, the two videos, icons, voices, or demo. Check redistribution and attribution for current files **and historical versions**, including the voice added in `22ecf87`. Do not push this history to a new host if the historical content is not cleared. Decide separately whether to replace media or publish a reviewed history; do not rewrite these refs by default.
- Inspect all candidate files. Run a dedicated secret scan locally on the candidate tree and fetched history, for example `gitleaks dir --redact .` and `gitleaks git --redact --log-opts="--all" .`. Do not upload scan results. Check author metadata and inspect artwork, screenshots and audio metadata for personal information. Rotate any exposed credential before publishing.
- Review the patch to the shared catalog against the existing private catalog. Keep `theme_config.json`, `daemon.*` state files at the root, `themes/themes.local.json`, locally generated images, `themes/user_media/`, and `vision.json` out of Git. Do not use `git add .` with this mixed workspace.
- Protect `main` with the CI checks and PR review. Enable private vulnerability reporting before public visibility. Test Electron/CDP and OS startup on machines you support; headless CI does not certify those paths.

## Git handoff

The commands below are for a maintainer to run after review. Verify that `origin` points to your GitHub repository. If `chore/repository-readiness` already exists in a separate checkout, locate it with `git worktree list` and work there instead of recreating it. Stage only explicitly reviewed source, configuration, tests, and assets.

```sh
git switch -c chore/repository-readiness
git add -- .github .editorconfig .gitattributes .gitignore AGENTS.md ARCHITECTURE.md CHANGELOG.md CONTRIBUTING.md README.md SECURITY.md requirements.txt requirements-dev.txt scripts/check_repo.py docs/REPOSITORY_AUDIT.md
git status --short
# Stage the remaining reviewed runtime paths and allowed media explicitly.
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "chore: prepare repository for collaboration"
git fetch origin --prune
git merge origin/main
```

If the merge conflicts, stop to review the conflicts and incoming assets. Re-run local checks after resolving the merge. Use this command only when the combined history is cleared for the chosen destination:

```sh
git push -u origin chore/repository-readiness
gh pr create --base main --head chore/repository-readiness --fill
```

Use **Create a merge commit** for the initial reconciliation PR, not squash or rebase. This keeps both existing branch histories in GitHub's `main` and enables a later fast-forward from the current local `main`.

If a new GitHub repository is needed, replace `OWNER/REPO` and use a separate `publish` remote. Run these commands only with permission to upload the reviewed history; private visibility does not remove the need to check it.

```sh
gh repo create OWNER/REPO --private
git remote add publish https://github.com/OWNER/REPO.git
# After the reviewed work is merged to the stable local main:
git push publish main
```

After merging the release changelog, update `main` from `origin` with a fast-forward. Example version only; select the actual version after reviewing scope. Substitute `publish` for `origin` in the push and add `--repo OWNER/REPO` to `gh` if releasing there.

```sh
git switch main
git pull --ff-only origin main
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin refs/tags/v0.1.0
gh release create v0.1.0 --verify-tag --title v0.1.0 --generate-notes
```
