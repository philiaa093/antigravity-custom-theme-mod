"""Central pytest fixtures and test harness for AntigravityTheme opaque-box testing.

Provides non-destructive isolation, synthetic image/SVG generation,
CLI runner with timeout protection, headless Node.js vm evaluator,
and schema validators conforming to references/theme-schema.md.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

_repo_root = Path(__file__).resolve().parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
from typing import Any, Callable, Dict, List, Optional
import xml.etree.ElementTree as ET

import pytest
from PIL import Image, ImageDraw

HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
RGBA_COLOR_RE = re.compile(r"^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\)$")
OVERLAY_RGB_RE = re.compile(r"^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$")

REQUIRED_SCHEMA_KEYS = [
    "concept", "primary", "secondary", "glow", "secondaryGlow",
    "bg", "frameBg", "textColor", "borderColor", "innerBorder",
    "clearBackdrop", "overlayRgb", "sidebarBg", "sidebarHoverBg",
    "aiCardBg", "aiCardBorder", "headerBg", "headerBorder",
    "unifiedGlass", "btnBg", "inputGlassBg", "inputCardBg",
    "modalBg", "modalHeaderBg", "cardBg", "cardSelectedBg", "wallpaper"
]


@pytest.fixture(scope="session")
def repo_root(tmp_path_factory) -> Path:
    """Give the reference server and CLI tests a disposable checkout."""
    root = tmp_path_factory.mktemp("checkout")
    for name in ("engine", "scripts", "themes", "web"):
        shutil.copytree(
            _repo_root / name, root / name,
            ignore=shutil.ignore_patterns("__pycache__", "themes.local.json", "user_media", "theme_*.webp", "upload_*.png"),
        )
    shutil.copy2(_repo_root / "theme_from_image.py", root)
    return root


@pytest.fixture(scope="session")
def compiled_payload(repo_root, tmp_path_factory):
    dist = tmp_path_factory.mktemp("payload") / "theme_payload.js"
    result = subprocess.run([sys.executable, str(repo_root / "scripts/build_payload.py"), "--out", str(dist)],
                            capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
    return dist


@pytest.fixture
def isolated_themes_json(tmp_path: Path, repo_root: Path) -> Path:
    """Creates an isolated copy of themes/themes.json in a temporary directory

    to ensure tests never pollute the workspace repository.
    """
    src_json = repo_root / "themes" / "themes.json"
    dest_json = tmp_path / "themes.json"
    dest_json.write_text(src_json.read_text(encoding="utf-8"), encoding="utf-8")
    return dest_json


@pytest.fixture
def synthetic_palette_image(tmp_path: Path) -> Path:
    """Generates a 200x200 PNG image with 4 distinct color quadrants:

    - Top-left: Amber (#FBBF24 / RGB 251, 191, 36)
    - Top-right: Sky Blue (#38BDF8 / RGB 56, 189, 248)
    - Bottom-left: Emerald (#34D399 / RGB 52, 211, 153)
    - Bottom-right: Deep Indigo (#1E1B4B / RGB 30, 27, 75)
    """
    img_path = tmp_path / "synthetic_palette.png"
    img = Image.new("RGB", (200, 200))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 100, 100], fill=(251, 191, 36))     # Amber
    draw.rectangle([100, 0, 200, 100], fill=(56, 189, 248))    # Sky Blue
    draw.rectangle([0, 100, 100, 200], fill=(52, 211, 153))    # Emerald
    draw.rectangle([100, 100, 200, 200], fill=(30, 27, 75))    # Deep Indigo
    img.save(img_path, format="PNG")
    return img_path


@pytest.fixture
def synthetic_gradient_image(tmp_path: Path) -> Path:
    """Generates a 256x256 horizontal gradient image from cyan to magenta."""
    img_path = tmp_path / "synthetic_gradient.png"
    img = Image.new("RGB", (256, 256))
    for x in range(256):
        r = int(x * (247 / 255))
        g = int((255 - x) * (245 / 255))
        b = 212
        for y in range(256):
            img.putpixel((x, y), (r, g, b))
    img.save(img_path, format="PNG")
    return img_path


@pytest.fixture
def synthetic_1x1_image(tmp_path: Path) -> Path:
    """Generates a 1x1 single-pixel image (minimum dimension boundary)."""
    img_path = tmp_path / "synthetic_1x1.png"
    img = Image.new("RGB", (1, 1), color=(147, 51, 234))  # Purple
    img.save(img_path, format="PNG")
    return img_path


@pytest.fixture
def synthetic_extreme_aspect_images(tmp_path: Path) -> Dict[str, Path]:
    """Generates extreme aspect ratio images (10000x1 horizontal, 1x10000 vertical)."""
    horiz_path = tmp_path / "extreme_10000x1.png"
    vert_path = tmp_path / "extreme_1x10000.png"
    Image.new("RGB", (10000, 1), color=(16, 185, 129)).save(horiz_path, format="PNG")
    Image.new("RGB", (1, 10000), color=(239, 68, 68)).save(vert_path, format="PNG")
    return {"horizontal": horiz_path, "vertical": vert_path}


@pytest.fixture
def corrupt_image_files(tmp_path: Path) -> Dict[str, Path]:
    """Generates various malformed and corrupt files to test error handling."""
    zero_byte = tmp_path / "zero_byte.png"
    zero_byte.write_bytes(b"")

    truncated = tmp_path / "truncated.jpg"
    truncated.write_bytes(b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01")

    garbage = tmp_path / "garbage.png"
    garbage.write_bytes(os.urandom(512))

    text_file = tmp_path / "fake_image.png"
    text_file.write_text("This is plain text pretending to be a PNG", encoding="utf-8")

    return {
        "zero_byte": zero_byte,
        "truncated": truncated,
        "garbage": garbage,
        "text_file": text_file,
    }


@pytest.fixture
def synthetic_circular_svg(tmp_path: Path) -> Path:
    """Creates a standard compliant circular SVG avatar with 100x100 viewBox and clipPath."""
    svg_path = tmp_path / "valid_avatar.svg"
    content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <clipPath id="circle-clip">
      <circle cx="50" cy="50" r="50" />
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip)">
    <rect width="100" height="100" fill="#38bdf8" />
    <circle cx="50" cy="40" r="20" fill="#ffffff" />
    <circle cx="50" cy="85" r="30" fill="#fbbf24" />
  </g>
</svg>"""
    svg_path.write_text(content, encoding="utf-8")
    return svg_path


@pytest.fixture
def malformed_svg_files(tmp_path: Path) -> Dict[str, Path]:
    """Generates invalid SVG files to test XML parser validation."""
    broken_xml = tmp_path / "broken_xml.svg"
    broken_xml.write_text("<svg viewBox='0 0 100 100'><circle></svg>", encoding="utf-8")

    missing_viewbox = tmp_path / "no_viewbox.svg"
    missing_viewbox.write_text("<svg width='100' height='100'><circle cx='50' cy='50' r='50'/></svg>", encoding="utf-8")

    non_square = tmp_path / "non_square.svg"
    non_square.write_text("<svg viewBox='0 0 200 100'><circle cx='50' cy='50' r='50'/></svg>", encoding="utf-8")

    return {
        "broken_xml": broken_xml,
        "missing_viewbox": missing_viewbox,
        "non_square": non_square,
    }


@pytest.fixture
def cli_runner(repo_root: Path) -> Callable[..., subprocess.CompletedProcess]:
    """Helper to execute CLI commands in the repository root with standardized capture."""
    def _run(args: List[str], cwd: Optional[Path] = None, timeout: int = 25) -> subprocess.CompletedProcess:
        full_cmd = [sys.executable] + args
        return subprocess.run(
            full_cmd,
            cwd=cwd or repo_root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    return _run


@pytest.fixture
def node_runner(repo_root: Path, tmp_path_factory) -> Callable[[str], subprocess.CompletedProcess]:
    """Helper to execute Node.js snippets with headless DOM/VM mocking."""
    def _run(js_code: str, timeout: int = 15) -> subprocess.CompletedProcess:
        wrapper = f"""
        const vm = require('vm');
        const localStorageStore = {{}};

        function createMockElement(tag = 'div') {{
            return {{
                id: '',
                tagName: (tag || 'div').toUpperCase(),
                style: {{ setProperty: () => {{}}, removeProperty: () => {{}} }},
                dataset: {{}},
                classList: {{ add: () => {{}}, remove: () => {{}}, contains: () => false }},
                children: [],
                parentElement: null,
                setAttribute: () => {{}},
                getAttribute: () => null,
                removeAttribute: () => {{}},
                appendChild: function(child) {{ child.parentElement = this; this.children.push(child); return child; }},
                removeChild: function(child) {{ return child; }},
                remove: () => {{}},
                textContent: '',
                innerHTML: '',
                getBoundingClientRect: () => ({{ top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800 }}),
                querySelector: function(sel) {{ return createMockElement('div'); }},
                querySelectorAll: function(sel) {{ return []; }},
                addEventListener: () => {{}},
                removeEventListener: () => {{}},
                width: 640,
                height: 480,
                getContext: (type) => ({{
                    filter: '',
                    fillStyle: '',
                    fillRect: () => {{}},
                    drawImage: () => {{}},
                    clearRect: () => {{}},
                }}),
                toDataURL: (fmt, q) => 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAEAESs=',
            }};
        }}

        class MockImage {{
            constructor() {{
                this.onload = null;
                this.onerror = null;
                this.width = 640;
                this.height = 480;
                this._src = '';
            }}
            get src() {{ return this._src; }}
            set src(v) {{
                this._src = v;
                if (typeof this.onload === 'function') {{
                    setTimeout(() => {{ if (this.onload) this.onload(); }}, 0);
                }}
            }}
        }}

        const mockBody = createMockElement('body');
        const mockHead = createMockElement('head');
        const mockHtml = createMockElement('html');

        const sandbox = {{
            window: {{}},
            addEventListener: () => {{}},
            removeEventListener: () => {{}},
            document: {{
                head: mockHead,
                body: mockBody,
                documentElement: mockHtml,
                createElement: (tag) => createMockElement(tag),
                getElementById: (id) => createMockElement('div'),
                querySelector: (sel) => createMockElement('div'),
                querySelectorAll: (sel) => [],
                addEventListener: () => {{}},
                removeEventListener: () => {{}},
            }},
            localStorage: {{
                getItem(k) {{ return localStorageStore[k] ?? null; }},
                setItem(k, v) {{ localStorageStore[k] = String(v); }},
                removeItem(k) {{ delete localStorageStore[k]; }}
            }},
            console: console,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            requestAnimationFrame: (cb) => setTimeout(cb, 16),
            cancelAnimationFrame: (id) => clearTimeout(id),
            ResizeObserver: class {{ observe() {{}} disconnect() {{}} }},
            MutationObserver: class {{ observe() {{}} disconnect() {{}} }},
            AbortController: AbortController,
            Image: MockImage,
            getComputedStyle: () => ({{ getPropertyValue: () => '' }}),
            matchMedia: () => ({{ matches: false, addListener: () => {{}}, removeListener: () => {{}} }}),
            AudioContext: class {{
                constructor() {{ this.currentTime = 0; this.state = 'suspended'; }}
                resume() {{ this.state = 'running'; return Promise.resolve(); }}
                createOscillator() {{
                    return {{
                        type: 'sine',
                        frequency: {{ setValueAtTime: () => {{}}, exponentialRampToValueAtTime: () => {{}} }},
                        connect: () => {{}},
                        start: () => {{}},
                        stop: () => {{}}
                    }};
                }}
                createGain() {{
                    return {{
                        gain: {{ setValueAtTime: () => {{}}, linearRampToValueAtTime: () => {{}}, exponentialRampToValueAtTime: () => {{}} }},
                        connect: () => {{}}
                    }};
                }}
            }}
        }};
        sandbox.webkitAudioContext = sandbox.AudioContext;
        sandbox.window = sandbox;
        global.window = sandbox;
        global.localStorage = sandbox.localStorage;
        global.sandbox = sandbox;
        vm.createContext(sandbox);
        {js_code}
        """
        temp_dir = tmp_path_factory.mktemp("node_runner")
        script_file = temp_dir / "runner.js"
        script_file.write_text(wrapper, encoding="utf-8")
        return subprocess.run(
            ["node", str(script_file)],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    return _run


@pytest.fixture
def theme_validator() -> Callable[[str, Dict[str, Any]], None]:
    """Validates that a theme configuration dictionary strictly conforms to references/theme-schema.md."""
    def _validate(name: str, theme: Dict[str, Any]) -> None:
        missing = [k for k in REQUIRED_SCHEMA_KEYS if k not in theme]
        assert not missing, f"Theme '{name}' missing required schema keys: {missing}"

        # Color formats
        assert HEX_COLOR_RE.match(theme["primary"]), f"Invalid primary hex in '{name}': {theme['primary']}"
        assert HEX_COLOR_RE.match(theme["secondary"]), f"Invalid secondary hex in '{name}': {theme['secondary']}"
        assert HEX_COLOR_RE.match(theme["textColor"]), f"Invalid textColor hex in '{name}': {theme['textColor']}"
        assert RGBA_COLOR_RE.match(theme["glow"]), f"Invalid glow rgba in '{name}': {theme['glow']}"
        assert RGBA_COLOR_RE.match(theme["secondaryGlow"]), f"Invalid secondaryGlow rgba in '{name}': {theme['secondaryGlow']}"

        # Triplet format "R, G, B"
        m = OVERLAY_RGB_RE.match(theme["overlayRgb"])
        assert m, f"Invalid overlayRgb triplet format in '{name}': {theme['overlayRgb']}"
        for part in m.groups():
            val = int(part)
            assert 0 <= val <= 255, f"RGB value out of range 0-255 in '{name}': {part}"

        # Check other standard RGBA keys
        rgba_keys = [
            "borderColor", "sidebarBg", "sidebarHoverBg", "aiCardBg",
            "aiCardBorder", "headerBg", "headerBorder", "btnBg",
            "inputGlassBg", "modalBg", "modalHeaderBg", "cardBg", "cardSelectedBg"
        ]
        for rk in rgba_keys:
            val = theme[rk]
            assert val.startswith("rgba(") and val.endswith(")"), (
                f"Field '{rk}' in '{name}' must be rgba string, got: {val}"
            )

        # Boolean and string types
        assert isinstance(theme["clearBackdrop"], bool), f"clearBackdrop must be boolean in '{name}'"
        assert isinstance(theme["unifiedGlass"], bool), f"unifiedGlass must be boolean in '{name}'"
        assert isinstance(theme["concept"], str) and len(theme["concept"]) > 0, f"concept must be non-empty string in '{name}'"
        assert isinstance(theme["wallpaper"], str), f"wallpaper must be string in '{name}'"

        # Optional avatar properties
        if "userAvatar" in theme and theme["userAvatar"]:
            assert isinstance(theme["userAvatar"], str)
        if "agentAvatar" in theme and theme["agentAvatar"]:
            assert isinstance(theme["agentAvatar"], str)

        # Optional light mode
        if theme.get("isLight"):
            assert isinstance(theme["isLight"], bool)

    return _validate


# Progressive Testability Helpers
def require_m2(repo_root: Path) -> Path:
    """Helper to gate Milestone 2 tests on theme_from_image.py presence."""
    script_path = repo_root / "theme_from_image.py"
    if not script_path.is_file():
        # Check alternative location scripts/theme_from_image.py
        alt = repo_root / "scripts" / "theme_from_image.py"
        if alt.is_file():
            return alt
        pytest.skip("Milestone 2 component 'theme_from_image.py' not yet implemented.")
    return script_path


def require_m3_avatars(repo_root: Path) -> List[Path]:
    """Helper to gate Milestone 3 avatar tests on avatar SVG files presence."""
    avatar_dir = repo_root / "themes" / "assets"
    expected = [
        avatar_dir / "avatar_anime.svg",
        avatar_dir / "avatar_robot.svg",
        avatar_dir / "avatar_pixel.svg",
    ]
    missing = [p for p in expected if not p.is_file()]
    if missing:
        pytest.skip(f"Milestone 3 avatar assets not yet implemented: {[p.name for p in missing]}")
    return expected


def require_m4_typography(repo_root: Path) -> str:
    """Helper to gate Milestone 4 typography tests on core.js typography support."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    if "--agy-font-ui" not in content:
        pytest.skip("Milestone 4 typography engine not yet implemented in engine/core.js")
    return content


def require_m4_audio(repo_root: Path) -> str:
    """Helper to gate Milestone 4 audio feedback tests on core.js audio support."""
    core_js = repo_root / "engine" / "core.js"
    content = core_js.read_text(encoding="utf-8")
    if "playFeedbackSound" not in content:
        pytest.skip("Milestone 4 audio feedback engine not yet implemented in engine/core.js")
    return content


# ---------------------------------------------------------------------------
# E2E Web Dashboard & System Tray Fixtures
# ---------------------------------------------------------------------------
import base64
import requests
from tests.embedded_server import AntigravityTestServer


class APIClient:
    """Wrapper around requests.Session providing base_url handling and defaults."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    def get(self, path: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}/{path.lstrip('/')}"
        kwargs.setdefault("timeout", 5)
        return self.session.get(url, **kwargs)

    def post(self, path: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}/{path.lstrip('/')}"
        kwargs.setdefault("timeout", 5)
        return self.session.post(url, **kwargs)

    def put(self, path: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}/{path.lstrip('/')}"
        kwargs.setdefault("timeout", 5)
        return self.session.put(url, **kwargs)

    def delete(self, path: str, **kwargs) -> requests.Response:
        url = f"{self.base_url}/{path.lstrip('/')}"
        kwargs.setdefault("timeout", 5)
        return self.session.delete(url, **kwargs)


@pytest.fixture(scope="session")
def synthetic_base64_image(tmp_path_factory) -> str:
    """Generates a valid 200x200 PNG image encoded as Base64 string."""
    temp_dir = tmp_path_factory.mktemp("b64_img")
    img_path = temp_dir / "synthetic_base64.png"
    img = Image.new("RGB", (200, 200))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 100, 100], fill=(251, 191, 36))     # Amber
    draw.rectangle([100, 0, 200, 100], fill=(56, 189, 248))    # Sky Blue
    draw.rectangle([0, 100, 100, 200], fill=(52, 211, 153))    # Emerald
    draw.rectangle([100, 100, 200, 200], fill=(30, 27, 75))    # Deep Indigo
    img.save(img_path, format="PNG")
    raw = img_path.read_bytes()
    return base64.b64encode(raw).decode("ascii")


@pytest.fixture(scope="session")
def server_info(repo_root: Path):
    """Run the reference implementation only; never contact a user's daemon."""
    default_config = dict(
        themeName="WLOP Cosmic", bubbleName="WLOP Cosmic", inputStyle="glass", dimming=75,
        wpEnabled=True, customWp="", userAvatar="", agentAvatar="", glassBlur=0,
        avatarSize=36, avatarRadius=50, soundEnabled=True, fontFamily="", codeFontFamily="",
    )
    (repo_root / "theme_config.json").write_text(json.dumps(default_config), encoding="utf-8")
    test_server = AntigravityTestServer(repo_root=repo_root)
    try:
        port = test_server.start()
        yield {"base_url": f"http://127.0.0.1:{port}", "port": port}
    finally:
        test_server.stop()


@pytest.fixture
def api_client(server_info) -> APIClient:
    """Provides a configured APIClient instance pointing to server_info['base_url']."""
    return APIClient(base_url=server_info["base_url"])


@pytest.fixture(autouse=True)
def isolate_test_state(repo_root: Path, request):
    """Restore the shared test server's mutable inputs, never live state."""
    files = (repo_root / "theme_config.json", repo_root / "themes/themes.json")
    snapshots = {file: file.read_bytes() for file in files if file.is_file()} if "server_info" in request.fixturenames else {}
    yield
    for file, snapshot in snapshots.items():
        file.write_bytes(snapshot)
