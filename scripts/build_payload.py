#!/usr/bin/env python3
"""
Compile themes/themes.json + engine/core.js into dist/theme_payload.js.
Inlines local SVG and raster wallpaper assets (compressing >2560px rasters to WebP
when Pillow is available) so the CDP runtime payload stays self-contained.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import mimetypes
import re
import sys
import tempfile
import urllib.parse
from pathlib import Path

ASSET_KEYS = ("wallpaper", "sticker", "cornerSvg", "userAvatar", "agentAvatar")
AVATAR_KEYS = {"userAvatar", "agentAvatar"}
AVATAR_MAX_DIM = 256
PLACEHOLDER = "/*__THEMES_PLACEHOLDER__*/{}"
STUDIO_PLACEHOLDER = "/*__STUDIO_ASSETS_PLACEHOLDER__*/{}"
DEFAULT_MAX_DIM = 2560
WEBP_QUALITY = 88


def encode_svg(svg_path: Path) -> str:
    svg_text = svg_path.read_text(encoding="utf-8")
    return "data:image/svg+xml," + urllib.parse.quote(svg_text)


def encode_raster(img_path: Path, max_dim: int) -> str:
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raw = img_path.read_bytes()
        mime, _ = mimetypes.guess_type(str(img_path))
        if not mime:
            mime = "image/png"
        if len(raw) > 2 * 1024 * 1024:
            print(
                f"[build_payload] Warning: Pillow not installed; embedding raw {img_path.name} "
                f"({len(raw) // 1024} KB). Install Pillow to auto-compress to 2K WebP.",
                file=sys.stderr,
            )
        return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"

    with Image.open(img_path) as img:
        img = ImageOps.exif_transpose(img)
        has_alpha = img.mode in ("RGBA", "LA", "PA") or (
            img.mode == "P" and "transparency" in img.info
        )
        img = img.convert("RGBA" if has_alpha else "RGB")

        w, h = img.size
        longest = max(w, h)
        if max_dim > 0 and longest > max_dim:
            scale = max_dim / float(longest)
            new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
            resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            img = img.resize(new_size, resample)

        # Keep existing small WebP bytes untouched if already within budget and not resized.
        if img_path.suffix.lower() == ".webp" and longest <= max_dim:
            raw = img_path.read_bytes()
            if len(raw) <= 1.2 * 1024 * 1024:
                return f"data:image/webp;base64,{base64.b64encode(raw).decode('ascii')}"

        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=4)
        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/webp;base64,{encoded}"


def resolve_asset_value(value: object, themes_dir: Path, max_dim: int) -> object:
    if not isinstance(value, str):
        return value
    trimmed = value.strip()
    if (
        not trimmed
        or trimmed.startswith("data:")
        or trimmed.startswith("http://")
        or trimmed.startswith("https://")
    ):
        return trimmed

    asset_path = Path(trimmed)
    if not asset_path.is_absolute():
        asset_path = (themes_dir / asset_path).resolve()
    if not asset_path.is_file():
        raise FileNotFoundError(f"Theme asset not found: {trimmed} (resolved: {asset_path})")

    if asset_path.suffix.lower() == ".svg":
        return encode_svg(asset_path)
    return encode_raster(asset_path, max_dim)


def build_payload(themes_path: Path, engine_path: Path, out_path: Path, max_dim: int) -> None:
    if not themes_path.is_file():
        raise FileNotFoundError(f"themes.json not found: {themes_path}")
    if not engine_path.is_file():
        raise FileNotFoundError(f"core.js not found: {engine_path}")

    themes_raw = json.loads(themes_path.read_text(encoding="utf-8"))
    if not isinstance(themes_raw, dict) or not themes_raw:
        raise ValueError("themes.json must be a non-empty JSON object keyed by theme name.")

    themes_dir = themes_path.parent
    resolved_themes: dict[str, dict] = {}
    for name, cfg in themes_raw.items():
        if not isinstance(cfg, dict):
            raise ValueError(f"Theme '{name}' must be a JSON object.")
        copied = dict(cfg)
        if "wallpaperVideo" in copied:
            video = copied["wallpaperVideo"]
            if (not isinstance(video, str)
                    or not re.fullmatch(r"assets/[a-z0-9][a-z0-9_-]*\.(?:mp4|webm|mov|m4v)", video, re.I)
                    or not (themes_dir / video).is_file()):
                raise ValueError(f"Theme '{name}' must reference an existing video under assets/.")
        for key in ASSET_KEYS:
            if key in copied:
                target_dim = min(max_dim, AVATAR_MAX_DIM) if key in AVATAR_KEYS else max_dim
                copied[key] = resolve_asset_value(copied[key], themes_dir, target_dim)
        resolved_themes[name] = copied

    engine_src = engine_path.read_text(encoding="utf-8")
    count = engine_src.count(PLACEHOLDER)
    if count != 1:
        raise ValueError(
            f"Expected exactly 1 '{PLACEHOLDER}' placeholder in {engine_path}, found {count}."
        )

    themes_json = json.dumps(resolved_themes, ensure_ascii=False)
    compiled = engine_src.replace(PLACEHOLDER, themes_json, 1)
    if STUDIO_PLACEHOLDER in compiled:
        asset_dir = engine_path.parent.parent / "themes" / "assets"
        asset_types = {"starfield-boot-bg.jpg": "image/jpeg", "agy-icon-color.png": "image/png"}
        asset_types.update({f"fonts/mali-500-{subset}.woff2": "font/woff2" for subset in ("latin", "latin-ext", "vi")})
        studio_assets = {
            name: f"data:{mime};base64,{base64.b64encode((asset_dir / name).read_bytes()).decode('ascii')}"
            for name, mime in asset_types.items() if (asset_dir / name).is_file()
        }
        compiled = compiled.replace(STUDIO_PLACEHOLDER, json.dumps(studio_assets), 1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=out_path.parent, delete=False) as file:
        staged = Path(file.name)
        try:
            file.write(compiled)
            file.close()
            staged.replace(out_path)
        finally:
            staged.unlink(missing_ok=True)

    size_kb = out_path.stat().st_size / 1024.0
    print(
        f"[build_payload] Built {out_path} ({size_kb:.1f} KB) with {len(resolved_themes)} theme(s): "
        + ", ".join(resolved_themes.keys())
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    local_catalog = repo_root / "themes" / "themes.local.json"
    shared_catalog = local_catalog.with_name("themes.json")
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description="Compile themes.json + engine/core.js -> dist/theme_payload.js")
    parser.add_argument("--themes", type=Path, default=local_catalog if local_catalog.is_file() else shared_catalog)
    parser.add_argument("--engine", type=Path, default=repo_root / "engine" / "core.js")
    parser.add_argument("--out", type=Path, default=repo_root / "dist" / "theme_payload.js")
    parser.add_argument("--max-dim", type=int, default=DEFAULT_MAX_DIM)
    args = parser.parse_args()

    build_payload(args.themes, args.engine, args.out, args.max_dim)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
