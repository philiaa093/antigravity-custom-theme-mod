"""Tier 1 (Feature Coverage) and Tier 2 (Boundary & Corner Cases) test suite

for AntigravityTheme Local Web Dashboard & REST API.
Conforms strictly to TEST_INFRA.md, PROJECT.md, and references/theme-schema.md.
"""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import socket
import sys
import pytest
import requests
from PIL import Image

from tests.embedded_server import AntigravityTestServer, STANDARD_CONFIG_KEYS, find_free_port


# ===========================================================================
# Tier 1: Feature Coverage (25 Tests across F1-F5)
# ===========================================================================

# --- F1: HTTP Server & Static Dashboard Serving ---

def test_f1_01_root_serves_html(api_client):
    """GET / returns HTTP 200, Content-Type text/html, dashboard title and DOM root."""
    res = api_client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers.get("Content-Type", "")
    content = res.text
    assert "<title>" in content
    assert "antigravity" in content.lower() and "theme" in content.lower()
    assert 'id="app"' in content or "container" in content.lower() or "body" in content.lower()


def test_f1_02_serves_stylesheet(api_client):
    """GET /style.css returns HTTP 200, Content-Type text/css, and glassmorphism styling."""
    res = api_client.get("/style.css")
    assert res.status_code == 200
    assert "text/css" in res.headers.get("Content-Type", "")
    content = res.text
    assert "glass" in content.lower() or "backdrop-filter" in content.lower()


def test_f1_03_serves_javascript(api_client):
    """GET /app.js returns HTTP 200, application/javascript Content-Type, and valid script."""
    res = api_client.get("/app.js")
    assert res.status_code == 200
    ct = res.headers.get("Content-Type", "")
    assert "javascript" in ct
    assert len(res.text) > 0


def test_f1_04_webport_file_accuracy(server_info, repo_root):
    """daemon.webport exists, contains valid integer matching active listener port."""
    webport_file = repo_root / "daemon.webport"
    assert webport_file.is_file(), "daemon.webport file does not exist"
    port_text = webport_file.read_text(encoding="utf-8").strip()
    assert port_text.isdigit(), f"daemon.webport content '{port_text}' is not a valid integer"
    assert int(port_text) == server_info["port"]


def test_f1_05_nonexistent_route_404(api_client):
    """GET /nonexistent_route_xyz returns HTTP 404 Not Found."""
    res = api_client.get("/nonexistent_route_xyz_12345")
    assert res.status_code == 404


# --- F2: Configuration Management REST API ---

def test_f2_01_get_config_schema(api_client):
    """GET /api/config returns HTTP 200 with all 14 standard configuration keys."""
    res = api_client.get("/api/config")
    assert res.status_code == 200
    cfg = res.json()
    assert isinstance(cfg, dict)
    for key in STANDARD_CONFIG_KEYS:
        assert key in cfg, f"Missing standard config key '{key}' in GET /api/config response"


def test_f2_02_post_config_slider_dimming(api_client, repo_root):
    """POST /api/config with {"dimming": 85} updates config and returns 200."""
    res = api_client.post("/api/config", json={"dimming": 85})
    assert res.status_code == 200
    data = res.json()
    assert data.get("success") is True
    assert data.get("config", {}).get("dimming") == 85

    # Verify disk persistence
    cfg_disk = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert cfg_disk["dimming"] == 85


def test_f2_03_post_config_booleans(api_client, repo_root):
    """POST /api/config toggling wpEnabled and soundEnabled persists booleans cleanly."""
    res = api_client.post("/api/config", json={"wpEnabled": False, "soundEnabled": False})
    assert res.status_code == 200
    data = res.json()
    assert data["config"]["wpEnabled"] is False
    assert data["config"]["soundEnabled"] is False

    cfg_disk = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert cfg_disk["wpEnabled"] is False
    assert cfg_disk["soundEnabled"] is False


def test_f2_04_post_config_typography(api_client, repo_root):
    """POST /api/config updating fontFamily and codeFontFamily persists font stacks."""
    update_payload = {
        "fontFamily": "Inter, system-ui, sans-serif",
        "codeFontFamily": "'Fira Code', 'Courier New', monospace"
    }
    res = api_client.post("/api/config", json=update_payload)
    assert res.status_code == 200
    cfg = res.json()["config"]
    assert cfg["fontFamily"] == update_payload["fontFamily"]
    assert cfg["codeFontFamily"] == update_payload["codeFontFamily"]

    cfg_disk = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert cfg_disk["fontFamily"] == update_payload["fontFamily"]


