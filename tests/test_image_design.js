'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startWebServer } = require('../daemon/web_server');

async function checkImageDesign() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-design-check-'));
    const engine = path.join(root, 'engine', 'core.js');
    const themes = path.join(root, 'themes', 'themes.json');
    const config = path.join(root, 'theme_config.json');
    const visionConfigPath = path.join(root, 'profile', 'vision.json');
    const assets = path.join(root, 'themes', 'assets');
    const payload = path.join(root, 'dist', 'theme_payload.js');
    const initialThemes = '{ "Existing": {} }\n';
    const initialConfig = '{ "themeName": "Existing" }\n';
    const tokens = {
        primary: '#ffffff', secondary: '#e7a15a', surface: '#7b3864', subject: [55, 39], rotation: 0,
        bubbleTint: '#1da88e', composerTint: '#d57530',
        bubble: 'ribbon', composer: 'glass', ornament: 'petal', concept: 'Plum glass with peach light'
    };
    const calls = [];
    let invalidResponse = false;
    let invalidAvatar = false;
    let generatedAvatar;
    const model = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
        if (req.url === '/v1/images/generations') {
            const output = invalidAvatar ? { url: 'https://invalid.example/avatar.png' } : { b64_json: generatedAvatar };
            res.end(JSON.stringify({ data: [output] }));
            return;
        }
        const content = JSON.stringify(invalidResponse ? { ...tokens, composerTint: 'url(https://invalid.example)' } : tokens);
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    let app;
    try {
        for (const name of ['engine', 'scripts', 'themes']) fs.mkdirSync(path.join(root, name));
        fs.writeFileSync(engine, 'const THEMES = /*__THEMES_PLACEHOLDER__*/{};\n');
        fs.writeFileSync(themes, initialThemes);
        fs.writeFileSync(config, initialConfig);
        for (const file of ['theme_from_image.py', 'scripts/build_payload.py']) {
            fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
        }
        const python = process.env.PYTHON_PATH || process.env.PYTHON || process.env.PYTHON_CMD || 'python';
        const [imageBase64, square] = execFileSync(python, ['-c', [
            'import base64, io', 'from PIL import Image, ImageDraw, PngImagePlugin', 'buf = io.BytesIO()',
            'meta = PngImagePlugin.PngInfo()', 'meta.add_text("private", "fixture metadata must stay local")',
            'portrait = Image.new("RGB", (480, 840), "#995d86")',
            'ImageDraw.Draw(portrait).rectangle((243, 310, 285, 348), fill="#20bdca")',
            'portrait.save(buf, format="PNG", pnginfo=meta)',
            'print(base64.b64encode(buf.getvalue()).decode("ascii"))',
            'buf = io.BytesIO()', 'Image.new("RGB", (400, 400), "#605ca8").save(buf, format="PNG")',
            'print(base64.b64encode(buf.getvalue()).decode("ascii"))',
        ].join('\n')], { encoding: 'utf8' }).trim().split(/\r?\n/);
        generatedAvatar = square;

        await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
        process.env.AGY_CONFIG_PATH = config;
        for (const key of ['AGY_VISION_URL', 'AGY_VISION_MODEL', 'AGY_VISION_API_KEY', 'AGY_IMAGE_MODEL']) delete process.env[key];
        const options = { rootDir: root, visionConfigPath, port: 49120, log: () => {} };
        app = await startWebServer(options);
        let base = `http://127.0.0.1:${app.port}`;
        const post = async (data, origin = base, endpoint = '/api/themes/from-image') => {
            const res = await fetch(`${base}${endpoint}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(data)
            });
            return [res.status, await res.json()];
        };
        const configure = (data, origin) => post(data, origin, '/api/vision/config');
        const readVisionConfig = async () => (await fetch(`${base}/api/vision/config`)).json();
        const status = await (await fetch(`${base}/api/status`)).json();
        assert.equal(status.imagePreview, true);
        assert.equal(status.imageStudio, true);
        assert.equal(status.visionAvailable, false);
        const request = { themeName: 'Pha l\u00ea H\u1ed3ng', imageName: 'test.png', imageBase64, isLight: true, createOnly: true };
        const vision = { url: `http://127.0.0.1:${model.address().port}/v1/chat/completions`, model: 'fixture-vision', imageModel: 'fixture-image' };
        assert.equal((await configure({ ...vision, apiKey: 'fixture-key' }, 'https://other.invalid'))[0], 403);
        assert.equal((await configure({ ...vision, url: 'http://provider.invalid/v1/chat/completions' }))[0], 400);
        assert.equal((await post({ ...request, preview: true, ai: true }))[0], 503);
        assert.equal(fs.existsSync(visionConfigPath), false);

        const publicVision = { success: true, ...vision, hasApiKey: true };
        assert.deepEqual(await configure({ ...vision, apiKey: 'fixture-key' }), [200, publicVision]);
        assert.deepEqual(await configure(vision), [200, publicVision]);
        assert.deepEqual(await readVisionConfig(), publicVision);
        assert.equal((await (await fetch(`${base}/api/status`)).json()).visionAvailable, true);
        assert.equal((await (await fetch(`${base}/api/status`)).json()).avatarAvailable, true);

        assert.equal((await post({ ...request, preview: true, ai: true }, 'https://other.invalid'))[0], 403);
        assert.equal((await post({ ...request, preview: true }))[0], 200);
        assert.equal(calls.length, 0);

        const [previewStatus, preview] = await post({ ...request, preview: true, ai: true, aiAvatar: true, activate: true });
        assert.equal(previewStatus, 200, JSON.stringify(preview));
        assert.equal(preview.preset.bgPosition, 'center center');
        assert.equal(preview.preset.concept, tokens.concept);
        assert.equal(preview.preset.inputStyle, 'glass');
        assert.equal(preview.preset.bubbleStyle, 'ribbon');
        assert.equal(preview.preset.bubbleRadius, 12);
        assert.equal(preview.preset.inputRadius, 20);
        assert.notEqual(preview.preset.frameBg, preview.preset.inputFrameBg);
        assert.match(preview.preset.inputShellBg, /^#[0-9a-f]{8}$/);
        assert.match(preview.preset.cornerSvg, /^data:image\/svg\+xml,/);
        assert.notEqual(preview.preset.primary, tokens.primary, 'white must be darkened for light glass');
        assert.equal(preview.preset.wallpaper, '');
        assert.deepEqual(preview.design, tokens);
        assert.deepEqual(preview.studio, { rotation: 0, framing: 'portrait', avatarSource: 'model' });
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, '/v1/chat/completions');
        assert.equal(calls[0].auth, 'Bearer fixture-key');
        assert.equal(calls[0].body.model, 'fixture-vision');
        const jpeg = calls[0].body.messages[0].content[1].image_url.url;
        assert.match(jpeg, /^data:image\/jpeg;base64,/);
        assert.ok(!Buffer.from(jpeg.split(',')[1], 'base64').includes('fixture metadata must stay local'));
        assert.equal(calls[1].url, '/v1/images/generations');
        assert.equal(calls[1].body.model, 'fixture-image');
        assert.match(calls[1].body.image, /^data:image\/jpeg;base64,/);
        const [dimensions, r, g, b] = execFileSync(python, ['-c', [
            'import base64, io, sys', 'from PIL import Image',
            'im = Image.open(io.BytesIO(base64.b64decode(sys.stdin.read())))',
            'print(str(im.width) + "x" + str(im.height), *im.getpixel((1044, 324)))',
        ].join('\n')], { input: preview.previewWallpaper.split(',')[1], encoding: 'utf8' }).trim().split(' ');
        assert.equal(dimensions, '1440x810');
        assert.ok(+g > +r + 65 && +b > +r + 65, 'subject marker must be retained in the sharp art area');
        assert.equal(fs.readFileSync(themes, 'utf8'), initialThemes);
        assert.equal(fs.readFileSync(config, 'utf8'), initialConfig);
        assert.equal(fs.existsSync(assets), false);
        assert.equal(fs.existsSync(payload), false);

        const drafted = { ...request, design: preview.design, rotation: 90, avatarData: preview.previewAvatar };
        const [reframeStatus, reframed] = await post({ ...drafted, preview: true });
        assert.equal(reframeStatus, 200);
        assert.deepEqual(reframed.studio, { rotation: 90, framing: 'landscape', avatarSource: 'model' });
        assert.notEqual(reframed.previewWallpaper, preview.previewWallpaper);
        assert.equal(reframed.previewAvatar, preview.previewAvatar);
        assert.equal(calls.length, 2, 'manual rotation must not call either model');

        const [variantStatus, variant] = await post({ ...request, preview: true, design: {
            ...tokens, composerTint: '#211ed0', composer: 'minimal'
        } });
        assert.equal(variantStatus, 200);
        assert.equal(variant.preset.bg, preview.preset.bg, 'composer changes must not change the bubble');
        assert.equal(variant.preset.frameBg, preview.preset.frameBg);
        assert.notEqual(variant.preset.inputShellBg, preview.preset.inputShellBg);
        assert.notEqual(variant.preset.inputFrameBg, preview.preset.inputFrameBg);
        assert.equal(variant.preset.inputRadius, 9);

        const [saveStatus, saved] = await post({ ...drafted, activate: true });
        assert.equal(saveStatus, 200, JSON.stringify(saved));
        assert.equal(calls.length, 2, 'saving must not call either model again');
        assert.equal(saved.sessionsCount, 0);
        const { agentAvatar, ...savedPreset } = saved.preset;
        assert.deepEqual({ ...savedPreset, wallpaper: '' }, preview.preset);
        assert.equal(fs.readFileSync(path.join(root, 'themes', saved.preset.wallpaper), 'base64'), reframed.previewWallpaper.split(',')[1]);
        assert.equal(fs.readFileSync(path.join(root, 'themes', agentAvatar), 'base64'), reframed.previewAvatar.split(',')[1]);
        assert.ok(fs.readFileSync(payload, 'utf8').includes('"agentAvatar": "data:image/webp;base64,'));
        const active = JSON.parse(fs.readFileSync(config, 'utf8'));
        assert.equal(active.themeName, request.themeName);
        assert.equal(active.bubbleName, request.themeName);
        assert.equal(active.inputStyle, 'glass');
        assert.equal((await post({ themeName: 'Existing' }, base, '/api/presets/activate'))[0], 200);
        assert.equal((await post({ inputStyle: 'double_gold' }, base, '/api/config'))[0], 200);
        const [activateStatus, activation] = await post({ themeName: request.themeName }, base, '/api/presets/activate');
        assert.equal(activateStatus, 200);
        assert.equal(activation.config.inputStyle, preview.preset.inputStyle);
        assert.equal((await post({ ...request, preview: true, ai: true }))[0], 409);
        assert.equal(calls.length, 2, 'duplicate names must not trigger a model call');

        invalidAvatar = true;
        const [fallbackStatus, fallback] = await post({ ...request, themeName: 'Avatar fallback', preview: true, ai: true, aiAvatar: true });
        assert.equal(fallbackStatus, 200);
        assert.equal(fallback.studio.avatarSource, 'crop');
        assert.equal(fallback.studio.avatarFailed, true);

        invalidResponse = true;
        assert.equal((await post({ ...request, themeName: 'Invalid tokens', preview: true, ai: true }))[0], 502);
        const savedThemes = fs.readFileSync(themes, 'utf8');
        fs.writeFileSync(engine, 'invalid build fixture');
        assert.equal((await post({ ...request, themeName: 'Build failure', activate: true }))[0], 500);
        assert.equal(fs.readFileSync(themes, 'utf8'), savedThemes);
        assert.equal(fs.readdirSync(assets).length, 2);
        assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).themeName, request.themeName);

        const removePreset = (themeName, origin = base) => fetch(
            `${base}/api/presets?${new URLSearchParams({ themeName })}`, { method: 'DELETE', headers: { Origin: origin } }
        );
        assert.equal((await removePreset('')).status, 400);
        assert.equal((await removePreset(request.themeName, 'https://other.invalid')).status, 403);
        assert.equal((await removePreset(request.themeName)).status, 409);
        assert.equal((await post({ themeName: 'Existing' }, base, '/api/config'))[0], 200);
        assert.equal((await removePreset(request.themeName)).status, 409, 'the bubble preset is in use');
        assert.equal((await post({ themeName: 'Existing' }, base, '/api/presets/activate'))[0], 200);
        const savedPayload = fs.readFileSync(payload, 'utf8');
        assert.equal((await removePreset(request.themeName)).status, 500, 'a failed build must not delete a preset');
        assert.equal(fs.readFileSync(themes, 'utf8'), savedThemes);
        assert.equal(fs.readFileSync(payload, 'utf8'), savedPayload);

        fs.writeFileSync(engine, 'const THEMES = /*__THEMES_PLACEHOLDER__*/{};\n');
        assert.equal((await removePreset(request.themeName)).status, 200);
        const remaining = await (await fetch(`${base}/api/presets`)).json();
        assert.deepEqual(remaining, { active: 'Existing', presets: { Existing: {} } });
        assert.deepEqual(JSON.parse(fs.readFileSync(themes, 'utf8')), remaining.presets);
        assert.ok(!fs.readFileSync(payload, 'utf8').includes(request.themeName));
        assert.equal(fs.readdirSync(assets).length, 2, 'deletion preserves assets');
        assert.equal((await removePreset(request.themeName)).status, 404);
        const lastPreset = await removePreset('Existing');
        assert.equal(lastPreset.status, 409);
        assert.match((await lastPreset.json()).error, /at least one preset/i);

        const restartPort = app.port + 100;
        await app.close();
        app = await startWebServer({ ...options, port: restartPort });
        base = `http://127.0.0.1:${app.port}`;
        assert.deepEqual(await readVisionConfig(), publicVision);
        const replacement = { ...vision, url: new URL('/other/v1/chat/completions', vision.url).href };
        assert.deepEqual(await configure(replacement), [200, { success: true, ...replacement, hasApiKey: false }]);
        assert.equal(JSON.parse(fs.readFileSync(visionConfigPath, 'utf8')).apiKey, '');
        await configure({ ...replacement, apiKey: 'replacement-key' });
        assert.equal((await configure({ ...replacement, clearApiKey: true }))[1].hasApiKey, false);
        console.log('Image design check passed: preview, rotation, safe save, and preset deletion.');
    } finally {
        await app?.close();
        await new Promise(resolve => model.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

checkImageDesign().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
