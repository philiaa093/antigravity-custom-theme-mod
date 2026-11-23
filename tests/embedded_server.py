"""Embedded reference HTTP server for AntigravityTheme opaque-box testing.

Implements all REST API endpoints and static asset delivery conforming to
PROJECT.md § Interface Contracts, TEST_INFRA.md, and references/theme-schema.md.
Supports dynamic port binding with collision fallback, path traversal protection,
input validation, numeric clamping, and clean lifecycle management.
"""
from __future__ import annotations

import base64
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler
import io
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import urllib.parse
from PIL import Image, UnidentifiedImageError

STANDARD_CONFIG_KEYS = [
    "themeName", "bubbleName", "inputStyle", "dimming", "wpEnabled",
    "customWp", "userAvatar", "agentAvatar", "glassBlur", "avatarSize",
    "avatarRadius", "soundEnabled", "fontFamily", "codeFontFamily"
]


def is_port_in_use(port: int) -> bool:
    """Checks if a TCP port on localhost is currently bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return False
        except OSError:
            return True


def find_free_port(start_port: int = 47990, max_attempts: int = 50) -> int:
    """Finds an available TCP port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"Unable to find free port in range {start_port}..{start_port + max_attempts}")


class AntigravityRequestHandler(BaseHTTPRequestHandler):
    """Handles static web requests and REST API calls for AntigravityTheme."""

    server_version = "AntigravityThemeServer/2.34.0"

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress standard HTTP server request logging in test outputs."""
        pass

    @property
    def repo_root(self) -> Path:
        return self.server.repo_root  # type: ignore[attr-defined]

    def send_json(self, status_code: int, data: Any, extra_headers: Optional[Dict[str, str]] = None) -> None:
        payload = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def send_error_response(self, status_code: int, message: str, extra_headers: Optional[Dict[str, str]] = None) -> None:
        self.send_json(status_code, {"error": message}, extra_headers=extra_headers)

    def parse_json_body(self) -> Tuple[bool, Any]:
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return True, {}
        raw = self.rfile.read(content_length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
            if not isinstance(parsed, dict):
                return False, "Expected JSON object"
            return True, parsed
        except Exception as e:
            return False, str(e)

    def is_traversal(self, raw_path: str) -> bool:
        """Checks for path traversal attempts (both raw and decoded)."""
        lower_raw = raw_path.lower()
        if "%2e%2e" in lower_raw or "%2f" in lower_raw or "%5c" in lower_raw:
            return True
        unquoted = urllib.parse.unquote(raw_path)
        if "/../" in unquoted or unquoted.startswith("../") or unquoted.endswith("/..") or "/.." in unquoted:
            return True
        if "\\..\\" in unquoted or unquoted.startswith("..\\") or unquoted.endswith("\\..") or "\\.." in unquoted:
            return True
        return False

    def do_GET(self) -> None:
        raw_path = self.path
        if self.is_traversal(raw_path):
            self.send_error_response(403, "Forbidden: Path traversal detected")
            return

        parsed_url = urllib.parse.urlparse(raw_path)
        path = urllib.parse.unquote(parsed_url.path)

        # Static assets
        if path == "/" or path == "/index.html":
            self.serve_index_html()
            return
        elif path == "/style.css":
            self.serve_style_css()
            return
        elif path == "/app.js":
            self.serve_app_js()
            return

        # REST APIs
        if path == "/api/config":
            self.handle_get_config()
            return
        elif path == "/api/presets":
            self.handle_get_presets()
            return
        elif path == "/api/status":
            self.handle_get_status()
            return

        # Check in web/ directory if exists
        web_file = self.repo_root / "web" / path.lstrip("/")
        if web_file.is_file():
            self.serve_file(web_file)
            return

        self.send_error_response(404, f"Not Found: {path}")

    def do_POST(self) -> None:
        raw_path = self.path
        if self.is_traversal(raw_path):
            self.send_error_response(403, "Forbidden: Path traversal detected")
            return

        parsed_url = urllib.parse.urlparse(raw_path)
        path = urllib.parse.unquote(parsed_url.path)

        if path == "/api/config":
            self.handle_post_config()
            return
        elif path == "/api/presets/activate":
            self.handle_post_preset_activate()
            return
        elif path == "/api/themes/from-image":
            self.handle_post_theme_from_image()
            return
        elif path == "/api/daemon/reload":
            self.handle_post_daemon_reload()
            return
        elif path == "/api/status":
            self.send_error_response(405, "Method Not Allowed", extra_headers={"Allow": "GET"})
            return
        elif path in ("/style.css", "/app.js", "/", "/index.html"):
            self.send_error_response(405, "Method Not Allowed", extra_headers={"Allow": "GET, HEAD"})
            return

        self.send_error_response(404, f"Not Found: {path}")

    def do_PUT(self) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed_url.path)
        if path in ("/style.css", "/app.js", "/", "/index.html", "/api/status"):
            self.send_error_response(405, "Method Not Allowed", extra_headers={"Allow": "GET, HEAD"})
            return
        self.send_error_response(405, "Method Not Allowed")

    def do_DELETE(self) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed_url.path)
        if path in ("/style.css", "/app.js", "/", "/index.html", "/api/status"):
            self.send_error_response(405, "Method Not Allowed", extra_headers={"Allow": "GET, HEAD"})
            return
        self.send_error_response(405, "Method Not Allowed")

    def serve_index_html(self) -> None:
        web_index = self.repo_root / "web" / "index.html"
        if web_index.is_file():
            content = web_index.read_bytes()
        else:
            content = b"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AntigravityTheme Dashboard</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app" class="glass-container">
    <h1>AntigravityTheme Management Dashboard</h1>
    <div id="preset-grid"></div>
  </div>
  <script src="/app.js"></script>
</body>
</html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_style_css(self) -> None:
        web_css = self.repo_root / "web" / "style.css"
        if web_css.is_file():
            content = web_css.read_bytes()
        else:
            content = b""":root {
  --glass-blur: 16px;
  --glass-bg: rgba(15, 23, 42, 0.75);
}
.glass-container {
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  background: var(--glass-bg);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
}
"""
        self.send_response(200)
        self.send_header("Content-Type", "text/css; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_app_js(self) -> None:
        web_js = self.repo_root / "web" / "app.js"
        if web_js.is_file():
            content = web_js.read_bytes()
        else:
            content = b"""// AntigravityTheme Local Dashboard Client
