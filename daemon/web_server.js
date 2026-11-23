'use strict';

/**
 * Antigravity Web Dashboard HTTP Server & REST API Backend
 * Native Node.js HTTP server with ZERO external npm dependencies.
 * Serves static assets from web/ and provides REST endpoints for theme management.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createHash, randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

const DEFAULT_CONFIG = {
    themeName: 'WLOP Cosmic',
    bubbleName: 'WLOP Cosmic',
    inputStyle: 'sync',
    dimming: 69,
    wpEnabled: true,
    customWp: '',
    userAvatar: '',
    agentAvatar: '',
    glassBlur: 10,
    avatarSize: 32,
    avatarRadius: 50,
    soundEnabled: true,
    fontFamily: '',
    codeFontFamily: '',
    wallpaperMode: 'preset', imageMedia: '', videoMedia: '',
    bootIntro: false, sketchReveal: false, customGreetings: [], taskVoiceEnabled: false, taskVoiceVolume: 80
};

const ALLOWED_INPUT_STYLES = new Set(['sync', 'double_gold', 'glass', 'minimal']);
const MAX_PAYLOAD_SIZE = 25 * 1024 * 1024; // 25 MB
const MEDIA_TYPES = {
    '.png': ['image/png', b => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
    '.jpg': ['image/jpeg', b => b[0] === 255 && b[1] === 216 && b[2] === 255],
    '.webp': ['image/webp', b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
    '.gif': ['image/gif', b => /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))],
    '.mp4': ['video/mp4', b => b.toString('ascii', 4, 8) === 'ftyp'],
    '.webm': ['video/webm', b => b.readUInt32BE(0) === 0x1a45dfa3],
    '.mp3': ['audio/mpeg', b => b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 255 && (b[1] & 0xe0) === 0xe0)],
    '.wav': ['audio/wav', b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE'],
    '.ogg': ['audio/ogg', b => b.toString('ascii', 0, 4) === 'OggS'],
    '.m4a': ['audio/mp4', b => b.toString('ascii', 4, 8) === 'ftyp'],
    '.aac': ['audio/aac', b => b[0] === 255 && (b[1] & 0xf6) === 0xf0],
    '.flac': ['audio/flac', b => b.toString('ascii', 0, 4) === 'fLaC']
};
MEDIA_TYPES['.jpeg'] = MEDIA_TYPES['.jpg'];
MEDIA_TYPES['.m4v'] = MEDIA_TYPES['.mp4'];
MEDIA_TYPES['.mov'] = ['video/quicktime', MEDIA_TYPES['.mp4'][1]];
const MEDIA_ID = /^[a-f0-9]{64}-[\p{L}\p{M}\p{N} ._()+-]{1,96}\.[a-z0-9]{2,4}$/u;
const SAMPLE_VOICE = 'voice/1795011944060_Tawa_voice_task_1.mp3';
const mediaType = name => MEDIA_TYPES[path.extname(name).toLowerCase()]?.[0];
const STUDIO_CONFIG_KEYS = ['wallpaperMode', 'imageMedia', 'videoMedia', 'bootIntro', 'sketchReveal', 'customGreetings', 'taskVoiceEnabled', 'taskVoiceVolume'];

function hasMediaDirectory(dir) {
    try {
        if (!fs.lstatSync(dir).isDirectory()) throw new Error('Media directory must not be a link');
        return true;
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return false;
    }
}

function listMedia(dir) {
    if (!hasMediaDirectory(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && MEDIA_ID.test(entry.name) && mediaType(entry.name))
        .map(({ name: id }) => ({ id, name: id.slice(65), kind: mediaType(id).split('/')[0] }));
}

async function serveMedia(req, res, file, type) {
    const stat = await fs.promises.lstat(file).catch(err => {
        if (err.code !== 'ENOENT') throw err;
    });
    if (!stat?.isFile() || !stat.size) return sendError(res, 404, 'Media file not found');
    const headers = {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
    };
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (match && (match[1] || match[2])) {
            start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
            if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
        }
        if (!match || (!match[1] && !Number(match[2])) || start > end || start >= stat.size) {
            res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` });
            return res.end();
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    await pipeline(fs.createReadStream(file, { start, end }), res).catch(() => res.destroy());
}

// Serialize config and catalog writes so presets cannot be activated during deletion.
let writeMutex = Promise.resolve();

function serializeWrite(fn) {
    const next = writeMutex.then(fn, fn);
    writeMutex = next.catch(() => {});
    return next;
}

/**
 * Atomically writes JSON data to target file on Windows NTFS.
 */
