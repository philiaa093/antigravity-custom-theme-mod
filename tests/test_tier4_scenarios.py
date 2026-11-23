"""Tier 4: Real-World Workflow Scenarios Test Suite (5 Tests).

Executes end-to-end integration workflows:
Scenario 1: End-to-End Theme Generation -> Inlining -> Payload Compilation -> Node Syntax Check.
Scenario 2: Registry Mutability (Append vs Update Idempotence).
Scenario 3: Full Payload Static Security Audit & Asset Consistency Check.
Scenario 4: Live Customizer Modal & State Round-Trip Simulation.
Scenario 5: Fallback Default Theme & Graceful Degradation Invariants.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Callable, Dict
import xml.etree.ElementTree as ET

import pytest

from tests.conftest import require_m2


def test_scenario_1_e2e_image_generation_to_payload(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    tmp_path: Path,
    theme_validator: Callable,
):
    """Scenario 1: End-to-End Image Theme Generation -> Inlining -> Payload Compilation -> Node Syntax Check."""
    script_path = require_m2(repo_root)

    out_themes = tmp_path / "themes.json"
    out_payload = tmp_path / "dist" / "theme_payload.js"
    theme_name = "E2E Aurora Horizon"

    # Step 1: Execute theme_from_image.py CLI
    res = cli_runner([
        str(script_path),
        str(synthetic_palette_image),
        "--name", theme_name,
        "--output", str(out_themes),
    ])
    assert res.returncode == 0, f"theme_from_image.py failed: {res.stderr}"
    assert out_themes.is_file(), "Generated themes.json was not written"

    # Step 2: Validate generated theme schema
    themes_data = json.loads(out_themes.read_text(encoding="utf-8"))
    assert theme_name in themes_data
    theme_validator(theme_name, themes_data[theme_name])

    # Step 3: Run build_payload.py to compile standalone payload
    build_script = repo_root / "scripts" / "build_payload.py"
    b_res = cli_runner([
        str(build_script),
        "--themes", str(out_themes),
        "--engine", str(repo_root / "engine" / "core.js"),
        "--out", str(out_payload),
    ])
    assert b_res.returncode == 0, f"build_payload.py failed: {b_res.stderr}"
    assert out_payload.is_file(), "Compiled theme_payload.js was not created"

    # Step 4: Verify JavaScript syntax of compiled payload using Node.js
    node_res = subprocess.run(["node", "-c", str(out_payload)], capture_output=True, text=True)
    assert node_res.returncode == 0, f"Payload has syntax error: {node_res.stderr}"

    # Step 5: Assert Zero Live Blur guardrail in compiled output
    payload_src = out_payload.read_text(encoding="utf-8")
    assert "backdrop-filter: none !important;" in payload_src, (
        "Zero Live Blur rule missing from compiled payload"
    )
    assert theme_name in payload_src, f"Theme '{theme_name}' was not bundled into payload"


def test_scenario_2_registry_mutability_append_vs_update_idempotence(
    repo_root: Path,
    cli_runner: Callable,
    synthetic_palette_image: Path,
    synthetic_gradient_image: Path,
    tmp_path: Path,
):
    """Scenario 2: Registry Mutability — Appending new vs updating existing preserves integrity and is idempotent."""
    script_path = require_m2(repo_root)
    themes_file = tmp_path / "themes.json"

    # Seed with initial preset
    initial_seed = {
        "Baseline Dark": {
            "concept": "Baseline Theme",
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
            "cardSelectedBg": "rgba(56, 189, 248, 0.15)",
            "wallpaper": "",
        }
    }
    themes_file.write_text(json.dumps(initial_seed, indent=2), encoding="utf-8")

    # Step A: Append new preset
    target_name = "Emerald Matrix"
    res1 = cli_runner([
        str(script_path),
        str(synthetic_palette_image),
        "--name", target_name,
        "--output", str(themes_file),
    ])
    assert res1.returncode == 0, f"Append failed: {res1.stderr}"
    data1 = json.loads(themes_file.read_text(encoding="utf-8"))
    assert len(data1) == 2, f"Expected 2 presets after append, found {len(data1)}"
    assert "Baseline Dark" in data1 and target_name in data1
    assert data1["Baseline Dark"]["primary"] == "#38bdf8"  # Untouched

    # Step B: Update existing preset with different image & --light flag
    res2 = cli_runner([
        str(script_path),
        str(synthetic_gradient_image),
        "--name", target_name,
        "--light",
        "--output", str(themes_file),
    ])
    assert res2.returncode == 0, f"Update failed: {res2.stderr}"
    data2 = json.loads(themes_file.read_text(encoding="utf-8"))
    assert len(data2) == 2, f"Key count must remain 2 after update, found {len(data2)}"
    assert data2[target_name].get("isLight") is True
    assert data2["Baseline Dark"]["primary"] == "#38bdf8"  # Still untouched

    # Step C: Idempotence check (re-running identical command yields identical file content)
    snapshot = themes_file.read_text(encoding="utf-8")
    res3 = cli_runner([
        str(script_path),
        str(synthetic_gradient_image),
        "--name", target_name,
        "--light",
        "--output", str(themes_file),
    ])
    assert res3.returncode == 0
    after_rerun = themes_file.read_text(encoding="utf-8")
    assert snapshot == after_rerun, "Re-running identical command must produce identical output"


def test_scenario_3_full_payload_static_security_audit(compiled_payload: Path):
    """Scenario 3: Static Security and Asset Consistency Audit on dist/theme_payload.js."""
    dist_file = compiled_payload
    assert dist_file.is_file(), "dist/theme_payload.js must exist"

    # Step 1: Syntax check with Node.js
    res = subprocess.run(["node", "-c", str(dist_file)], capture_output=True, text=True)
    assert res.returncode == 0, f"Payload has JS syntax error: {res.stderr}"

    payload_src = dist_file.read_text(encoding="utf-8")

    # Step 2: Zero Live Blur enforcement
    # Assert backdrop-filter: none !important is present
    assert "backdrop-filter: none !important;" in payload_src, (
        "Zero Live Blur rule missing from dist/theme_payload.js"
    )
    # Assert NO live backdrop-filter: blur on scrollables
    forbidden_blur_matches = re.findall(r'\.overflow-y-auto[^{]*\{[^}]*backdrop-filter:\s*blur', payload_src)
    assert not forbidden_blur_matches, f"Found live blur on .overflow-y-auto: {forbidden_blur_matches}"

    # Step 3: SVG Data URI XML Integrity
    double_quoted = re.findall(r'"data:image/svg\+xml,([^"\\]*(?:\\.[^"\\]*)*)"', payload_src)
    single_quoted = re.findall(r"'data:image/svg\+xml,([^'\\]*(?:\\.[^'\\]*)*)'", payload_src)
    svg_uris = double_quoted + single_quoted
    assert len(svg_uris) >= 1, "Payload must contain inlined SVG assets"
    for uri in svg_uris:
        decoded_svg = urllib.parse.unquote(uri)
        root = ET.fromstring(decoded_svg)
        assert root.tag.endswith("svg"), "Data URI must decode to valid SVG element"
        assert "viewBox" in root.attrib or ("width" in root.attrib and "height" in root.attrib)

    # Step 4: WebP Data URI Header Integrity
    double_webp = re.findall(r'"data:image/webp;base64,([A-Za-z0-9+/=]+)"', payload_src)
    single_webp = re.findall(r"'data:image/webp;base64,([A-Za-z0-9+/=]+)'", payload_src)
    webp_matches = double_webp + single_webp
    assert len(webp_matches) >= 1, "Payload must contain inlined WebP assets"
    for b64 in webp_matches:
        raw_bytes = base64.b64decode(b64[:64])
        # WebP RIFF header check: bytes 0..4 == b'RIFF', bytes 8..12 == b'WEBP'
        assert raw_bytes[:4] == b"RIFF", f"Invalid WebP RIFF magic: {raw_bytes[:4]}"
        assert raw_bytes[8:12] == b"WEBP", f"Invalid WebP type signature: {raw_bytes[8:12]}"

    # Audio may use the daemon's media URL helper, not an external source.
    audio_calls = re.findall(r'new\s+Audio\((.+)\);', payload_src)
    assert len(audio_calls) == len(re.findall(r'new\s+Audio\(', payload_src))
    assert set(audio_calls) == {'clip', 'mediaFileUrl(picked.id, picked.bundled)'}
    assert re.search(r'const clip = mediaFileUrl\(`assets/voice/', payload_src)
    assert not re.search(r'fetch\([\'"][^\'"]+\.(?:mp3|wav|ogg)', payload_src), "External audio fetch forbidden"


def test_scenario_4_live_customizer_modal_and_state_roundtrip(compiled_payload: Path, node_runner: Callable):
    """Scenario 4: Live Customizer Modal & State Round-Trip Simulation."""
    dist_file = compiled_payload
    assert dist_file.is_file(), "dist/theme_payload.js must exist"
    payload_content = dist_file.read_text(encoding="utf-8")

    test_js = f"""
    let capturedConfig = null;
    sandbox.agySaveThemeConfig = (cfg) => {{
        capturedConfig = cfg;
        return Promise.resolve(true);
    }};

    // Run the payload in sandbox
    const payloadCode = {json.dumps(payload_content)};
    vm.runInContext(payloadCode, sandbox);

    // Call window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__ if exposed
    if (typeof sandbox.window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__ === 'function') {{
        sandbox.window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__({{
            themeName: 'WLOP Cosmic',
            avatarSize: 40,
            avatarRadius: 50,
            userAvatar: 'none'
        }});
    }}
    """
    res = node_runner(test_js)
    assert res.returncode == 0, f"Customizer state simulation failed: {res.stderr}"


def test_scenario_5_fallback_default_theme_and_graceful_degradation(
    repo_root: Path,
    compiled_payload: Path,
    theme_validator: Callable,
    node_runner: Callable,
):
    """Scenario 5: Fallback Default Theme & Graceful Degradation Invariants."""
    themes_file = repo_root / "themes" / "themes.json"
    themes = json.loads(themes_file.read_text(encoding="utf-8"))

    # Invariant 1: First key in themes.json is the system fallback default
    first_key = list(themes.keys())[0]
    assert first_key == "WLOP Cosmic", f"First preset should be 'WLOP Cosmic', got '{first_key}'"
    theme_validator(first_key, themes[first_key])

    # Invariant 2: Pure-CSS theme (e.g. Midnight Obsidian) specifies wallpaper: ""
    assert "Midnight Obsidian" in themes
    midnight = themes["Midnight Obsidian"]
    assert midnight["wallpaper"] == "", "Pure-CSS preset wallpaper must be empty string"
    assert "pureBg" in midnight and midnight["pureBg"], "Pure-CSS preset must provide pureBg gradient"

    # Invariant 3: Headless engine evaluation when theme_config.json is absent
    dist_file = compiled_payload
    payload_content = dist_file.read_text(encoding="utf-8")
    test_js = f"""
    // With empty localStorage, payload should safely initialize default fallback
    const payloadCode = {json.dumps(payload_content)};
    const res = vm.runInContext(payloadCode, sandbox);
    """
    res = node_runner(test_js)
    assert res.returncode == 0, f"Headless default initialization failed: {res.stderr}"
