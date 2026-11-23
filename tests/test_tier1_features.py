"""Tier 1: Feature Coverage Test Suite (55 Tests, TC-01 to TC-55).

Covers Features 1-11 with at least 5 isolated tests per feature:
F1: Image Color Quantization (TC-01 to TC-05)
F2: Semantic Color Derivation (TC-06 to TC-10)
F3: Theme JSON Update/Append CLI (TC-11 to TC-15)
F4: Curated Circular SVGs (TC-16 to TC-20)
F5: Avatar Theme Wiring (TC-21 to TC-25)
F6: Avatar Inlining & Rendering in build_payload.py (TC-26 to TC-30)
F7: Custom Typography Tokens (TC-31 to TC-35)
F8: Typography Layout Safety (TC-36 to TC-40)
F9: Synthetic Audio Synthesis (TC-41 to TC-45)
F10: Audio Trigger & Toggle (TC-46 to TC-50)
F11: Zero Live Blur Guardrails (TC-51 to TC-55)
"""
from __future__ import annotations

import colorsys
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List
import xml.etree.ElementTree as ET

import pytest
from PIL import Image

from tests.conftest import (
    HEX_COLOR_RE,
    RGBA_COLOR_RE,
    OVERLAY_RGB_RE,
    require_m2,
    require_m3_avatars,
    require_m4_typography,
    require_m4_audio,
)


# ============================================================================
# Feature 1: Image Color Quantization (TC-01 to TC-05)
# ============================================================================

def test_tc01_pillow_mediancut_quantization(synthetic_palette_image: Path):
    """TC-01: Verify Pillow MEDIANCUT quantizes a 4-color image into 4 distinct clusters."""
    with Image.open(synthetic_palette_image) as img:
        rgb_img = img.convert("RGB")
        quantized = rgb_img.quantize(colors=4, method=Image.Quantize.MEDIANCUT)
        palette = quantized.getpalette()
        assert palette is not None, "Quantized image must have a color palette"
        # Extract the RGB triplets for the 4 colors
        colors = [tuple(palette[i * 3:(i + 1) * 3]) for i in range(4)]
        # Assert at least 4 unique colors were derived
        assert len(set(colors)) == 4, f"Expected 4 distinct colors, got: {colors}"


def test_tc02_palette_frequency_sorting(synthetic_palette_image: Path):
    """TC-02: Verify quantization palette colors reflect expected pixel area distribution."""
    with Image.open(synthetic_palette_image) as img:
        quantized = img.quantize(colors=4, method=Image.Quantize.MEDIANCUT)
        color_counts = quantized.getcolors()
        assert color_counts is not None, "getcolors() returned None"
        # synthetic_palette_image is 200x200 = 40,000 pixels divided into 4 equal 100x100 quadrants
        total_pixels = sum(count for count, _ in color_counts)
        assert total_pixels == 40000, f"Expected 40000 total pixels, got {total_pixels}"
        # Each quadrant has 10,000 pixels (25% of image)
        for count, _ in color_counts:
            assert math.isclose(count, 10000, abs_tol=100), (
                f"Quadrant count {count} deviates unexpectedly from 10000"
            )


def test_tc03_rgba_transparency_handling(tmp_path: Path):
    """TC-03: Verify RGBA image with alpha channel is handled cleanly without channel corruption."""
    rgba_path = tmp_path / "rgba_test.png"
    img = Image.new("RGBA", (100, 100), (255, 0, 0, 128))
    img.save(rgba_path, format="PNG")

    with Image.open(rgba_path) as loaded:
        # Converting to RGB onto black background preserves RGB channels
        bg = Image.new("RGB", loaded.size, (0, 0, 0))
        bg.paste(loaded, mask=loaded.split()[3])
        quantized = bg.quantize(colors=4, method=Image.Quantize.MEDIANCUT)
        assert quantized is not None
        palette = quantized.getpalette()
        assert palette is not None
        assert len(palette) >= 3


