"""Check source syntax and ensure shared presets build without local files."""

import ast
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess

from build_payload import ASSET_KEYS


ROOT = Path(__file__).resolve().parents[1]


class DashboardScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and "src" not in dict(attrs):
            self.inline = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.inline = False

    def handle_data(self, data):
        if self.inline:
            self.scripts.append(data)


def check_shared_catalog():
    themes = ROOT / "themes"
    assets = themes / "assets"
    catalog = json.loads((themes / "themes.json").read_text(encoding="utf-8"))
    for name, preset in catalog.items():
        for key in (*ASSET_KEYS, "wallpaperVideo"):
            value = preset.get(key, "")
            if value in ("", "none") or (isinstance(value, str) and value.startswith("data:image/")):
                continue
            if not isinstance(value, str) or not value.startswith("assets/") or "\\" in value:
                raise SystemExit(f"Shared preset {name!r}: {key} must reference assets/ or an inline image")
            file = (themes / value).resolve()
            if not file.is_relative_to(assets) or not file.is_file() or file.name.startswith(("theme_", "upload_")):
                raise SystemExit(f"Shared preset {name!r}: {key} needs a portable, reviewed asset")


def main():
    check_shared_catalog()
    for file in sorted([*ROOT.glob("*.py"), *ROOT.glob("scripts/*.py"), *ROOT.glob("tests/*.py")]):
        ast.parse(file.read_bytes(), filename=str(file.relative_to(ROOT)))
    for directory in ("daemon", "engine", "scripts", "tests"):
        for file in sorted((ROOT / directory).glob("*.js")):
            subprocess.run(["node", "--check", file], check=True)
    dashboard = DashboardScripts()
    dashboard.feed((ROOT / "web/index.html").read_text(encoding="utf-8"))
    dashboard.close()
    if not dashboard.scripts:
        raise SystemExit("web/index.html: no inline dashboard script found")
    for script in dashboard.scripts:
        subprocess.run(["node", "--check"], input=script.encode("utf-8"), check=True)
    print("Shared assets and Python, JavaScript, and Dashboard syntax checks passed.")


if __name__ == "__main__":
    main()
