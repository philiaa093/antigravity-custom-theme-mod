'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(probe, label, timeout = 9000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await probe().catch(() => null);
        if (result) return result;
        await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
}

async function createCdp({ emptyFirst = false, evaluationDelay = 0, listDelay = 0 } = {}) {
    const state = { requests: 0, evaluations: [], active: 0, maxActive: 0 };
    const sockets = new Set();
    const server = http.createServer((req, res) => {
        state.requests++;
        const reply = () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([{ id: 'reused-target', type: 'page', url: 'https://127.0.0.1:61000/',
                webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/reused-target` }]));
        };
        if (state.requests === 1 && listDelay) setTimeout(reply, listDelay);
        else reply();
    });
    server.on('upgrade', (req, socket) => {
        const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        let buffered = Buffer.alloc(0);
        const respond = message => {
            if (socket.destroyed) return;
            const body = Buffer.from(JSON.stringify(message));
            assert.ok(body.length < 126, 'Fixture response must fit one small WebSocket frame');
            socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
        };
        socket.on('data', async chunk => {
            buffered = Buffer.concat([buffered, chunk]);
            while (buffered.length >= 2) {
                const opcode = buffered[0] & 15;
                const masked = Boolean(buffered[1] & 128);
                let size = buffered[1] & 127;
                let offset = 2;
                if (size === 126) {
                    if (buffered.length < 4) return;
                    size = buffered.readUInt16BE(2); offset = 4;
                } else if (size === 127) {
                    if (buffered.length < 10) return;
                    size = Number(buffered.readBigUInt64BE(2)); offset = 10;
                }
                if (buffered.length < offset + (masked ? 4 : 0) + size) return;
                const mask = masked ? buffered.subarray(offset, offset + 4) : null;
                offset += masked ? 4 : 0;
                const body = Buffer.from(buffered.subarray(offset, offset + size));
                buffered = buffered.subarray(offset + size);
                if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
                if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
                if (opcode !== 1) continue;
                const request = JSON.parse(body.toString());
                if (request.method !== 'Runtime.evaluate') { respond({ id: request.id, result: {} }); continue; }
                state.evaluations.push(request.params.expression);
                const first = state.evaluations.length === 1;
                state.active++;
                state.maxActive = Math.max(state.maxActive, state.active);
                void delay(first ? evaluationDelay : 0).then(() => {
                    state.active--;
                    respond({ id: request.id, result: { result: { type: 'string', value: first && emptyFirst ? '' : 'Saved preset' } } });
                });
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { port: server.address().port, state, async close() {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    } };
}

async function startFixture(t, preparePort = () => {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reconnect-'));
    const portFile = path.join(root, 'DevToolsActivePort');
    for (const dir of ['daemon', 'scripts', 'themes', 'dist', 'engine']) fs.mkdirSync(path.join(root, dir));
    for (const file of ['daemon/theme_daemon.js', 'daemon/web_server.js', 'scripts/build_payload.py']) {
        fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
    }
    fs.writeFileSync(path.join(root, 'engine/core.js'), 'const THEMES = /*__THEMES_PLACEHOLDER__*/{};');
    fs.writeFileSync(path.join(root, 'themes/themes.json'), '{"Saved preset":{}}');
    fs.writeFileSync(path.join(root, 'theme_config.json'), '{"themeName":"Saved preset","bubbleName":"Saved preset"}');
    fs.writeFileSync(path.join(root, 'dist/theme_payload.js'), '// CDP transport fixture; renderer behavior is covered separately.');
    preparePort(portFile);
    const daemon = spawn(process.execPath, [path.join(root, 'daemon/theme_daemon.js')], {
        cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, AGY_PORT_FILE: portFile,
            AGY_CONFIG_PATH: path.join(root, 'theme_config.json') }
    });
    const ended = new Promise(resolve => daemon.once('exit', resolve));
    t.after(async () => {
        if (daemon.exitCode === null) daemon.kill();
        await ended;
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    const status = async () => {
        if (daemon.exitCode !== null) throw new Error('Daemon exited');
        const port = fs.readFileSync(path.join(root, 'daemon.webport'), 'utf8').trim();
        return (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    };
    await waitFor(status, 'daemon startup');
    return { root, portFile, daemon, status };
}

test('daemon retries an early empty DOM without overlapping injections and reconnects after update', async t => {
    const first = await createCdp({ emptyFirst: true, evaluationDelay: 2300 });
    const second = await createCdp();
    t.after(async () => { await first.close(); await second.close(); });
    const app = await startFixture(t, file => fs.writeFileSync(file, `${first.port}\n/devtools/browser/first\n`));
    await waitFor(async () => {
        const status = await app.status();
        return status.sessionsCount === 1 && status.appliedTheme === 'Saved preset';
    }, 'theme applied after initial empty DOM');
    assert.ok(first.state.evaluations.length >= 2);
    assert.equal(first.state.maxActive, 1, 'Slow injection must be coalesced');
    assert.match(first.state.evaluations.at(-1), /"themeName":"Saved preset"/);
    fs.writeFileSync(app.portFile, `${second.port}\n/devtools/browser/after-update\n`);
    await waitFor(async () => {
        const status = await app.status();
        return second.state.evaluations.length > 0 && status.sessionsCount === 1 && status.appliedTheme === 'Saved preset';
    }, 'saved theme applied after port rotation with a reused target ID');
    assert.match(second.state.evaluations[0], /"bubbleName":"Saved preset"/);
    assert.equal(fs.readFileSync(path.join(app.root, 'theme_config.json'), 'utf8'), '{"themeName":"Saved preset","bubbleName":"Saved preset"}');
});

test('daemon stays responsive for missing, malformed, and unreadable debug port files', async t => {
    const cdp = await createCdp();
    t.after(() => cdp.close());
    const app = await startFixture(t);
    assert.equal((await app.status()).sessionsCount, 0);
    fs.writeFileSync(app.portFile, `${cdp.port}garbage\n`);
    await delay(1900);
    assert.equal(cdp.state.requests, 0, 'A numeric prefix is not a valid port');
    fs.unlinkSync(app.portFile);
    fs.mkdirSync(app.portFile);
    await delay(1900);
    assert.equal((await app.status()).running, true, 'A temporarily unreadable port file must not crash the daemon');
    fs.rmdirSync(app.portFile);
    fs.writeFileSync(app.portFile, '65536\n');
    await delay(1700);
    assert.equal((await app.status()).sessionsCount, 0);
    fs.writeFileSync(app.portFile, `${cdp.port}\n`);
    await waitFor(async () => (await app.status()).sessionsCount === 1, 'valid debug file after transient failure');
    fs.unlinkSync(app.portFile);
    await waitFor(async () => (await app.status()).sessionsCount === 0, 'missing restart port clears stale applied sessions');
});

test('daemon discards a delayed target list after disconnection before reusing a target ID', async t => {
    const old = await createCdp({ listDelay: 1800 });
    const next = await createCdp();
    t.after(async () => { await old.close(); await next.close(); });
    const app = await startFixture(t, file => fs.writeFileSync(file, `${old.port}\n/old-instance\n`));
    await waitFor(async () => old.state.requests > 0, 'old target-list request started');
    fs.unlinkSync(app.portFile);
    await delay(2400);
    assert.equal(old.state.evaluations.length, 0, 'A delayed obsolete target list must not create a session');
    assert.equal((await app.status()).sessionsCount, 0, 'A disconnected renderer must not be reported as applied');
    fs.writeFileSync(app.portFile, `${next.port}\n/new-instance\n`);
    await waitFor(async () => next.state.evaluations.length > 0 && (await app.status()).sessionsCount === 1,
        'new instance receives its saved theme');
});

test('daemon keeps one injection while an evaluation exceeds the CDP timeout', async t => {
    const cdp = await createCdp({ evaluationDelay: 10000 });
    t.after(() => cdp.close());
    const app = await startFixture(t, file => fs.writeFileSync(file, `${cdp.port}\n`));
    await waitFor(async () => cdp.state.evaluations.length > 0 && cdp.state.active === 0 &&
        (await app.status()).appliedTheme === 'Saved preset', 'slow evaluation finishes', 14000);
    assert.equal(cdp.state.maxActive, 1, 'A local timeout does not cancel the remote evaluation');
    assert.equal(cdp.state.evaluations.length, 1, 'The late result must confirm the original injection');
});

test('daemon applies a rebuilt payload after the current injection finishes', async t => {
    const cdp = await createCdp({ evaluationDelay: 4000 });
    t.after(() => cdp.close());
    const app = await startFixture(t, file => fs.writeFileSync(file, `${cdp.port}\n`));
    await waitFor(async () => cdp.state.evaluations.length === 1, 'first injection started');
    fs.writeFileSync(path.join(app.root, 'dist/theme_payload.js'), '// rebuilt-payload-during-injection');
    await delay(6500);
    assert.ok(cdp.state.evaluations.some(source => source.includes('rebuilt-payload-during-injection')),
        'A rebuild during injection must be applied after the previous payload');
    assert.equal(cdp.state.maxActive, 1);
    assert.equal((await app.status()).appliedTheme, 'Saved preset');
});