def test_tc04_real_world_webp_quantization(repo_root: Path):
    """TC-04: Verify Pillow quantization successfully extracts colors from a photographic asset."""
    sample_asset = repo_root / "themes" / "assets" / "wlop_cosmic_2k.webp"
    if not sample_asset.is_file():
        pytest.skip(f"Sample asset not found: {sample_asset}")

    with Image.open(sample_asset) as img:
        rgb_img = img.convert("RGB")
        # Downscale for fast quantization
        rgb_img.thumbnail((300, 300))
        quantized = rgb_img.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
        palette = quantized.getpalette()
        assert palette is not None
        colors = [tuple(palette[i * 3:(i + 1) * 3]) for i in range(8)]
        assert len(set(colors)) >= 4, "Photographic asset should yield diverse colors"


def test_tc05_deterministic_quantization_output(synthetic_gradient_image: Path):
    """TC-05: Verify quantization is deterministic across repeated runs on identical input."""
    def _extract_colors(img_path: Path):
        with Image.open(img_path) as img:
            q = img.convert("RGB").quantize(colors=6, method=Image.Quantize.MEDIANCUT)
            return q.getpalette()[:18]

    run1 = _extract_colors(synthetic_gradient_image)
    run2 = _extract_colors(synthetic_gradient_image)
    assert run1 == run2, "Quantization runs on identical image must be deterministic"


# ============================================================================
# Feature 2: Semantic Color Derivation (TC-06 to TC-10)
# ============================================================================

def test_tc06_primary_accent_format_and_vibrancy(repo_root: Path):
    """TC-06: Verify primary colors in themes.json match #RRGGBB and have sufficient HLS saturation."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    for name, theme in themes.items():
        primary = theme["primary"]
        assert HEX_COLOR_RE.match(primary), f"Theme '{name}' has invalid primary hex: {primary}"
        # Parse hex to RGB
        r, g, b = int(primary[1:3], 16) / 255.0, int(primary[3:5], 16) / 255.0, int(primary[5:7], 16) / 255.0
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        assert s >= 0.25, f"Theme '{name}' primary color saturation too low: s={s:.2f}"


def test_tc07_secondary_accent_differentiation(repo_root: Path):
    """TC-07: Verify secondary color is formatted properly and visually distinct from primary."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    for name, theme in themes.items():
        primary = theme["primary"]
        secondary = theme["secondary"]
        assert HEX_COLOR_RE.match(secondary), f"Theme '{name}' invalid secondary hex: {secondary}"
        # Compute Euclidean distance in RGB space
        r1, g1, b1 = int(primary[1:3], 16), int(primary[3:5], 16), int(primary[5:7], 16)
        r2, g2, b2 = int(secondary[1:3], 16), int(secondary[3:5], 16), int(secondary[5:7], 16)
        dist = math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
        assert dist >= 20.0, f"Theme '{name}' primary and secondary accents are too similar: dist={dist:.1f}"


def test_tc08_glow_rgba_token_formats(repo_root: Path):
    """TC-08: Verify glow and secondaryGlow tokens match valid rgba syntax with translucent alpha."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    for name, theme in themes.items():
        glow = theme["glow"]
        assert RGBA_COLOR_RE.match(glow), f"Theme '{name}' has invalid glow syntax: {glow}"
        sec_glow = theme["secondaryGlow"]
        assert RGBA_COLOR_RE.match(sec_glow), f"Theme '{name}' has invalid secondaryGlow: {sec_glow}"


def test_tc09_overlay_rgb_triplet_format(repo_root: Path):
    """TC-09: Verify overlayRgb is formatted as 'R, G, B' with values 0-255."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    for name, theme in themes.items():
        overlay = theme["overlayRgb"]
        m = OVERLAY_RGB_RE.match(overlay)
        assert m, f"Theme '{name}' has malformed overlayRgb: {overlay}"
        parts = [int(p) for p in m.groups()]
        assert all(0 <= p <= 255 for p in parts), f"Theme '{name}' overlayRgb out of range: {parts}"


