'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startWebServer } = require('../daemon/web_server');

async function checkStudioMedia() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-media-check-'));
    const config = path.join(root, 'config.json');
    process.env.AGY_CONFIG_PATH = config;
    const broadcasts = [];
    let confirmed = 0;
    let app;
    try {
        const assets = path.join(root, 'themes', 'assets');
        const shipped = path.join(__dirname, '..', 'themes', 'assets');
        const sampleId = 'assets/voice/1795011944060_Tawa_voice_task_1.mp3';
        fs.mkdirSync(path.join(assets, 'voice'), { recursive: true });
        fs.writeFileSync(path.join(root, 'themes', 'themes.json'), JSON.stringify({
            'Furina Live': { wallpaper: 'assets/furina-poster.webp' },
            'Midnight Obsidian': { wallpaper: '' },
            'Invalid poster': { wallpaper: 'assets/voice/tawa_voice1.mp3' }
        }));
        const video = fs.readFileSync(path.join(shipped, 'furina-bg.mp4'));
        const image = fs.readFileSync(path.join(shipped, 'furina-poster.webp'));
        fs.writeFileSync(path.join(assets, 'furina-bg.mp4'), video);
        fs.writeFileSync(path.join(assets, 'furina-poster.webp'), image);
        fs.copyFileSync(path.join(shipped, 'voice', 'tawa_voice1.mp3'), path.join(assets, 'voice', 'tawa_voice1.mp3'));
        fs.copyFileSync(path.join(shipped, sampleId.slice(7)), path.join(assets, sampleId.slice(7)));
        app = await startWebServer({ rootDir: root, port: 0, visionConfigPath: path.join(root, 'vision.json'), log() {}, cdp: {
            async broadcastTheme(patch) { broadcasts.push(patch); return confirmed; }
        } });
        const { base, token } = app.mediaAccess;
        const headers = { Authorization: `Bearer ${token}` };
        const api = new URL(base).origin + '/api';
        const upload = (name, body) => fetch(`${base}?name=${encodeURIComponent(name)}`, { method: 'POST', headers, body });
        const list = async () => (await (await fetch(base, { headers })).json()).files;
        const update = (patch, origin = new URL(base).origin) => fetch(`${api}/config`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(patch) });

        assert.equal((await fetch(base)).status, 403);
        assert.equal((await fetch(`${base}/assets/furina-bg.mp4`)).status, 403);
        assert.equal((await upload('../invalid.mp4', video)).status, 415);
        assert.equal((await upload('invalid.mp4', Buffer.alloc(16))).status, 415);
        assert.equal((await upload('invalid.svg', Buffer.from('<svg/>'))).status, 415);
        const [sample] = await list();
        assert.equal(sample.id, sampleId);
        assert.equal(sample.bundled, true);
        for (const name of ['voice/tawa_voice1.mp3', sampleId.slice(7)]) {
            const audioUrl = `${base}/assets/${encodeURIComponent(name)}`;
            assert.equal((await fetch(audioUrl, { method: 'HEAD' })).status, 403);
            const audio = await fetch(`${audioUrl}?token=${token}`, { method: 'HEAD' });
            assert.equal(audio.status, 200);
            assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg');
            assert.equal((await fetch(audioUrl, { method: 'DELETE', headers })).status, 404);
        }

        const posterUrl = name => `${api}/presets/poster?${new URLSearchParams({ themeName: name })}`;
        const cover = await fetch(posterUrl('Furina Live'));
        assert.equal(cover.status, 200);
        assert.equal(cover.headers.get('Content-Type'), 'image/webp');
        assert.equal(cover.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
        assert.deepEqual(Buffer.from(await cover.arrayBuffer()), image);
        assert.equal((await fetch(posterUrl('Furina Live'), { headers: { Origin: 'https://other.invalid' } })).status, 403);
        assert.equal((await fetch(posterUrl('Midnight Obsidian'))).status, 404);
        assert.equal((await fetch(posterUrl('Invalid poster'))).status, 404);

        const activate = async () => (await fetch(`${api}/presets/activate`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ themeName: 'Furina Live' }) })).json();
        assert.equal((await activate()).appliedSessions, 0);
        confirmed = 1;
        assert.equal((await activate()).appliedSessions, 1);

        const response = await upload('C\u1ea3nh tuy\u1ebft.mp4', video);
        assert.equal(response.status, 200);
        const item = await response.json();
        assert.equal(item.name, 'C\u1ea3nh tuy\u1ebft.mp4');
        assert.equal(item.kind, 'video');
        assert.deepEqual(await (await upload('Duplicate.m4v', video)).json(), item);
        const poster = await (await upload('Poster.webp', image)).json();
        const voice = Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex');
        assert.equal((await (await upload('Tone.wav', voice)).json()).kind, 'audio');
        assert.deepEqual(new Set((await list()).map(file => file.kind)), new Set(['image', 'video', 'audio']));

        const file = `${base}/${encodeURIComponent(item.id)}`;
        const asset = `${base}/assets/furina-bg.mp4?token=${token}`;
        const url = `${file}?token=${token}`;
        for (const target of [url, asset]) {
            const range = await fetch(target, { headers: { Range: 'bytes=4-7' } });
            assert.equal(range.status, 206);
            assert.equal(range.headers.get('Content-Range'), `bytes 4-7/${video.length}`);
            assert.equal(await range.text(), 'ftyp');
            assert.equal((await fetch(target, { headers: { Range: 'bytes=-0' } })).status, 416);
            const tail = await fetch(target, { headers: { Range: 'bytes=-9' } });
            assert.deepEqual(Buffer.from(await tail.arrayBuffer()), video.subarray(-9));
            const head = await fetch(target, { method: 'HEAD' });
            assert.equal(Number(head.headers.get('Content-Length')), video.length);
            assert.equal(head.headers.get('X-Content-Type-Options'), 'nosniff');
        }
        assert.equal((await fetch(url, { method: 'DELETE' })).status, 403);

        assert.equal((await update({ videoMedia: poster.id })).status, 400);
        assert.equal((await update({ wallpaperMode: 'video' }, 'https://other.invalid')).status, 403);
        assert.equal((await update({ taskVoiceVolume: 120 })).status, 400);
        assert.equal((await update({ wallpaperMode: 'video', videoMedia: item.id, imageMedia: poster.id,
            customGreetings: ['Hi!', 'Hi!'], bootIntro: true, sketchReveal: true, taskVoiceEnabled: true, taskVoiceVolume: 20 })).status, 200);
        assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')).customGreetings, ['Hi!']);

        assert.equal((await fetch(file, { method: 'DELETE', headers })).status, 200);
        assert.equal((await fetch(url)).status, 404);
        assert.equal(fs.existsSync(path.join(root, 'themes', 'user_media', item.id)), false);
        const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
        assert.equal(saved.videoMedia, '');
        assert.equal(saved.imageMedia, poster.id);
        assert.deepEqual(broadcasts.at(-1), { videoMedia: '' });
        console.log('Studio media check passed: posters, bundled voices, authorization, upload, deduplication, seeking, settings, and deletion.');
    } finally {
        if (app) await app.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function checkDaemonStartup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-daemon-check-'));
    const pidFile = path.join(root, 'daemon.pid');
    const portFile = path.join(root, 'daemon.webport');
    let daemon, ended;
    try {
        for (const dir of ['daemon', 'scripts', 'themes', 'dist', 'engine']) fs.mkdirSync(path.join(root, dir));
        for (const file of ['daemon/theme_daemon.js', 'daemon/web_server.js', 'scripts/build_payload.py']) {
            fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
        }
        const artifact = path.join(root, 'dist', 'theme_payload.js');
        fs.writeFileSync(artifact, '// stale');
        fs.utimesSync(artifact, 1, 1);
        fs.writeFileSync(path.join(root, 'engine', 'core.js'), 'const THEMES = /*__THEMES_PLACEHOLDER__*/{};');
        fs.writeFileSync(path.join(root, 'themes', 'themes.json'), '{"Shared preset":{}}');
        fs.writeFileSync(path.join(root, 'themes', 'themes.local.json'), '{"Fresh preset":{}}');
        const args = [path.join(root, 'daemon', 'theme_daemon.js')];
        const options = { cwd: root, windowsHide: true, env: { ...process.env,
            AGY_PORT_FILE: path.join(root, 'no-cdp'), AGY_CONFIG_PATH: path.join(root, 'config.json') } };
        daemon = spawn(process.execPath, args, { ...options, stdio: 'ignore' });
        ended = new Promise(resolve => daemon.once('exit', resolve));
        for (let i = 0; i < 160 && !fs.existsSync(portFile) && daemon.exitCode === null; i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(fs.existsSync(portFile), fs.existsSync(path.join(root, 'daemon.log')) ? fs.readFileSync(path.join(root, 'daemon.log'), 'utf8') : 'Daemon did not start');
        const port = Number(fs.readFileSync(portFile, 'utf8'));
        assert.match(fs.readFileSync(artifact, 'utf8'), /Fresh preset/);
        const presets = await (await fetch(`http://127.0.0.1:${port}/api/presets`)).json();
        assert.deepEqual(Object.keys(presets.presets), ['Fresh preset']);
        if (process.platform === 'win32') fs.unlinkSync(pidFile); // A stale tray must not bypass the workspace lock.
        execFileSync(process.execPath, args, { ...options, timeout: 5000 });
        const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
        assert.equal(status.pid, daemon.pid);
        assert.equal(Number(fs.readFileSync(portFile, 'utf8')), port);
        console.log('Daemon startup check passed: stale payload rebuilt and duplicate launch refused.');
    } finally {
        if (daemon) { daemon.kill(); await ended; }
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
}

checkStudioMedia().then(checkDaemonStartup).catch(err => { console.error(err); process.exitCode = 1; });
