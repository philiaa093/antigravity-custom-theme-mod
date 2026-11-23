#!/usr/bin/env node
'use strict';

/**
 * Antigravity Custom Theme Daemon (Windows / macOS / Linux)
 * Connects to Antigravity CDP (DevToolsActivePort), injects dist/theme_payload.js,
 * persists user theme preferences in theme_config.json, and hot-reloads on rebuild.
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');

if (typeof globalThis.WebSocket !== 'function') {
    console.error('[theme-daemon] Node.js >= 22 with built-in WebSocket is required.');
    process.exit(1);
}

const ROOT_DIR = path.resolve(__dirname, '..');
const PID_FILE = path.join(ROOT_DIR, 'daemon.pid');
const WEBPORT_FILE = path.join(ROOT_DIR, 'daemon.webport');
const CONFIG_FILE = process.env.AGY_CONFIG_PATH || path.join(ROOT_DIR, 'theme_config.json');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PAYLOAD_PATH = path.join(DIST_DIR, 'theme_payload.js');
const LOG_FILE = path.join(ROOT_DIR, 'daemon.log');
const DEFAULT_CONFIG = {};

const { startWebServer, resolveThemesFile, readPresets, validateAndClampConfig, atomicWriteJsonSync } = require('./web_server');
const THEMES_PATH = resolveThemesFile(ROOT_DIR);

function resolvePortFile() {
    if (process.env.AGY_PORT_FILE) {
        return process.env.AGY_PORT_FILE;
    }

    const home = os.homedir();
    let candidates;
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        candidates = [
            path.join(appData, 'antigravity', 'DevToolsActivePort'),
            path.join(appData, 'Antigravity', 'DevToolsActivePort'),
        ];
    } else if (process.platform === 'darwin') {
        const appSupport = path.join(home, 'Library', 'Application Support');
        candidates = [
            path.join(appSupport, 'antigravity', 'DevToolsActivePort'),
            path.join(appSupport, 'Antigravity', 'DevToolsActivePort'),
        ];
    } else {
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        candidates = [
            path.join(xdgConfig, 'antigravity', 'DevToolsActivePort'),
            path.join(xdgConfig, 'Antigravity', 'DevToolsActivePort'),
        ];
    }

    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) {
            fs.writeFileSync(LOG_FILE, '');
        }
        fs.appendFileSync(LOG_FILE, line);
    } catch (_) {}
    if (process.stdout.isTTY || process.env.AGY_DAEMON_STDOUT === '1') {
        process.stdout.write(line);
    }
}

function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function acquirePidLock() {
    if (fs.existsSync(PID_FILE)) {
        const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
            log(`Another daemon instance is already running (PID ${existingPid}). Exiting.`);
            process.exit(0);
        }
    }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function ensurePayload() {
    const builder = path.join(ROOT_DIR, 'scripts', 'build_payload.py');
    const sources = [builder, path.join(ROOT_DIR, 'engine', 'core.js'), THEMES_PATH];
    const artifact = fs.statSync(PAYLOAD_PATH, { throwIfNoEntry: false });
    if (artifact?.size && sources.every(file => (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) <= artifact.mtimeMs)) return;
    const python = process.env.PYTHON_PATH || process.env.PYTHON || process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
    execFileSync(python, [builder, '--themes', THEMES_PATH], { cwd: ROOT_DIR, windowsHide: true, timeout: 60000 });
    log('Rebuilt missing or stale dist/theme_payload.js.');
}

function removePidLock() {
    try {
        if (fs.existsSync(PID_FILE)) {
            const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
            if (pid === process.pid) {
                fs.unlinkSync(PID_FILE);
            }
        }
    } catch (_) {}
}

function removeWebportLock() {
    try {
        if (fs.existsSync(WEBPORT_FILE)) {
            fs.unlinkSync(WEBPORT_FILE);
        }
    } catch (_) {}
}

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        }
    } catch (err) {
        log(`Failed reading theme_config.json: ${err.message}`);
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(next) {
    try {
        if (!next || typeof next !== 'object' || Array.isArray(next)) return null;
        const presets = readPresets(THEMES_PATH);
        const { sanitized, errors } = validateAndClampConfig(next, presets);
        if (errors.length) throw new Error(errors.join('; '));
        atomicWriteJsonSync(CONFIG_FILE, { ...readConfig(), ...sanitized });
        return sanitized;
    } catch (err) {
        log(`Failed saving theme_config.json: ${err.message}`);
        return null;
    }
}

let missingPayloadLogged = false;
let webServerInstance = null;

function isThemePage(url) {
    try {
        const page = new URL(url);
        return (['https:', 'http:'].includes(page.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(page.hostname) &&
            !(page.protocol === 'http:' && Number(page.port) === webServerInstance?.port)) ||
            (page.protocol === 'vscode-file:' && page.hostname === 'vscode-app' && /\/(?:workbench|launchpad)\.html$/.test(page.pathname));
    } catch (_) { return false; }
}

function buildInjectedSource(page) {
    if (!fs.existsSync(PAYLOAD_PATH)) {
        if (!missingPayloadLogged) {
            log(`Payload not built yet (${PAYLOAD_PATH}). Run: python scripts/build_payload.py`);
            missingPayloadLogged = true;
        }
        return null;
    }
    missingPayloadLogged = false;

    const cfgJson = JSON.stringify(readConfig());
    const payloadCode = fs.readFileSync(PAYLOAD_PATH, 'utf8');
    const expected = new URL(page.url);
    const guard = `window === window.top && location.protocol === ${JSON.stringify(expected.protocol)} && location.host === ${JSON.stringify(expected.host)}`;
    return `(() => {
        if (!(${guard}) || !document.body || !document.head) return '';
        window.__AGY_INITIAL_CONFIG__ = ${cfgJson};
        window.__AGY_MEDIA_ACCESS__ = ${JSON.stringify(webServerInstance?.mediaAccess || null)};
        ${payloadCode}
        return document.getElementById('agy-studio-style') ? localStorage.getItem('agy_theme_v3') : '';
    })()`;
}

function getPortInfo() {
    const portFile = resolvePortFile();
    if (!fs.existsSync(portFile)) return null;
    const lines = fs
        .readFileSync(portFile, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    const port = parseInt(lines[0], 10);
    if (!Number.isFinite(port) || port <= 0) return null;
    return { port, token: lines[1] || '' };
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
        req.on('error', reject);
    });
}

const sessions = new Map();
let lastPort = null;
let reloadTimer = null;

function createSession(target) {
    const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const session = { id: target.id, ws, target };
    sessions.set(target.id, session);

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (ws.readyState !== 1) {
                reject(new Error('WebSocket is not open'));
                return;
            }
            const id = nextId++;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, 8000);
            pending.set(id, { resolve, reject, timer });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    session.send = send;
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description?.split('\n')[0] || result.exceptionDetails.text);
        return result.result?.value;
    }

    session.applyTheme = async (config) => {
        const expr = `window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__?.(${JSON.stringify(config)}, false)`;
        const applied = await evaluate(expr);
        if (!applied || (config.themeName && applied !== config.themeName)) throw new Error('Renderer did not apply the requested theme');
        session.appliedTheme = applied;
    };

    session.reinject = async () => {
        try {
            const src = buildInjectedSource(session.target);
            session.appliedTheme = src ? await evaluate(src) : '';
        } catch (err) {
            session.appliedTheme = '';
            log(`Reinject error for ${session.id}: ${err.message}`);
        }
        return session.appliedTheme;
    };

    ws.addEventListener('message', async (event) => {
        let msg;
        try {
            msg = JSON.parse(String(event.data));
        } catch (_) {
            return;
        }

        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
            else p.resolve(msg.result);
            return;
        }

        if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === 'agySaveThemeConfig') {
            try {
                const payload = JSON.parse(msg.params.payload || '{}');
                const changes = saveConfig(payload);
                if (!changes) return;
                if (changes.themeName && session.appliedTheme) session.appliedTheme = changes.themeName;
                for (const other of sessions.values()) {
                    if (other.id !== target.id) {
                        other.applyTheme(changes).catch(() => other.reinject());
                    }
                }
            } catch (err) {
                log(`Config binding error: ${err.message}`);
            }
            return;
        }

        if (msg.method === 'Page.domContentEventFired') {
            await session.reinject();
        }
    });

    ws.addEventListener('open', async () => {
        try {
            await send('Page.enable');
            await send('Runtime.enable');
            try {
                await send('Runtime.addBinding', { name: 'agySaveThemeConfig' });
            } catch (_) {}

            await session.reinject();
            log(`Attached target ${target.id}`);
        } catch (err) {
            log(`Attach error for ${target.id}: ${err.message}`);
        }
    });

    const cleanup = () => {
        for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error('WebSocket closed'));
        }
        pending.clear();
        if (sessions.get(target.id) === session) sessions.delete(target.id);
    };
    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);
}

async function scanPages() {
    const info = getPortInfo();
    if (!info) return;

    if (lastPort !== null && lastPort !== info.port) {
        for (const s of sessions.values()) {
            try {
                s.ws.close();
            } catch (_) {}
        }
        sessions.clear();
    }
    lastPort = info.port;

    let targets;
    try {
        targets = await fetchJson(`http://127.0.0.1:${info.port}/json`);
    } catch (_) {
        return;
    }
    if (!Array.isArray(targets)) return;

    const pages = targets.filter(t => t?.type === 'page' && t.webSocketDebuggerUrl && isThemePage(t.url));

    const liveIds = new Set(pages.map((p) => p.id));
    for (const [id, session] of sessions.entries()) {
        if (!liveIds.has(id)) {
            try {
                session.ws.close();
            } catch (_) {}
            sessions.delete(id);
        }
    }

    for (const page of pages) {
        const session = sessions.get(page.id);
        if (!session) { createSession(page); continue; }
        const previous = new URL(session.target.url);
        const current = new URL(page.url);
        session.target = page;
        if (previous.protocol !== current.protocol || previous.host !== current.host) session.reinject();
    }
}

function watchPayload() {
    try {
        if (!fs.existsSync(DIST_DIR)) {
            fs.mkdirSync(DIST_DIR, { recursive: true });
        }
        fs.watch(DIST_DIR, (_eventType, filename) => {
            if (filename && filename !== 'theme_payload.js') return;
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                log('Detected dist/theme_payload.js update; hot-reloading attached pages.');
                for (const s of sessions.values()) {
                    s.reinject();
                }
            }, 250);
        });
    } catch (err) {
        log(`fs.watch skipped: ${err.message}`);
    }
}

const cdpController = {
    getSessionCount() {
        return Array.from(sessions.values()).filter(s => s.appliedTheme).length;
    },
    getAppliedTheme() {
        return Array.from(sessions.values()).find(s => s.appliedTheme)?.appliedTheme || '';
    },
    async broadcastTheme(config) {
        const list = Array.from(sessions.values());
        const confirmed = await Promise.all(list.map(async s => {
            try {
                await s.applyTheme(config);
                return true;
            } catch (err) {
                log(`Broadcast error for ${s.id}: ${err.message}`);
                const applied = await s.reinject();
                return Boolean(applied && (!config.themeName || applied === config.themeName));
            }
        }));
        return confirmed.filter(Boolean).length;
    },
    async reinjectAll() {
        const list = Array.from(sessions.values());
        await Promise.all(list.map((s) => s.reinject().catch((err) => {
            log(`Reinject error for ${s.id}: ${err.message}`);
        })));
    }
};

function shutdown(signal) {
    log(`Shutting down on ${signal}.`);
    if (webServerInstance) {
        try { webServerInstance.close(); } catch (_) {}
    }
    for (const s of sessions.values()) {
        try {
            s.ws.close();
        } catch (_) {}
    }
    sessions.clear();
    removePidLock();
    removeWebportLock();
    process.exit(0);
}

async function startDaemon() {
    acquirePidLock();
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('exit', () => {
        removePidLock();
        removeWebportLock();
    });
    try {
        ensurePayload();
        webServerInstance = await startWebServer({ rootDir: ROOT_DIR, themesFilePath: THEMES_PATH, cdp: cdpController, log });
    } catch (err) {
        log(`Daemon startup failed: ${err.message}`);
        process.exit(1);
    }
    log(`Theme daemon started (PID ${process.pid}, platform=${process.platform}, portFile=${resolvePortFile()}).`);
    watchPayload();
    scanPages();
    setInterval(scanPages, 1500);
}

if (process.platform === 'win32') {
    // Tray launchers use daemon.pid as a status file; the pipe stays locked even if that file is removed.
    const key = createHash('sha256').update(fs.realpathSync(ROOT_DIR).toLowerCase()).digest('hex').slice(0, 24);
    const lock = net.createServer(socket => socket.end());
    lock.on('error', err => {
        log(err.code === 'EADDRINUSE' ? 'Another theme daemon owns this workspace.' : `Daemon lock failed: ${err.message}`);
        process.exit(err.code === 'EADDRINUSE' ? 0 : 1);
    });
    lock.listen(`\\\\.\\pipe\\antigravity-theme-${key}`, startDaemon);
} else void startDaemon();