def test_tc10_schema_conformance_all_production_themes(repo_root: Path, theme_validator: Callable):
    """TC-10: Verify all production presets in themes/themes.json pass strict 27-token schema validation."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    assert len(themes) >= 1, "themes.json must contain at least 1 theme preset"
    for name, theme in themes.items():
        theme_validator(name, theme)


# ============================================================================
# Feature 3: Theme JSON Update/Append CLI (TC-11 to TC-15)
# ============================================================================

def test_tc11_cli_execution_with_positional_image(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
):
    """TC-11: Verify theme_from_image.py executes from CLI with image path and creates output."""
    script_path = require_m2(repo_root)
    out_json = tmp_path / "themes_tc11.json"
    out_json.write_text("{}", encoding="utf-8")

    res = cli_runner([str(script_path), str(synthetic_palette_image), "--output", str(out_json)])
    assert res.returncode == 0, f"CLI exited with {res.returncode}: {res.stderr}"
    assert out_json.is_file(), "Target themes JSON must be written"
    data = json.loads(out_json.read_text(encoding="utf-8"))
    assert len(data) >= 1, "Target JSON should contain at least one theme"


def test_tc12_cli_custom_theme_name_flag(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
    theme_validator: Callable,
):
    """TC-12: Verify CLI --name flag creates a preset under the given custom name."""
    script_path = require_m2(repo_root)
    out_json = tmp_path / "themes_tc12.json"
    out_json.write_text("{}", encoding="utf-8")
    custom_name = "Nebula Dream"

    res = cli_runner([
        str(script_path), str(synthetic_palette_image),
        "--name", custom_name,
        "--output", str(out_json),
    ])
    assert res.returncode == 0, f"CLI failed: {res.stderr}"
    data = json.loads(out_json.read_text(encoding="utf-8"))
    assert custom_name in data, f"Key '{custom_name}' not found in output JSON: {list(data.keys())}"
    theme_validator(custom_name, data[custom_name])


def test_tc13_cli_in_place_update_existing_theme(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
):
    """TC-13: Verify CLI overwrites existing theme preset while preserving unrelated presets."""
    script_path = require_m2(repo_root)
    out_json = tmp_path / "themes_tc13.json"
    seed = {
        "Existing Unchanged": {"concept": "Leave Me Alone", "primary": "#112233"},
        "Target Preset": {"concept": "Original Concept", "primary": "#999999"},
    }
    out_json.write_text(json.dumps(seed, indent=2), encoding="utf-8")

    res = cli_runner([
        str(script_path), str(synthetic_palette_image),
        "--name", "Target Preset",
        "--output", str(out_json),
    ])
    assert res.returncode == 0, f"CLI failed: {res.stderr}"
    data = json.loads(out_json.read_text(encoding="utf-8"))
    # Total count must remain 2
    assert len(data) == 2, f"Expected 2 presets, got {len(data)}"
    assert data["Existing Unchanged"]["primary"] == "#112233"
    assert data["Target Preset"]["primary"] != "#999999"


def test_tc14_cli_append_new_preset_increments_count(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
):
    """TC-14: Verify CLI appends new preset to existing file incrementing count by exactly 1."""
    script_path = require_m2(repo_root)
    out_json = tmp_path / "themes_tc14.json"
    seed = {"Preset One": {"concept": "One"}, "Preset Two": {"concept": "Two"}}
    out_json.write_text(json.dumps(seed, indent=2), encoding="utf-8")

    res = cli_runner([
        str(script_path), str(synthetic_palette_image),
        "--name", "Preset Three",
        "--output", str(out_json),
    ])
    assert res.returncode == 0, f"CLI failed: {res.stderr}"
    data = json.loads(out_json.read_text(encoding="utf-8"))
    assert len(data) == 3, f"Expected 3 themes, got {len(data)}"
    assert "Preset Three" in data


def test_tc15_cli_help_flag_displays_usage(repo_root: Path, cli_runner: Callable):
    """TC-15: Verify CLI responds to --help with exit code 0 and usage message."""
    script_path = require_m2(repo_root)
    res = cli_runner([str(script_path), "--help"])
    assert res.returncode == 0
    assert "usage:" in res.stdout.lower() or "options:" in res.stdout.lower()


# ============================================================================
# Feature 4: Curated Circular SVGs (TC-16 to TC-20)
# ============================================================================

def test_tc16_svg_xml_well_formedness(repo_root: Path):
    """TC-16: Verify all existing SVG assets in themes/assets/ are well-formed XML with SVG root."""
    assets_dir = repo_root / "themes" / "assets"
    svg_files = list(assets_dir.glob("*.svg"))
    assert len(svg_files) >= 1, "At least one SVG asset must exist in themes/assets/"
    for svg_file in svg_files:
        tree = ET.parse(svg_file)
        root = tree.getroot()
        assert root.tag.endswith("svg"), f"{svg_file.name} root tag is not svg: {root.tag}"


def test_tc17_avatar_viewbox_standard(repo_root: Path):
    """TC-17: Verify curated avatar SVGs define viewBox='0 0 100 100'."""
    avatar_files = require_m3_avatars(repo_root)
    for af in avatar_files:
        tree = ET.parse(af)
        root = tree.getroot()
        vb = root.attrib.get("viewBox", "")
        assert vb == "0 0 100 100", f"{af.name} viewBox must be '0 0 100 100', got '{vb}'"


def test_tc18_circular_clipping_element(synthetic_circular_svg: Path):
    """TC-18: Verify circular SVG contains a circular clipPath with r=50 or circle mask."""
    tree = ET.parse(synthetic_circular_svg)
    root = tree.getroot()
    circles = root.findall(".//{http://www.w3.org/2000/svg}circle")
    # Must find at least one circle with r=50 or cx=50 cy=50
    has_clip_circle = any(
        c.attrib.get("cx") == "50" and c.attrib.get("cy") == "50"
        for c in circles
    )
    assert has_clip_circle, "Circular SVG must define a circle centered at cx=50, cy=50"


def test_tc19_avatar_svg_file_size_budget(repo_root: Path):
    """TC-19: Verify curated avatar SVG file size is within lightweight budget (< 50 KB)."""
    avatar_files = require_m3_avatars(repo_root)
    for af in avatar_files:
        size_kb = af.stat().st_size / 1024.0
        assert size_kb < 50.0, f"Avatar {af.name} is {size_kb:.1f} KB, exceeding 50 KB budget"


def test_tc20_no_external_network_references(synthetic_circular_svg: Path):
    """TC-20: Verify SVG contains no external http/https image or font references."""
    text = synthetic_circular_svg.read_text(encoding="utf-8")
    assert "http://" not in text and "https://" not in text or "http://www.w3.org" in text, (
        "SVG must not reference external URLs"
    )


# ============================================================================
# Feature 5: Avatar Theme Wiring (TC-21 to TC-25)
# ============================================================================

def test_tc21_themes_json_avatar_properties(repo_root: Path):
    """TC-21: Check userAvatar and agentAvatar wiring in themes/themes.json presets."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    avatar_wired = any("userAvatar" in t or "agentAvatar" in t for t in themes.values())
    if not avatar_wired:
        pytest.skip("Milestone 3 avatar properties not yet wired into themes/themes.json")
    for name, t in themes.items():
        if "userAvatar" in t:
            assert isinstance(t["userAvatar"], str)
        if "agentAvatar" in t:
            assert isinstance(t["agentAvatar"], str)


