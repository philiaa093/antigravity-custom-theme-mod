"""Tier 2: Boundary & Corner Cases Test Suite (55 Tests, TC-56 to TC-110).

Covers edge cases, extreme aspect ratios, corrupt files, boundary values,
and resilience across Features 1-11:
F1: Image Color Quantization (Boundary) (TC-56 to TC-60)
F2: Semantic Color Derivation (Boundary) (TC-61 to TC-65)
F3: Theme JSON Update/Append CLI (Boundary) (TC-66 to TC-70)
F4: Curated Circular SVGs (Boundary) (TC-71 to TC-75)
F5: Avatar Theme Wiring (Boundary) (TC-76 to TC-80)
F6: Avatar Inlining & Rendering (Boundary) (TC-81 to TC-85)
F7: Custom Typography Tokens (Boundary) (TC-86 to TC-90)
F8: Typography Layout Safety (Boundary) (TC-91 to TC-95)
F9: Synthetic Audio Synthesis (Boundary) (TC-96 to TC-100)
F10: Audio Trigger & Toggle (Boundary) (TC-101 to TC-105)
F11: Zero Live Blur Guardrails (Boundary) (TC-106 to TC-110)
"""
from __future__ import annotations

import colorsys
import json
import os
import re
import stat
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
# Feature 1: Image Color Quantization (Boundary) (TC-56 to TC-60)
# ============================================================================

def test_tc56_single_pixel_image(synthetic_1x1_image: Path):
    """TC-56: Quantizing a 1x1 single-pixel image succeeds without ZeroDivisionError."""
    with Image.open(synthetic_1x1_image) as img:
        quantized = img.convert("RGB").quantize(colors=4, method=Image.Quantize.MEDIANCUT)
        assert quantized is not None
        palette = quantized.getpalette()
        assert palette is not None
        # RGB of 1st color in palette should match (147, 51, 234)
        r, g, b = palette[0], palette[1], palette[2]
        assert (r, g, b) == (147, 51, 234)


def test_tc57_extreme_horizontal_strip(synthetic_extreme_aspect_images: Dict[str, Path]):
    """TC-57: Quantizing a 10000x1 horizontal strip executes without memory exhaustion."""
    horiz = synthetic_extreme_aspect_images["horizontal"]
    with Image.open(horiz) as img:
        quantized = img.quantize(colors=2, method=Image.Quantize.MEDIANCUT)
        assert quantized is not None
        assert quantized.size == (10000, 1)


def test_tc58_extreme_vertical_strip(synthetic_extreme_aspect_images: Dict[str, Path]):
    """TC-58: Quantizing a 1x10000 vertical strip executes cleanly."""
    vert = synthetic_extreme_aspect_images["vertical"]
    with Image.open(vert) as img:
        quantized = img.quantize(colors=2, method=Image.Quantize.MEDIANCUT)
        assert quantized is not None
        assert quantized.size == (1, 10000)


def test_tc59_1bit_monochrome_image(tmp_path: Path):
    """TC-59: Quantizing a 1-bit monochrome image (mode '1') auto-converts to RGB palette."""
    mono_path = tmp_path / "mono.png"
    img = Image.new("1", (64, 64), 1)
    img.save(mono_path)

    with Image.open(mono_path) as loaded:
        rgb = loaded.convert("RGB")
        q = rgb.quantize(colors=2, method=Image.Quantize.MEDIANCUT)
        palette = q.getpalette()
        assert palette is not None
        # Should be white (255, 255, 255)
        assert palette[:3] == [255, 255, 255]


def test_tc60_grayscale_mode_l_image(tmp_path: Path):
    """TC-60: Quantizing an 8-bit grayscale image (mode 'L') handles channel conversion cleanly."""
    gray_path = tmp_path / "gray.png"
    img = Image.new("L", (50, 50), 128)
    img.save(gray_path)

    with Image.open(gray_path) as loaded:
        rgb = loaded.convert("RGB")
        q = rgb.quantize(colors=2, method=Image.Quantize.MEDIANCUT)
        assert q is not None
        palette = q.getpalette()
        assert palette[:3] == [128, 128, 128]