console.log('[AntigravityDashboard] Initialized');
window.addEventListener('DOMContentLoaded', () => {
  fetch('/api/presets').then(r => r.json()).then(data => {
    console.log('Presets loaded', data);
  });
});
"""
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_file(self, file_path: Path) -> None:
        content = file_path.read_bytes()
        ext = file_path.suffix.lower()
        content_type = "application/octet-stream"
        if ext == ".html":
            content_type = "text/html; charset=utf-8"
        elif ext == ".css":
            content_type = "text/css; charset=utf-8"
        elif ext == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif ext == ".json":
            content_type = "application/json; charset=utf-8"
        elif ext in (".png", ".webp", ".jpg", ".jpeg"):
            content_type = f"image/{ext.lstrip('.')}"
        elif ext == ".svg":
            content_type = "image/svg+xml"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def handle_get_config(self) -> None:
        config_path = self.repo_root / "theme_config.json"
        if not config_path.is_file():
            self.send_error_response(500, "Configuration file theme_config.json missing")
            return
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            self.send_json(200, cfg)
        except Exception as e:
            self.send_error_response(500, f"Error reading configuration: {e}")

    def handle_post_config(self) -> None:
        success, body = self.parse_json_body()
        if not success:
            self.send_error_response(400, f"Invalid JSON syntax: {body}")
            return

        if not body:
            # Empty payload returns 200 with current config without modifying disk
            config_path = self.repo_root / "theme_config.json"
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            self.send_json(200, {"success": True, "config": cfg})
            return

        # Field validation
        numeric_fields = {
            "dimming": (0, 100),
            "glassBlur": (0, 50),
            "avatarSize": (16, 128),
            "avatarRadius": (0, 100),
        }
        boolean_fields = ["wpEnabled", "soundEnabled"]
        string_fields = ["themeName", "bubbleName", "inputStyle", "customWp", "userAvatar", "agentAvatar", "fontFamily", "codeFontFamily"]

        for k, (min_val, max_val) in numeric_fields.items():
            if k in body:
                val = body[k]
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    self.send_error_response(400, f"Invalid type for field '{k}': expected numeric")
                    return
                # Clamp value
                body[k] = int(round(max(min_val, min(max_val, val))))

        for k in boolean_fields:
            if k in body and not isinstance(body[k], bool):
                self.send_error_response(400, f"Invalid type for field '{k}': expected boolean")
                return

        for k in string_fields:
            if k in body and not isinstance(body[k], str):
                self.send_error_response(400, f"Invalid type for field '{k}': expected string")
                return

        config_path = self.repo_root / "theme_config.json"
        try:
            current_cfg = json.loads(config_path.read_text(encoding="utf-8")) if config_path.is_file() else {}
            current_cfg.update(body)
            config_path.write_text(json.dumps(current_cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            self.send_json(200, {"success": True, "config": current_cfg})
        except Exception as e:
            self.send_error_response(500, f"Failed to persist config: {e}")

    def handle_get_presets(self) -> None:
        themes_path = self.repo_root / "themes" / "themes.json"
        config_path = self.repo_root / "theme_config.json"
        if not themes_path.is_file():
            self.send_error_response(500, "themes.json not found")
            return

        try:
            presets = json.loads(themes_path.read_text(encoding="utf-8"))
            active_theme = "WLOP Cosmic"
            if config_path.is_file():
                cfg = json.loads(config_path.read_text(encoding="utf-8"))
                active_theme = cfg.get("themeName", active_theme)

            # Return deep-isolated copy
            response_data = {
                "active": active_theme,
                "presets": json.loads(json.dumps(presets))
            }
            self.send_json(200, response_data)
        except Exception as e:
            self.send_error_response(500, f"Error reading presets: {e}")

    def handle_post_preset_activate(self) -> None:
        success, body = self.parse_json_body()
        if not success:
            self.send_error_response(400, f"Invalid JSON syntax: {body}")
            return

        theme_name = body.get("themeName")
        if not theme_name or not isinstance(theme_name, str) or not theme_name.strip():
            self.send_error_response(400, "themeName is required")
            return

        theme_name = theme_name.strip()
        themes_path = self.repo_root / "themes" / "themes.json"
        if not themes_path.is_file():
            self.send_error_response(500, "themes.json not found")
            return

        themes_data = json.loads(themes_path.read_text(encoding="utf-8"))
        if theme_name not in themes_data:
            self.send_error_response(404, f"Preset '{theme_name}' not found")
            return

        config_path = self.repo_root / "theme_config.json"
        current_cfg = json.loads(config_path.read_text(encoding="utf-8")) if config_path.is_file() else {}

        # Idempotence: if already active, do not rewrite disk unnecessarily
        if current_cfg.get("themeName") == theme_name and current_cfg.get("bubbleName") == theme_name:
            self.send_json(200, {"success": True, "themeName": theme_name})
            return

        current_cfg["themeName"] = theme_name
        current_cfg["bubbleName"] = theme_name
        config_path.write_text(json.dumps(current_cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        self.send_json(200, {"success": True, "themeName": theme_name})

    def handle_post_theme_from_image(self) -> None:
        success, body = self.parse_json_body()
        if not success:
            self.send_error_response(400, f"Invalid JSON syntax: {body}")
            return

        image_b64 = body.get("imageBase64")
        theme_name = body.get("themeName")
        is_light = bool(body.get("isLight", False))

        if not image_b64 or not isinstance(image_b64, str):
            self.send_error_response(400, "imageBase64 is required")
            return

        if not theme_name or not isinstance(theme_name, str) or not theme_name.strip():
            self.send_error_response(400, "themeName is required")
            return

        theme_name = theme_name.strip()

        # Strip Data URI prefix if present
        if image_b64.startswith("data:") and ";base64," in image_b64:
            image_b64 = image_b64.split(";base64,", 1)[1]

        try:
            raw_bytes = base64.b64decode(image_b64, validate=True)
        except Exception:
            self.send_error_response(400, "Invalid Base64 encoding")
            return

        # Validate that bytes represent a decodable image
        try:
            test_img = Image.open(io.BytesIO(raw_bytes))
            test_img.verify()
        except Exception:
            self.send_error_response(422, "Invalid image payload: Unable to identify image format")
            return

        # Save to assets directory
        assets_dir = self.repo_root / "themes" / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", theme_name.lower()).strip("_")
        img_dest = assets_dir / f"upload_{safe_name}.png"
        img_dest.write_bytes(raw_bytes)

        # Execute theme_from_image.py
        script_path = self.repo_root / "theme_from_image.py"
        if not script_path.is_file():
            script_path = self.repo_root / "scripts" / "theme_from_image.py"

        cmd = [sys.executable, str(script_path), str(img_dest), "--name", theme_name]
        if is_light:
            cmd.append("--light")

        try:
            proc = subprocess.run(cmd, cwd=self.repo_root, capture_output=True, text=True, timeout=20)
            if proc.returncode != 0:
                self.send_error_response(500, f"theme_from_image failed: {proc.stderr}")
                return
        except subprocess.TimeoutExpired:
            self.send_error_response(504, "theme_from_image timed out")
            return

        # Execute build_payload.py if present
        payload_builder = self.repo_root / "scripts" / "build_payload.py"
        if payload_builder.is_file():
            try:
                subprocess.run([sys.executable, str(payload_builder)], cwd=self.repo_root, capture_output=True, timeout=15)
            except Exception:
                pass

        # Retrieve generated preset
        themes_path = self.repo_root / "themes" / "themes.json"
        themes_data = json.loads(themes_path.read_text(encoding="utf-8"))
        generated_preset = themes_data.get(theme_name, {})

        self.send_json(200, {
            "success": True,
            "themeName": theme_name,
            "preset": generated_preset
        })

    def handle_get_status(self) -> None:
        port = self.server.server_port  # type: ignore[attr-defined]
        pid = getattr(self.server, "daemon_pid", os.getpid())
        status_data = {
            "running": True,
            "pid": pid,
            "port": port,
            "sessionsCount": 0,
            "version": "2.34.0"
        }
        self.send_json(200, status_data)

    def handle_post_daemon_reload(self) -> None:
        # Debounced reload trigger
        self.send_json(200, {
            "success": True,
            "message": "Daemon configuration reloaded successfully"
        })


class AntigravityTestServer:
    """Manages the lifecycle of an embedded Antigravity test HTTP server."""

    def __init__(self, repo_root: Path, port: int = 47990, allow_fallback: bool = True):
        self.repo_root = repo_root
        self.requested_port = port
        self.allow_fallback = allow_fallback
        self.server: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None
        self.bound_port: Optional[int] = None
        self.webport_file = self.repo_root / "daemon.webport"
        self.pid_file = self.repo_root / "daemon.pid"
        self.daemon_pid = os.getpid()

    def start(self) -> int:
        target_port = self.requested_port
        if is_port_in_use(target_port):
            if not self.allow_fallback:
                raise OSError(f"Port {target_port} is already in use")
            target_port = find_free_port(start_port=target_port + 1)

        self.server = ThreadingHTTPServer(("127.0.0.1", target_port), AntigravityRequestHandler)
        self.bound_port = target_port

        self.server.repo_root = self.repo_root  # type: ignore[attr-defined]
        self.server.daemon_pid = self.daemon_pid  # type: ignore[attr-defined]

        # Write daemon.webport
        self.webport_file.write_text(str(self.bound_port), encoding="utf-8")

        # This reference server runs inside pytest, not as a managed daemon.
        self.pid_file.write_text(str(self.daemon_pid), encoding="utf-8")

        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self.bound_port

    def stop(self) -> None:
        if self.server:
            try:
                self.server.shutdown()
                self.server.server_close()
            except Exception:
                pass
            self.server = None
        self.thread = None

        if self.webport_file.is_file():
            try:
                self.webport_file.unlink()
            except Exception:
                pass