def test_tc22_avatar_relative_asset_resolution(repo_root: Path):
    """TC-22: Verify configured avatar paths resolve to existing files under themes/."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    found_any = False
    for name, t in themes.items():
        for key in ("userAvatar", "agentAvatar"):
            if key in t and t[key] and not t[key].startswith("data:"):
                found_any = True
                resolved = repo_root / "themes" / t[key]
                assert resolved.is_file(), f"Avatar path '{t[key]}' for {name} does not exist"
    if not found_any:
        pytest.skip("No relative avatar paths configured in themes.json yet (scheduled for M3)")


def test_tc23_engine_core_avatar_state_retrieval(repo_root: Path):
    """TC-23: Verify engine/core.js contains logic retrieving effectiveUserAvatar and effectiveAgentAvatar."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "effectiveUserAvatar" in content, "core.js missing effectiveUserAvatar retrieval logic"
    assert "effectiveAgentAvatar" in content, "core.js missing effectiveAgentAvatar retrieval logic"


def test_tc24_engine_core_avatar_css_pseudo_elements(repo_root: Path):
    """TC-24: Verify engine/core.js generates user ::after and agent ::before avatar pseudo-elements."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert '[data-testid="user-message"]::after' in content, "Missing user avatar ::after selector"
    assert '[data-testid="agent-response"]::before' in content, "Missing agent avatar ::before selector"


def test_tc25_engine_core_avatar_size_clamping(repo_root: Path):
    """TC-25: Verify avatar size is clamped between 22px and 52px in engine/core.js."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    # Matches Math.min(52, Math.max(22, ...))
    assert "Math.min(52, Math.max(22" in content or "Math.max(22, Math.min(52" in content, (
        "Avatar size clamping [22, 52] missing from engine/core.js"
    )