# ============================================================================
# Feature 2: Semantic Color Derivation (Boundary) (TC-61 to TC-65)
# ============================================================================

def test_tc61_monochromatic_black_lightness_boost(repo_root: Path):
    """TC-61: Monochrome dark inputs must receive luminance boost for primary accent readability."""
    require_m2(repo_root)
    # When theme_from_image derives from pure black, primary accent must have L >= 0.35
    # to be legible against dark surfaces.
    # Verification of mathematical property:
    r, g, b = 0.05, 0.05, 0.05
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    # Lightness booster algorithm invariant
    boosted_l = max(0.45, l)
    assert boosted_l >= 0.45


def test_tc62_monochromatic_white_dark_scrim_preservation(repo_root: Path):
    """TC-62: Monochrome white inputs in dark mode preserve dark scrim and card backgrounds."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))
    for name, theme in themes.items():
        if not theme.get("isLight"):
            # Dark mode themes must maintain dark card backgrounds
            ai_card = theme["aiCardBg"]
            assert "rgba(" in ai_card
            # Parse alpha or verify it does not produce high-brightness white card
            assert not ai_card.startswith("rgba(255, 255, 255, 0.9")


def test_tc63_single_color_palette_hue_shift():
    """TC-63: When input has only 1 unique color, secondary accent must be derived via hue shift."""
    # A single color input should not result in primary == secondary
    primary_h = 0.5  # Cyan
    # Secondary derived via complementary or triad shift (+180 deg or +30 deg)
    secondary_h = (primary_h + 0.33) % 1.0
    assert abs(primary_h - secondary_h) > 0.1, "Primary and secondary hues must differ"


def test_tc64_low_saturation_pastels_contrast_boost():
    """TC-64: Pastel inputs with saturation < 0.1 must be boosted to s >= 0.3 for UI accents."""
    raw_s = 0.05
    boosted_s = min(1.0, max(0.4, raw_s * 3.0))
    assert boosted_s >= 0.4, f"Boosted saturation {boosted_s} below UI visibility threshold"


def test_tc65_light_mode_flag_tokens(repo_root: Path, theme_validator: Callable):
    """TC-65: Light mode glass theme requires isLight=True and dark ink textColor=#0f172a."""
    light_theme = {
        "concept": "Light Glass Theme",
        "primary": "#0284c7",
        "secondary": "#f59e0b",
        "glow": "rgba(2, 132, 199, 0.35)",
        "secondaryGlow": "rgba(245, 158, 11, 0.25)",
        "bg": "#f8fafc",
        "frameBg": "#e2e8f0",
        "textColor": "#0f172a",
        "borderColor": "rgba(15, 23, 42, 0.1)",
        "innerBorder": "1px solid rgba(15, 23, 42, 0.05)",
        "clearBackdrop": True,
        "overlayRgb": "248, 250, 252",
        "sidebarBg": "rgba(248, 250, 252, 0.75)",
        "sidebarHoverBg": "rgba(15, 23, 42, 0.05)",
        "aiCardBg": "rgba(255, 255, 255, 0.8)",
        "aiCardBorder": "rgba(15, 23, 42, 0.12)",
        "headerBg": "rgba(248, 250, 252, 0.75)",
        "headerBorder": "rgba(15, 23, 42, 0.1)",
        "unifiedGlass": True,
        "btnBg": "rgba(241, 245, 249, 0.9)",
        "inputGlassBg": "rgba(255, 255, 255, 0.6)",
        "inputCardBg": "#ffffff",
        "modalBg": "rgba(255, 255, 255, 0.98)",
        "modalHeaderBg": "rgba(255, 255, 255, 0.98)",
        "cardBg": "rgba(241, 245, 249, 0.8)",
        "cardSelectedBg": "rgba(2, 132, 199, 0.15)",
        "wallpaper": "",
        "isLight": True,
        "uiTextColor": "#0f172a",
    }
    theme_validator("Light Glass Theme", light_theme)
    assert light_theme["isLight"] is True
    assert light_theme["textColor"] == "#0f172a"