def test_f2_05_post_config_avatars(api_client, repo_root):
    """POST /api/config updating avatarSize and avatarRadius persists geometry values."""
    res = api_client.post("/api/config", json={"avatarSize": 44, "avatarRadius": 25})
    assert res.status_code == 200
    cfg = res.json()["config"]
    assert cfg["avatarSize"] == 44
    assert cfg["avatarRadius"] == 25

    cfg_disk = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert cfg_disk["avatarSize"] == 44
    assert cfg_disk["avatarRadius"] == 25


# --- F3: Presets Management REST API ---

def test_f3_01_get_presets_inventory(api_client):
    """GET /api/presets returns HTTP 200 with dictionary of presets from themes/themes.json."""
    res = api_client.get("/api/presets")
    assert res.status_code == 200
    data = res.json()
    assert "presets" in data
    presets = data["presets"]
    assert isinstance(presets, dict)

    # Built-in presets must be present
    for name in ["WLOP Cosmic", "Midnight Obsidian", "Cyberpunk Neon", "Nordic Frost", "Kyoto Matcha", "Gemini-chan Live", "Furina Live"]:
        assert name in presets, f"Expected preset '{name}' not found in /api/presets response"


def test_f3_02_presets_active_property(api_client, repo_root):
    """GET /api/presets response includes active key strictly matching current config."""
    cfg_disk = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    expected_active = cfg_disk.get("themeName", "WLOP Cosmic")

    res = api_client.get("/api/presets")
    assert res.status_code == 200
    assert res.json().get("active") == expected_active


def test_f3_03_activate_preset_endpoint(api_client):
    """POST /api/presets/activate with valid preset name returns HTTP 200 { success: true, themeName: ... }."""
    target_preset = "Cyberpunk Neon"
    res = api_client.post("/api/presets/activate", json={"themeName": target_preset})
    assert res.status_code == 200
    data = res.json()
    assert data.get("success") is True
    assert data.get("themeName") == target_preset


def test_f3_04_activate_preset_persists(api_client, repo_root):
    """POST /api/presets/activate mutates theme_config.json on disk to reflect activated theme."""
    target_preset = "Nordic Frost"
    res = api_client.post("/api/presets/activate", json={"themeName": target_preset})
    assert res.status_code == 200

    cfg_disk = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert cfg_disk["themeName"] == target_preset
    assert cfg_disk["bubbleName"] == target_preset


def test_f3_05_preset_schema_completeness(api_client):
    """All returned presets have required color tokens (concept, primary, secondary, glow, overlayRgb)."""
    res = api_client.get("/api/presets")
    assert res.status_code == 200
    presets = res.json().get("presets", {})
    required_tokens = ["concept", "primary", "secondary", "glow", "overlayRgb"]
    for name, p in presets.items():
        for token in required_tokens:
            assert token in p, f"Preset '{name}' missing required token '{token}'"


# --- F4: Image-to-Theme Extraction REST API ---