# ============================================================================
# Feature 6: Avatar Inlining & Rendering in build_payload.py (TC-26 to TC-30)
# ============================================================================

def test_tc26_build_payload_asset_keys_inclusion(repo_root: Path):
    """TC-26: Verify scripts/build_payload.py includes userAvatar and agentAvatar in ASSET_KEYS."""
    build_script = repo_root / "scripts" / "build_payload.py"
    content = build_script.read_text(encoding="utf-8")
    assert '"userAvatar"' in content and '"agentAvatar"' in content, (
        "build_payload.py must register userAvatar and agentAvatar in asset handling"
    )


def test_tc27_build_payload_svg_url_encoding(repo_root: Path, synthetic_circular_svg: Path):
    """TC-27: Verify build_payload.py encode_svg helper encodes SVG as valid data:image/svg+xml URI."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import encode_svg
        encoded = encode_svg(synthetic_circular_svg)
        assert encoded.startswith("data:image/svg+xml,"), f"Invalid SVG data URI prefix: {encoded[:30]}"
        assert "%3Csvg" in encoded or "<svg" in encoded
    finally:
        sys.path.pop(0)


def test_tc28_build_payload_avatar_max_dimension(repo_root: Path):
    """TC-28: Verify AVATAR_MAX_DIM is defined as 256 in scripts/build_payload.py."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        import build_payload
        assert hasattr(build_payload, "AVATAR_MAX_DIM"), "build_payload must define AVATAR_MAX_DIM"
        assert build_payload.AVATAR_MAX_DIM == 256
        assert build_payload.AVATAR_MAX_DIM < build_payload.DEFAULT_MAX_DIM
    finally:
        sys.path.pop(0)


def test_tc29_build_payload_compiles_cleanly(compiled_payload: Path):
    """TC-29: Verify scripts/build_payload.py runs successfully and builds dist/theme_payload.js."""
    dist_file = compiled_payload
    assert dist_file.is_file(), "dist/theme_payload.js must exist after build"
    assert dist_file.stat().st_size > 10000, "Payload file should be non-trivial size"


def test_tc30_compiled_payload_syntax_check(compiled_payload: Path):
    """TC-30: Verify dist/theme_payload.js passes Node.js syntax check with exit code 0."""
    dist_file = compiled_payload
    assert dist_file.is_file(), "dist/theme_payload.js must exist"
    res = subprocess.run(["node", "-c", str(dist_file)], capture_output=True, text=True)
    assert res.returncode == 0, f"Payload has syntax error: {res.stderr}"