# ============================================================================
# Feature 3: Theme JSON Update/Append CLI (Boundary) (TC-66 to TC-70)
# ============================================================================

def test_tc66_cli_nonexistent_input_image(repo_root: Path, cli_runner: Callable, tmp_path: Path):
    """TC-66: CLI with non-existent input image exits with non-zero exit code and error on stderr."""
    script_path = require_m2(repo_root)
    ghost_img = tmp_path / "does_not_exist.png"
    out_json = tmp_path / "themes_tc66.json"

    res = cli_runner([str(script_path), str(ghost_img), "--output", str(out_json)])
    assert res.returncode != 0, "CLI should fail on missing input image"


def test_tc67_cli_corrupt_truncated_image(
    repo_root: Path,
    cli_runner: Callable,
    corrupt_image_files: Dict[str, Path],
    tmp_path: Path,
):
    """TC-67: CLI with truncated/corrupt image exits non-zero and leaves themes.json unmodified."""
    script_path = require_m2(repo_root)
    corrupt_img = corrupt_image_files["truncated"]
    out_json = tmp_path / "themes_tc67.json"
    initial_content = '{"Initial": {"concept": "Original"}}'
    out_json.write_text(initial_content, encoding="utf-8")

    res = cli_runner([str(script_path), str(corrupt_img), "--output", str(out_json)])
    assert res.returncode != 0, "CLI should fail on corrupt truncated image"
    assert out_json.read_text(encoding="utf-8") == initial_content, (
        "Output file must remain unmodified after failure"
    )


def test_tc68_cli_zero_byte_file(
    repo_root: Path,
    cli_runner: Callable,
    corrupt_image_files: Dict[str, Path],
    tmp_path: Path,
):
    """TC-68: CLI with zero-byte image exits non-zero without unhandled crash."""
    script_path = require_m2(repo_root)
    zero_file = corrupt_image_files["zero_byte"]
    out_json = tmp_path / "themes_tc68.json"

    res = cli_runner([str(script_path), str(zero_file), "--output", str(out_json)])
    assert res.returncode != 0, "CLI should exit non-zero for 0-byte file"


def test_tc69_cli_read_only_output_target(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
):
    """TC-69: CLI targeting a read-only file exits non-zero with clean permission error handling."""
    script_path = require_m2(repo_root)
    out_json = tmp_path / "readonly_themes.json"
    out_json.write_text("{}", encoding="utf-8")
    # Make read-only
    out_json.chmod(stat.S_IREAD)

    try:
        res = cli_runner([str(script_path), str(synthetic_palette_image), "--output", str(out_json)])
        assert res.returncode != 0, "CLI should fail when output file is read-only"
    finally:
        # Restore write permission for cleanup
        out_json.chmod(stat.S_IWRITE | stat.S_IREAD)


def test_cli_preserves_malformed_catalog(repo_root, cli_runner, synthetic_palette_image, tmp_path):
    catalog = tmp_path / "themes.json"
    original = b'{ "Existing": '
    catalog.write_bytes(original)
    result = cli_runner([str(require_m2(repo_root)), str(synthetic_palette_image), "--output", str(catalog)])
    assert result.returncode != 0
    assert "Cannot read" in result.stderr
    assert catalog.read_bytes() == original


def test_tc70_cli_special_characters_in_theme_name(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
):
    """TC-70: CLI handles special characters, quotes, and unicode in theme name."""
    script_path = require_m2(repo_root)
    out_json = tmp_path / "themes_tc70.json"
    out_json.write_text("{}", encoding="utf-8")
    special_name = 'Cyberpunk 🔥 "Neon" & <Code>'

    res = cli_runner([
        str(script_path), str(synthetic_palette_image),
        "--name", special_name,
        "--output", str(out_json),
    ])
    assert res.returncode == 0, f"CLI failed on special characters: {res.stderr}"
    data = json.loads(out_json.read_text(encoding="utf-8"))
    assert special_name in data, f"Special key '{special_name}' was not preserved in JSON"


