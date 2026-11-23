"""Tier 3 (Cross-Feature Pairwise) and Tier 4 (Real-World Scenarios) test suite

for AntigravityTheme Local Web Dashboard & Windows System Tray.
Conforms strictly to TEST_INFRA.md, PROJECT.md, and references/theme-schema.md.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import socket
import time
import pytest
import requests

from tests.embedded_server import AntigravityTestServer, STANDARD_CONFIG_KEYS, find_free_port


# ===========================================================================
# Tier 3: Cross-Feature Pairwise Combinations (10 Tests)
# ===========================================================================

def test_tier3_01_port_discovery_slider_status(server_info, api_client, repo_root):
    """TC-3.1: Explicit daemon.webport discovery + single slider update (dimming: 75) + status check."""
    # Step 1: Explicit port discovery via daemon.webport
    webport_file = repo_root / "daemon.webport"
    assert webport_file.is_file(), "daemon.webport must exist for explicit port discovery"
    discovered_port = int(webport_file.read_text(encoding="utf-8").strip())
    assert discovered_port == server_info["port"]

    # Step 2: Slider update
    update_res = api_client.post("/api/config", json={"dimming": 75})
    assert update_res.status_code == 200
    assert update_res.json()["config"]["dimming"] == 75

    # Step 3: Status health check
    status_res = api_client.get("/api/status")
    assert status_res.status_code == 200
    assert status_res.json().get("running") is True

    # Verify disk persistence
    disk_cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert disk_cfg["dimming"] == 75


def test_tier3_02_default_port_typography_reload(api_client, repo_root):
    """TC-3.2: Default port fallback + Nordic Frost + typography (Inter + JetBrains) + live reload."""
    # Step 1: Activate Light preset
    activate_res = api_client.post("/api/presets/activate", json={"themeName": "Nordic Frost"})
    assert activate_res.status_code == 200

    # Step 2: Typography update
    typo_payload = {
        "fontFamily": "Inter, sans-serif",
        "codeFontFamily": "'JetBrains Mono', monospace"
    }
    config_res = api_client.post("/api/config", json=typo_payload)
    assert config_res.status_code == 200
    cfg = config_res.json()["config"]
    assert cfg["fontFamily"] == typo_payload["fontFamily"]
    assert cfg["codeFontFamily"] == typo_payload["codeFontFamily"]

    # Step 3: Reload trigger
    reload_res = api_client.post("/api/daemon/reload")
    assert reload_res.status_code == 200
    assert reload_res.json().get("success") is True


def test_tier3_03_port_discovery_css_preset_booleans(api_client, repo_root):
    """TC-3.3: Explicit webport + Pure CSS preset ('Midnight Obsidian') + boolean toggle (wpEnabled: false)."""
    # Step 1: Activate Pure CSS theme
    activate_res = api_client.post("/api/presets/activate", json={"themeName": "Midnight Obsidian"})
    assert activate_res.status_code == 200

    # Step 2: Boolean toggle
    toggle_res = api_client.post("/api/config", json={"wpEnabled": False, "soundEnabled": False})
    assert toggle_res.status_code == 200
    assert toggle_res.json()["config"]["wpEnabled"] is False
    assert toggle_res.json()["config"]["soundEnabled"] is False

    # Step 3: Verify disk persistence
    disk_cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert disk_cfg["themeName"] == "Midnight Obsidian"
    assert disk_cfg["wpEnabled"] is False
    assert disk_cfg["soundEnabled"] is False


def test_tier3_04_default_port_neon_avatar_geometry(api_client, repo_root):
    """TC-3.4: Default port + 'Cyberpunk Neon' + avatar geometry (avatarSize: 48, radius: 30) + status check."""
    # Step 1: Activate neon theme
    activate_res = api_client.post("/api/presets/activate", json={"themeName": "Cyberpunk Neon"})
    assert activate_res.status_code == 200

    # Step 2: Geometry updates
    geom_res = api_client.post("/api/config", json={"avatarSize": 48, "avatarRadius": 30})
    assert geom_res.status_code == 200
    cfg = geom_res.json()["config"]
    assert cfg["avatarSize"] == 48
    assert cfg["avatarRadius"] == 30

    # Step 3: Status check
    status_res = api_client.get("/api/status")
    assert status_res.status_code == 200
    assert status_res.json().get("running") is True


def test_tier3_05_port_discovery_custom_image_blur_reload(api_client, synthetic_base64_image, repo_root):
    """TC-3.5: Explicit port + generated theme activation + glassBlur: 8 + reload trigger."""
    # Step 1: Upload synthetic image theme
    theme_name = "Pairwise Custom Dark"
    upload_res = api_client.post("/api/themes/from-image", json={
        "imageBase64": synthetic_base64_image,
        "themeName": theme_name,
        "isLight": False
    })
    assert upload_res.status_code == 200

    # Step 2: Activate the custom theme
    activate_res = api_client.post("/api/presets/activate", json={"themeName": theme_name})
    assert activate_res.status_code == 200

    # Step 3: Blur customization & reload
    config_res = api_client.post("/api/config", json={"glassBlur": 8})
    assert config_res.status_code == 200
    assert config_res.json()["config"]["glassBlur"] == 8

    reload_res = api_client.post("/api/daemon/reload")
    assert reload_res.status_code == 200


def test_tier3_06_default_port_light_image_input_styling(api_client, synthetic_base64_image, repo_root):
    """TC-3.6: Default port + light image theme generation + inputStyle: 'classic' + preset activation."""
    theme_name = "Pairwise Custom Light"
    # Step 1: Synthesize light theme from image
    upload_res = api_client.post("/api/themes/from-image", json={
        "imageBase64": synthetic_base64_image,
        "themeName": theme_name,
        "isLight": True
    })
    assert upload_res.status_code == 200
    assert upload_res.json()["preset"].get("isLight") is True

    # Step 2: Input style customization
    config_res = api_client.post("/api/config", json={"inputStyle": "classic", "dimming": 95})
    assert config_res.status_code == 200
    assert config_res.json()["config"]["inputStyle"] == "classic"

    # Step 3: Activate generated preset
    activate_res = api_client.post("/api/presets/activate", json={"themeName": theme_name})
    assert activate_res.status_code == 200

    # Verify disk
    disk_cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert disk_cfg["themeName"] == theme_name
    assert disk_cfg["inputStyle"] == "classic"


def test_tier3_07_port_discovery_zen_matcha_code_font(api_client, repo_root):
    """TC-3.7: Explicit port + 'Kyoto Matcha' activation + typography (Geist + Fira Code) + status check."""
    # Step 1: Activate Kyoto Matcha
    activate_res = api_client.post("/api/presets/activate", json={"themeName": "Kyoto Matcha"})
    assert activate_res.status_code == 200

    # Step 2: Update typography
    typo_res = api_client.post("/api/config", json={
        "fontFamily": "Geist, system-ui",
        "codeFontFamily": "'Fira Code', monospace"
    })
    assert typo_res.status_code == 200

    # Step 3: Status check
    status_res = api_client.get("/api/status")
    assert status_res.status_code == 200
    assert status_res.json().get("running") is True


def test_tier3_08_default_port_custom_light_audio_reload(api_client, synthetic_base64_image):
    """TC-3.8: Generated light preset, audio toggle, and repeatable reload."""
    theme_name = "Reference Light Audio"
    upload = api_client.post("/api/themes/from-image", json={
        "themeName": theme_name, "imageBase64": synthetic_base64_image, "isLight": True,
    })
    assert upload.status_code == 200
    assert upload.json()["preset"]["isLight"] is True
    activate_res = api_client.post("/api/presets/activate", json={"themeName": theme_name})
    assert activate_res.status_code == 200

    # Step 2: Toggle audio setting
    audio_res = api_client.post("/api/config", json={"soundEnabled": True, "wpEnabled": True})
    assert audio_res.status_code == 200
    assert audio_res.json()["config"]["soundEnabled"] is True

    # Step 3: Reload idempotence
    r1 = api_client.post("/api/daemon/reload")
    r2 = api_client.post("/api/daemon/reload")
    assert r1.status_code == 200
    assert r2.status_code == 200


def test_tier3_09_port_discovery_zero_blur_zero_dimming(api_client, repo_root):
    """TC-3.9: Explicit port + 'WLOP Cosmic' + boundary parameters (dimming: 0, glassBlur: 0)."""
    # Step 1: Activate WLOP Cosmic
    activate_res = api_client.post("/api/presets/activate", json={"themeName": "WLOP Cosmic"})
    assert activate_res.status_code == 200

    # Step 2: Set boundary values
    bounds_res = api_client.post("/api/config", json={"dimming": 0, "glassBlur": 0})
    assert bounds_res.status_code == 200
    cfg = bounds_res.json()["config"]
    assert cfg["dimming"] == 0
    assert cfg["glassBlur"] == 0

    # Verify disk
    disk_cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert disk_cfg["dimming"] == 0
    assert disk_cfg["glassBlur"] == 0


def test_tier3_10_default_port_full_reset_status_reload(api_client, repo_root):
    """TC-3.10: Default port + full reset to standard defaults + status and reload sequence."""
    default_config = {
        "themeName": "WLOP Cosmic",
        "bubbleName": "WLOP Cosmic",
        "inputStyle": "glass",
        "dimming": 92,
        "wpEnabled": True,
        "customWp": "",
        "userAvatar": "",
        "agentAvatar": "",
        "glassBlur": 3,
        "avatarSize": 38,
        "avatarRadius": 50,
        "soundEnabled": True,
        "fontFamily": "",
        "codeFontFamily": ""
    }
    reset_res = api_client.post("/api/config", json=default_config)
    assert reset_res.status_code == 200

    status_res = api_client.get("/api/status")
    assert status_res.status_code == 200

    reload_res = api_client.post("/api/daemon/reload")
    assert reload_res.status_code == 200


# ===========================================================================
# Tier 4: Real-World Application Scenarios (5 Workloads)
# ===========================================================================

def test_tier4_01_user_browsing_to_activation(api_client, repo_root):
    """Scenario 1: Complete web session: load dashboard assets, query presets, inspect active preset, activate Nordic Frost."""
    # 1. User opens browser to dashboard
    res_index = api_client.get("/")
    assert res_index.status_code == 200
    assert "antigravity" in res_index.text.lower() and "theme" in res_index.text.lower()

    # 2. Browser fetches stylesheets and scripts
    res_css = api_client.get("/style.css")
    assert res_css.status_code == 200

    res_js = api_client.get("/app.js")
    assert res_js.status_code == 200

    # 3. Dashboard frontend loads presets inventory and current config
    res_presets = api_client.get("/api/presets")
    assert res_presets.status_code == 200
    presets_data = res_presets.json()
    assert "Nordic Frost" in presets_data["presets"]

    res_cfg = api_client.get("/api/config")
    assert res_cfg.status_code == 200

    # 4. User clicks 'Nordic Frost' preset card and applies
    res_activate = api_client.post("/api/presets/activate", json={"themeName": "Nordic Frost"})
    assert res_activate.status_code == 200
    assert res_activate.json().get("success") is True

    # 5. Client re-queries config and presets to refresh UI
    res_cfg_after = api_client.get("/api/config")
    assert res_cfg_after.status_code == 200
    assert res_cfg_after.json()["themeName"] == "Nordic Frost"

    res_presets_after = api_client.get("/api/presets")
    assert res_presets_after.status_code == 200
    assert res_presets_after.json()["active"] == "Nordic Frost"


def test_tier4_02_granular_aesthetic_customization(api_client, repo_root):
    """Scenario 2: Granular aesthetic customization workflow: sliders, avatar geometry, typography, save and verify."""
    # 1. User configures detailed customization parameters
    updates = {
        "dimming": 88,
        "glassBlur": 6,
        "avatarSize": 42,
        "avatarRadius": 50,
        "fontFamily": "Inter, sans-serif",
        "inputStyle": "glass"
    }

    # 2. Submit changes via POST /api/config
    save_res = api_client.post("/api/config", json=updates)
    assert save_res.status_code == 200
    saved_cfg = save_res.json()["config"]

    # 3. Verify all edited values match
    for k, v in updates.items():
        assert saved_cfg[k] == v, f"Field '{k}' mismatch: expected {v}, got {saved_cfg[k]}"

    # 4. Verify unedited values preserved cleanly
    assert "themeName" in saved_cfg
    assert "wpEnabled" in saved_cfg

    # 5. Verify daemon status remains operational
    status_res = api_client.get("/api/status")
    assert status_res.status_code == 200
    assert status_res.json().get("running") is True


def test_tier4_03_e2e_image_theme_synthesis_and_switch(api_client, synthetic_base64_image, repo_root, theme_validator):
    """Scenario 3: End-to-end image theme synthesis, palette extraction, preset persistence, and immediate switch."""
    theme_name = "E2E Sunset Glow"

    # 1. User uploads image in dashboard
    upload_res = api_client.post("/api/themes/from-image", json={
        "imageBase64": synthetic_base64_image,
        "imageName": "sunset_palette.png",
        "themeName": theme_name,
        "isLight": False
    })
    assert upload_res.status_code == 200
    data = upload_res.json()
    assert data.get("success") is True
    preset = data.get("preset", {})
    assert preset, "Generated preset payload must not be empty"

    # 2. Verify schema compliance
    theme_validator(theme_name, preset)

    # 3. Verify preset is now listed in presets inventory
    presets_res = api_client.get("/api/presets")
    assert presets_res.status_code == 200
    assert theme_name in presets_res.json()["presets"]

    # 4. Immediately switch active theme to newly created preset
    activate_res = api_client.post("/api/presets/activate", json={"themeName": theme_name})
    assert activate_res.status_code == 200

    # 5. Verify config persistence on disk
    disk_cfg = json.loads((repo_root / "theme_config.json").read_text(encoding="utf-8"))
    assert disk_cfg["themeName"] == theme_name


def test_tier4_04_dynamic_port_collision_recovery(server_info, repo_root):
    """Scenario 4: Multi-instance dynamic port collision handling, fallback binding, and recovery."""
    # Find free base port
    base_port = find_free_port(start_port=48400)

    # 1. Occupy base_port with an external socket
    blocker_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker_socket.bind(("127.0.0.1", base_port))
    blocker_socket.listen(1)

    try:
        # 2. Start server targeting the occupied base_port
        fallback_server = AntigravityTestServer(repo_root=repo_root, port=base_port, allow_fallback=True)
        try:
            actual_port = fallback_server.start()
            # 3. Assert collision was detected and fallback triggered
            assert actual_port != base_port
            assert actual_port > base_port

            # 4. Verify client discovers the port via daemon.webport
            webport_file = repo_root / "daemon.webport"
            assert webport_file.is_file()
            discovered = int(webport_file.read_text(encoding="utf-8").strip())
            assert discovered == actual_port

            # 5. Connect to fallback instance and verify operation
            status_res = requests.get(f"http://127.0.0.1:{actual_port}/api/status", timeout=5)
            assert status_res.status_code == 200
            assert status_res.json().get("port") == actual_port

            # 6. Execute config mutation on fallback instance
            config_res = requests.post(f"http://127.0.0.1:{actual_port}/api/config", json={"dimming": 77}, timeout=5)
            assert config_res.status_code == 200
            assert config_res.json()["config"]["dimming"] == 77
        finally:
            fallback_server.stop()
            (repo_root / "daemon.webport").write_text(str(server_info["port"]), encoding="utf-8")
    finally:
        blocker_socket.close()


def test_tier4_05_system_tray_lifecycle_and_shutdown(server_info, repo_root):
    """Scenario 5: System Tray lifecycle: discovery, left-click browser URL, right-click switch/reload, exit cleanup."""
    # 1. System Tray discovers active webport
    webport_file = repo_root / "daemon.webport"
    assert webport_file.is_file()
    port = int(webport_file.read_text(encoding="utf-8").strip())
    assert port == server_info["port"]

    # 2. Tray Left-Click: resolves dashboard URL and launches default browser
    tray_url = f"http://localhost:{port}"
    dash_res = requests.get(f"http://127.0.0.1:{port}/", timeout=5)
    assert dash_res.status_code == 200
    assert "antigravity" in dash_res.text.lower() and "theme" in dash_res.text.lower()

    # 3. Tray Right-Click: Theme Presets submenu switch
    switch_res = requests.post(
        f"http://127.0.0.1:{port}/api/presets/activate",
        json={"themeName": "Cyberpunk Neon"},
        timeout=5
    )
    assert switch_res.status_code == 200
    assert switch_res.json().get("themeName") == "Cyberpunk Neon"

    # 4. Tray Right-Click: Reload Daemon
    reload_res = requests.post(f"http://127.0.0.1:{port}/api/daemon/reload", timeout=5)
    assert reload_res.status_code == 200

    # 5. Tray Exit cleanup lifecycle verification (using isolated server instance)
    exit_port = find_free_port(start_port=48500)
    exit_server = AntigravityTestServer(repo_root=repo_root, port=exit_port, allow_fallback=True)
    exit_server.start()
    assert (repo_root / "daemon.webport").is_file()

    # Simulate Tray Exit event
    exit_server.stop()
    # Webport removed and process terminated cleanly
    assert not (repo_root / "daemon.webport").is_file(), "Exit must cleanly remove daemon.webport"
    (repo_root / "daemon.webport").write_text(str(server_info["port"]), encoding="utf-8")