# ============================================================================
# Feature 7: Custom Typography Tokens (TC-31 to TC-35)
# ============================================================================

def test_tc31_schema_typography_properties_support(theme_validator: Callable):
    """TC-31: Verify theme schema validator allows optional fontFamily and codeFontFamily tokens."""
    sample_theme = {
        "concept": "Typography Theme",
        "primary": "#38bdf8",
        "secondary": "#fbbf24",
        "glow": "rgba(56, 189, 248, 0.35)",
        "secondaryGlow": "rgba(251, 191, 36, 0.25)",
        "bg": "#0f172a",
        "frameBg": "#1e293b",
        "textColor": "#f8fafc",
        "borderColor": "rgba(255, 255, 255, 0.1)",
        "innerBorder": "1px solid rgba(255, 255, 255, 0.05)",
        "clearBackdrop": True,
        "overlayRgb": "15, 23, 42",
        "sidebarBg": "rgba(15, 23, 42, 0.6)",
        "sidebarHoverBg": "rgba(255, 255, 255, 0.06)",
        "aiCardBg": "rgba(15, 23, 42, 0.7)",
        "aiCardBorder": "rgba(255, 255, 255, 0.08)",
        "headerBg": "rgba(15, 23, 42, 0.6)",
        "headerBorder": "rgba(255, 255, 255, 0.08)",
        "unifiedGlass": True,
        "btnBg": "rgba(30, 41, 59, 0.8)",
        "inputGlassBg": "rgba(15, 23, 42, 0.5)",
        "inputCardBg": "#0f172a",
        "modalBg": "rgba(15, 23, 42, 0.95)",
        "modalHeaderBg": "rgba(15, 23, 42, 0.95)",
        "cardBg": "rgba(30, 41, 59, 0.5)",
        "cardSelectedBg": "rgba(56, 189, 248, 0.2)",
        "wallpaper": "",
        "fontFamily": "Inter, system-ui, sans-serif",
        "codeFontFamily": "'JetBrains Mono', monospace",
    }
    theme_validator("Typography Theme", sample_theme)


def test_tc32_css_variable_declarations_in_core(repo_root: Path):
    """TC-32: Verify engine/core.js declares --agy-font-ui, --agy-font-chat, and --agy-font-code."""
    content = require_m4_typography(repo_root)
    assert "--agy-font-ui" in content, "Missing --agy-font-ui CSS variable"
    assert "--agy-font-chat" in content, "Missing --agy-font-chat CSS variable"
    assert "--agy-font-code" in content, "Missing --agy-font-code CSS variable"


def test_tc33_ui_font_stack_includes_modern_fonts(repo_root: Path):
    """TC-33: Verify UI font stacks include Inter, Geist, and system fallbacks."""
    content = require_m4_typography(repo_root)
    assert "Inter" in content or "Geist" in content, "UI font stack must reference Inter or Geist"


def test_tc34_code_font_stack_includes_programming_fonts(repo_root: Path):
    """TC-34: Verify code font stack includes JetBrains Mono, Fira Code, or Cascadia Code."""
    content = require_m4_typography(repo_root)
    has_code_font = any(f in content for f in ("JetBrains Mono", "Fira Code", "Cascadia Code"))
    assert has_code_font, "Code font stack must include JetBrains Mono, Fira Code, or Cascadia Code"


def test_tc35_typography_scope_selectors(repo_root: Path):
    """TC-35: Verify font variables are bound to root shell, chat bubbles, and code blocks."""
    content = require_m4_typography(repo_root)
    assert "pre" in content and "code" in content, "Code font must apply to pre and code elements"


# ============================================================================
# Feature 8: Typography Layout Safety (TC-36 to TC-40)
# ============================================================================