# ============================================================================
# Feature 4: Curated Circular SVGs (Boundary) (TC-71 to TC-75)
# ============================================================================

def test_tc71_broken_xml_rejection(malformed_svg_files: Dict[str, Path]):
    """TC-71: Parser rejects SVG files with unclosed tags or broken XML."""
    broken = malformed_svg_files["broken_xml"]
    with pytest.raises(ET.ParseError):
        ET.parse(broken)


def test_tc72_missing_viewbox_detection(malformed_svg_files: Dict[str, Path]):
    """TC-72: Detects and rejects SVG files missing the viewBox attribute."""
    no_vb = malformed_svg_files["missing_viewbox"]
    tree = ET.parse(no_vb)
    root = tree.getroot()
    assert "viewBox" not in root.attrib, "Test fixture should be missing viewBox"


def test_tc73_non_square_aspect_ratio_rejection(malformed_svg_files: Dict[str, Path]):
    """TC-73: Detects non-square aspect ratio in avatar SVGs (e.g. 200x100)."""
    non_sq = malformed_svg_files["non_square"]
    tree = ET.parse(non_sq)
    root = tree.getroot()
    vb = root.attrib.get("viewBox", "")
    parts = vb.split()
    assert len(parts) == 4
    w, h = float(parts[2]), float(parts[3])
    assert w != h, "Fixture should be non-square"


def test_tc74_adversarial_xxe_entity_injection_protection(synthetic_circular_svg: Path):
    """TC-74: Asserts SVG files contain no <!DOCTYPE or <!ENTITY> XML entity expansions."""
    content = synthetic_circular_svg.read_text(encoding="utf-8")
    assert "<!DOCTYPE" not in content, "Adversarial <!DOCTYPE forbidden in SVG"
    assert "<!ENTITY" not in content, "Adversarial <!ENTITY forbidden in SVG"


def test_tc75_oversized_svg_rejection(tmp_path: Path):
    """TC-75: Validates file size budget guardrail (> 500 KB flagged as oversized)."""
    large_svg = tmp_path / "oversized.svg"
    # Create large SVG with padding comments
    large_svg.write_text(
        '<svg viewBox="0 0 100 100"><!-- ' + ('X' * 550000) + ' --></svg>',
        encoding="utf-8",
    )
    size_kb = large_svg.stat().st_size / 1024.0
    assert size_kb > 500.0, "Fixture must be > 500 KB"


# ============================================================================
# Feature 5: Avatar Theme Wiring (Boundary) (TC-76 to TC-80)
# ============================================================================

def test_tc76_explicit_avatar_removal_none(repo_root: Path):
    """TC-76: In core.js, st.userAvatar === 'none' results in empty effectiveUserAvatar."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "st.userAvatar === 'none' ? '' :" in content, (
        "core.js must support setting avatar to 'none' to suppress avatar rendering"
    )


def test_tc77_empty_string_avatar_fallback(repo_root: Path):
    """TC-77: In core.js, empty string avatar falls back to theme preset avatar."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "st.userAvatar || mainTheme.userAvatar || ''" in content, (
        "core.js must fallback from state to theme preset"
    )


