# Agent instructions

- Read `ARCHITECTURE.md` and `CONTRIBUTING.md` before changing runtime boundaries. `SKILL.md` is the theme-authoring workflow, not the maintainer policy.
- Preserve installer paths, existing preset keys and saved user settings. Check `git status --short` and keep unrelated changes. Do not stage, push, or publish unless asked.
- Keep private state and images out of commits. Test in temporary directories. Do not run installers, alter shortcuts or exercise live CDP without user approval.
- Run `python scripts/check_repo.py` and the relevant suite from `CONTRIBUTING.md`. Use `--themes themes/themes.json` for shared builds. A clean Python reference suite is not a live-daemon verification.
- Prefer data-only presets or tests against an existing seam. Do not introduce npm, a bundler, a package split, or placeholder plugins for a single feature. Keep renderer scroll areas free of live blur.