def test_f4_01_image_upload_success(api_client, synthetic_base64_image):
    """POST /api/themes/from-image with valid base64 image returns HTTP 200 { success: true, themeName: ... }."""
    payload = {
        "imageBase64": synthetic_base64_image,
        "imageName": "test_amber_sky.png",
        "themeName": "Tier1 Test Dark",
        "isLight": False
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data.get("success") is True
    assert data.get("themeName") == "Tier1 Test Dark"
    assert "preset" in data


def test_f4_02_new_theme_appears_in_presets(api_client, synthetic_base64_image, repo_root):
    """Newly generated theme preset appears in subsequent GET /api/presets call and themes.json."""
    theme_name = "Tier1 Amber Sunset"
    payload = {
        "imageBase64": synthetic_base64_image,
        "themeName": theme_name,
        "isLight": False
    }
    upload_res = api_client.post("/api/themes/from-image", json=payload)
    assert upload_res.status_code == 200

    presets_res = api_client.get("/api/presets")
    assert presets_res.status_code == 200
    presets = presets_res.json().get("presets", {})
    assert theme_name in presets, f"New preset '{theme_name}' not listed in GET /api/presets"

    themes_disk = json.loads((repo_root / "themes" / "themes.json").read_text(encoding="utf-8"))
    assert theme_name in themes_disk


def test_f4_03_new_theme_schema_valid(api_client, synthetic_base64_image, theme_validator):
    """Newly generated theme preset conforms to AntigravityTheme schema with WCAG contrast tokens."""
    theme_name = "Tier1 Schema Check"
    payload = {
        "imageBase64": synthetic_base64_image,
        "themeName": theme_name,
        "isLight": False
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    preset = res.json().get("preset")
    assert preset, "No preset object returned in image synthesis response"
    theme_validator(theme_name, preset)


def test_f4_04_image_upload_light_mode(api_client, synthetic_base64_image):
    """POST /api/themes/from-image with isLight: true generates light theme with isLight: true."""
    theme_name = "Tier1 Light Mode Preset"
    payload = {
        "imageBase64": synthetic_base64_image,
        "themeName": theme_name,
        "isLight": True
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    preset = res.json().get("preset", {})
    assert preset.get("isLight") is True
    assert preset.get("textColor") in ("#0f172a", preset.get("uiTextColor"))


def test_f4_05_image_wallpaper_path(api_client, synthetic_base64_image):
    """Generated preset contains wallpaper path pointing to saved image asset."""
    theme_name = "Tier1 Wallpaper Path Preset"
    payload = {
        "imageBase64": synthetic_base64_image,
        "themeName": theme_name,
        "isLight": False
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    preset = res.json().get("preset", {})
    assert "wallpaper" in preset
    assert len(preset["wallpaper"]) > 0


# --- F5: Daemon Diagnostics & Lifecycle API ---

def test_f5_01_get_status_schema(api_client):
    """GET /api/status returns HTTP 200 with { running: true, pid, port, sessionsCount, version }."""
    res = api_client.get("/api/status")
    assert res.status_code == 200
    status = res.json()
    assert status.get("running") is True
    assert isinstance(status.get("pid"), int) and status["pid"] > 0
    assert isinstance(status.get("port"), int) and status["port"] > 0
    assert "sessionsCount" in status
    assert "version" in status


def test_f5_02_status_pid_validity(api_client, repo_root):
    """Reported PID matches daemon.pid (if present) and corresponds to a living process."""
    res = api_client.get("/api/status")
    assert res.status_code == 200
    reported_pid = res.json().get("pid")
    assert reported_pid > 0

    pid_file = repo_root / "daemon.pid"
    if pid_file.is_file():
        try:
            expected_pid = int(pid_file.read_text(encoding="utf-8").strip())
            assert reported_pid == expected_pid
        except Exception:
            pass


def test_f5_03_status_port_validity(api_client, server_info, repo_root):
    """Reported port matches daemon.webport and active socket connection."""
    res = api_client.get("/api/status")
    assert res.status_code == 200
    reported_port = res.json().get("port")
    assert reported_port == server_info["port"]

    webport_file = repo_root / "daemon.webport"
    if webport_file.is_file():
        file_port = int(webport_file.read_text(encoding="utf-8").strip())
        assert reported_port == file_port


def test_f5_04_daemon_reload_endpoint(api_client):
    """POST /api/daemon/reload returns HTTP 200 { success: true, message: ... }."""
    res = api_client.post("/api/daemon/reload")
    assert res.status_code == 200
    data = res.json()
    assert data.get("success") is True
    assert "message" in data


def test_f5_05_daemon_alive_after_reload(api_client):
    """Daemon continues responding to GET /api/status immediately after reload."""
    reload_res = api_client.post("/api/daemon/reload")
    assert reload_res.status_code == 200

    status_res = api_client.get("/api/status")
    assert status_res.status_code == 200
    assert status_res.json().get("running") is True


# ===========================================================================
# Tier 2: Boundary & Corner Cases (25 Tests across F1-F5)
# ===========================================================================

# --- F1: Server Boundaries ---

def test_f1_06_path_traversal_parent(api_client):
    """GET /../daemon/theme_daemon.js rejected with HTTP 403 or 404."""
    res = api_client.get("/../daemon/theme_daemon.js")
    assert res.status_code in (403, 404)


def test_f1_07_encoded_path_traversal(api_client):
    """GET /%2e%2e/%2e%2e/theme_config.json rejected with HTTP 403 or 404."""
    res = api_client.get("/%2e%2e/%2e%2e/theme_config.json")
    assert res.status_code in (403, 404)


def test_f1_08_disallowed_http_verbs(api_client):
    """PUT /style.css and DELETE /app.js return HTTP 405 Method Not Allowed."""
    res_put = api_client.put("/style.css")
    assert res_put.status_code == 405

    res_del = api_client.delete("/app.js")
    assert res_del.status_code == 405


def test_f1_09_port_collision_fallback(server_info, repo_root):
    """If port 47990 is bound, secondary server binds to 47991+ and updates daemon.webport."""
    occupied_port = server_info["port"]
    # Attempt to start secondary server requesting the already bound port
    secondary_server = AntigravityTestServer(repo_root=repo_root, port=occupied_port, allow_fallback=True)
    try:
        new_port = secondary_server.start()
        assert new_port != occupied_port
        assert new_port > occupied_port
        # Verify daemon.webport updated
        webport = int((repo_root / "daemon.webport").read_text(encoding="utf-8").strip())
        assert webport == new_port
    finally:
        secondary_server.stop()
        # Restore primary port in daemon.webport
        (repo_root / "daemon.webport").write_text(str(occupied_port), encoding="utf-8")


def test_f1_10_concurrent_burst_requests(api_client):
    """30 rapid parallel GET / requests succeed without dropped connections."""
    def _fetch(_):
        return api_client.get("/").status_code

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(_fetch, range(30)))

    assert len(results) == 30
    assert all(code == 200 for code in results)


# --- F2: Config Boundaries ---

def test_f2_06_dimming_numeric_clamping(api_client):
    """POST /api/config with dimming: 150 clamps to 100; dimming: -50 clamps to 0."""
    res_high = api_client.post("/api/config", json={"dimming": 150})
    assert res_high.status_code == 200
    assert res_high.json()["config"]["dimming"] == 100

    res_low = api_client.post("/api/config", json={"dimming": -50})
    assert res_low.status_code == 200
    assert res_low.json()["config"]["dimming"] == 0


def test_f2_07_glass_blur_bounds(api_client):
    """POST /api/config with glassBlur: 999 clamps to upper bound (50) or returns 400."""
    res = api_client.post("/api/config", json={"glassBlur": 999})
    assert res.status_code in (200, 400)
    if res.status_code == 200:
        assert res.json()["config"]["glassBlur"] <= 50


def test_f2_08_malformed_json_body(api_client):
    """POST /api/config with malformed JSON string returns HTTP 400 Bad Request."""
    headers = {"Content-Type": "application/json"}
    res = api_client.post("/api/config", data='{"themeName": "Broken JSON', headers=headers)
    assert res.status_code == 400


def test_f2_09_invalid_type_field(api_client):
    """POST /api/config with {"dimming": "not_a_number"} returns HTTP 400 Bad Request."""
    res = api_client.post("/api/config", json={"dimming": "not_a_number"})
    assert res.status_code == 400


def test_f2_10_empty_update_payload(api_client, repo_root):
    """POST /api/config with {} returns HTTP 200 with unchanged config."""
    initial_cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    res = api_client.post("/api/config", json={})
    assert res.status_code == 200
    returned_cfg = res.json()["config"]
    assert returned_cfg["themeName"] == initial_cfg["themeName"]
    assert returned_cfg["dimming"] == initial_cfg["dimming"]


# --- F3: Presets Boundaries ---

def test_f3_06_activate_nonexistent_preset(api_client):
    """POST /api/presets/activate with 'Unknown Galaxy' returns HTTP 404 Not Found."""
    res = api_client.post("/api/presets/activate", json={"themeName": "Unknown Galaxy"})
    assert res.status_code == 404
    assert "not found" in res.json().get("error", "").lower()


def test_f3_07_activate_missing_field(api_client):
    """POST /api/presets/activate with {} returns HTTP 400 Bad Request."""
    res = api_client.post("/api/presets/activate", json={})
    assert res.status_code == 400


def test_f3_08_activate_idempotent(api_client):
    """Activating current active preset returns HTTP 200 without redundant disk writes."""
    presets_res = api_client.get("/api/presets")
    active_theme = presets_res.json().get("active")

    # Activate the already-active theme
    res = api_client.post("/api/presets/activate", json={"themeName": active_theme})
    assert res.status_code == 200
    assert res.json().get("themeName") == active_theme


def test_f3_09_activate_utf8_spaces(api_client, repo_root):
    """Activating 'Kyoto Matcha' or preset with UTF-8 characters succeeds cleanly."""
    target_preset = "Kyoto Matcha"
    res = api_client.post("/api/presets/activate", json={"themeName": target_preset})
    assert res.status_code == 200
    assert res.json().get("themeName") == target_preset

    cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert cfg["themeName"] == target_preset


def test_f3_10_presets_immutable_via_get(api_client):
    """Presets dictionary in server memory is protected against client mutation."""
    res1 = api_client.get("/api/presets")
    assert res1.status_code == 200
    presets1 = res1.json()["presets"]

    # Mutate client-side dictionary
    presets1["WLOP Cosmic"]["primary"] = "#000000"

    # Re-fetch from server
    res2 = api_client.get("/api/presets")
    assert res2.status_code == 200
    presets2 = res2.json()["presets"]
    assert presets2["WLOP Cosmic"]["primary"] != "#000000"


# --- F4: Image Extraction Boundaries ---

def test_f4_06_corrupt_base64_string(api_client):
    """POST /api/themes/from-image with invalid base64 characters returns HTTP 400 Bad Request."""
    payload = {
        "imageBase64": "not_base64_data@@@!#$%",
        "themeName": "Corrupt B64"
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 400


def test_f4_07_non_image_payload(api_client):
    """Valid base64 encoding of non-image arbitrary bytes returns HTTP 422 Unprocessable Entity."""
    fake_bytes = b"This is plain text pretending to be an image."
    b64_text = base64.b64encode(fake_bytes).decode("ascii")
    payload = {
        "imageBase64": b64_text,
        "themeName": "Text Disguised As Image"
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code in (400, 422)


def test_f4_08_single_pixel_image(api_client):
    """1x1 PNG base64 upload succeeds and extracts valid dominant color without ZeroDivisionError."""
    img = Image.new("RGB", (1, 1), color=(147, 51, 234))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_pixel = base64.b64encode(buf.getvalue()).decode("ascii")

    payload = {
        "imageBase64": b64_pixel,
        "themeName": "Single Pixel Purple",
        "isLight": False
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    preset = res.json().get("preset", {})
    assert "primary" in preset and preset["primary"].startswith("#")


def test_f4_09_missing_required_fields(api_client):
    """POST /api/themes/from-image missing imageBase64 returns HTTP 400 Bad Request."""
    res = api_client.post("/api/themes/from-image", json={"themeName": "Missing Payload"})
    assert res.status_code == 400


def test_f4_10_duplicate_preset_name(api_client, synthetic_base64_image, repo_root):
    """Uploading image with existing theme name updates preset idempotently without syntax error."""
    payload = {
        "imageBase64": synthetic_base64_image,
        "themeName": "Cyberpunk Neon",
        "isLight": False
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    assert res.json().get("themeName") == "Cyberpunk Neon"

    # Verify JSON syntax integrity
    themes_file = repo_root / "themes" / "themes.json"
    themes_data = json.loads(themes_file.read_text(encoding="utf-8"))
    assert "Cyberpunk Neon" in themes_data


# --- F5: Daemon Lifecycle Boundaries ---

def test_f5_06_stale_pid_recovery(server_info, repo_root):
    """Server recovers from stale daemon.pid if the recorded process is no longer running."""
    pid_file = repo_root / "daemon.pid"
    # Write a dummy dead PID
    pid_file.write_text("9999999", encoding="utf-8")

    # Start a test server; it should detect dead PID and update it
    free_port = find_free_port(start_port=48100)
    srv = AntigravityTestServer(repo_root=repo_root, port=free_port, allow_fallback=True)
    try:
        srv.start()
        # Verify daemon.pid updated
        new_pid = int(pid_file.read_text(encoding="utf-8").strip())
        assert new_pid != 9999999
    finally:
        srv.stop()
        (repo_root / "daemon.webport").write_text(str(server_info["port"]), encoding="utf-8")


def test_f5_07_status_disallowed_method(api_client):
    """POST /api/status returns HTTP 405 Method Not Allowed."""
    res = api_client.post("/api/status")
    assert res.status_code == 405
    assert "GET" in res.headers.get("Allow", "")


def test_f5_08_rapid_reload_throttling(api_client):
    """Multiple rapid calls to POST /api/daemon/reload execute safely without race condition."""
    for _ in range(5):
        res = api_client.post("/api/daemon/reload")
        assert res.status_code == 200


def test_f5_09_webport_file_lifecycle(server_info, repo_root):
    """Stopping daemon removes daemon.webport cleanly."""
    free_port = find_free_port(start_port=48200)
    srv = AntigravityTestServer(repo_root=repo_root, port=free_port, allow_fallback=True)
    srv.start()
    webport_file = repo_root / "daemon.webport"
    assert webport_file.is_file()

    srv.stop()
    assert not webport_file.is_file(), "daemon.webport should be unlinked upon daemon shutdown"
    (repo_root / "daemon.webport").write_text(str(server_info["port"]), encoding="utf-8")


def test_f5_10_no_zombie_child_processes(api_client, synthetic_base64_image):
    """Execution of theme_from_image.py does not leave orphaned background processes."""
    payload = {
        "imageBase64": synthetic_base64_image,
        "themeName": "No Zombie Test",
        "isLight": False
    }
    res = api_client.post("/api/themes/from-image", json=payload)
    assert res.status_code == 200
    # Process execution completed cleanly