function atomicWriteJsonSync(targetPath, data, mode = 0o666) {
    const dir = path.dirname(targetPath);
    const basename = path.basename(targetPath);
    const tmpPath = path.join(dir, `.${basename}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`);
    const formatted = JSON.stringify(data, null, 2) + '\n';

    const fd = fs.openSync(tmpPath, 'wx', mode);
    try {
        fs.writeSync(fd, formatted, 0, 'utf8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }

    let attempts = 10;
    let delayMs = 15;
    while (attempts > 0) {
        try {
            fs.renameSync(tmpPath, targetPath);
            return;
        } catch (err) {
            attempts--;
            if (attempts === 0 || (err.code !== 'EPERM' && err.code !== 'EBUSY')) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                throw err;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
            delayMs *= 2;
        }
    }
}

function resolvePython() {
    return process.env.PYTHON_PATH || process.env.PYTHON || process.env.PYTHON_CMD || 'python';
}

function execFileAsync(cmd, args, options) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, options, (err, stdout, stderr) => {
            if (err) {
                const message = (stderr || stdout || err.message).trim();
                const wrapped = new Error(message);
                wrapped.code = err.code;
                wrapped.killed = err.killed;
                return reject(wrapped);
            }
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

function sendJson(res, statusCode, data) {
    setCorsHeaders(res);
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(payload);
}

function sendError(res, statusCode, message, details) {
    const body = { success: false, error: message };
    if (details !== undefined) body.details = details;
    sendJson(res, statusCode, body);
}

function isLoopback(hostname) {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

function isLocalDashboard(req, url) {
    const site = req.headers['sec-fetch-site'];
    return isLoopback(url.hostname) && (!req.headers.origin || req.headers.origin === url.origin) &&
        (!site || site === 'same-origin' || site === 'none');
}

function validateVisionConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected AI settings');
    let url;
    if (typeof input.url === 'string' && input.url.length <= 2048) {
        try { url = new URL(input.url.trim()); } catch (_) {}
    }
    if (!url || !(url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))) ||
        url.username || url.password || url.search || url.hash || url.pathname === '/') {
        throw new Error('Enter the full HTTPS API URL, or local HTTP URL, without credentials, query, or fragment');
    }
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    if (!model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) throw new Error('Enter a valid model ID');
    const imageModel = input.imageModel === undefined ? '' : input.imageModel;
    if (typeof imageModel !== 'string' || imageModel.length > 128 || /[\u0000-\u001f\u007f]/.test(imageModel) ||
        (imageModel.trim() && !url.pathname.endsWith('/chat/completions'))) {
        throw new Error('An image model requires a valid model ID and a URL ending in /chat/completions');
    }
    const apiKey = input.apiKey === undefined ? '' : input.apiKey;
    if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{0,2048}$/.test(apiKey.trim())) throw new Error('Invalid API key');
    return { url: url.href, model, imageModel: imageModel.trim(), apiKey: apiKey.trim() };
}

