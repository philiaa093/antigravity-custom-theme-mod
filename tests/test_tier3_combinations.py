"""Tier 3: Pairwise Cross-Feature Integration Test Suite (10 Tests, TC-3.1 to TC-3.10).

Tests orthogonal combinations across:
Theme Source (Image Dark, Image Light, Pure CSS, Wallpaper)
x Typography (Default, Inter/JetBrains, Geist/Fira, Cascadia)
x Audio Setting (Enabled, Disabled)
x Avatar Preset (Anime SVG, Robot SVG, Pixel SVG, Custom WebP, Disabled 'none')
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Dict

import pytest

PAIRWISE_MATRIX = [
    {
        "id": "TC-3.1",
        "name": "Pairwise 1: Dark Image + JetBrains Mono + Audio Enabled + Anime Avatar",
        "theme_source": "img_dark",
        "font_ui": "Inter, sans-serif",
        "font_code": "'JetBrains Mono', monospace",
        "audio_enabled": True,
        "avatar_type": "anime",
    },
    {
        "id": "TC-3.2",
        "name": "Pairwise 2: Light Image + Default Font + Audio Disabled + Robot Avatar",
        "theme_source": "img_light",
        "font_ui": "",
        "font_code": "",
        "audio_enabled": False,
        "avatar_type": "robot",
    },
    {
        "id": "TC-3.3",
        "name": "Pairwise 3: Pure CSS + Geist/Fira + Audio Enabled + Pixel Avatar",
        "theme_source": "css_pure",
        "font_ui": "Geist, sans-serif",
        "font_code": "'Fira Code', monospace",
        "audio_enabled": True,
        "avatar_type": "pixel",
    },
    {
        "id": "TC-3.4",
        "name": "Pairwise 4: Wallpaper + Cascadia Code + Audio Disabled + Custom WebP Avatar",
        "theme_source": "wallpaper",
        "font_ui": "'Cascadia Code', monospace",
        "font_code": "'Cascadia Code', monospace",
        "audio_enabled": False,
        "avatar_type": "custom_webp",
    },
    {
        "id": "TC-3.5",
        "name": "Pairwise 5: Dark Image + Geist + Audio Disabled + Disabled Avatars",
        "theme_source": "img_dark",
        "font_ui": "Geist, sans-serif",
        "font_code": "",
        "audio_enabled": False,
        "avatar_type": "none",
    },
    {
        "id": "TC-3.6",
        "name": "Pairwise 6: Light Image + Cascadia + Audio Enabled + Anime Avatar",
        "theme_source": "img_light",
        "font_ui": "'Cascadia Code', monospace",
        "font_code": "'Cascadia Code', monospace",
        "audio_enabled": True,
        "avatar_type": "anime",
    },
    {
        "id": "TC-3.7",
        "name": "Pairwise 7: Pure CSS + Default Font + Audio Enabled + Robot Avatar",
        "theme_source": "css_pure",
        "font_ui": "",
        "font_code": "",
        "audio_enabled": True,
        "avatar_type": "robot",
    },
    {
        "id": "TC-3.8",
        "name": "Pairwise 8: Wallpaper + JetBrains Mono + Audio Enabled + Pixel Avatar",
        "theme_source": "wallpaper",
        "font_ui": "Inter, sans-serif",
        "font_code": "'JetBrains Mono', monospace",
        "audio_enabled": True,
        "avatar_type": "pixel",
    },
    {
        "id": "TC-3.9",
        "name": "Pairwise 9: Saturated Dark Image + Cascadia + Audio Disabled + Custom Avatar",
        "theme_source": "img_dark",
        "font_ui": "'Cascadia Code', monospace",
        "font_code": "'Fira Code', monospace",
        "audio_enabled": False,
        "avatar_type": "custom_webp",
    },
    {
        "id": "TC-3.10",
        "name": "Pairwise 10: Light Image + JetBrains Mono + Audio Disabled + Disabled Avatars",
        "theme_source": "img_light",
        "font_ui": "Inter, sans-serif",
        "font_code": "'JetBrains Mono', monospace",
        "audio_enabled": False,
        "avatar_type": "none",
    },
]


def _generate_pairwise_theme(cfg: Dict[str, Any], tmp_path: Path) -> Dict[str, Any]:
    """Generates a complete 27-token theme definition and required synthetic assets."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    is_light = cfg["theme_source"] == "img_light"
    theme_source = cfg["theme_source"]

    # Base colors
    primary = "#0284c7" if is_light else "#38bdf8"
    secondary = "#d97706" if is_light else "#fbbf24"
    text_color = "#0f172a" if is_light else "#f8fafc"
    overlay_rgb = "248, 250, 252" if is_light else "15, 23, 42"

    # Wallpaper setup
    wallpaper_val = ""
    pure_bg = ""
    if theme_source == "wallpaper":
        wp_path = assets_dir / "test_wp.webp"
        if not wp_path.is_file():
            # Write minimal valid WebP header or 1x1 image
            from PIL import Image
            Image.new("RGB", (64, 64), (20, 30, 50)).save(wp_path, format="WEBP")
        wallpaper_val = "assets/test_wp.webp"
    elif theme_source == "css_pure":
        pure_bg = "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)"

    # Avatar setup
    avatar_val = ""
    avatar_type = cfg["avatar_type"]
    if avatar_type in ("anime", "robot", "pixel"):
        svg_file = assets_dir / f"avatar_{avatar_type}.svg"
        if not svg_file.is_file():
            svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
              <clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath>
              <g clip-path="url(#c)"><rect width="100" height="100" fill="{primary}"/></g>
            </svg>"""
            svg_file.write_text(svg_content, encoding="utf-8")
        avatar_val = f"assets/avatar_{avatar_type}.svg"
    elif avatar_type == "custom_webp":
        avatar_val = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAEAESs="
    elif avatar_type == "none":
        avatar_val = ""

    theme = {
        "concept": f"Pairwise test for {cfg['id']}",
        "primary": primary,
        "secondary": secondary,
        "glow": f"rgba(56, 189, 248, 0.35)",
        "secondaryGlow": f"rgba(251, 191, 36, 0.25)",
        "bg": "#f8fafc" if is_light else "#0f172a",
        "frameBg": "#e2e8f0" if is_light else "#1e293b",
        "textColor": text_color,
        "borderColor": "rgba(15, 23, 42, 0.1)" if is_light else "rgba(255, 255, 255, 0.1)",
        "innerBorder": "1px solid rgba(255, 255, 255, 0.05)",
        "clearBackdrop": True,
        "overlayRgb": overlay_rgb,
        "sidebarBg": "rgba(248, 250, 252, 0.75)" if is_light else "rgba(15, 23, 42, 0.6)",
        "sidebarHoverBg": "rgba(15, 23, 42, 0.05)" if is_light else "rgba(255, 255, 255, 0.06)",
        "aiCardBg": "rgba(255, 255, 255, 0.8)" if is_light else "rgba(15, 23, 42, 0.7)",
        "aiCardBorder": "rgba(15, 23, 42, 0.12)" if is_light else "rgba(255, 255, 255, 0.08)",
        "headerBg": "rgba(248, 250, 252, 0.75)" if is_light else "rgba(15, 23, 42, 0.6)",
        "headerBorder": "rgba(15, 23, 42, 0.1)" if is_light else "rgba(255, 255, 255, 0.08)",
        "unifiedGlass": True,
        "btnBg": "rgba(241, 245, 249, 0.9)" if is_light else "rgba(30, 41, 59, 0.8)",
        "inputGlassBg": "rgba(255, 255, 255, 0.6)" if is_light else "rgba(15, 23, 42, 0.5)",
        "inputCardBg": "#ffffff" if is_light else "#0f172a",
        "modalBg": "rgba(255, 255, 255, 0.98)" if is_light else "rgba(15, 23, 42, 0.95)",
        "modalHeaderBg": "rgba(255, 255, 255, 0.98)" if is_light else "rgba(15, 23, 42, 0.95)",
        "cardBg": "rgba(241, 245, 249, 0.8)" if is_light else "rgba(30, 41, 59, 0.5)",
        "cardSelectedBg": "rgba(56, 189, 248, 0.15)",
        "wallpaper": wallpaper_val,
    }

    if is_light:
        theme["isLight"] = True
        theme["uiTextColor"] = "#0f172a"
    if pure_bg:
        theme["pureBg"] = pure_bg
    if cfg["font_ui"]:
        theme["fontFamily"] = cfg["font_ui"]
    if cfg["font_code"]:
        theme["codeFontFamily"] = cfg["font_code"]
    if avatar_val:
        theme["userAvatar"] = avatar_val
        theme["agentAvatar"] = avatar_val

    return theme


@pytest.mark.parametrize("case", PAIRWISE_MATRIX, ids=lambda c: c["id"])
def test_pairwise_cross_feature_combination(
    case: Dict[str, Any],
    repo_root: Path,
    tmp_path: Path,
    theme_validator: Callable,
    node_runner: Callable,
):
    """Executes pairwise integration test for Theme Source x Typography x Audio x Avatar."""
    # Step 1: Generate valid theme configuration conforming to references/theme-schema.md
    theme_dict = _generate_pairwise_theme(case, tmp_path)
    theme_name = f"Test_{case['id']}"
    theme_validator(theme_name, theme_dict)

    # Step 2: Write temporary themes.json
    themes_json_path = tmp_path / "themes.json"
    themes_json_path.write_text(json.dumps({theme_name: theme_dict}, indent=2), encoding="utf-8")

    # Step 3: Compile standalone payload with scripts/build_payload.py
    dist_payload_path = tmp_path / "dist" / "theme_payload.js"
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import build_payload
        build_payload(
            themes_path=themes_json_path,
            engine_path=repo_root / "engine" / "core.js",
            out_path=dist_payload_path,
            max_dim=2560,
        )
    finally:
        sys.path.pop(0)

    assert dist_payload_path.is_file(), "Compiled payload was not created"
    payload_content = dist_payload_path.read_text(encoding="utf-8")

    # Step 4: Verify Node.js JavaScript syntax
    node_res = subprocess.run(["node", "-c", str(dist_payload_path)], capture_output=True, text=True)
    assert node_res.returncode == 0, f"Payload compilation has JS syntax errors: {node_res.stderr}"

    # Step 5: Assert Zero Live Blur guardrail is maintained
    assert "backdrop-filter: none !important;" in payload_content, (
        "Zero Live Blur rule backdrop-filter: none !important must be in compiled payload"
    )

    # Step 6: Verify Theme registration in payload
    assert theme_name in payload_content, f"Theme '{theme_name}' was not bundled into payload"

    # Step 7: Headless VM evaluation with simulated browser state
    sound_flag = "true" if case["audio_enabled"] else "false"
    test_js = f"""
    sandbox.localStorage.setItem('agy_sound_enabled_v3', '{sound_flag}');
    // Execute payload in sandbox
    const payloadCode = {json.dumps(payload_content)};
    const res = vm.runInContext(payloadCode, sandbox);
    """
    vm_res = node_runner(test_js)
    assert vm_res.returncode == 0, f"Headless VM evaluation failed: {vm_res.stderr}"