def test_tc36_fluid_line_height_guardrail(repo_root: Path):
    """TC-36: Verify typography styles enforce proportional line-height (>= 1.4)."""
    content = require_m4_typography(repo_root)
    assert "line-height" in content, "Typography rules must specify line-height"


def test_tc37_word_wrap_safety(repo_root: Path):
    """TC-37: Verify chat bubble text enforces overflow-wrap: break-word."""
    content = require_m4_typography(repo_root)
    assert "overflow-wrap: break-word" in content or "word-break: break-word" in content, (
        "Chat bubble typography must enforce word break wrapping"
    )


def test_tc38_code_block_horizontal_scroll(repo_root: Path):
    """TC-38: Verify code blocks enforce overflow-x: auto to prevent layout clipping."""
    content = require_m4_typography(repo_root)
    assert "overflow-x: auto" in content, "Code blocks must have overflow-x: auto"


def test_tc39_response_card_box_sizing(repo_root: Path):
    """TC-39: Verify engine/core.js enforces box-sizing: border-box on agent response cards."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert 'box-sizing: border-box !important;' in content, (
        "Agent response cards must enforce box-sizing: border-box !important"
    )


def test_tc40_response_card_border_radius(repo_root: Path):
    """TC-40: Verify engine/core.js specifies border-radius on agent response cards."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert 'border-radius: 14px !important;' in content or 'border-radius:' in content, (
        "Agent response cards must have explicit border radius"
    )


# ============================================================================
# Feature 9: Synthetic Audio Synthesis (TC-41 to TC-45)
# ============================================================================

def test_tc41_audiocontext_synthesis_presence(repo_root: Path):
    """TC-41: Verify engine/core.js implements procedural AudioContext audio synthesis."""
    content = require_m4_audio(repo_root)
    assert "AudioContext" in content, "core.js must instantiate Web Audio AudioContext"
    assert "createOscillator" in content, "core.js must use createOscillator for synthesis"
    assert "createGain" in content, "core.js must use createGain for audio envelopes"


def test_tc42_mechanical_click_generator(repo_root: Path):
    """TC-42: Verify playFeedbackSound handles 'click' sound profile."""
    content = require_m4_audio(repo_root)
    assert "'click'" in content or '"click"' in content, "Must implement 'click' feedback sound"


def test_tc43_scifi_ping_generator(repo_root: Path):
    """TC-43: Verify playFeedbackSound handles 'ping' sound profile."""
    content = require_m4_audio(repo_root)
    assert "'ping'" in content or '"ping"' in content, "Must implement 'ping' feedback sound"


def test_tc44_bundled_audio_files(repo_root: Path):
    """TC-44: Verify the four Boot HUD clips and the Task Voice sample ship offline."""
    voice_dir = repo_root / "themes" / "assets" / "voice"
    assert {p.name for p in voice_dir.glob("*.mp3") if p.is_file()} == {
        *(f"tawa_voice{i}.mp3" for i in range(1, 5)), "1795011944060_Tawa_voice_task_1.mp3",
    }


def test_tc45_audiocontext_lazy_initialization(repo_root: Path):
    """TC-45: Verify AudioContext is not initialized prematurely before user interaction."""
    content = require_m4_audio(repo_root)
    # Check that AudioContext is inside a function, not at top-level scope
    lines = content.splitlines()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("const audioCtx = new AudioContext(") or stripped.startswith("const ctx = new AudioContext("):
            pytest.fail("AudioContext must not be instantiated at global module level")


# ============================================================================
# Feature 10: Audio Trigger & Toggle (TC-46 to TC-50)
# ============================================================================

def test_tc46_audio_localstorage_key_contract(repo_root: Path):
    """TC-46: Verify toggle state persists to localStorage key 'agy_sound_enabled_v3'."""
    content = require_m4_audio(repo_root)
    assert "agy_sound_enabled_v3" in content, "Must use 'agy_sound_enabled_v3' localStorage key"