function readRequestBody(req, limit = MAX_PAYLOAD_SIZE) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalSize = 0;

        req.on('data', (chunk) => {
            totalSize += chunk.length;
            if (totalSize > limit) {
                req.destroy();
                const err = new Error('Payload too large');
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function parseMultipart(buffer, boundary) {
    const boundaryBuf = Buffer.from('--' + boundary);
    const result = { fields: Object.create(null), files: Object.create(null) };
    let start = buffer.indexOf(boundaryBuf);

    while (start !== -1) {
        start += boundaryBuf.length;
        if (buffer.slice(start, start + 2).toString() === '--') break;
        if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;

        const nextBoundary = buffer.indexOf(boundaryBuf, start);
        if (nextBoundary === -1) break;

        const partBuf = buffer.slice(start, nextBoundary - 2);
        start = nextBoundary;

        const headerSep = Buffer.from('\r\n\r\n');
        const headerEnd = partBuf.indexOf(headerSep);
        if (headerEnd === -1) continue;

        const headersStr = partBuf.slice(0, headerEnd).toString('utf8');
        const bodyBuf = partBuf.slice(headerEnd + 4);

        const nameMatch = headersStr.match(/name="([^"]+)"/i);
        const filenameMatch = headersStr.match(/filename="([^"]+)"/i);

        if (nameMatch) {
            const fieldName = nameMatch[1];
            if (filenameMatch) {
                result.files[fieldName] = {
                    filename: filenameMatch[1],
                    data: bodyBuf
                };
            } else {
                result.fields[fieldName] = bodyBuf.toString('utf8').trim();
            }
        }
    }
    return result;
}

async function extractImagePayload(req) {
    const rawBuffer = await readRequestBody(req);
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
        let json;
        try {
            json = JSON.parse(rawBuffer.toString('utf8'));
        } catch (_) {
            const err = new Error('Invalid JSON payload');
            err.statusCode = 400;
            throw err;
        }

        if (typeof json?.imageBase64 !== 'string' || !json.imageBase64) {
            const err = new Error("Field 'imageBase64' is required");
            err.statusCode = 400;
            throw err;
        }

        const cleanBase64 = json.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '');
        if (cleanBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
            throw Object.assign(new Error('Invalid base64 image'), { statusCode: 400 });
        }
        const imageBuffer = Buffer.from(cleanBase64, 'base64');
        return {
            themeName: json.themeName,
            imageName: typeof json.imageName === 'string' ? json.imageName : 'uploaded_image.png',
            imageBuffer,
            isLight: json.isLight === true,
            activate: json.activate === true,
            preview: json.preview === true,
            ai: json.ai === true,
            design: json.design,
            rotation: json.rotation,
            aiAvatar: json.aiAvatar === true,
            avatarData: json.avatarData,
            createOnly: json.createOnly === true
        };
    } else if (contentType.includes('multipart/form-data')) {
        const match = contentType.match(/boundary=([^;]+)/i);
        if (!match) {
            const err = new Error('Malformed multipart: missing boundary');
            err.statusCode = 400;
            throw err;
        }
        const boundary = match[1].trim().replace(/^["']|["']$/g, '');
        const parsed = parseMultipart(rawBuffer, boundary);

        const fileEntry = parsed.files.image || parsed.files.file || Object.values(parsed.files)[0];
        if (!fileEntry || !fileEntry.data || fileEntry.data.length === 0) {
            const err = new Error('Missing image file in multipart upload');
            err.statusCode = 400;
            throw err;
        }

        return {
            themeName: parsed.fields.themeName,
            imageName: fileEntry.filename || 'uploaded_image.png',
            imageBuffer: fileEntry.data,
            isLight: parsed.fields.isLight === 'true' || parsed.fields.isLight === '1',
            activate: parsed.fields.activate === 'true' || parsed.fields.activate === '1'
        };
    }

    const err = new Error('Unsupported Content-Type: expected application/json or multipart/form-data');
    err.statusCode = 400;
    throw err;
}

function readPresets(themesFilePath) {
    try {
        if (fs.existsSync(themesFilePath)) {
            const raw = fs.readFileSync(themesFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        }
    } catch (_) {}
    return {};
}

function readConfig(configFilePath) {
    try {
        if (fs.existsSync(configFilePath)) {
            const raw = fs.readFileSync(configFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return { ...DEFAULT_CONFIG, ...(parsed.customWp ? { wallpaperMode: 'image' } : {}), ...parsed };
            }
        }
    } catch (_) {}
    return { ...DEFAULT_CONFIG };
}

function validateAndClampConfig(updates, knownPresets) {
    const sanitized = {};
    const errors = [];

    if (updates.themeName !== undefined) {
        if (typeof updates.themeName !== 'string' || !updates.themeName.trim()) {
            errors.push("Field 'themeName' must be a non-empty string");
        } else if (knownPresets && !Object.hasOwn(knownPresets, updates.themeName)) {
            errors.push(`Theme preset '${updates.themeName}' does not exist`);
        } else {
            sanitized.themeName = updates.themeName.trim();
        }
    }

    if (updates.bubbleName !== undefined) {
        if (typeof updates.bubbleName !== 'string' || !updates.bubbleName.trim()) {
            errors.push("Field 'bubbleName' must be a non-empty string");
        } else if (knownPresets && !Object.hasOwn(knownPresets, updates.bubbleName)) {
            errors.push(`Bubble theme preset '${updates.bubbleName}' does not exist`);
        } else {
            sanitized.bubbleName = updates.bubbleName.trim();
        }
    }

    if (updates.inputStyle !== undefined) {
        if (typeof updates.inputStyle !== 'string' || !ALLOWED_INPUT_STYLES.has(updates.inputStyle)) {
            errors.push(`Field 'inputStyle' must be one of: ${Array.from(ALLOWED_INPUT_STYLES).join(', ')}`);
        } else {
            sanitized.inputStyle = updates.inputStyle;
        }
    }

    if (updates.dimming !== undefined) {
        const num = Number(updates.dimming);
        if (!Number.isFinite(num)) {
            errors.push("Field 'dimming' must be a valid number");
        } else {
            sanitized.dimming = Math.round(Math.min(100, Math.max(0, num)));
        }
    }

    if (updates.glassBlur !== undefined) {
        const num = Number(updates.glassBlur);
        if (!Number.isFinite(num)) {
            errors.push("Field 'glassBlur' must be a valid number");
        } else {
            sanitized.glassBlur = Math.round(Math.min(24, Math.max(0, num)));
        }
    }

    if (updates.avatarSize !== undefined) {
        const num = Number(updates.avatarSize);
        if (!Number.isFinite(num)) {
            errors.push("Field 'avatarSize' must be a valid number");
        } else {
            sanitized.avatarSize = Math.round(Math.min(52, Math.max(22, num)));
        }
    }

    if (updates.avatarRadius !== undefined) {
        const num = Number(updates.avatarRadius);
        if (!Number.isFinite(num)) {
            errors.push("Field 'avatarRadius' must be a valid number");
        } else {
            sanitized.avatarRadius = Math.round(Math.min(50, Math.max(0, num)));
        }
    }

    if (updates.wpEnabled !== undefined) {
        sanitized.wpEnabled = Boolean(updates.wpEnabled);
    }

    if (updates.soundEnabled !== undefined) {
        sanitized.soundEnabled = Boolean(updates.soundEnabled);
    }

    if (updates.customWp !== undefined) {
        sanitized.customWp = typeof updates.customWp === 'string' ? updates.customWp.trim() : '';
        if (sanitized.customWp && updates.wallpaperMode === undefined) sanitized.wallpaperMode = 'image';
    }

    if (updates.userAvatar !== undefined) {
        sanitized.userAvatar = typeof updates.userAvatar === 'string' ? updates.userAvatar.trim() : '';
    }

    if (updates.agentAvatar !== undefined) {
        sanitized.agentAvatar = typeof updates.agentAvatar === 'string' ? updates.agentAvatar.trim() : '';
    }

    if (updates.fontFamily !== undefined) {
        sanitized.fontFamily = typeof updates.fontFamily === 'string' ? updates.fontFamily.replace(/[;{}]/g, '').trim() : '';
    }

    if (updates.codeFontFamily !== undefined) {
        sanitized.codeFontFamily = typeof updates.codeFontFamily === 'string' ? updates.codeFontFamily.replace(/[;{}]/g, '').trim() : '';
    }

    if (updates.wallpaperMode !== undefined) {
        if (['preset', 'image', 'video'].includes(updates.wallpaperMode)) sanitized.wallpaperMode = updates.wallpaperMode;
        else errors.push('Invalid wallpaper mode');
    }
    for (const [key, kind] of [['imageMedia', 'image'], ['videoMedia', 'video']]) {
        const value = updates[key];
        if (value === undefined) continue;
        if (typeof value === 'string' && (value === '' || (MEDIA_ID.test(value) && mediaType(value)?.startsWith(`${kind}/`)))) {
            sanitized[key] = value;
        } else errors.push(`Invalid ${kind} ID`);
    }
    for (const key of ['bootIntro', 'sketchReveal', 'taskVoiceEnabled']) {
        if (updates[key] === undefined) continue;
        if (typeof updates[key] === 'boolean') sanitized[key] = updates[key];
        else errors.push(`Invalid ${key}`);
    }
    if (updates.taskVoiceVolume !== undefined) {
        const value = updates.taskVoiceVolume;
        if (Number.isFinite(value) && value >= 0 && value <= 100) sanitized.taskVoiceVolume = Math.round(value);
        else errors.push('Task voice volume must be between 0 and 100');
    }
    if (updates.customGreetings !== undefined) {
        const lines = updates.customGreetings;
        if (!Array.isArray(lines) || lines.length > 12 || lines.some(line => typeof line !== 'string' || line.length > 120 || /[\x00-\x1f\x7f]/.test(line))) {
            errors.push('Use at most 12 single-line greetings, each up to 120 characters');
        } else sanitized.customGreetings = [...new Set(lines.map(line => line.trim()).filter(Boolean))];
    }

    return { sanitized, errors };
}

function listenWithFallback(server, preferredPort, host, maxAttempts = 20) {
    return new Promise((resolve, reject) => {
        let currentPort = preferredPort;
        let attempts = 0;

        function tryListen() {
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(currentPort, host);
        }

        function onError(err) {
            server.removeListener('listening', onListening);
            if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
                attempts++;
                currentPort++;
                tryListen();
            } else {
                reject(err);
            }
        }

        function onListening() {
            server.removeListener('error', onError);
            resolve(server.address().port);
        }

        tryListen();
    });
}

/**
 * Starts the Web Server.
 * @param {Object} options
 * @param {number} [options.port=47990] Preferred port
 * @param {string} [options.host='127.0.0.1'] Host
 * @param {string} options.rootDir Project root directory
 * @param {Object} options.cdp CDP Controller with getSessionCount, broadcastTheme, reinjectAll
 * @param {Function} [options.log=console.log] Log function
 * @returns {Promise<{ server: http.Server, port: number, close: Function }>}
 */
async function startWebServer(options = {}) {
    const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
    const preferredPort = options.port === 0 ? 0 : parseInt(options.port, 10) || 47990;
    const host = options.host || '127.0.0.1';
    const cdp = options.cdp || {
        getSessionCount: () => 0,
        broadcastTheme: async () => {},
        reinjectAll: async () => {}
    };
    const log = typeof options.log === 'function' ? options.log : console.log;

    const webDir = path.join(rootDir, 'web');
    const configFilePath = process.env.AGY_CONFIG_PATH || path.join(rootDir, 'theme_config.json');
    const themesFilePath = options.themesFilePath || resolveThemesFile(rootDir);
    const assetsDir = path.join(rootDir, 'themes', 'assets');
    const mediaDir = path.join(rootDir, 'themes', 'user_media');
    const mediaToken = randomUUID();
    const webportFile = path.join(rootDir, 'daemon.webport');
    const localAppData = process.platform === 'win32' && process.env.LOCALAPPDATA;
    const visionFile = options.visionConfigPath || path.join(
        localAppData || os.homedir(), localAppData ? 'AntigravityTheme' : '.antigravity-theme', 'vision.json'
    );
    const { AGY_VISION_URL, AGY_VISION_MODEL, AGY_VISION_API_KEY, AGY_IMAGE_MODEL, ...workerEnv } = process.env;
    let visionConfig = { url: '', model: '', imageModel: '', apiKey: '' };
    try {
        if (fs.existsSync(visionFile)) {
            visionConfig = validateVisionConfig(JSON.parse(fs.readFileSync(visionFile, 'utf8')));
        } else if (AGY_VISION_URL && AGY_VISION_MODEL) {
            visionConfig = validateVisionConfig({ url: AGY_VISION_URL, model: AGY_VISION_MODEL, apiKey: AGY_VISION_API_KEY, imageModel: AGY_IMAGE_MODEL });
        }
    } catch (_) {
        log('Invalid AI settings; reconfigure them in the Dashboard');
    }
    const pythonOptions = {
        cwd: rootDir, timeout: 45000, windowsHide: true,
        env: { ...workerEnv, PYTHONIOENCODING: 'utf-8' }
    };

    async function updatePresetCatalog(themeName, { artifacts = {}, preset, createOnly }) {
        const themesDir = path.dirname(themesFilePath);
        const readThemeSource = () => fs.existsSync(themesFilePath) ? fs.readFileSync(themesFilePath, 'utf8') : null;
        const original = readThemeSource();
        const presets = original === null ? {} : JSON.parse(original);
        if (!presets || typeof presets !== 'object' || Array.isArray(presets)) throw new Error('Invalid themes.json');
        const assertNotInUse = () => {
            const config = readConfig(configFilePath);
            if (config.themeName === themeName || config.bubbleName === themeName) {
                throw Object.assign(new Error('Switch to another preset before deleting this one'), { statusCode: 409 });
            }
        };
        if (preset) {
            if (createOnly && Object.hasOwn(presets, themeName)) {
                throw Object.assign(new Error('Theme name already exists'), { statusCode: 409 });
            }
        } else {
            if (!Object.hasOwn(presets, themeName)) {
                throw Object.assign(new Error('Theme preset does not exist'), { statusCode: 404 });
            }
            if (Object.keys(presets).length === 1) {
                throw Object.assign(new Error('At least one preset must remain'), { statusCode: 409 });
            }
            assertNotInUse();
            // ponytail: keep assets that may be shared; add reference-aware cleanup if disk usage warrants it.
            delete presets[themeName];
        }

        const id = randomUUID();
        const assetDir = path.join(themesDir, 'assets');
        const stagedThemes = path.join(themesDir, `.themes-${id}.json`);
        const dist = path.join(rootDir, 'dist');
        const stagedPayload = path.join(dist, `.payload-${id}.js`);
        const copied = [];
        let keepAsset = false;
        try {
            if (preset) await fs.promises.mkdir(assetDir, { recursive: true });
            for (const [field, source] of Object.entries(artifacts)) {
                const assetName = `theme_${id}_${field}.webp`;
                const asset = path.join(assetDir, assetName);
                await fs.promises.copyFile(source, asset, fs.constants.COPYFILE_EXCL);
                copied.push(asset);
                preset[field] = `assets/${assetName}`;
            }
            atomicWriteJsonSync(stagedThemes, preset ? { ...presets, [themeName]: preset } : presets);
            await execFileAsync(resolvePython(), [
                path.join(rootDir, 'scripts', 'build_payload.py'),
                '--themes', stagedThemes, '--engine', path.join(rootDir, 'engine', 'core.js'), '--out', stagedPayload
            ], pythonOptions);
            if (readThemeSource() !== original) {
                throw Object.assign(new Error('Themes changed while building; try again'), { statusCode: 409 });
            }
            if (!preset) assertNotInUse(); // The IDE can update the config while Python is building.
            fs.renameSync(stagedThemes, themesFilePath);
            keepAsset = true;
            try {
                fs.renameSync(stagedPayload, path.join(dist, 'theme_payload.js'));
            } catch (err) {
                if (original === null) fs.unlinkSync(themesFilePath);
                else {
                    fs.writeFileSync(stagedThemes, original, { flag: 'wx' });
                    fs.renameSync(stagedThemes, themesFilePath);
                }
                keepAsset = false;
                throw err;
            }
        } finally {
            const leftovers = [stagedThemes, stagedPayload];
            if (!keepAsset) leftovers.push(...copied);
            await Promise.all(leftovers.map(file => fs.promises.rm(file, { force: true }).catch(() => {})));
        }
    }

    const server = http.createServer(async (req, res) => {
        try {
            setCorsHeaders(res);
            const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
            const pathname = parsedUrl.pathname;

            // Handle OPTIONS preflight
            if (req.method === 'OPTIONS') {
                if (pathname.startsWith('/api/media') && isLoopback(parsedUrl.hostname)) {
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                    res.setHeader('Access-Control-Allow-Private-Network', 'true');
                }
                res.writeHead(204);
                return res.end();
            }

            if (pathname === '/api/media' || pathname.startsWith('/api/media/')) {
                const collection = pathname === '/api/media';
                const readFile = !collection && ['GET', 'HEAD'].includes(req.method);
                if (!isLoopback(parsedUrl.hostname) || !(req.headers.authorization === `Bearer ${mediaToken}` ||
                    (readFile && parsedUrl.searchParams.get('token') === mediaToken))) {
                    return sendError(res, 403, 'Open the media library in Custom Theme Studio');
                }
                if (collection && req.method === 'GET') {
                    const files = listMedia(mediaDir);
                    if (fs.lstatSync(path.join(assetsDir, SAMPLE_VOICE), { throwIfNoEntry: false })?.isFile()) {
                        files.push({ id: `assets/${SAMPLE_VOICE}`, name: 'Tawa (bundled sample)', kind: 'audio', bundled: true });
                    }
                    return sendJson(res, 200, { files });
                }
                if (collection && req.method === 'POST') {
                    const original = parsedUrl.searchParams.get('name') || '';
                    const ext = path.extname(original).toLowerCase();
                    const format = MEDIA_TYPES[ext];
                    if (!format || /[/\\:\x00-\x1f\x7f]/.test(original) || original.length > 255) {
                        return sendError(res, 415, 'Unsupported media file');
                    }
                    if (Number(req.headers['content-length']) > MAX_PAYLOAD_SIZE) {
                        return sendError(res, 413, 'Media file exceeds 25 MB');
                    }
                    const bytes = await readRequestBody(req);
                    if (bytes.length < 12 || !format[1](bytes)) return sendError(res, 415, 'File does not match its media format');
                    const kind = format[0].split('/')[0];
                    const hash = createHash('sha256').update(bytes).digest('hex');
                    const stem = original.slice(0, -ext.length).normalize('NFC').replace(/[^\p{L}\p{M}\p{N} ._()+-]/gu, '_').slice(0, 48).replace(/[\uD800-\uDFFF]/gu, '').trim() || 'Media';
                    const item = await serializeWrite(async () => {
                        const duplicate = listMedia(mediaDir).find(file => file.kind === kind && file.id.startsWith(`${hash}-`));
                        if (duplicate) return duplicate;
                        const name = stem + ext;
                        const id = `${hash}-${name}`;
                        await fs.promises.mkdir(mediaDir, { recursive: true });
                        const staging = path.join(mediaDir, `.${randomUUID()}`);
                        try {
                            await fs.promises.writeFile(staging, bytes, { flag: 'wx' });
                            await fs.promises.rename(staging, path.join(mediaDir, id));
                        } finally {
                            await fs.promises.rm(staging, { force: true });
                        }
                        return { id, name, kind };
                    });
                    return sendJson(res, 200, item);
                }
                const asset = pathname.startsWith('/api/media/assets/');
                let id;
                try { id = decodeURIComponent(pathname.slice(asset ? '/api/media/assets/'.length : '/api/media/'.length)); }
                catch (_) { return sendError(res, 400, 'Invalid media name'); }
                const type = mediaType(id);
                const bundledVideo = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9]+$/i.test(id) && type?.startsWith('video/');
                const bundledVoice = id === SAMPLE_VOICE || /^voice\/tawa_voice[1-4]\.mp3$/.test(id);
                if (readFile && asset && (bundledVideo || bundledVoice)) {
                    return await serveMedia(req, res, path.join(assetsDir, id), type);
                }
                if (!asset && MEDIA_ID.test(id) && type && hasMediaDirectory(mediaDir)) {
                    const file = path.join(mediaDir, id);
                    if (readFile) return await serveMedia(req, res, file, type);
                    if (req.method === 'DELETE') {
                        const next = await serializeWrite(() => {
                            if (!listMedia(mediaDir).some(item => item.id === id)) return null;
                            const config = readConfig(configFilePath);
                            const patch = {};
                            for (const key of ['imageMedia', 'videoMedia']) {
                                if (config[key] === id) patch[key] = '';
                            }
                            if (Object.keys(patch).length) atomicWriteJsonSync(configFilePath, { ...config, ...patch });
                            try { fs.unlinkSync(file); }
                            catch (err) {
                                if (Object.keys(patch).length) atomicWriteJsonSync(configFilePath, config);
                                throw err;
                            }
                            return patch;
                        });
                        if (!next) return sendError(res, 404, 'Media file not found');
                        if (Object.keys(next).length) await cdp.broadcastTheme(next).catch(err => log(`CDP broadcast warning: ${err.message}`));
                        return sendJson(res, 200, { success: true });
                    }
                }
                return sendError(res, 404, 'Media file not found');
            }

            // --- REST API ROUTES ---
            if (pathname.startsWith('/api/')) {
                if (pathname === '/api/vision/config') {
                    if (!isLocalDashboard(req, parsedUrl)) {
                        return sendError(res, 403, 'AI settings must come from the local Dashboard');
                    }
                    if (req.method === 'POST') {
                        const contentType = (req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
                        if (contentType !== 'application/json') {
                            return sendError(res, 415, 'Expected application/json');
                        }
                        let input, next;
                        try {
                            input = JSON.parse((await readRequestBody(req, 16 * 1024)).toString('utf8'));
                            next = validateVisionConfig(input);
                        } catch (err) {
                            return sendError(res, err.statusCode || 400, err instanceof SyntaxError ? 'Invalid JSON body' : err.message);
                        }
                        if (input.clearApiKey === true) next.apiKey = '';
                        else if (!next.apiKey && next.url === visionConfig.url) next.apiKey = visionConfig.apiKey;
                        try {
                            fs.mkdirSync(path.dirname(visionFile), { recursive: true, mode: 0o700 });
                            atomicWriteJsonSync(visionFile, next, 0o600);
                            visionConfig = next;
                        } catch (_) {
                            log('Failed to write AI settings to the user profile');
                            return sendError(res, 500, 'Could not save AI settings in the user profile');
                        }
                    } else if (req.method !== 'GET') {
                        return sendError(res, 405, 'Use GET or POST');
                    }
                    return sendJson(res, 200, {
                        success: true, url: visionConfig.url, model: visionConfig.model,
                        imageModel: visionConfig.imageModel, hasApiKey: Boolean(visionConfig.apiKey)
                    });
                }

                // 1. GET /api/config
                if (req.method === 'GET' && pathname === '/api/config') {
                    const cfg = readConfig(configFilePath);
                    return sendJson(res, 200, cfg);
                }

                // 2. POST /api/config
                if (req.method === 'POST' && pathname === '/api/config') {
                    let body;
                    try {
                        const raw = await readRequestBody(req);
                        body = JSON.parse(raw.toString('utf8'));
                    } catch (_) {
                        return sendError(res, 400, 'Invalid JSON body');
                    }

                    if (!body || typeof body !== 'object' || Array.isArray(body)) {
                        return sendError(res, 400, 'Request body must be a JSON object');
                    }
                    if (STUDIO_CONFIG_KEYS.some(key => Object.hasOwn(body, key)) && !isLocalDashboard(req, parsedUrl)) {
                        return sendError(res, 403, 'Studio settings must come from the local Dashboard');
                    }

                    let updated;
                    try {
                        updated = await serializeWrite(() => {
                            const presets = readPresets(themesFilePath);
                            const { sanitized, errors } = validateAndClampConfig(body, presets);
                            if (errors.length) throw Object.assign(new Error('Validation failed'), { statusCode: 400, details: errors });
                            const current = readConfig(configFilePath);
                            const merged = { ...current, ...sanitized };
                            atomicWriteJsonSync(configFilePath, merged);
                            return merged;
                        });
                    } catch (err) {
                        if (err.statusCode) return sendError(res, err.statusCode, err.message, err.details);
                        return sendError(res, 500, `Failed to save configuration: ${err.message}`);
                    }

                    try {
                        await cdp.broadcastTheme(updated);
                    } catch (err) {
                        log(`CDP broadcast warning: ${err.message}`);
                    }

                    return sendJson(res, 200, { success: true, config: updated });
                }

                // 3. Preset listing and posters
                if (pathname === '/api/presets/poster' && ['GET', 'HEAD'].includes(req.method)) {
                    if (!isLocalDashboard(req, parsedUrl)) return sendError(res, 403, 'Open the local Dashboard to preview presets');
                    const name = parsedUrl.searchParams.get('themeName');
                    const presets = readPresets(themesFilePath);
                    const wallpaper = name && Object.hasOwn(presets, name) ? presets[name]?.wallpaper : null;
                    const file = typeof wallpaper === 'string' && /^assets\/([^/\\:\x00-\x1f\x7f]+)$/.exec(wallpaper)?.[1];
                    const type = file ? mediaType(file) : undefined;
                    if (!type?.startsWith('image/')) return sendError(res, 404, 'No local poster for this preset');
                    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
                    return await serveMedia(req, res, path.join(assetsDir, file), type);
                }

                if (req.method === 'GET' && pathname === '/api/presets') {
                    const presets = readPresets(themesFilePath);
                    const cfg = readConfig(configFilePath);
                    return sendJson(res, 200, {
                        active: cfg.themeName || Object.keys(presets)[0] || '',
                        presets
                    });
                }

                if (req.method === 'DELETE' && pathname === '/api/presets') {
                    if (!isLocalDashboard(req, parsedUrl)) {
                        return sendError(res, 403, 'Preset deletion must come from the local Dashboard');
                    }
                    const themeName = parsedUrl.searchParams.get('themeName');
                    if (!themeName?.trim()) return sendError(res, 400, "Query parameter 'themeName' is required");

                    try {
                        await serializeWrite(() => updatePresetCatalog(themeName, {}));
                    } catch (err) {
                        if (err.statusCode) return sendError(res, err.statusCode, err.message);
                        log(`Preset deletion failed: ${err.message}`);
                        return sendError(res, 500, 'Failed to delete the preset; check daemon.log');
                    }
                    try {
                        await cdp.reinjectAll();
                    } catch (err) {
                        log(`CDP reinject warning: ${err.message}`);
                    }
                    return sendJson(res, 200, { success: true, themeName });
                }

                // 4. POST /api/presets/activate
                if (req.method === 'POST' && pathname === '/api/presets/activate') {
                    let body;
                    try {
                        const raw = await readRequestBody(req);
                        body = JSON.parse(raw.toString('utf8'));
                    } catch (_) {
                        return sendError(res, 400, 'Invalid JSON body');
                    }

                    const themeName = body ? body.themeName : null;
                    if (!themeName || typeof themeName !== 'string') {
                        return sendError(res, 400, "Field 'themeName' is required and must be a string");
                    }

                    let updated;
                    try {
                        updated = await serializeWrite(() => {
                            const presets = readPresets(themesFilePath);
                            if (!Object.hasOwn(presets, themeName)) {
                                throw Object.assign(new Error(`Theme preset '${themeName}' does not exist`), { statusCode: 404 });
                            }
                            const current = readConfig(configFilePath);
                            const next = {
                                ...current,
                                themeName,
                                bubbleName: themeName,
                                inputStyle: ALLOWED_INPUT_STYLES.has(presets[themeName]?.inputStyle) ? presets[themeName].inputStyle : current.inputStyle,
                                customWp: '', wallpaperMode: 'preset', wpEnabled: true
                            };
                            atomicWriteJsonSync(configFilePath, next);
                            return next;
                        });
                    } catch (err) {
                        if (err.statusCode) return sendError(res, err.statusCode, err.message);
                        return sendError(res, 500, `Failed to activate preset: ${err.message}`);
                    }

                    let appliedSessions = 0;
                    try {
                        appliedSessions = (await cdp.broadcastTheme(updated)) ?? 0;
                    } catch (err) {
                        log(`CDP broadcast warning: ${err.message}`);
                    }

                    return sendJson(res, 200, { success: true, themeName, config: updated, appliedSessions });
                }

                // 5. POST /api/themes/from-image
                if (req.method === 'POST' && pathname === '/api/themes/from-image') {
                    if (!isLocalDashboard(req, parsedUrl)) {
                        return sendError(res, 403, 'Image import must come from the local Dashboard');
                    }
                    let payload;
                    try {
                        payload = await extractImagePayload(req);
                    } catch (err) {
                        return sendError(res, err.statusCode || 400, err.message);
                    }

                    const themeName = typeof payload.themeName === 'string' ? payload.themeName.normalize('NFC').trim() : '';
                    if (!/^[\p{L}\p{M}\p{N} _().'+-]{1,64}$/u.test(themeName) || Object.hasOwn(Object.prototype, themeName)) {
                        return sendError(res, 400, "Use 1-64 letters, numbers, spaces or _().'+- for the theme name");
                    }
                    if (payload.ai && (!payload.preview || payload.design != null)) {
                        return sendError(res, 400, 'AI can only create a preview');
                    }
                    if (payload.ai && !visionConfig.url) {
                        return sendError(res, 503, 'Vision AI is not configured');
                    }
                    if (payload.rotation !== undefined && ![0, 90, 180, 270].includes(payload.rotation)) {
                        return sendError(res, 400, 'Rotation must be 0, 90, 180, or 270 degrees');
                    }
                    if (payload.aiAvatar && (!payload.ai || !payload.preview)) {
                        return sendError(res, 400, 'An image model can only create an avatar during AI preview');
                    }
                    if (payload.aiAvatar && !visionConfig.imageModel) {
                        return sendError(res, 503, 'Configure an image-to-image model to generate an avatar');
                    }
                    if (payload.createOnly && Object.hasOwn(readPresets(themesFilePath), themeName)) {
                        return sendError(res, 409, 'Theme name already exists');
                    }
                    const design = payload.design == null ? null : JSON.stringify(payload.design);
                    if (design && (typeof payload.design !== 'object' || Array.isArray(payload.design) || design.length > 2048)) {
                        return sendError(res, 400, 'Invalid design tokens');
                    }
                    let avatarBuffer;
                    if (payload.avatarData !== undefined) {
                        const match = !payload.ai && design && typeof payload.avatarData === 'string' &&
                            payload.avatarData.length <= 384 * 1024 && /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.avatarData);
                        if (!match || match[1].length % 4 !== 0) return sendError(res, 400, 'Invalid preview avatar');
                        avatarBuffer = Buffer.from(match[1], 'base64');
                    }

                    const ext = path.extname(payload.imageName).toLowerCase();
                    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
                    const safeExt = allowedExts.includes(ext) ? ext : '.png';
                    const workerOptions = payload.ai ? {
                        ...pythonOptions,
                        timeout: payload.aiAvatar ? 130000 : pythonOptions.timeout,
                        env: {
                            ...pythonOptions.env, AGY_VISION_URL: visionConfig.url,
                            AGY_VISION_MODEL: visionConfig.model, AGY_VISION_API_KEY: visionConfig.apiKey,
                            AGY_IMAGE_MODEL: visionConfig.imageModel
                        }
                    } : pythonOptions;

                    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-image-'));
                    const imageFile = path.join(workDir, `wallpaper${safeExt}`);
                    const artifacts = { wallpaper: path.join(workDir, 'landscape.webp'), agentAvatar: path.join(workDir, 'avatar.webp') };
                    try {
                        await fs.promises.writeFile(imageFile, payload.imageBuffer);
                        const args = [path.join(rootDir, 'theme_from_image.py'), imageFile, `--name=${themeName}`, '--preview', '--render-dir', workDir];
                        if (payload.isLight) args.push('--light');
                        if (payload.ai) args.push('--ai');
                        if (payload.aiAvatar) args.push('--ai-avatar');
                        if (design) args.push(`--design=${design}`);
                        if (payload.rotation !== undefined) args.push('--rotation', String(payload.rotation));
                        if (avatarBuffer) {
                            const inputAvatar = path.join(workDir, 'imported-avatar.webp');
                            await fs.promises.writeFile(inputAvatar, avatarBuffer);
                            args.push('--avatar-input', inputAvatar);
                        }
                        let result;
                        try {
                            const { stdout } = await execFileAsync(resolvePython(), args, workerOptions);
                            result = JSON.parse(stdout);
                        } catch (err) {
                            if (err.code === 1) return sendError(res, 422, 'Invalid image or design tokens');
                            if (payload.ai && (err.code === 2 || err.killed)) {
                                return sendError(res, 502, 'Vision AI failed; check the endpoint and model or use the local palette');
                            }
                            throw err;
                        }

                        // ponytail: reuse the upload and design tokens on save; add short-lived drafts only if uploads become costly.
                        if (payload.preview) {
                            const imageUrl = file => `data:image/webp;base64,${fs.readFileSync(file, 'base64')}`;
                            return sendJson(res, 200, {
                                success: true, themeName, ...result,
                                previewWallpaper: imageUrl(artifacts.wallpaper), previewAvatar: imageUrl(artifacts.agentAvatar)
                            });
                        }
                        const updatedConfig = await serializeWrite(async () => {
                            await updatePresetCatalog(themeName, { artifacts, preset: result.preset, createOnly: payload.createOnly });
                            if (payload.activate) {
                                const current = readConfig(configFilePath);
                                const next = {
                                    ...current,
                                    themeName,
                                    bubbleName: themeName,
                                    inputStyle: ALLOWED_INPUT_STYLES.has(result.preset.inputStyle) ? result.preset.inputStyle : current.inputStyle,
                                    wpEnabled: true,
                                    customWp: '', wallpaperMode: 'preset'
                                };
                                atomicWriteJsonSync(configFilePath, next);
                                return next;
                            }
                        });
                        if (updatedConfig) {
                            try {
                                await cdp.reinjectAll();
                                await cdp.broadcastTheme(updatedConfig);
                            } catch (_) {}
                        }

                        return sendJson(res, 200, {
                            success: true,
                            themeName,
                            preset: result.preset,
                            sessionsCount: cdp.getSessionCount()
                        });
                    } catch (err) {
                        if (err.statusCode) return sendError(res, err.statusCode, err.message);
                        log(`Theme generation failed: ${err.message}`);
                        return sendError(res, 500, `Failed to ${payload.preview ? 'preview' : 'save'} the image theme; check daemon.log`);
                    } finally {
                        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
                    }
                }

                // 6. GET /api/status
                if (req.method === 'GET' && pathname === '/api/status') {
                    return sendJson(res, 200, {
                        running: true,
                        pid: process.pid,
                        port: server.address() ? server.address().port : null,
                        sessionsCount: cdp.getSessionCount(),
                        appliedTheme: cdp.getAppliedTheme?.() || '',
                        imagePreview: true,
                        imageStudio: true,
                        visionAvailable: Boolean(visionConfig.url),
                        avatarAvailable: Boolean(visionConfig.imageModel),
                        version: '1.0.0'
                    });
                }

                // 7. POST /api/daemon/reload
                if (req.method === 'POST' && pathname === '/api/daemon/reload') {
                    try {
                        await cdp.reinjectAll();
                        return sendJson(res, 200, {
                            success: true,
                            message: 'Payload re-injected'
                        });
                    } catch (err) {
                        return sendError(res, 500, `Failed to reload payload: ${err.message}`);
                    }
                }

                // Unknown /api/* route
                return sendError(res, 404, 'API endpoint not found');
            }

            // --- STATIC DASHBOARD ASSETS SERVING ---
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('405 Method Not Allowed');
            }

            let relPath = pathname === '/' ? '/index.html' : pathname;
            try {
                relPath = decodeURIComponent(relPath);
            } catch (_) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('400 Bad Request');
            }

            // Path traversal protection
            const safeRelPath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
            const targetFilePath = path.resolve(webDir, '.' + safeRelPath);
            const relToWeb = path.relative(webDir, targetFilePath);

            if (relToWeb.startsWith('..') || path.isAbsolute(relToWeb)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('403 Forbidden');
            }

            fs.stat(targetFilePath, (err, stats) => {
                if (err || !stats.isFile()) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end('404 Not Found');
                }

                const ext = path.extname(targetFilePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': stats.size,
                    'Cache-Control': 'no-cache'
                });

                if (req.method === 'HEAD') {
                    return res.end();
                }

                const stream = fs.createReadStream(targetFilePath);
                stream.pipe(res);
                stream.on('error', () => {
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    }
                    res.end('500 Internal Server Error');
                });
            });
        } catch (err) {
            log(`Unhandled server error: ${err.stack || err.message}`);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        }
    });

    const boundPort = await listenWithFallback(server, preferredPort, host, 20);

    // Write daemon.webport
    try {
        fs.writeFileSync(webportFile, String(boundPort), 'utf8');
    } catch (err) {
        log(`Failed writing daemon.webport: ${err.message}`);
    }

    log(`Web server listening on http://${host}:${boundPort}`);

    const close = () => {
        return new Promise((resolve) => {
            try {
                if (fs.existsSync(webportFile)) {
                    fs.unlinkSync(webportFile);
                }
            } catch (_) {}
            server.close(() => resolve());
        });
    };

    return { server, port: boundPort, close, mediaAccess: { base: `http://${host}:${boundPort}/api/media`, token: mediaToken } };
}

function resolveThemesFile(rootDir) {
    const dir = path.join(rootDir, 'themes');
    const local = path.join(dir, 'themes.local.json');
    return fs.statSync(local, { throwIfNoEntry: false })?.isFile() ? local : path.join(dir, 'themes.json');
}

module.exports = {
    resolveThemesFile,
    startWebServer,
    readConfig,
    readPresets,
    validateAndClampConfig,
    atomicWriteJsonSync,
    DEFAULT_CONFIG,
    ALLOWED_INPUT_STYLES
};