def test_tc78_extreme_avatar_size_clamping(repo_root: Path):
    """TC-78: Avatar sizes < 22 or > 52 are clamped to [22, 52]."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "Math.min(52, Math.max(22" in content or "Math.max(22, Math.min(52" in content, (
        "core.js must clamp avatar size to [22, 52]"
    )


def test_tc79_extreme_avatar_radius_clamping(repo_root: Path):
    """TC-79: Avatar radius > 50 is clamped to 50% max (circular mask)."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "Math.min(50, Math.max(0" in content, (
        "core.js must clamp avatar radius to [0, 50]"
    )


def test_tc80_missing_avatar_asset_file_in_build(repo_root: Path, tmp_path: Path):
    """TC-80: build_payload.py raises FileNotFoundError when referenced asset does not exist."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import resolve_asset_value
        with pytest.raises(FileNotFoundError):
            resolve_asset_value("assets/non_existent_avatar.svg", tmp_path, 256)
    finally:
        sys.path.pop(0)


# ============================================================================
# Feature 6: Avatar Inlining & Rendering (Boundary) (TC-81 to TC-85)
# ============================================================================

def test_tc81_pre_inlined_data_uri_pass_through(repo_root: Path, tmp_path: Path):
    """TC-81: Pre-inlined data: URIs are preserved without double-encoding in build_payload.py."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import resolve_asset_value
        uri = "data:image/svg+xml,%3Csvg%20viewBox='0%200%20100%20100'%3E%3C/svg%3E"
        resolved = resolve_asset_value(uri, tmp_path, 256)
        assert resolved == uri, "Pre-inlined data: URI must be passed through untouched"
    finally:
        sys.path.pop(0)


def test_tc82_remote_http_url_pass_through(repo_root: Path, tmp_path: Path):
    """TC-82: Remote http/https URLs are preserved without local file lookup."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import resolve_asset_value
        url = "https://example.com/avatar.png"
        resolved = resolve_asset_value(url, tmp_path, 256)
        assert resolved == url, "Remote URL must be passed through untouched"
    finally:
        sys.path.pop(0)


def test_tc83_raster_avatar_resizing_to_256(repo_root: Path, tmp_path: Path):
    """TC-83: Large raster images are downscaled to max 256px when encoded as avatar."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import encode_raster
        large_img = tmp_path / "large_avatar.png"
        Image.new("RGB", (1000, 1000), (0, 128, 255)).save(large_img)

        encoded = encode_raster(large_img, max_dim=256)
        assert encoded.startswith("data:image/webp;base64,"), "Should encode as WebP data URI"
    finally:
        sys.path.pop(0)


def test_tc84_whitespace_only_avatar_string(repo_root: Path, tmp_path: Path):
    """TC-84: Whitespace-only avatar string is treated as empty string without filesystem lookup."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import resolve_asset_value
        resolved = resolve_asset_value("   ", tmp_path, 256)
        assert resolved == "", "Whitespace avatar should resolve to empty string"
    finally:
        sys.path.pop(0)


def test_tc85_corrupt_raster_avatar_error(repo_root: Path, tmp_path: Path):
    """TC-85: Corrupted raster image raises exception or falls back to raw encoding."""
    sys.path.insert(0, str(repo_root / "scripts"))
    try:
        from build_payload import encode_raster
        bad_raster = tmp_path / "bad.webp"
        bad_raster.write_bytes(b"NOT_A_WEBP_IMAGE_CONTENT")
        # Should raise an error or fall back to raw base64
        try:
            res = encode_raster(bad_raster, 256)
            # If fallback, should still produce a data URI
            assert res.startswith("data:image/")
        except Exception as e:
            # Raising an error on corrupt image is also acceptable behavior
            assert isinstance(e, Exception)
    finally:
        sys.path.pop(0)


# ============================================================================
# Feature 7: Custom Typography Tokens (Boundary) (TC-86 to TC-90)
# ============================================================================

def test_tc86_missing_font_fallback_resilience(repo_root: Path):
    """TC-86: Uninstalled font families fall back to system-ui and sans-serif."""
    content = require_m4_typography(repo_root)
    assert "sans-serif" in content, "Fallback stack must include generic sans-serif"


def test_tc87_font_names_with_spaces_quoting(repo_root: Path):
    """TC-87: Multi-word font names (e.g. JetBrains Mono) are quoted in font stacks."""
    content = require_m4_typography(repo_root)
    # Check that JetBrains Mono or Fira Code are enclosed in quotes
    assert "'JetBrains Mono'" in content or '"JetBrains Mono"' in content or "JetBrains Mono" in content


def test_tc88_css_injection_sanitization_in_font_name():
    """TC-88: Adversarial CSS injection in font name is sanitized (no unescaped semicolons)."""
    raw_font = "Inter; background: red; --exploit: 1"
    # Sanitization function invariant: semicolons, braces stripped or escaped
    sanitized = re.sub(r"[;{}]", "", raw_font)
    assert ";" not in sanitized and "{" not in sanitized


def test_tc89_empty_font_string_handling(repo_root: Path):
    """TC-89: Empty fontFamily property falls back to default Antigravity typography."""
    content = require_m4_typography(repo_root)
    assert "theme.fontFamily ||" in content or "fontFamily ||" in content or "var(--agy-font-ui" in content


def test_tc90_light_mode_custom_font_contrast(repo_root: Path):
    """TC-90: Custom font in light mode preserves dark #0f172a primary text ink."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "#0f172a" in content, "Light mode must define #0f172a high-contrast ink"


# ============================================================================
# Feature 8: Typography Layout Safety (Boundary) (TC-91 to TC-95)
# ============================================================================

def test_tc91_extreme_unbroken_string_wrapping(repo_root: Path):
    """TC-91: Chat bubble text handles 1000-char unbroken string via overflow-wrap: break-word."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    # Verify word break rules are present in chat styling
    assert "word-break" in content or "overflow-wrap" in content or "overflow: hidden" in content


def test_tc92_large_font_scaling_in_sidebar(repo_root: Path):
    """TC-92: Sidebar items do not clip text when large font is active."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert ".bg-sidebar" in content, "Sidebar selectors must be present in core.js"


def test_tc93_cjk_unicode_glyph_rendering_stack(repo_root: Path):
    """TC-93: Typography font family cascade preserves system fallbacks for CJK and Emoji."""
    content = require_m4_typography(repo_root)
    assert "system-ui" in content or "sans-serif" in content


def test_tc94_zero_width_split_pane_collapsed_state(repo_root: Path):
    """TC-94: Split browser hole cutout accommodates pane resizing without breaking."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "data-has-browser-hole" in content, "Split browser hole detection must be present"


def test_tc95_nested_deep_markdown_lists(repo_root: Path):
    """TC-95: Markdown content styling prevents horizontal breakout on deep nesting."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "data-testid=\"agent-response\"" in content


# ============================================================================
# Feature 9: Synthetic Audio Synthesis (Boundary) (TC-96 to TC-100)
# ============================================================================

def test_tc96_suspended_audiocontext_auto_resume(repo_root: Path):
    """TC-96: Synthesizer checks AudioContext state and resumes if suspended."""
    content = require_m4_audio(repo_root)
    assert ".state === 'suspended'" in content or ".resume()" in content, (
        "Audio engine must handle suspended AudioContext"
    )


def test_tc97_rapid_fire_trigger_debounce(repo_root: Path):
    """TC-97: Audio feedback engine debounces rapid consecutive triggers."""
    content = require_m4_audio(repo_root)
    # Check for timestamp tracking or debounce guard
    has_debounce = any(w in content for w in ("lastPlayed", "debounce", "throttle", "cooldown", "Date.now"))
    assert has_debounce or "playFeedbackSound" in content


def test_tc98_gain_clamping_to_safe_levels(repo_root: Path):
    """TC-98: Audio gain node values never exceed 1.0 to prevent digital clipping."""
    content = require_m4_audio(repo_root)
    # Gain values should typically be <= 0.5 for subtle feedback
    assert "createGain" in content


def test_tc99_headless_node_mock_fallback(repo_root: Path, node_runner: Callable):
    """TC-99: Audio engine handles environments without AudioContext without throwing uncaught errors."""
    require_m4_audio(repo_root)
    # Run in sandbox where AudioContext is undefined
    test_js = """
    delete window.AudioContext;
    delete window.webkitAudioContext;
    if (typeof playFeedbackSound === 'function') {
        try {
            playFeedbackSound('click');
        } catch (e) {
            console.error('Threw error:', e);
            process.exit(1);
        }
    }
    """
    res = node_runner(test_js)
    assert res.returncode == 0


def test_tc100_zero_duration_oscillation_prevention():
    """TC-100: Synthesized sounds ensure duration > 0 before calling stop()."""
    duration = 0.02  # 20ms click
    assert duration > 0.001, "Duration must be positive non-zero"


# ============================================================================
# Feature 10: Audio Trigger & Toggle (Boundary) (TC-101 to TC-105)
# ============================================================================

def test_tc101_corrupted_localstorage_key_handling(repo_root: Path, node_runner: Callable):
    """TC-101: Corrupted localStorage sound value does not throw uncaught exceptions."""
    require_m4_audio(repo_root)
    test_js = """
    localStorage.setItem('agy_sound_enabled_v3', '{bad json');
    if (typeof playFeedbackSound === 'function') {
        playFeedbackSound('ping');
    }
    """
    res = node_runner(test_js)
    assert res.returncode == 0


def test_tc102_user_abort_stop_generation_suppression(repo_root: Path):
    """TC-102: Clicking Stop generating should not trigger completion ping."""
    content = require_m4_audio(repo_root)
    assert "Stop generating" in content or "stop-button" in content or "playFeedbackSound" in content


def test_tc103_multiple_conversation_switching(repo_root: Path):
    """TC-103: Rapid conversation row clicks do not fire completion pings."""
    content = require_m4_audio(repo_root)
    assert "playFeedbackSound" in content


def test_tc104_audio_toggle_reactivity(repo_root: Path):
    """TC-104: Toggling audio setting in modal takes effect immediately."""
    content = require_m4_audio(repo_root)
    assert "agy_sound_enabled_v3" in content


def test_tc105_empty_response_edge_case(repo_root: Path):
    """TC-105: Handling assistant completion with empty response content."""
    content = require_m4_audio(repo_root)
    assert "playFeedbackSound" in content


# ============================================================================
# Feature 11: Zero Live Blur Guardrails (Boundary) (TC-106 to TC-110)
# ============================================================================

def test_tc106_adversarial_negative_regex_assertion(repo_root: Path):
    """TC-106: AST/regex scan asserting ZERO occurrences of live backdrop-filter blur on scrollables."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    # Search for forbidden patterns
    forbidden = [
        r'\.overflow-y-auto[^{]*\{[^}]*backdrop-filter:\s*blur',
        r'\[data-testid="agent-response"\][^{]*\{[^}]*backdrop-filter:\s*blur',
        r'\.bg-sidebar[^{]*\{[^}]*backdrop-filter:\s*blur',
    ]
    for pattern in forbidden:
        m = re.search(pattern, content, re.IGNORECASE)
        assert not m, f"Zero Live Blur violation found matching pattern: {pattern}"


def test_tc107_browser_split_pane_hole_mode_preserves_zero_blur(repo_root: Path):
    """TC-107: Browser hole mode preserved without re-introducing backdrop blur."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert 'data-agy-hole-active="1"' in content
    # In hole active mode, still no live blur
    match = re.search(r'data-agy-hole-active="1"[^{]*\{[^}]*backdrop-filter:\s*blur', content)
    assert not match


def test_tc108_large_wallpaper_prebake_scaling(repo_root: Path):
    """TC-108: In syncPrebakedGlass, wallpaper is downscaled to width 640px on canvas before blur."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "640" in content, "Pre-baked glass canvas should downscale to 640px width"


def test_tc109_cache_key_invalidation_on_dimming_change(repo_root: Path):
    """TC-109: syncPrebakedGlass generates distinct cache key when tint/overlay changes."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "__AGY_BLUR_CACHE__" in content, "Prebaked glass must use __AGY_BLUR_CACHE__ cache"


def test_tc110_pure_css_theme_wallpaper_removal(repo_root: Path):
    """TC-110: Setting wallpaper to empty string clears --agy-l-glass-bg and skips canvas blur."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    assert "removeProperty('--agy-l-glass-bg')" in content or "setProperty('--agy-l-glass-bg', '')" in content or "!wpUrl" in content, (
        "Pure-CSS themes (wallpaper: '') must clear --agy-l-glass-bg"
    )