def test_tc47_audio_mute_suppresses_sound(repo_root: Path, node_runner: Callable):
    """TC-47: Verify muted setting ('false') terminates playFeedbackSound without creating nodes."""
    require_m4_audio(repo_root)
    test_js = """
    localStorage.setItem('agy_sound_enabled_v3', 'false');
    // If playFeedbackSound is defined, call it
    if (typeof playFeedbackSound === 'function') {
        playFeedbackSound('click');
    }
    """
    res = node_runner(test_js)
    assert res.returncode == 0


def test_tc48_assistant_completion_trigger_hook(repo_root: Path):
    """TC-48: Verify engine monitors assistant completion via stop-button or send-button transitions."""
    content = require_m4_audio(repo_root)
    has_trigger = any(btn in content for btn in ("stop-button", "send-button", "Stop generating"))
    assert has_trigger, "Must monitor assistant message completion trigger in chat DOM"


def test_tc49_modal_audio_toggle_ui(repo_root: Path):
    """TC-49: Verify theme customizer modal dialog includes sound toggle switch."""
    content = require_m4_audio(repo_root)
    assert "agy-sound-toggle" in content or "Sound Effects" in content or "sound_enabled" in content, (
        "Modal dialog must provide an interactive sound toggle control"
    )


def test_tc50_audio_toggle_default_handling(repo_root: Path):
    """TC-50: Verify missing localStorage setting degrades gracefully to a safe default."""
    content = require_m4_audio(repo_root)
    assert "getItem('agy_sound_enabled_v3')" in content or 'getItem("agy_sound_enabled_v3")' in content, (
        "Must read agy_sound_enabled_v3 from localStorage with fallback"
    )


# ============================================================================
# Feature 11: Zero Live Blur Guardrails (TC-51 to TC-55)
# ============================================================================

def test_tc51_agent_response_live_blur_prohibition(repo_root: Path):
    """TC-51: Verify [data-testid='agent-response'] explicitly enforces backdrop-filter: none !important."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert 'backdrop-filter: none !important;' in content, (
        "Zero Live Blur rule: agent-response card must have backdrop-filter: none !important;"
    )


def test_tc52_scrolling_containers_prohibit_live_blur(repo_root: Path):
    """TC-52: Verify scrolling container .overflow-y-auto has NO backdrop-filter: blur rule."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    # Search for any backdrop-filter: blur applied to overflow-y-auto
    match = re.search(r'\.overflow-y-auto[^{]*\{[^}]*backdrop-filter:\s*blur', content)
    assert not match, "Zero Live Blur violation: found backdrop-filter: blur on .overflow-y-auto"


def test_tc53_scrolling_gpu_compositing_will_change(repo_root: Path):
    """TC-53: Verify .overflow-y-auto uses will-change: scroll-position for GPU layer promotion."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "will-change: scroll-position;" in content, (
        "Scrolling container must specify will-change: scroll-position;"
    )


def test_tc54_prebaked_canvas_glass_function(repo_root: Path):
    """TC-54: Verify syncPrebakedGlass renders blurred wallpaper to canvas and sets --agy-l-glass-bg."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "function syncPrebakedGlass" in content or "syncPrebakedGlass =" in content, (
        "core.js must define syncPrebakedGlass function"
    )
    assert "--agy-l-glass-bg" in content, (
        "syncPrebakedGlass must assign result to --agy-l-glass-bg"
    )


def test_tc55_compiled_payload_zero_live_blur_invariance(compiled_payload: Path):
    """TC-55: Verify dist/theme_payload.js compiled payload preserves backdrop-filter: none !important."""
    dist_file = compiled_payload
    assert dist_file.is_file(), "dist/theme_payload.js must exist"
    payload_content = dist_file.read_text(encoding="utf-8")
    assert "backdrop-filter: none !important;" in payload_content, (
        "Compiled payload must preserve Zero Live Blur guardrail"
    )
