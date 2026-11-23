(() => {
  const THEMES = /*__THEMES_PLACEHOLDER__*/{};
  const STUDIO_ASSETS = /*__STUDIO_ASSETS_PLACEHOLDER__*/{};
  const THEME_KEYS = Object.keys(THEMES);
  const DEFAULT_THEME_KEY = THEME_KEYS[0] || 'Default';

  const mediaAccess = window.__AGY_MEDIA_ACCESS__;
  delete window.__AGY_MEDIA_ACCESS__;
  window.__AGY_STUDIO_CLEANUP__?.();
  const studioScope = new AbortController();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const MEDIA_ID = /^[a-f0-9]{64}-[\p{L}\p{M}\p{N} ._()+-]{1,96}\.[a-z0-9]{2,4}$/u;
  const MEDIA_ACCEPT = {
    image: '.png,.jpg,.jpeg,.webp,.gif', video: '.mp4,.webm,.mov,.m4v', audio: '.mp3,.wav,.ogg,.m4a,.aac,.flac'
  };
  const STUDIO_DEFAULTS = {
    wallpaperMode: 'preset', imageMedia: '', videoMedia: '', bootIntro: false, sketchReveal: false,
    customGreetings: [], taskVoiceEnabled: false, taskVoiceVolume: 80
  };
  let studio = { ...STUDIO_DEFAULTS };
  let liveBackdrop, liveLayer, liveVideo, liveFrame, sketchLayer, bootDialog, bootTimer, bootAudio, taskAudio;
  let revealRequest = 0, revealedBackdrop = '', pendingBackdrop = '', glassKey = '';
  let greeting, greetingPool = '', lastGreeting = '', lastVoice = '';
  let closeStudio = () => {};
  let disposeStudioPreview = () => {};

  function normalizeStudio(config) {
    const normalized = { ...STUDIO_DEFAULTS };
    if (['preset', 'image', 'video'].includes(config.wallpaperMode)) normalized.wallpaperMode = config.wallpaperMode;
    for (const key of ['imageMedia', 'videoMedia']) {
      if (typeof config[key] === 'string' && MEDIA_ID.test(config[key])) normalized[key] = config[key];
    }
    for (const key of ['bootIntro', 'sketchReveal', 'taskVoiceEnabled']) normalized[key] = config[key] === true;
    if (Number.isFinite(config.taskVoiceVolume)) normalized.taskVoiceVolume = Math.max(0, Math.min(100, Math.round(config.taskVoiceVolume)));
    if (Array.isArray(config.customGreetings)) {
      normalized.customGreetings = [...new Set(config.customGreetings.filter(s => typeof s === 'string')
        .map(s => s.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120)).filter(Boolean))].slice(0, 12);
    }
    return normalized;
  }

  function mediaFileUrl(id, bundled = false) {
    if (!mediaAccess || typeof id !== 'string') return '';
    if (bundled) {
      if (!/^assets\/(?:[a-z0-9][a-z0-9_-]*\.(?:mp4|webm|mov|m4v)|voice\/(?:tawa_voice[1-4]|1795011944060_Tawa_voice_task_1)\.mp3)$/i.test(id)) return '';
      id = id.slice(7);
    } else if (!MEDIA_ID.test(id)) return '';
    return `${mediaAccess.base}/${bundled ? 'assets/' : ''}${encodeURIComponent(id)}?token=${encodeURIComponent(mediaAccess.token)}`;
  }

  async function mediaRequest(suffix = '', options = {}) {
    if (!mediaAccess) throw new Error('Restart the theme daemon to use local media.');
    const response = await fetch(mediaAccess.base + suffix, {
      ...options, headers: { Authorization: `Bearer ${mediaAccess.token}` },
      referrerPolicy: 'no-referrer', signal: studioScope.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not access local media.');
    return data;
  }

  const STORAGE_THEME = 'agy_theme_v3';
  const STORAGE_BUBBLE = 'agy_bubble_v3';
  const STORAGE_INPUT = 'agy_input_v3';
  const STORAGE_DIMMING = 'agy_dimming_v3';
  const STORAGE_WP_ENABLED = 'agy_wp_enabled_v3';
  const STORAGE_CUSTOM_WP = 'agy_custom_wp_v3';
  const STORAGE_USER_AVATAR = 'agy_user_avatar_v3';
  const STORAGE_AGENT_AVATAR = 'agy_agent_avatar_v3';
  const STORAGE_GLASS_BLUR = 'agy_glass_blur_v3';
  const STORAGE_AVATAR_SIZE = 'agy_avatar_size_v3';
  const STORAGE_AVATAR_RADIUS = 'agy_avatar_radius_v3';
  const STORAGE_SOUND_ENABLED = 'agy_sound_enabled_v3';
  const STORAGE_FONT_FAMILY = 'agy_font_family_v3';
  const STORAGE_CODE_FONT_FAMILY = 'agy_code_font_family_v3';

  function sanitizeFontName(raw) {
    return String(raw || '').replace(/[;{}]/g, '').trim();
  }

  function buildFontStacks(userFont, userCodeFont, theme) {
    const uiBase = sanitizeFontName(userFont || (theme && theme.fontFamily) || '');
    const codeBase = sanitizeFontName(userCodeFont || (theme && theme.codeFontFamily) || '');

    const uiStack = uiBase
      ? `${uiBase}, Inter, Geist, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
      : "Inter, Geist, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

    const chatStack = uiStack;

    const codeStack = codeBase
      ? `${codeBase}, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, 'Courier New', monospace`
      : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, 'Courier New', monospace";

    return { uiStack, chatStack, codeStack };
  }

  let audioCtx = null;
  let lastPlayedSoundTime = 0;

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    const AudioCtxClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
                          (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));
    if (!AudioCtxClass) return null;
    try {
      audioCtx = new AudioCtxClass();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function isSoundEnabled() {
    try {
      const val = localStorage.getItem('agy_sound_enabled_v3');
      if (val === null) return window.__AGY_INITIAL_CONFIG__?.soundEnabled !== false;
      return val !== 'false';
    } catch (e) {
      return true;
    }
  }

  function playFeedbackSound(type = 'click') {
    if (!isSoundEnabled()) return;

    const now = Date.now();
    if (now - lastPlayedSoundTime < 30) return;
    lastPlayedSoundTime = now;

    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === 'click') {
        const duration = 0.025;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(160, t + duration);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + duration);
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (e) {}
        };
      } else if (type === 'ping') {
        const duration = 0.22;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.08);

        gain.gain.setValueAtTime(0.10, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + duration);
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (e) {}
        };
      }
    } catch (e) {}
  }

  if (typeof window !== 'undefined') {
    window.playFeedbackSound = playFeedbackSound;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.playFeedbackSound = playFeedbackSound;
  }

  const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const INPUT_STYLES = {
    'sync': {
      label: 'Synced Ornament Frame',
      desc: 'Follows the active theme borders & decorative SVG ornament'
    },
    'double_gold': {
      label: 'Amber Gold Double Border',
      desc: 'Warm metallic double border with corner filigree'
    },
    'glass': {
      label: 'Translucent Crystal Glass',
      desc: 'Lets more of your background artwork shine through'
    },
    'minimal': {
      label: 'Minimal Clean',
      desc: 'Sleek subtle border without top decorative stickers'
    }
  };

  function composerLook(theme, style) {
    const gold = style === 'double_gold';
    const card = gold ? 'linear-gradient(145deg, rgba(44, 28, 20, 0.90), rgba(24, 15, 12, 0.92))'
      : style === 'glass' ? (theme.inputGlassBg || 'rgba(20, 15, 13, 0.52)')
      : (theme.inputCardBg || 'rgba(28, 19, 16, 0.88)');
    return {
      card,
      preview: style === 'glass' && theme.inputShellBg ? `linear-gradient(${card}, ${card}), ${theme.inputShellBg}` : card,
      frame: gold ? 'linear-gradient(135deg, #f59e0b 0%, rgba(217, 119, 6, 0.35) 50%, #fbbf24 100%)'
        : (theme.inputFrameBg || theme.frameBg),
      radius: (!gold && style === theme.inputStyle && theme.inputRadius) || 16,
      ink: gold ? '#e4e4e7' : theme.textColor || '#a1a1aa',
      accent: gold ? '#fbbf24' : theme.primary
    };
  }

  function composerPreset(main, bubble) {
    return main.inputFrameBg || bubble.inputFrameBg ? main : bubble;
  }

  function getState() {
    const init = window.__AGY_INITIAL_CONFIG__ || {};
    const rawTheme = localStorage.getItem(STORAGE_THEME) || init.themeName || DEFAULT_THEME_KEY;
    const themeName = THEMES[rawTheme] ? rawTheme : DEFAULT_THEME_KEY;
    const rawBubble = localStorage.getItem(STORAGE_BUBBLE) || init.bubbleName || themeName;
    const bubbleName = THEMES[rawBubble] ? rawBubble : themeName;
    const inputStyle = localStorage.getItem(STORAGE_INPUT) || init.inputStyle || 'sync';
    const dimming = parseInt(localStorage.getItem(STORAGE_DIMMING) || (init.dimming !== undefined ? init.dimming : '69'), 10);
    const wpEnabled = localStorage.getItem(STORAGE_WP_ENABLED) !== null
      ? localStorage.getItem(STORAGE_WP_ENABLED) !== 'false'
      : (init.wpEnabled !== undefined ? init.wpEnabled : true);
    const customWp = localStorage.getItem(STORAGE_CUSTOM_WP) ?? init.customWp ?? '';
    const userAvatar = localStorage.getItem(STORAGE_USER_AVATAR) ?? init.userAvatar ?? '';
    const agentAvatar = localStorage.getItem(STORAGE_AGENT_AVATAR) ?? init.agentAvatar ?? '';
    const rawBlur = localStorage.getItem(STORAGE_GLASS_BLUR) ?? init.glassBlur;
    const glassBlur = rawBlur !== undefined && rawBlur !== null && rawBlur !== '' ? parseInt(rawBlur, 10) : 10;
    const rawAvSize = localStorage.getItem(STORAGE_AVATAR_SIZE) ?? init.avatarSize;
    const avatarSize = rawAvSize !== undefined && rawAvSize !== null && rawAvSize !== '' ? parseInt(rawAvSize, 10) : 32;
    const rawAvRad = localStorage.getItem(STORAGE_AVATAR_RADIUS) ?? init.avatarRadius;
    const avatarRadius = rawAvRad !== undefined && rawAvRad !== null && rawAvRad !== '' ? parseInt(rawAvRad, 10) : 50;
    const soundEnabled = localStorage.getItem(STORAGE_SOUND_ENABLED) !== null
      ? localStorage.getItem(STORAGE_SOUND_ENABLED) !== 'false'
      : (init.soundEnabled !== undefined ? init.soundEnabled : true);
    const fontFamily = localStorage.getItem(STORAGE_FONT_FAMILY) || init.fontFamily || '';
    const codeFontFamily = localStorage.getItem(STORAGE_CODE_FONT_FAMILY) || init.codeFontFamily || '';
    return { themeName, bubbleName, inputStyle, dimming, wpEnabled, customWp, userAvatar, agentAvatar, glassBlur, avatarSize, avatarRadius, soundEnabled, fontFamily, codeFontFamily, ...studio };
  }

  // Downscale user/agent avatar uploads to 192x192 WebP once so theme_config.json stays tiny
  function compressAvatarFile(file, callback) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const size = 192;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const natW = img.naturalWidth || size;
          const natH = img.naturalHeight || size;
          const side = Math.min(natW, natH);
          const sx = Math.max(0, Math.floor((natW - side) / 2));
          const sy = Math.max(0, Math.floor((natH - side) / 2));
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          const out = canvas.toDataURL('image/webp', 0.88);
          callback(out && out.startsWith('data:image/webp') ? out : canvas.toDataURL('image/png'));
        } catch (e) {
          callback(String(reader.result || ''));
        }
      };
      img.onerror = () => callback(String(reader.result || ''));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  }

  // Pre-bake L-shaped header/sidebar glass blur once per theme/dimming change to avoid per-frame GPU backdrop readback
  function syncPrebakedGlass(wpUrl, overlayRgb, overlayAlpha, tintBg, blurStr) {
    const shell = document.querySelector('.agy-shell');
    if (!wpUrl) {
      glassKey = '';
      if (shell) shell.style.removeProperty('--agy-l-glass-bg');
      return;
    }
    const key = `${wpUrl.slice(0, 64)}|${wpUrl.length}|${overlayRgb}|${overlayAlpha.toFixed(3)}|${tintBg}|${blurStr}`;
    glassKey = key;
    window.__AGY_BLUR_CACHE__ = window.__AGY_BLUR_CACHE__ || {};
    const cached = window.__AGY_BLUR_CACHE__[key];
    if (cached) {
      if (shell) shell.style.setProperty('--agy-l-glass-bg', 'url("' + cached + '")');
      return;
    }
    const img = new Image();
    if (/^https?:/.test(wpUrl)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (glassKey !== key || studioScope.signal.aborted) return;
      try {
        const w = 640;
        const h = Math.min(1200, Math.max(180, Math.round((img.naturalHeight || 1440) * (w / (img.naturalWidth || 2560)))));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const pxMatch = String(blurStr !== undefined ? blurStr : '10px').match(/(\d+(?:\.\d+)?)/);
        const scaledBlur = Math.max(0, Math.min(24, Math.round(pxMatch ? parseFloat(pxMatch[1]) : 10)));
        ctx.filter = scaledBlur > 0 ? `blur(${scaledBlur}px)` : 'none';
        ctx.drawImage(img, -12, -12, w + 24, h + 24);
        ctx.filter = 'none';
        ctx.fillStyle = `rgba(${overlayRgb}, ${overlayAlpha})`;
        ctx.fillRect(0, 0, w, h);
        if (tintBg) {
          ctx.fillStyle = tintBg;
          ctx.fillRect(0, 0, w, h);
        }
        const baked = canvas.toDataURL('image/webp', 0.85);
        window.__AGY_BLUR_CACHE__[key] = baked;
        const keys = Object.keys(window.__AGY_BLUR_CACHE__);
        if (keys.length > 8) delete window.__AGY_BLUR_CACHE__[keys[0]];
        const curShell = document.querySelector('.agy-shell');
        if (curShell) curShell.style.setProperty('--agy-l-glass-bg', 'url("' + baked + '")');
      } catch (e) {}
    };
    img.src = wpUrl;
  }

  function applyTheme(overrides = {}, persist = true) {
    studio = normalizeStudio({ ...studio, ...overrides });
    const st = { ...getState(), ...overrides, ...studio };
    if (!Object.hasOwn(THEMES, st.themeName)) st.themeName = DEFAULT_THEME_KEY;
    if (!Object.hasOwn(THEMES, st.bubbleName)) st.bubbleName = st.themeName;
    try {
      localStorage.setItem(STORAGE_THEME, st.themeName);
      localStorage.setItem(STORAGE_BUBBLE, st.bubbleName);
      localStorage.setItem(STORAGE_INPUT, st.inputStyle);
      localStorage.setItem(STORAGE_DIMMING, String(st.dimming));
      localStorage.setItem(STORAGE_WP_ENABLED, String(st.wpEnabled));
      if (overrides.customWp !== undefined) {
        localStorage.setItem(STORAGE_CUSTOM_WP, overrides.customWp);
      }
      if (overrides.userAvatar !== undefined) {
        localStorage.setItem(STORAGE_USER_AVATAR, overrides.userAvatar);
      }
      if (overrides.agentAvatar !== undefined) {
        localStorage.setItem(STORAGE_AGENT_AVATAR, overrides.agentAvatar);
      }
      if (overrides.glassBlur !== undefined) {
        localStorage.setItem(STORAGE_GLASS_BLUR, String(overrides.glassBlur));
      }
      if (overrides.avatarSize !== undefined) {
        localStorage.setItem(STORAGE_AVATAR_SIZE, String(overrides.avatarSize));
      }
      if (overrides.avatarRadius !== undefined) {
        localStorage.setItem(STORAGE_AVATAR_RADIUS, String(overrides.avatarRadius));
      }
      if (overrides.soundEnabled !== undefined) {
        localStorage.setItem(STORAGE_SOUND_ENABLED, String(overrides.soundEnabled));
      }
      if (overrides.fontFamily !== undefined) {
        localStorage.setItem(STORAGE_FONT_FAMILY, overrides.fontFamily);
      }
      if (overrides.codeFontFamily !== undefined) {
        localStorage.setItem(STORAGE_CODE_FONT_FAMILY, overrides.codeFontFamily);
      }
    } catch (e) {}

    const mainTheme = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY];
    const bubbleTheme = THEMES[st.bubbleName] || mainTheme;
    const presetVideo = mediaFileUrl(mainTheme.wallpaperVideo, true);
    const wantedVideo = studio.wallpaperMode === 'video' ? mediaFileUrl(studio.videoMedia) || presetVideo
      : studio.wallpaperMode === 'preset' ? presetVideo : '';
    const wpVideoUrl = st.wpEnabled && !reducedMotion?.matches ? wantedVideo : '';
    const wpUrl = (studio.wallpaperMode === 'image' && (mediaFileUrl(studio.imageMedia) || st.customWp)) || mainTheme.wallpaper || '';
    const { uiStack, chatStack, codeStack } = buildFontStacks(st.fontFamily, st.codeFontFamily, mainTheme);

    const oldLegacy = document.getElementById('antigravity-ho-ly-chibi-theme');
    if (oldLegacy) oldLegacy.remove();

    let styleEl = document.getElementById('antigravity-custom-theme-active');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'antigravity-custom-theme-active';
      document.head.appendChild(styleEl);
    }

    const isLight = Boolean(mainTheme.isLight);
    const lightScale = isLight ? 0.42 : 0.85;
    const overlayAlpha = mainTheme.clearBackdrop
      ? Math.min(0.92, Math.max(0.0, ((st.dimming - 10) / 82) * lightScale))
      : Math.min(0.92, Math.max(0.12, (st.dimming / 100) * (isLight ? 0.45 : 0.78)));
    const overlayRgb = mainTheme.overlayRgb || '10, 7, 6';
    const bgPosition = mainTheme.bgPosition || 'center center';
    const secondaryGlowStop = mainTheme.secondaryGlow
      ? `, radial-gradient(circle at 22% 72%, ${mainTheme.secondaryGlow} 0%, transparent 55%)`
      : '';

    const scrim = mainTheme.clearBackdrop
      ? `linear-gradient(rgba(${overlayRgb}, ${overlayAlpha}), rgba(${overlayRgb}, ${overlayAlpha}))`
      : `radial-gradient(circle at 75% 40%, ${mainTheme.glow} 0%, transparent 65%)${secondaryGlowStop}, linear-gradient(rgba(${overlayRgb}, ${overlayAlpha * 0.85}), rgba(${overlayRgb}, ${overlayAlpha}))`;
    const bgLayers = wpUrl ? `${scrim}, url("${wpUrl}")`
      : mainTheme.pureBg || `radial-gradient(circle at 75% 30%, ${mainTheme.glow} 0%, transparent 60%), linear-gradient(160deg, rgba(${overlayRgb}, 0.96), #070910)`;

    const wpCss = st.wpEnabled ? `
      .agy-shell {
        background-image: ${bgLayers} !important;
        background-size: cover !important;
        background-position: ${bgPosition} !important;
        background-repeat: no-repeat !important;
        image-rendering: auto !important;
      }
      /* Keep transparent scrollers on GPU composited-scrolling layers */
      .agy-shell .overflow-y-auto {
        will-change: scroll-position;
      }
      .agy-sheet,
      .agy-inset-shell,
      .browser-hole-opaque,
      [data-main-content-body="true"],
      [data-side-panel-body="true"],
      [class*="agy-inset-shell"],
      [class*="--shell-canvas"],
      .agy-shell div.absolute.bottom-0.pointer-events-none,
      .agy-shell [class*="z-50"] .pointer-events-none.right-full,
      .agy-shell .bg-background:not(.settings-modal-container):not(.settings-modal-container *):not(#agy-custom-theme-modal-backdrop *) {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
      }
      /* Browser split-pane hole cutout: keep wallpaper & L-glass visible outside [data-browser-hole] without covering live BrowserView */
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"]:not(:has(#agy-sketch-reveal))::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background-image: ${wpVideoUrl ? 'none' : bgLayers};
        background-size: cover;
        background-position: ${bgPosition};
        background-repeat: no-repeat;
        clip-path: var(--agy-hole-clip, none);
        will-change: transform;
      }
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] > :not([data-has-browser-hole="true"]):not([data-browser-hole]:not([data-browser-hole="false"])):not(.settings-modal-container),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] .browser-hole-opaque:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-pane-id]:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-tiling-pane]:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-main-content-header]:not([data-has-browser-hole="true"]),
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-side-panel-strip]:not([data-has-browser-hole="true"]) {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
      }
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] :is([data-main-content-body], [data-side-panel-body]):not([data-has-browser-hole="true"]) {
        box-shadow: none !important;
      }
      body[data-has-browser-hole="true"] .agy-shell[data-agy-hole-active="1"] [data-split-sash] {
        background: rgba(56, 189, 248, 0.14) !important;
        background-image: none !important;
      }
    ` : `
      .agy-shell {
        background: #111113 !important;
      }
    `;

    const defaultCornerSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Cpath d='M2 20 L2 6 Q2 2 6 2 L20 2' stroke='%23fbbf24' stroke-width='1.5' fill='none' opacity='0.65'/%3E%3Ccircle cx='6' cy='6' r='2' fill='%23fbbf24' opacity='0.75'/%3E%3C/svg%3E";
    const cornerFiligreeUrl = bubbleTheme.cornerSvg || defaultCornerSvg;

    const bubbleStickerCss = bubbleTheme.sticker ? (bubbleTheme.isOrnament ? `
      .group\\/user-input-step {
        padding-top: 18px !important;
      }
      .agy-user-bubble-frame::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop}px;
        right: ${bubbleTheme.stickerRight}px;
        width: ${bubbleTheme.stickerW}px;
        height: ${bubbleTheme.stickerH}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
        z-index: 25;
        pointer-events: none;
        transition: transform 0.2s ease;
      }
    ` : `
      .group\\/user-input-step {
        padding-top: ${Math.max(36, Math.abs(bubbleTheme.stickerTop) + 8)}px !important;
      }
      .agy-user-bubble-frame::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop}px;
        right: ${bubbleTheme.stickerRight}px;
        width: ${bubbleTheme.stickerW}px;
        height: ${bubbleTheme.stickerH}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: bottom center;
        background-repeat: no-repeat;
        z-index: 25;
        pointer-events: none;
        transition: transform 0.2s ease;
      }
    `) : `
      .agy-user-bubble-frame::before { display: none !important; }
    `;

    const showInputSticker = st.inputStyle !== 'minimal' && bubbleTheme.sticker;
    const inputStickerCss = showInputSticker ? (bubbleTheme.isOrnament ? `
      .surface-composer {
        margin-top: 16px !important;
        overflow: visible !important;
      }
      .surface-composer::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop}px;
        right: 16px;
        width: ${bubbleTheme.stickerW + 8}px;
        height: ${bubbleTheme.stickerH + 2}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
        z-index: 30;
        pointer-events: none;
      }
      .surface-composer::after {
        content: "";
        position: absolute;
        bottom: 3px;
        left: 4px;
        width: 16px;
        height: 16px;
        background-image: url("${cornerFiligreeUrl}");
        background-size: contain;
        background-repeat: no-repeat;
        transform: rotate(180deg);
        z-index: 25;
        pointer-events: none;
        opacity: 0.78;
      }
    ` : `
      .surface-composer {
        margin-top: 28px !important;
        overflow: visible !important;
      }
      .surface-composer::before {
        content: "";
        position: absolute;
        top: ${bubbleTheme.stickerTop - 4}px;
        right: 16px;
        width: ${bubbleTheme.stickerW + 6}px;
        height: ${bubbleTheme.stickerH + 6}px;
        background-image: url("${bubbleTheme.sticker}");
        background-size: contain;
        background-position: bottom center;
        background-repeat: no-repeat;
        z-index: 30;
        pointer-events: none;
      }
      .surface-composer::after { display: none !important; }
    `) : `
      .surface-composer::before,
      .surface-composer::after { display: none !important; }
    `;

    const composerTheme = composerPreset(mainTheme, bubbleTheme);
    const input = composerLook(composerTheme, st.inputStyle);
    const inputShellBg = mainTheme.inputShellBg || (isLight ? 'rgba(255, 250, 253, 0.86)' : 'rgba(10, 16, 30, 0.82)');
    const bubbleRadius = bubbleTheme.bubbleRadius ?? (bubbleTheme.isScroll ? 6 : 14);

    const sidebarBg = mainTheme.sidebarBg || 'rgba(14, 10, 8, 0.68)';
    const sidebarHoverBg = mainTheme.sidebarHoverBg || 'rgba(255, 255, 255, 0.08)';
    const btnBg = mainTheme.btnBg || 'rgba(48, 30, 22, 0.62)';
    const modalBg = mainTheme.modalBg || 'rgba(14, 12, 12, 0.96)';
    const innerBubbleBorder = bubbleTheme.isScroll
      ? '2px solid #78350f'
      : (bubbleTheme.innerBorder || '1px solid rgba(255, 255, 255, 0.06)');

    const uiInk = mainTheme.uiTextColor || (isLight ? '#0f172a' : 'rgba(248, 250, 252, 0.96)');
    const uiMutedInk = mainTheme.uiMutedColor || (isLight ? '#334155' : 'rgba(241, 245, 249, 0.92)');
    const uiShadow = isLight ? 'none' : '0 1px 4px rgba(0, 0, 0, 0.92), 0 0 8px rgba(0, 0, 0, 0.68)';
    const pillBg = mainTheme.pillBg || (isLight ? 'rgba(255, 255, 255, 0.78)' : 'rgba(6, 11, 24, 0.78)');
    const pillHoverBg = mainTheme.pillHoverBg || (isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(10, 18, 38, 0.92)');
    const pillText = mainTheme.pillTextColor || (isLight ? '#0f172a' : '#f8fafc');
    const pillBorder = mainTheme.pillBorder || (isLight ? 'rgba(15, 23, 42, 0.16)' : 'rgba(255, 255, 255, 0.16)');
    const preCodeBg = isLight ? `rgba(${overlayRgb}, 0.72)` : `rgba(${overlayRgb}, 0.56)`;

    const effectiveUserAvatar = st.userAvatar === 'none' ? '' : (st.userAvatar || mainTheme.userAvatar || '');
    const effectiveAgentAvatar = st.agentAvatar === 'none' ? '' : (st.agentAvatar || mainTheme.agentAvatar || '');
    const avSize = Math.min(52, Math.max(22, Number(st.avatarSize) || 32));
    const avAgentSize = Math.max(22, avSize - 2);
    const avRadius = Math.min(50, Math.max(0, Number.isFinite(Number(st.avatarRadius)) ? Number(st.avatarRadius) : 50));

    const avatarCss = `
      ${effectiveUserAvatar ? `
      .agy-shell [data-testid="user-message"] {
        position: relative !important;
        padding-right: ${avSize + 10}px !important;
      }
      .agy-shell [data-testid="user-message"]::after {
        content: "";
        position: absolute;
        right: 0;
        bottom: 6px;
        width: ${avSize}px;
        height: ${avSize}px;
        border-radius: ${avRadius}%;
        background-image: url("${effectiveUserAvatar}");
        background-size: cover;
        background-position: center;
        border: 1.5px solid ${mainTheme.primary};
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4), 0 0 8px ${mainTheme.glow};
        pointer-events: none;
      }
      ` : ''}
      ${effectiveAgentAvatar ? `
      .agy-shell [data-testid="agent-response"] {
        position: relative !important;
        padding-left: ${avAgentSize + 22}px !important;
        min-height: ${avAgentSize + 20}px !important;
      }
      .agy-shell [data-testid="agent-response"]::before {
        content: "";
        position: absolute;
        top: 12px;
        left: 12px;
        width: ${avAgentSize}px;
        height: ${avAgentSize}px;
        border-radius: ${avRadius}%;
        background-image: url("${effectiveAgentAvatar}");
        background-size: cover;
        background-position: center;
        border: 1.5px solid ${mainTheme.secondary || mainTheme.primary};
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4), 0 0 8px ${mainTheme.secondaryGlow || mainTheme.glow};
        pointer-events: none;
      }
      ` : ''}
    `;

    const sidebarEnhanceCss = (mainTheme.sidebarEnhanceText || isLight) ? `
      .agy-shell .bg-sidebar a,
      .agy-shell .bg-sidebar span,
      .agy-shell .bg-sidebar button {
        color: ${isLight ? uiInk : 'inherit'};
        text-shadow: ${isLight ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.88)'};
      }
      .agy-shell .bg-sidebar .text-muted-foreground,
      .agy-shell .bg-sidebar .text-secondary-foreground {
        color: ${uiMutedInk} !important;
      }
    ` : '';

    const aiCardCss = mainTheme.aiCardBg ? `
      /* Translucent reading card for AI responses (zero live backdrop-filter for max 120fps scroll) */
      .agy-shell [data-testid="agent-response"] {
        background: ${mainTheme.aiCardBg} !important;
        ${isLight ? `color: ${uiInk} !important;` : ''}
        backdrop-filter: none !important;
        border: 1px solid ${mainTheme.aiCardBorder || (isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.1)')} !important;
        border-radius: 14px !important;
        padding: 12px 16px !important;
        box-shadow: ${isLight ? '0 4px 14px rgba(15, 23, 42, 0.08)' : '0 4px 14px rgba(0, 0, 0, 0.28)'} !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-bleed,
      .agy-shell [data-testid="agent-response"] .md-table-host {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin-inline: 0 !important;
        left: auto !important;
        right: auto !important;
        transform: none !important;
        box-sizing: border-box !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-scroll,
      .agy-shell [data-testid="agent-response"] :has(> table):not(.md-table-frame) {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        padding-bottom: 2px !important;
        box-sizing: border-box !important;
        /* Keep standard scrollbar-width: auto so Chromium does not disable ::-webkit-scrollbar */
        scrollbar-width: auto !important;
        scrollbar-color: auto !important;
      }
      .agy-shell [data-testid="agent-response"] .md-table-frame {
        /* .md-table-frame sits INSIDE .md-table-scroll; forcing width:100% + overflow:hidden hid overflow from .md-table-scroll */
        width: fit-content !important;
        min-width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        transform: none !important;
        box-sizing: border-box !important;
      }
      .agy-shell [data-testid="agent-response"] :is(.md-math-display, .katex-display) {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding-bottom: 4px !important;
        box-sizing: border-box !important;
        scrollbar-width: auto !important;
        scrollbar-color: auto !important;
      }
      .agy-shell [data-testid="agent-response"] :not(.md-math-display):not(.katex-display) > .katex {
        display: inline-block !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        vertical-align: middle !important;
        box-sizing: border-box !important;
        scrollbar-width: auto !important;
        scrollbar-color: auto !important;
      }
      .agy-shell [data-testid="agent-response"] :is(.md-table-scroll, :has(> table):not(.md-table-frame), .md-math-display, .katex-display, :not(.md-math-display):not(.katex-display) > .katex)::-webkit-scrollbar {
        height: 8px !important;
        display: block !important;
      }
      .agy-shell [data-testid="agent-response"] :is(.md-table-scroll, :has(> table):not(.md-table-frame), .md-math-display, .katex-display, :not(.md-math-display):not(.katex-display) > .katex)::-webkit-scrollbar-track {
        background: ${isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.06)'} !important;
        border-radius: 9999px !important;
      }
      .agy-shell [data-testid="agent-response"] :is(.md-table-scroll, :has(> table):not(.md-table-frame), .md-math-display, .katex-display, :not(.md-math-display):not(.katex-display) > .katex)::-webkit-scrollbar-thumb {
        background: ${isLight ? 'rgba(15, 23, 42, 0.34)' : 'rgba(148, 163, 184, 0.48)'} !important;
        border-radius: 9999px !important;
      }
      .agy-shell [data-testid="agent-response"] :is(.md-table-scroll, :has(> table):not(.md-table-frame), .md-math-display, .katex-display, :not(.md-math-display):not(.katex-display) > .katex)::-webkit-scrollbar-thumb:hover {
        background: ${isLight ? 'rgba(15, 23, 42, 0.54)' : 'rgba(148, 163, 184, 0.72)'} !important;
      }
      .agy-shell [data-testid="agent-response"] table {
        width: 100% !important;
        min-width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        table-layout: auto !important;
        box-sizing: border-box !important;
      }
      .agy-shell [data-testid="agent-response"] :is(th, td) {
        max-width: none !important;
        white-space: normal !important;
        word-break: normal !important;
        overflow-wrap: break-word !important;
        padding: 8px 12px !important;
      }
      .agy-shell [data-testid="agent-response"] :is(td, th) .inline-pill-wrap {
        min-width: 0 !important;
      }
      ${isLight ? `
      .agy-shell [data-main-content-body="true"],
      .agy-shell [data-testid="agent-response"] :is(p, li, span, code, h1, h2, h3, h4, strong, td, th) {
        color: ${uiInk};
      }
      ` : ''}
      .agy-shell [data-main-content-body="true"] h1,
      .agy-shell [data-main-content-body="true"] h2 {
        text-shadow: ${isLight ? 'none' : '0 2px 10px rgba(0, 0, 0, 0.85)'};
      }
    ` : '';

    const glassSource = wpVideoUrl && liveVideo?.getAttribute('src') === wpVideoUrl && liveFrame || wpUrl;
    const useUnifiedGlass = Boolean(st.wpEnabled && glassSource && mainTheme.unifiedGlass);
    if (useUnifiedGlass && typeof syncShellMetrics === 'function') {
      syncShellMetrics();
    }
    if (useUnifiedGlass) {
      const effectiveBlur = Number.isFinite(st.glassBlur) ? `${st.glassBlur}px` : (mainTheme.headerBlur || '3px');
      syncPrebakedGlass(glassSource, overlayRgb, overlayAlpha, mainTheme.headerBg || '', effectiveBlur);
    } else {
      syncPrebakedGlass(null);
    }

    const sidePanelCss = st.wpEnabled ? `
      /* Frosted pre-baked glass + dark/light reading scrim for right-side Artifact / Text / Diff split panels */
      ${useUnifiedGlass ? `
      .agy-shell[data-agy-side-glass="1"]::before {
        clip-path: polygon(
          evenodd,
          0 0,
          100% 0,
          100% var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) 100%,
          0 100%,
          0 0,
          var(--agy-side-l, 100%) var(--agy-side-t, 75px),
          var(--agy-side-r, 100%) var(--agy-side-t, 75px),
          var(--agy-side-r, 100%) var(--agy-side-b, 100%),
          var(--agy-side-l, 100%) var(--agy-side-b, 100%),
          var(--agy-side-l, 100%) var(--agy-side-t, 75px)
        ) !important;
      }
      ` : ''}
      body:not([data-has-browser-hole="true"]) .agy-shell [data-side-panel-body="true"]:not([data-has-browser-hole="true"]):not(:has([data-browser-hole]:not([data-browser-hole="false"]))) {
        background: ${mainTheme.aiCardBg || `rgba(${overlayRgb}, 0.72)`} !important;
        ${isLight ? `color: ${uiInk} !important;` : ''}
        backdrop-filter: none !important;
        border-left: 1px solid ${mainTheme.aiCardBorder || (isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)')} !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
      }
      body:not([data-has-browser-hole="true"]) .agy-shell [data-side-panel-body="true"]:not([data-has-browser-hole="true"]):not(:has([data-browser-hole]:not([data-browser-hole="false"]))) pre {
        background: ${preCodeBg} !important;
        border: 1px solid ${mainTheme.aiCardBorder || (isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)')} !important;
        border-radius: 10px !important;
      }
      .agy-shell [data-side-panel-body="true"] :is(h1, h2, h3, h4) {
        ${isLight ? `color: ${uiInk} !important;` : ''}
        text-shadow: ${isLight ? 'none' : '0 1px 6px rgba(0, 0, 0, 0.85)'};
      }
    ` : '';

    const headerCss = mainTheme.headerBg ? `
      /* Frosted top titlebar & seamless L-shaped unified glass (zero live backdrop-filter) */
      ${useUnifiedGlass ? `
      .agy-shell {
        position: relative !important;
      }
      .agy-shell > div:first-of-type {
        position: relative !important;
        z-index: 3 !important;
      }
      .agy-shell > div:not(:first-of-type) {
        position: relative !important;
        z-index: 2 !important;
      }
      .agy-shell::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background-color: ${mainTheme.headerBg};
        background-image: var(--agy-l-glass-bg, none);
        background-size: cover;
        background-position: ${bgPosition};
        background-repeat: no-repeat;
        backdrop-filter: none !important;
        will-change: transform;
        clip-path: polygon(
          0 0,
          100% 0,
          100% var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) var(--agy-hdr-h, 75px),
          var(--agy-sidebar-w, 256px) 100%,
          0 100%
        );
      }
      .agy-shell [class*="@container/titlebar"] {
        background: transparent !important;
        backdrop-filter: none !important;
        border-bottom: 1px solid ${mainTheme.headerBorder || 'rgba(56, 189, 248, 0.10)'} !important;
      }
      ` : `
      .agy-shell [class*="@container/titlebar"] {
        background: ${mainTheme.headerBg} !important;
        backdrop-filter: none !important;
        border-bottom: 1px solid ${mainTheme.headerBorder || 'rgba(56, 189, 248, 0.15)'} !important;
      }
      `}
      .agy-shell [class*="@container/titlebar"] [data-testid="breadcrumb-segment"],
      .agy-shell [class*="@container/titlebar"] [data-testid="pane-titlebar-toolbar"] button,
      .agy-shell [class*="@container/titlebar"] [data-testid="pane-titlebar-toolbar"] span {
        color: ${uiInk} !important;
        text-shadow: ${uiShadow};
      }
      .agy-shell [class*="@container/titlebar"] [data-testid="pane-titlebar-toolbar"] button.border {
        background: ${isLight ? 'rgba(255, 255, 255, 0.56)' : 'rgba(6, 11, 24, 0.36)'} !important;
        border-color: ${pillBorder} !important;
      }
    ` : '';

    const sidebarOuterCss = useUnifiedGlass ? `
      .agy-shell aside,
      .agy-shell [data-sidebar="true"],
      .agy-shell .bg-sidebar:not(.surface-opaque) {
        background: transparent !important;
        backdrop-filter: none !important;
      }
    ` : `
      .agy-shell aside,
      .agy-shell [data-sidebar="true"],
      .agy-shell .bg-sidebar:not(.surface-opaque) {
        background: ${sidebarBg} !important;
        backdrop-filter: none !important;
      }
    `;

    styleEl.textContent = `
      :root, .agy-shell {
        --agy-font-ui: ${uiStack};
        --agy-font-chat: ${chatStack};
        --agy-font-code: ${codeStack};
        font-family: var(--agy-font-ui) !important;
      }

      .agy-user-bubble,
      .surface-composer,
      [data-testid="agent-response"] {
        font-family: var(--agy-font-chat) !important;
        line-height: 1.5 !important;
        overflow-wrap: break-word !important;
        word-break: break-word !important;
      }

      pre, code, kbd, samp {
        font-family: var(--agy-font-code) !important;
        overflow-x: auto !important;
      }

      ${wpCss}

      /* Translucent themed glass sidebar (unified via ::before when unifiedGlass is active) */
      ${sidebarOuterCss}
      .agy-shell .bg-sidebar:not(.surface-opaque) .bg-sidebar:not(.surface-opaque),
      .agy-shell [data-sidebar="true"] .bg-sidebar:not(.surface-opaque),
      .agy-shell .bg-sidebar:not(.surface-opaque) [class*="group/headerbtn"],
      .agy-shell .bg-sidebar:not(.surface-opaque) [class*="group/section-header"] {
        background: transparent !important;
        backdrop-filter: none !important;
      }
      /* Keep floating menubar dropdowns & opaque popovers readable (never inherit transparent sidebar bg) */
      .agy-shell .surface-opaque.bg-sidebar,
      .agy-shell .surface-opaque.border-menu-border {
        background: ${modalBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, ${isLight ? '0.18' : '0.65'}) !important;
        backdrop-filter: none !important;
      }
      /* Preserve virtual list positioning; hide sticky headers only while scrolled */
      .agy-shell .bg-sidebar .agy-scrolled > .w-full.relative > .bg-sidebar[style*="position: sticky"] {
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.14s ease !important;
      }
      .agy-shell .bg-sidebar [class*="group/headerbtn"]:hover,
      .agy-shell .bg-sidebar a:hover {
        background: ${sidebarHoverBg} !important;
      }
      ${sidebarEnhanceCss}
      ${aiCardCss}
      ${sidePanelCss}
      ${avatarCss}
      ${headerCss}

      /* "+ New Conversation" button glow */
      .agy-button-custom.border.border-border {
        background: ${btnBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3) !important;
      }

      /* User Chat Bubble Double-Border Frame & Ornament */
      .agy-user-bubble-frame {
        background: ${bubbleTheme.frameBg} !important;
        border-radius: ${bubbleRadius}px !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45), 0 0 12px ${bubbleTheme.glow} !important;
        position: relative !important;
        overflow: visible !important;
        padding: 1.2px !important;
      }

      .agy-user-bubble-frame::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: ${bubbleTheme.isOrnament ? '16px' : '14px'};
        height: ${bubbleTheme.isOrnament ? '16px' : '14px'};
        background-image: url("${cornerFiligreeUrl}");
        background-size: contain;
        background-repeat: no-repeat;
        pointer-events: none;
        opacity: ${bubbleTheme.isOrnament ? '0.85' : '0.65'};
      }

      .agy-user-bubble {
        background: ${bubbleTheme.bg} !important;
        border-radius: ${bubbleRadius - 1}px !important;
        padding: 8px 16px !important;
        color: ${bubbleTheme.textColor} !important;
        border: ${innerBubbleBorder} !important;
        overflow: visible !important;
        font-weight: 450 !important;
      }

      .agy-user-bubble * {
        color: ${bubbleTheme.textColor} !important;
      }

      /* Unified Glass Composer with Crisp Gradient Border */
      .surface-composer {
        background:
          linear-gradient(${inputShellBg}, ${inputShellBg}) padding-box,
          ${input.frame} border-box !important;
        border: 1.5px solid transparent !important;
        border-radius: ${input.radius}px !important;
        padding: 0 !important;
        box-shadow: ${isLight
          ? `0 10px 30px rgba(85, 45, 70, 0.14), 0 0 0 1px rgba(255, 255, 255, 0.6) inset`
          : `0 10px 32px rgba(0, 0, 0, 0.55), 0 0 18px ${bubbleTheme.glow}`} !important;
        position: relative !important;
      }

      /* Làm thanh top bar chứa repo/branch hòa vào khối chung */
      .surface-composer > :not(.surface-composer-card) {
        background: transparent !important;
        border-bottom: 1px solid ${isLight ? 'rgba(117, 51, 76, 0.10)' : 'rgba(255, 255, 255, 0.06)'} !important;
        padding: 6px 10px !important;
      }

      .surface-composer-card {
        background: ${input.card} !important;
        backdrop-filter: none !important;
        border-radius: 0 0 ${input.radius - 1.5}px ${input.radius - 1.5}px !important;
        border: none !important;
        box-shadow: none !important;
      }

      /* High-contrast pill badges for top composer bar (adaptive light/dark theme) */
      .surface-composer [data-testid="project-selector-trigger"],
      .surface-composer [data-testid="branch-pill-trigger"],
      .surface-composer [aria-label="Select Environment"],
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"] {
        background: ${pillBg} !important;
        color: ${pillText} !important;
        border: 1px solid ${pillBorder} !important;
        border-radius: 9999px !important;
        font-weight: 500 !important;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25) !important;
        margin: 1px 2px !important;
        transition: background-color 0.15s ease, border-color 0.15s ease !important;
      }
      .surface-composer [data-testid="branch-pill-trigger"],
      .surface-composer [aria-label="Select Environment"],
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button:not([data-testid="project-selector-trigger"]),
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"]:not([data-testid="project-selector-trigger"]) {
        padding-left: 8px !important;
        padding-right: 7px !important;
        gap: 4px !important;
      }
      .surface-composer [data-testid="project-selector-trigger"]:hover,
      .surface-composer [data-testid="branch-pill-trigger"]:hover,
      .surface-composer [aria-label="Select Environment"]:hover,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button:hover,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"]:hover {
        background: ${pillHoverBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        color: ${pillText} !important;
      }
      .surface-composer [data-testid="project-selector-trigger"] *,
      .surface-composer [data-testid="branch-pill-trigger"] *,
      .surface-composer [aria-label="Select Environment"] *,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] button *,
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] [role="button"] * {
        color: ${pillText} !important;
      }
      .surface-composer > :not(.surface-composer-card) [data-testid="input-box-bottom-toolbar"] .ml-auto > * {
        background: ${pillBg} !important;
        color: ${pillText} !important;
        border-radius: 9999px !important;
        padding: 2px 8px !important;
      }

      ${bubbleStickerCss}
      ${inputStickerCss}

      @media (max-width: 640px) {
        .agy-user-bubble-frame::before,
        .surface-composer::before {
          transform: scale(0.78);
          transform-origin: bottom right;
        }
      }

      .settings-modal-container {
        background: ${modalBg} !important;
        border: 1px solid ${mainTheme.borderColor} !important;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.75), 0 0 24px ${mainTheme.glow} !important;
        backdrop-filter: none !important;
      }

      #agy-custom-theme-modal-dialog {
        background: ${modalBg} !important;
        border-color: ${mainTheme.borderColor} !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.9), 0 0 32px ${mainTheme.glow} !important;
      }
      #agy-custom-theme-modal-header {
        background: ${mainTheme.modalHeaderBg || 'rgba(22, 16, 14, 0.85)'} !important;
      }
      #agy-custom-theme-badge {
        color: ${mainTheme.primary} !important;
        border-color: ${mainTheme.borderColor} !important;
        background: ${mainTheme.glow} !important;
      }
      #agy-custom-theme-sidebar-btn svg {
        color: ${mainTheme.primary} !important;
      }

      ${isLight ? `
        /* 1. Hero greeting ("Hey Nguyên...") & logo A ở giữa */
        .agy-shell [data-main-content-body="true"] :is(h1, h2, h3, p, span) {
          color: ${uiInk} !important;
          text-shadow: 0 1px 14px rgba(255, 255, 255, 0.88) !important;
        }
        .agy-shell [data-main-content-body="true"] svg {
          color: ${mainTheme.primary} !important;
          opacity: 0.85 !important;
        }

        /* 2. Toàn bộ thanh titlebar & hàng icon góc trên trái */
        .agy-shell [class*="@container/titlebar"] :is(button, a, span, svg),
        .agy-shell header :is(button, a, span, svg),
        .agy-shell .bg-sidebar svg {
          color: ${uiInk} !important;
        }

        /* 3. Chữ nhập liệu, placeholder, model picker & nút Turbo trong khung chat */
        .surface-composer-card,
        .surface-composer-card :is(textarea, input, [contenteditable="true"], button, span, svg) {
          color: ${uiInk} !important;
        }
        .surface-composer-card :is(textarea::placeholder, input::placeholder),
        .surface-composer-card [data-placeholder]::before,
        .surface-composer-card .text-muted-foreground,
        .surface-composer-card .opacity-50 {
          color: ${uiMutedInk} !important;
          opacity: 0.88 !important;
        }

        /* 4. Nút gửi (Send / Voice) đồng bộ màu accent thay vì trắng bệch */
        .surface-composer-card button[data-testid="send-button"],
        .surface-composer-card button[aria-label*="Send"],
        .surface-composer-card button.rounded-full:last-of-type {
          background: ${mainTheme.primary} !important;
          color: #ffffff !important;
        }
        .surface-composer-card button[data-testid="send-button"] svg,
        .surface-composer-card button[aria-label*="Send"] svg,
        .surface-composer-card button.rounded-full:last-of-type svg {
          color: #ffffff !important;
        }
      ` : `
        /* Dark mode: cho logo A giữa màn hình sáng nhẹ lên để không chìm vào tóc nhân vật */
        .agy-shell [data-main-content-body="true"] > div svg {
          filter: drop-shadow(0 0 12px ${mainTheme.glow});
        }
      `}
    `;

    if (!document.getElementById('agy-studio-style')) {
      const studioStyle = document.createElement('style');
      studioStyle.id = 'agy-studio-style';
      studioStyle.textContent = STUDIO_CSS;
      document.head.appendChild(studioStyle);
    }
    syncLiveBackdrop(st.wpEnabled ? wpUrl : '', wpVideoUrl, scrim, bgPosition);
    syncEmptyGreeting();
    if (!studio.bootIntro && bootDialog && !bootDialog.dataset.replay) closeBoot();
    if (!st.soundEnabled) stopBootVoice();
    if (!st.soundEnabled || !studio.taskVoiceEnabled) stopTaskVoice();
    syncTitleBarOverlay(st);
    scheduleTitleBarSync(st);
    if (persist && Object.keys(overrides).length && window.agySaveThemeConfig) {
      try {
        const patch = Object.fromEntries(Object.keys(overrides).filter(key => Object.hasOwn(st, key)).map(key => [key, st[key]]));
        window.agySaveThemeConfig(JSON.stringify(patch));
      } catch (e) {}
    }
    return st.themeName;
  }

  const STUDIO_CSS = `
    ${Object.entries({
      latin: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+2212',
      'latin-ext': 'U+0100-02BA, U+02BD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+20A0-20AB, U+2113, U+2C60-2C7F, U+A720-A7FF',
      vi: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB'
    }).map(([subset, range]) => {
      const src = STUDIO_ASSETS['fonts/mali-500-' + subset + '.woff2'];
      return src ? `@font-face {font-family:'Agy Mali'; src:url("${src}") format('woff2'); font-weight:500; font-display:swap; unicode-range:${range};}` : '';
    }).join('\n')}
    .agy-shell [data-agy-custom-greeting] { font-family:'Agy Mali', cursive !important; font-weight:500; }
    .agy-shell:has(> #agy-live-bg-layer) { position:relative !important; isolation:isolate; }
    #agy-live-bg-layer { position:absolute; inset:0; z-index:-1; overflow:hidden; pointer-events:none; clip-path:var(--agy-hole-clip, none); }
    #agy-live-bg-layer video, #agy-live-bg-layer > span, #agy-sketch-reveal canvas { position:absolute; inset:0; width:100%; height:100%; }
    #agy-live-bg-layer video, #agy-sketch-reveal canvas { object-fit:cover; }
    #agy-live-bg-layer:not([data-ready]) > :is(video, .agy-live-scrim) { visibility:hidden; }
    @property --agy-bloom { syntax:'<percentage>'; inherits:false; initial-value:0%; }
    #agy-sketch-reveal { background:#07111d; mask-image:radial-gradient(circle at 42% 54%, transparent var(--agy-bloom), black calc(var(--agy-bloom) + 12%)); animation:agy-bloom 1s 650ms both; }
    #agy-sketch-reveal canvas { animation:agy-draw 650ms ease-out both; }
    @keyframes agy-draw { from { clip-path:inset(0 100% 0 0); } to { clip-path:inset(0); } }
    @keyframes agy-bloom { from { --agy-bloom:0%; } to { --agy-bloom:110%; } }
    #agy-boot-hud { width:min(34rem, 90vw); margin:auto; padding:clamp(1.25rem, 5vw, 3rem); box-sizing:border-box; color:#eef7ff;
      background:linear-gradient(110deg, #07111dec, #102d4a99) center / cover${STUDIO_ASSETS['starfield-boot-bg.jpg'] ? `, url("${STUDIO_ASSETS['starfield-boot-bg.jpg']}") center / cover` : ', #07111d'};
      border:1px solid #457096; border-radius:12px; box-shadow:0 16px 64px #020912c0; }
    #agy-boot-hud::backdrop { background:#030b16ae; }
    #agy-boot-hud h2 { margin:0; font-size:clamp(1.6rem, 5vw, 2.5rem); letter-spacing:-.04em; }
    #agy-boot-hud .agy-boot-brand { display:flex; align-items:center; gap:12px; }
    #agy-boot-hud .agy-boot-brand img { width:40px; height:40px; object-fit:contain; }
    #agy-boot-hud p { color:#c2daed; margin:10px 0 20px; }
    #agy-boot-hud .agy-boot-track { display:block; height:2px; background:#273f55; margin-bottom:20px; }
    #agy-boot-hud .agy-boot-track::before { content:''; display:block; width:100%; height:100%; background:#94d7fb; transform-origin:left; animation:agy-boot-fill 1800ms linear both; }
    @keyframes agy-boot-fill { from { transform:scaleX(0); } to { transform:scaleX(1); } }
    .agy-studio-controls { display:grid; gap:9px; font-size:12.5px; min-width:0; }
    .agy-studio-controls > section, .agy-studio-controls details { border-top:1px solid #ffffff20; padding-top:10px; }
    .agy-studio-controls summary { cursor:pointer; font-weight:600; }
    .agy-studio-controls .agy-studio-row { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; margin-top:8px; }
    .agy-studio-controls .agy-studio-row > * { max-width:100%; min-width:0; }
    .agy-studio-controls :is(select, button, textarea), #agy-boot-hud button { padding:5px 9px; color:#f4f4f5; background:#1d2531; border:1px solid #ffffff32; border-radius:6px; }
    .agy-studio-controls button, #agy-boot-hud button { cursor:pointer; }
    .agy-studio-controls button:disabled { opacity:.5; cursor:default; }
    .agy-studio-controls :focus-visible, #agy-boot-hud button:focus-visible, .agy-preset-card:focus-visible { outline:2px solid #94d7fb; outline-offset:2px; }
    .agy-studio-controls textarea { width:100%; box-sizing:border-box; resize:vertical; }
    .agy-studio-controls :is(img, video) { display:block; width:min(100%, 380px); max-height:200px; object-fit:contain; background:#0a101a; margin-top:8px; border-radius:6px; }
    .agy-studio-controls audio { max-width:100%; margin-top:8px; }
    .agy-studio-controls [role="status"] { margin:0; color:#cbd5e1; overflow-wrap:anywhere; }
    @media (prefers-reduced-motion:reduce) { #agy-boot-hud .agy-boot-track::before { animation:none; } }
  `;

  function releaseMedia(element) {
    if (!element) return;
    element.pause();
    element.removeAttribute('src');
    element.load();
  }

  function clearSketch() {
    revealRequest++;
    pendingBackdrop = '';
    sketchLayer?.remove();
    sketchLayer = null;
  }

  function clearLiveLayer() {
    clearSketch();
    if (liveVideo) {
      liveVideo.onloadeddata = liveVideo.onerror = null;
      releaseMedia(liveVideo);
      liveVideo = liveFrame = null;
    }
    liveLayer?.remove();
    liveLayer = null;
  }

  function syncWallpaperPlayback() {
    if (document.hidden) liveVideo?.pause();
    else liveVideo?.play().catch(() => {});
  }

  function mountLiveLayer(shell) {
    if (liveLayer) return;
    liveLayer = document.createElement('agy-live-bg');
    liveLayer.id = 'agy-live-bg-layer';
    liveLayer.setAttribute('aria-hidden', 'true');
    shell.prepend(liveLayer);
  }

  function syncLiveBackdrop(imageUrl, videoUrl, scrim, position) {
    const shell = document.querySelector('.agy-shell');
    if (shell !== liveBackdrop?.shell || videoUrl !== liveBackdrop?.videoUrl || !liveLayer?.isConnected) clearLiveLayer();
    if (imageUrl !== liveBackdrop?.imageUrl || position !== liveBackdrop?.position || !studio.sketchReveal || reducedMotion?.matches) clearSketch();
    if (imageUrl !== liveBackdrop?.imageUrl || videoUrl !== liveBackdrop?.videoUrl || shell !== liveBackdrop?.shell) revealedBackdrop = '';
    liveBackdrop = { shell, imageUrl, videoUrl, position };
    if (!shell || (!videoUrl && (!imageUrl || !studio.sketchReveal || reducedMotion?.matches))) {
      if (liveLayer) clearLiveLayer();
      return;
    }
    mountLiveLayer(shell);
    if (videoUrl) {
      if (!liveVideo) {
        const video = document.createElement('video');
        const tint = document.createElement('span');
        tint.className = 'agy-live-scrim';
        video.id = 'agy-live-bg-video';
        video.crossOrigin = 'anonymous';
        video.muted = video.loop = video.playsInline = true;
        video.preload = 'auto';
        video.onloadeddata = () => {
          liveLayer.dataset.ready = '1';
          if (studio.videoMedia && studio.wallpaperMode === 'video') {
            try {
              liveFrame = captureBackdrop(video, 400)?.toDataURL('image/webp', 0.8);
              if (liveFrame) applyTheme({}, false);
            } catch (_) {} // Poster fallback if a frame cannot be sampled.
          }
          maybeSketch();
        };
        video.onerror = () => { if (liveLayer) delete liveLayer.dataset.ready; maybeSketch(); };
        liveLayer.append(video, tint);
        liveVideo = video;
        video.src = videoUrl;
        syncWallpaperPlayback();
      }
      liveVideo.style.objectPosition = position;
      liveLayer.querySelector('.agy-live-scrim').style.backgroundImage = scrim;
    }
    maybeSketch();
  }

  function captureBackdrop(media, maxSide) {
    const width = media.videoWidth || media.naturalWidth;
    const height = media.videoHeight || media.naturalHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(media, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function showSketch() {
    if (!liveBackdrop?.shell || reducedMotion?.matches || (!liveBackdrop.imageUrl && !liveBackdrop.videoUrl)) return false;
    const { imageUrl, videoUrl, position } = liveBackdrop;
    mountLiveLayer(liveBackdrop.shell);
    clearSketch();
    const request = revealRequest;
    pendingBackdrop = videoUrl || imageUrl;
    try {
      let source = liveVideo;
      if (!source || source.readyState < 2 || source.error) {
        if (!imageUrl) return false;
        source = new Image();
        if (/^https?:/.test(imageUrl)) source.crossOrigin = 'anonymous';
        source.src = imageUrl;
        await source.decode();
      }
      if (request !== revealRequest || !liveLayer?.isConnected) return false;
      const canvas = captureBackdrop(source, 480);
      if (!canvas) return false;
      const { width: w, height: h } = canvas;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, w, h).data;
      const lines = ctx.createImageData(w, h);
      // ponytail: use a bounded RGB edge map; trace vector contours only if line-by-line drawing is needed.
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          let strength = 0;
          for (let c = i; c < i + 3; c++) {
            strength = Math.max(strength, Math.abs(pixels[c - 4] - pixels[c + 4]), Math.abs(pixels[c - w * 4] - pixels[c + w * 4]));
          }
          lines.data[i] = 155;
          lines.data[i + 1] = 213;
          lines.data[i + 2] = 255;
          lines.data[i + 3] = (strength - 13) * 4;
        }
      }
      ctx.putImageData(lines, 0, 0);
      const overlay = document.createElement('span');
      overlay.id = 'agy-sketch-reveal';
      canvas.style.objectPosition = position;
      overlay.appendChild(canvas);
      overlay.addEventListener('animationend', event => {
        if (event.target !== overlay) return;
        overlay.remove();
        if (!liveVideo) clearLiveLayer();
      });
      liveLayer.appendChild(overlay);
      sketchLayer = overlay;
      return true;
    } catch (_) {
      return false;
    } finally {
      if (request === revealRequest) {
        revealedBackdrop = pendingBackdrop;
        pendingBackdrop = '';
      }
    }
  }

  function maybeSketch() {
    const key = liveBackdrop?.videoUrl || liveBackdrop?.imageUrl;
    if (!studio.sketchReveal || bootDialog || (studio.bootIntro && !window.__AGY_BOOT_SEEN__) ||
      (liveVideo && liveVideo.readyState < 2 && !liveVideo.error) || !key || key === revealedBackdrop || key === pendingBackdrop) return;
    void showSketch();
  }

  function stopBootVoice() {
    if (!bootAudio) return;
    const audio = bootAudio;
    bootAudio = null;
    audio.onended = null;
    releaseMedia(audio);
  }

  function closeBoot({ reveal = true, stopVoice = true } = {}) {
    if (stopVoice) stopBootVoice();
    if (!bootDialog) return;
    clearTimeout(bootTimer);
    bootDialog.close();
    bootDialog.remove();
    bootDialog = null;
    if (reveal) maybeSketch();
  }

  function showBoot(replay = false) {
    if (!replay && (!studio.bootIntro || window.__AGY_BOOT_SEEN__ || reducedMotion?.matches)) return;
    closeBoot({ reveal: false });
    window.__AGY_BOOT_SEEN__ = true;
    bootDialog = document.createElement('dialog');
    bootDialog.id = 'agy-boot-hud';
    if (replay) bootDialog.dataset.replay = '1';
    bootDialog.setAttribute('aria-labelledby', 'agy-boot-title');
    const icon = STUDIO_ASSETS['agy-icon-color.png'];
    bootDialog.innerHTML = `<div class="agy-boot-brand">${icon ? `<img src="${icon}" alt="">` : ''}<h2 id="agy-boot-title">Starfield Boot</h2></div><p>Antigravity Theme Studio</p><span class="agy-boot-track" aria-hidden="true"></span><button autofocus type="button">Skip intro</button>`;
    bootDialog.querySelector('button').onclick = () => { playFeedbackSound('click'); closeBoot(); };
    bootDialog.addEventListener('cancel', event => { event.preventDefault(); closeBoot(); });
    document.body.appendChild(bootDialog);
    bootDialog.showModal();
    if (isSoundEnabled() && (replay || navigator.userActivation?.hasBeenActive)) {
      const clip = mediaFileUrl(`assets/voice/tawa_voice${1 + Math.floor(Math.random() * 4)}.mp3`, true);
      if (clip) {
        const audio = new Audio(clip);
        bootAudio = audio;
        audio.volume = 0.6;
        audio.onended = stopBootVoice;
        audio.play().catch(() => {
          if (bootAudio !== audio) return;
          stopBootVoice();
          playFeedbackSound('ping');
        });
      } else playFeedbackSound('ping');
    }
    bootTimer = setTimeout(() => closeBoot({ stopVoice: false }), 1800);
  }

  const GREETING_PATTERN = /^(?:Hey\s+[^,]{1,40},\s+what\s+should\s+we\s+build\s+today\??|Good\s+to\s+see\s+you,[^.]{1,40}\.\s+What'?s\s+next\??|What\s+(?:should|are)\s+we\s+build(?:ing)?\s+today\??|Welcome\s+back(?:[,.!\s]+.{0,75})?|Where\s+should\s+we\s+pick\s+up\??|Ready\s+(?:to\s+build|when\s+you\s+are)\b.{0,50})$/i;

  function restoreGreeting() {
    if (!greeting) return;
    if (greeting.node.nodeValue === greeting.value) greeting.node.nodeValue = greeting.original;
    greeting.element.removeAttribute('data-agy-custom-greeting');
    greeting = null;
  }

  function syncEmptyGreeting() {
    const root = document.querySelector('.agy-shell [data-main-content-body="true"]');
    const pool = studio.customGreetings;
    if (!pool.length || !root || root.querySelector('[data-testid="agent-response"], [data-testid="user-message"], .agy-user-bubble-frame')) {
      restoreGreeting();
      return;
    }
    const key = pool.join('\n');
    if (key === greetingPool && greeting && root.contains(greeting.node) && greeting.node.nodeValue === greeting.value) return;
    restoreGreeting();
    for (const element of root.querySelectorAll('[data-testid="greeting"], h1, h2, h3, p, span, div')) {
      if (element.childNodes.length !== 1 || element.firstChild.nodeType !== 3) continue;
      if (element.closest('button, code, pre, .surface-composer, .settings-modal-container')) continue;
      const node = element.firstChild;
      if (element.dataset.testid !== 'greeting' && !GREETING_PATTERN.test(node.nodeValue.trim())) continue;
      const options = pool.length > 1 ? pool.filter(line => line !== lastGreeting) : pool;
      const value = options[Math.floor(Math.random() * options.length)];
      greeting = { element, node, value, original: node.nodeValue };
      greetingPool = key;
      lastGreeting = value;
      node.nodeValue = value;
      element.setAttribute('data-agy-custom-greeting', '');
      break;
    }
  }

  function stopTaskVoice() {
    const audio = taskAudio;
    taskAudio = null;
    if (audio) {
      audio.onended = audio.onerror = null;
      releaseMedia(audio);
    }
  }

  async function playCompletionSound(stillCurrent) {
    if (!isSoundEnabled()) return;
    if (studio.taskVoiceEnabled && mediaAccess) {
      try {
        const { files } = await mediaRequest();
        if (!stillCurrent() || !isSoundEnabled() || studioScope.signal.aborted) return;
        const voices = files.filter(file => file.kind === 'audio' && !file.bundled);
        const choices = voices.length > 1 ? voices.filter(file => file.id !== lastVoice) : voices;
        const picked = choices[Math.floor(Math.random() * choices.length)] || files.find(file => file.kind === 'audio' && file.bundled);
        if (picked && studio.taskVoiceEnabled) {
          if (!studio.taskVoiceVolume) return;
          stopTaskVoice();
          const audio = new Audio(mediaFileUrl(picked.id, picked.bundled));
          audio.volume = studio.taskVoiceVolume / 100;
          taskAudio = audio;
          audio.onended = audio.onerror = () => { if (taskAudio === audio) stopTaskVoice(); };
          try {
            await audio.play();
            lastVoice = picked.id;
            return;
          } catch (_) { if (taskAudio === audio) stopTaskVoice(); }
        }
      } catch (_) {} // Keep the built-in ping when a local voice is unavailable.
    }
    if (stillCurrent() && !studioScope.signal.aborted) playFeedbackSound('ping');
  }

  window.__AGY_STUDIO_CLEANUP__ = () => {
    studioScope.abort();
    document.getElementById('agy-studio-style')?.remove();
    closeStudio();
    clearLiveLayer();
    closeBoot({ reveal: false });
    restoreGreeting();
    stopTaskVoice();
  };
  reducedMotion?.addEventListener?.('change', () => {
    if (reducedMotion.matches) closeBoot({ reveal: false });
    applyTheme({}, false);
  }, { signal: studioScope.signal });
  document.addEventListener('visibilitychange', syncWallpaperPlayback, { signal: studioScope.signal });

  function syncTitleBarOverlay(stOverride) {
    const st = stOverride || getState();
    const activeTh = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY] || {};
    if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
      try {
        window.electronNative.setTitleBarOverlay({
          color: st.wpEnabled ? '#00000000' : '#111114',
          symbolColor: (st.wpEnabled && activeTh.isLight) ? '#0f172a' : '#f8fafc'
        });
      } catch (e) {}
    }
  }

  function clearTitleBarTimers() {
    if (Array.isArray(window.__AGY_TBO_TIMERS__)) {
      window.__AGY_TBO_TIMERS__.forEach(id => clearTimeout(id));
    }
    window.__AGY_TBO_TIMERS__ = [];
  }

  function scheduleTitleBarSync(stOverride) {
    clearTitleBarTimers();
    const st = stOverride || getState();
    syncTitleBarOverlay(st);
    [300, 900, 2000, 4000, 7000].forEach(ms => {
      window.__AGY_TBO_TIMERS__.push(setTimeout(() => syncTitleBarOverlay(), ms));
    });
  }

  function removeCustomTheme() {
    window.__AGY_STUDIO_CLEANUP__?.();
    window.__AGY_MODAL_OBSERVER__?.disconnect();
    if (window.__AGY_TICK_RAF__) cancelAnimationFrame(window.__AGY_TICK_RAF__);
    window.__AGY_TICK_RAF__ = 0;
    window.__AGY_SHELL_RO__?.disconnect();
    window.__AGY_SHELL_RO__ = null;
    clearTitleBarTimers();
    if (window.__AGY_SCROLL_AC__) {
      try { window.__AGY_SCROLL_AC__.abort(); } catch (e) {}
    }
    const styleEl = document.getElementById('antigravity-custom-theme-active');
    if (styleEl) styleEl.remove();
    const navBtn = document.getElementById('agy-custom-theme-sidebar-btn');
    if (navBtn) navBtn.remove();
    const settingsBtn = document.getElementById('agy-custom-theme-settings-btn');
    if (settingsBtn) settingsBtn.remove();
    const modal = document.getElementById('agy-custom-theme-modal-backdrop');
    if (modal) modal.remove();
    const shell = document.querySelector('.agy-shell');
    if (shell) {
      delete shell.dataset.agyHoleActive;
      shell.style.removeProperty('--agy-hole-clip');
      shell.style.removeProperty('--agy-l-glass-bg');
    }
    if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
      try {
        window.electronNative.setTitleBarOverlay({ color: '#111114', symbolColor: '#f8fafc' });
      } catch (e) {}
    }
  }

  window.__ANTIGRAVITY_APPLY_CUSTOM_THEME__ = applyTheme;
  window.__ANTIGRAVITY_REMOVE_CUSTOM_THEME__ = removeCustomTheme;
  window.__ANTIGRAVITY_OPEN_THEME_MODAL__ = openCustomThemeModal;

  const initialConfig = window.__AGY_INITIAL_CONFIG__ || {};
  if (initialConfig.wallpaperMode === undefined && getState().customWp) studio.wallpaperMode = 'image';
  applyTheme(initialConfig, false);

  function openCustomThemeModal() {
    let backdrop = document.getElementById('agy-custom-theme-modal-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('dialog');
      backdrop.id = 'agy-custom-theme-modal-backdrop';
      backdrop.setAttribute('aria-labelledby', 'agy-theme-modal-title');
      backdrop.style.cssText = `
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        box-sizing: border-box;
        margin: 0;
        border: 0;
        align-items: center;
        justify-content: center;
        padding: clamp(12px, 4vw, 32px);
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(10px);
      `;

      backdrop.innerHTML = `
        <div id="agy-custom-theme-modal-dialog" style="background: rgba(16, 12, 11, 0.97); border: 1.2px solid rgba(212, 148, 106, 0.35); border-radius: 18px; width: 100%; max-width: 900px; height: 86vh; max-height: 860px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.9), 0 0 32px rgba(224, 142, 85, 0.25); font-family: system-ui, -apple-system, sans-serif;">
          <div id="agy-custom-theme-modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 18px 26px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(22, 16, 14, 0.85);">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span id="agy-theme-modal-title" style="font-size: 17px; font-weight: 600; color: #f4f4f5; letter-spacing: -0.2px;">Custom Theme Studio</span>
              <span id="agy-custom-theme-badge" style="font-size: 11.5px; padding: 2.5px 9px; border-radius: 9999px; background: rgba(224, 142, 85, 0.2); color: #e08e55; font-weight: 500; border: 1px solid rgba(224, 142, 85, 0.3);">${THEME_KEYS.length} Preset${THEME_KEYS.length > 1 ? 's' : ''}</span>
            </div>
            <button id="agy-theme-modal-close-btn" type="button" aria-label="Close Theme Studio" autofocus style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #d4d4d8; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; font-size: 15px; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">✕</button>
          </div>
          <div id="agy-theme-modal-body" style="flex: 1; overflow-y: auto; height: 100%;"></div>
        </div>
      `;

      document.body.appendChild(backdrop);

      closeStudio = () => {
        disposeStudioPreview();
        backdrop.close();
        backdrop.style.display = '';
      };
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeStudio();
      });
      backdrop.querySelector('#agy-theme-modal-close-btn').addEventListener('click', closeStudio);
      backdrop.addEventListener('cancel', event => { event.preventDefault(); closeStudio(); });
    }

    if (!backdrop.open) {
      backdrop.style.display = 'flex';
      backdrop.showModal();
    }
    const body = backdrop.querySelector('#agy-theme-modal-body');
    renderThemePanels(body);
  }

  function bindStudioControls(root, wpToggle) {
    root.innerHTML = `
      ${mediaAccess ? `<section aria-label="Wallpaper library">
        <label>Wallpaper source <select id="agy-wallpaper-mode"><option value="preset">Use preset</option><option value="image">Static image</option><option value="video">Video</option></select></label>
        <div id="agy-wallpaper-picker" hidden>
          <div class="agy-studio-row">
            <select id="agy-wallpaper-file" aria-label="Saved wallpapers"></select>
            <button type="button" id="agy-wallpaper-upload">Add wallpaper</button>
            <button type="button" id="agy-wallpaper-use">Use wallpaper</button>
            <button type="button" id="agy-wallpaper-delete">Delete file</button>
          </div>
          <div id="agy-wallpaper-preview"></div>
        </div>
      </section>` : ''}
      <details>
        <summary>Motion and greetings</summary>
        <div class="agy-studio-row"><label><input id="agy-boot-toggle" type="checkbox"> Boot HUD at startup</label><button type="button" id="agy-boot-replay">Replay Boot HUD</button></div>
        <div class="agy-studio-row"><label><input id="agy-sketch-toggle" type="checkbox"> Sketch Reveal on wallpaper changes</label><button type="button" id="agy-sketch-replay">Replay Sketch Reveal</button></div>
        <div class="agy-studio-row"><label for="agy-greetings">Empty chat greetings (one per line; leave blank for the default)</label>
          <textarea id="agy-greetings" rows="3" maxlength="1451"></textarea><button type="button" id="agy-greetings-save">Save greetings</button></div>
      </details>
      ${mediaAccess ? `<details>
        <summary>Task voice</summary>
        <div class="agy-studio-row"><label><input id="agy-task-voice-enable" type="checkbox"> Play a random voice when a task finishes</label>
          <label>Volume <input id="agy-task-voice-volume" type="range" min="0" max="100"></label></div>
        <div class="agy-studio-row"><select id="agy-voice-file" aria-label="Saved voices"></select>
          <button type="button" id="agy-voice-upload">Add voices</button><button type="button" id="agy-voice-delete">Delete file</button></div>
        <div id="agy-voice-preview"></div>
      </details><input type="file" id="agy-media-upload" hidden>` : ''}
      <p id="agy-studio-status" role="status"></p>
    `;
    const get = id => root.querySelector('#agy-' + id);
    const message = text => { get('studio-status').textContent = text; };
    const checkbox = (id, key) => {
      const input = get(id);
      input.checked = studio[key];
      input.onchange = () => applyTheme({ [key]: input.checked });
    };
    checkbox('boot-toggle', 'bootIntro');
    checkbox('sketch-toggle', 'sketchReveal');
    get('boot-replay').onclick = () => showBoot(true);
    get('sketch-replay').onclick = async () => {
      if (await showSketch()) closeStudio();
      else message(reducedMotion?.matches ? 'Sketch Reveal is off while reduced motion is enabled.' : 'Enable a wallpaper with a readable image or video first.');
    };
    get('greetings').value = studio.customGreetings.join('\n');
    get('greetings-save').onclick = () => {
      const lines = get('greetings').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (lines.length > 12 || lines.some(line => line.length > 120)) return message('Use at most 12 greetings, each up to 120 characters.');
      applyTheme({ customGreetings: lines });
      get('greetings').value = studio.customGreetings.join('\n');
      message('Greetings saved.');
    };
    if (!mediaAccess) return () => {};

    checkbox('task-voice-enable', 'taskVoiceEnabled');
    const volume = get('task-voice-volume');
    volume.value = studio.taskVoiceVolume;
    volume.onchange = () => applyTheme({ taskVoiceVolume: Number(volume.value) });

    const mode = get('wallpaper-mode');
    const input = get('media-upload');
    let files = [], busy = false, uploadKind;
    function clearPreview(preview) {
      const player = preview.querySelector('audio, video');
      if (player) { player.onerror = null; releaseMedia(player); }
      preview.replaceChildren();
    }
    const wallpaper = { select: get('wallpaper-file'), preview: get('wallpaper-preview'), remove: get('wallpaper-delete') };
    const voice = { select: get('voice-file'), preview: get('voice-preview'), remove: get('voice-delete') };
    disposeStudioPreview = () => [wallpaper, voice].forEach(({ preview }) => clearPreview(preview));

    function showSelection(panel) {
      clearPreview(panel.preview);
      const item = files.find(file => file.id === panel.select.value);
      panel.remove.disabled = !item || Boolean(item.bundled);
      if (panel === wallpaper) get('wallpaper-use').disabled = !item;
      if (!item || !root.isConnected || !root.getClientRects().length) return;
      const player = document.createElement(item.kind === 'image' ? 'img' : item.kind);
      player.setAttribute('aria-label', item.name);
      if (item.kind === 'image') player.alt = item.name;
      else { player.controls = true; player.preload = 'metadata'; player.playsInline = true; }
      if (item.kind === 'video') player.muted = true;
      player.onerror = () => message('Cannot preview this file. Check its format and codec.');
      player.src = mediaFileUrl(item.id, item.bundled);
      panel.preview.replaceChildren(player);
    }

    function list(panel, kind, selected = '') {
      panel.select.replaceChildren(new Option(`Choose a saved ${kind}`, ''),
        ...files.filter(file => file.kind === kind).map(file => new Option(file.name, file.id)));
      panel.select.value = Array.from(panel.select.options).some(option => option.value === selected) ? selected : '';
      showSelection(panel);
    }
    function refreshWallpaper() {
      const kind = mode.value = studio.wallpaperMode;
      get('wallpaper-picker').hidden = kind === 'preset';
      list(wallpaper, kind, studio[`${kind}Media`]);
    }
    async function updateFiles() { files = (await mediaRequest()).files; }
    async function run(action) {
      if (busy) return;
      busy = true;
      try { await action(); }
      catch (err) { if (!studioScope.signal.aborted) message(err.message); }
      finally { busy = false; }
    }
    void run(async () => { await updateFiles(); refreshWallpaper(); list(voice, 'audio'); });
    refreshWallpaper();
    list(voice, 'audio');
    mode.onchange = () => {
      applyTheme({ wallpaperMode: mode.value, wpEnabled: true });
      wpToggle.checked = true;
      refreshWallpaper();
    };
    for (const panel of [wallpaper, voice]) {
      panel.select.onchange = () => showSelection(panel);
      panel.remove.onclick = () => run(async () => {
        const item = files.find(file => file.id === panel.select.value);
        if (!item || item.bundled || !window.confirm(`Permanently delete "${item.name}" from the local media library?`)) return;
        clearPreview(panel.preview);
        await mediaRequest('/' + encodeURIComponent(item.id), { method: 'DELETE' });
        if (item.kind !== 'audio' && studio[`${item.kind}Media`] === item.id) applyTheme({ [`${item.kind}Media`]: '' }, false);
        await updateFiles();
        if (panel === wallpaper) refreshWallpaper();
        else list(panel, 'audio');
        message('File deleted.');
      });
    }
    voice.preview.closest('details').addEventListener('toggle', event => {
      if (event.target.open) showSelection(voice);
      else clearPreview(voice.preview);
    });
    get('wallpaper-use').onclick = () => {
      const kind = mode.value;
      if (!wallpaper.select.value || kind === 'preset') return;
      applyTheme({ [`${kind}Media`]: wallpaper.select.value, wallpaperMode: kind, wpEnabled: true });
      wpToggle.checked = true;
      message('Wallpaper applied.');
    };
    function chooseFiles(kind) { uploadKind = kind; input.accept = MEDIA_ACCEPT[kind]; input.multiple = kind === 'audio'; input.click(); }
    get('wallpaper-upload').onclick = () => chooseFiles(mode.value);
    get('voice-upload').onclick = () => chooseFiles('audio');
    input.onchange = () => {
      const selected = Array.from(input.files);
      const kind = uploadKind;
      input.value = '';
      if (!selected.length) return;
      void run(async () => {
        if (selected.some(file => file.size > 25 * 1024 * 1024 || !MEDIA_ACCEPT[kind].split(',').some(ext => file.name.toLowerCase().endsWith(ext)))) {
          return message('Choose a supported file up to 25 MB.');
        }
        message('Saving files locally…');
        let item;
        try {
          for (const file of selected) item = await mediaRequest('?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
        } finally {
          await updateFiles();
          if (kind === 'audio') list(voice, kind, item?.id);
          else if (kind === mode.value) list(wallpaper, kind, item?.id);
        }
        message(kind === 'audio' ? 'Voices saved.' : 'Wallpaper saved. Preview it, then choose Use wallpaper.');
      });
    };
    return refreshWallpaper;
  }

  function renderThemePanels(container) {
    disposeStudioPreview();
    const st = getState();
    const mainTheme = THEMES[st.themeName] || THEMES[DEFAULT_THEME_KEY];
    const effUserAv = st.userAvatar === 'none' ? '' : (st.userAvatar || mainTheme.userAvatar || '');
    const effAgentAv = st.agentAvatar === 'none' ? '' : (st.agentAvatar || mainTheme.agentAvatar || '');

    container.innerHTML = `
      <div id="agy-theme-scroll-container" style="padding: 24px clamp(12px, 4vw, 32px) 48px; max-width: 860px; margin: 0 auto; color: #f4f4f5;">
        <div style="border: 1px solid ${mainTheme.borderColor}; background: ${mainTheme.cardBg || 'rgba(22, 16, 14, 0.72)'}; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-size: 14.5px; font-weight: 600; color: #f4f4f5; margin-bottom: 2px;">Wallpaper, Pre-Baked Blur & Config</div>
              <div style="font-size: 12.5px; color: #a1a1aa;">Balance artwork clarity, 120fps pre-baked frosted glass blur, or share config JSON.</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-wp-toggle" type="checkbox" ${st.wpEnabled ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Backdrop
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #d4d4d8; cursor: pointer;">
                <input id="agy-sound-toggle" type="checkbox" ${st.soundEnabled ? 'checked' : ''} style="accent-color: ${mainTheme.primary}; cursor: pointer;" />
                Sound Effects
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa;">
                Dim
                <input id="agy-dim-slider" type="range" min="15" max="92" value="${st.dimming}" style="width: 96px; cursor: pointer; accent-color: #ffffff; height: 5px;" />
                <span id="agy-dim-val" style="min-width: 32px; text-align: right;">${st.dimming}%</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa;">
                Blur
                <input id="agy-blur-slider" type="range" min="0" max="24" value="${st.glassBlur}" style="width: 78px; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
                <span id="agy-blur-val" style="min-width: 30px; text-align: right;">${st.glassBlur}px</span>
              </label>
              ${!mediaAccess ? `<label style="padding: 5px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Custom Image
                <input id="agy-wp-upload" type="file" accept="image/*" style="display: none;" />
              </label>` : ''}
              <button id="agy-export-btn" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Export JSON
              </button>
              <button id="agy-import-toggle" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Import JSON
              </button>
              <button id="agy-reset-btn" type="button" style="padding: 5px 10px; border-radius: 8px; background: rgba(239, 68, 68, 0.14); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                Reset
              </button>
            </div>
          </div>
          <div id="agy-import-box" style="display: none; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
            <textarea id="agy-import-text" rows="3" placeholder='Paste exported theme config JSON here (e.g. {"themeName":"WLOP Cosmic","dimming":45,...})' style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.35); color: #f4f4f5; border: 1px solid ${mainTheme.borderColor}; border-radius: 8px; padding: 8px 10px; font-family: monospace; font-size: 12px; resize: vertical;"></textarea>
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px;">
              <span id="agy-import-msg" style="font-size: 12px; color: #fca5a5;"></span>
              <button id="agy-import-apply" type="button" style="padding: 5px 12px; border-radius: 7px; background: ${mainTheme.primary}; color: #090d16; font-weight: 600; font-size: 12px; border: none; cursor: pointer;">Apply JSON</button>
            </div>
          </div>
          <div class="agy-studio-controls"></div>
        </div>

        <div style="border: 1px solid ${mainTheme.borderColor}; background: ${mainTheme.cardBg || 'rgba(22, 16, 14, 0.72)'}; border-radius: 12px; padding: 14px 20px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f4f4f5; margin-bottom: 2px;">Chat Avatars (User & AI Agent)</div>
              <div style="font-size: 12px; color: #a1a1aa;">Profile badges rendered beside chat messages (auto-compressed WebP).</div>
            </div>
            <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div id="agy-user-av-preview" style="width: 30px; height: 30px; border-radius: ${st.avatarRadius}%; border: 1.5px solid ${mainTheme.primary}; background: rgba(255,255,255,0.06) ${effUserAv ? `url('${effUserAv}') center/cover no-repeat` : ''}; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #a1a1aa;">${effUserAv ? '' : 'U'}</div>
                <label style="padding: 4px 10px; border-radius: 7px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                  User
                  <input id="agy-user-av-upload" type="file" accept="image/*" style="display: none;" />
                </label>
                <button id="agy-user-av-clear" type="button" style="padding: 4px 8px; border-radius: 7px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.14); color: #a1a1aa; font-size: 11.5px; cursor: pointer;">Off</button>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div id="agy-agent-av-preview" style="width: 30px; height: 30px; border-radius: ${st.avatarRadius}%; border: 1.5px solid ${mainTheme.secondary || mainTheme.primary}; background: rgba(255,255,255,0.06) ${effAgentAv ? `url('${effAgentAv}') center/cover no-repeat` : ''}; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #a1a1aa;">${effAgentAv ? '' : 'AI'}</div>
                <label style="padding: 4px 10px; border-radius: 7px; background: rgba(255, 255, 255, 0.08); border: 1px solid ${mainTheme.borderColor}; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap;">
                  Agent
                  <input id="agy-agent-av-upload" type="file" accept="image/*" style="display: none;" />
                </label>
                <button id="agy-agent-av-clear" type="button" style="padding: 4px 8px; border-radius: 7px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.14); color: #a1a1aa; font-size: 11.5px; cursor: pointer;">Off</button>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.07);">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa;">
              Size
              <input id="agy-av-size" type="range" min="22" max="52" value="${st.avatarSize}" style="width: 100px; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
              <span id="agy-av-size-val" style="min-width: 34px;">${st.avatarSize}px</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa;">
              Corner Radius
              <input id="agy-av-rad" type="range" min="0" max="50" value="${st.avatarRadius}" style="width: 100px; cursor: pointer; accent-color: ${mainTheme.primary}; height: 5px;" />
              <span id="agy-av-rad-val" style="min-width: 34px;">${st.avatarRadius}%</span>
            </label>
          </div>
        </div>

        <div style="margin-bottom: 28px;">
          <div style="font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">User Chat Bubble</div>
          <div style="font-size: 12.5px; color: #a1a1aa; margin-bottom: 14px;">Mix and match bubble frame & ornament independently from the active wallpaper.</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            ${THEME_KEYS.map(name => {
              const th = THEMES[name];
              const isSelected = name === st.bubbleName;
              const stickerTop = th.isOrnament ? Math.round((th.stickerTop || 0) * 0.85) : Math.round((th.stickerTop || 0) * 0.74);
              const stickerW = Math.round((th.stickerW || 0) * 0.78);
              const stickerH = th.isOrnament ? Math.round((th.stickerH || 0) * 0.8) : Math.round((th.stickerH || 0) * 0.78);
              const radius = th.bubbleRadius ?? (th.isScroll ? 6 : 12);
              return `
                <div class="agy-bubble-card" data-name="${name}" style="position: relative; border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: ${isSelected ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)'}; padding: 24px 18px 14px 18px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; min-height: 112px; transition: border-color 0.15s ease, background-color 0.15s ease;">
                  <div style="display: flex; justify-content: center; align-items: center; width: 100%; margin-top: 6px; margin-bottom: 10px;">
                     <div style="position: relative; width: 192px; height: 46px; padding: 1.2px; border-radius: ${radius}px; background: ${th.frameBg}; box-shadow: 0 4px 14px rgba(0,0,0,0.45), 0 0 10px ${th.glow};">
                       <div style="position: relative; width: 100%; height: 100%; background: ${th.bg}; border: ${th.innerBorder || '1px solid ' + th.borderColor}; border-radius: ${radius - 1}px; display: flex; align-items: center; padding: 0 16px;">
                        ${th.sticker ? `<div style="position: absolute; top: ${stickerTop}px; right: 8px; width: ${stickerW}px; height: ${stickerH}px; background-image: url('${th.sticker}'); background-size: contain; background-position: ${th.isOrnament ? 'center' : 'bottom center'}; background-repeat: no-repeat; pointer-events: none;"></div>` : ''}
                        <span style="font-size: 13.5px; font-weight: 500; color: ${th.textColor};">Hello ✨</span>
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 13.5px; font-weight: 500; color: #e4e4e7;">${name}</span>
                    <div class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-bottom: 28px;">
          <div style="font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">Composer Style</div>
          <div style="font-size: 12.5px; color: #a1a1aa; margin-bottom: 14px;">Customize the chat input frame without affecting keyboard shortcuts or attachments.</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            ${Object.entries(INPUT_STYLES).map(([key, item]) => {
              const isSelected = key === st.inputStyle;
              const activeBubbleTh = THEMES[st.bubbleName] || mainTheme;
              const inputTheme = composerPreset(mainTheme, activeBubbleTh);
              const input = composerLook(inputTheme, key);
              const previewStickerStyle = activeBubbleTh.isOrnament
                ? 'top: -12px; right: 10px; width: 72px; height: 22px; background-position: center;'
                : 'top: -22px; right: 10px; width: 32px; height: 28px; background-position: bottom center;';
              return `
                <div class="agy-input-card" data-style="${key}" style="border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: ${isSelected ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)'}; padding: 16px 18px; cursor: pointer; display: flex; flex-direction: column; gap: 12px; transition: border-color 0.15s ease, background-color 0.15s ease;">
                   <div class="agy-input-preview-outer" style="position: relative; margin-top: 8px; padding: 1.5px; border-radius: ${input.radius}px; background: ${input.frame};">
                    <div class="agy-input-preview-sticker" style="position: absolute; ${previewStickerStyle} background-image: url('${activeBubbleTh.sticker || ''}'); background-size: contain; background-repeat: no-repeat; display: ${key !== 'minimal' && activeBubbleTh.sticker ? 'block' : 'none'}; pointer-events: none;"></div>
                     <div class="agy-input-preview-inner" style="background: ${input.preview}; border-radius: ${input.radius - 1.5}px; padding: 8px 12px; font-size: 12px; color: ${input.ink}; display: flex; justify-content: space-between; align-items: center;">
                      <span>Ask anything, @ to mention...</span>
                       <span class="agy-input-preview-turbo" style="color: ${input.accent}; font-size: 11px;">Send →</span>
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <div style="font-size: 13.5px; font-weight: 500; color: #e4e4e7;">${item.label}</div>
                      <div style="font-size: 11.5px; color: #a1a1aa;">${item.desc}</div>
                    </div>
                    <div class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div>
          <div style="font-size: 15px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">Theme Presets (${THEME_KEYS.length})</div>
          <div style="font-size: 12.5px; color: #a1a1aa; margin-bottom: 14px;">Complete backdrop, palette, unified L-glass, and matching ornaments.</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            ${THEME_KEYS.map(name => {
              const th = THEMES[name];
              const isSelected = name === st.themeName;
              const thumbBg = th.wallpaper
                ? `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(14,12,12,0.85)), url('${th.wallpaper}')`
                : (th.pureBg || th.bg);
              const thumbOrnamentStyle = th.isOrnament
                ? 'right: 10px; bottom: 8px; width: 76px; height: 24px; background-position: center;'
                : 'right: 12px; bottom: 4px; width: 42px; height: 38px; background-position: bottom center;';
              return `
                <button type="button" class="agy-preset-card" data-name="${name}" aria-pressed="${isSelected}" style="padding:0; text-align:left; border-radius: 12px; border: ${isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)'}; background: rgba(14, 12, 12, 0.82); overflow: hidden; cursor: pointer; display: flex; flex-direction: column; transition: border-color 0.15s ease;">
                  <span style="height: 68px; width: 100%; background-image: ${thumbBg}; background-size: cover; background-position: ${th.bgPosition || 'center'}; position: relative; display: flex; align-items: flex-end; padding: 8px 14px; box-sizing:border-box;">
                    ${th.sticker ? `<span style="position: absolute; ${thumbOrnamentStyle} background-image: url('${th.sticker}'); background-size: contain; background-repeat: no-repeat; pointer-events: none;"></span>` : ''}
                    <span style="font-size: 13.5px; font-weight: 600; color: #fff;">${name}</span>
                  </span>
                  <span style="padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; width:100%; box-sizing:border-box;">
                    <span style="font-size: 12px; color: #a1a1aa;">${th.concept || ''}</span>
                    <span class="agy-card-check-slot">${isSelected ? CHECK_SVG : ''}</span>
                  </span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    function updateInputPreviews(bName) {
      const activeTh = THEMES[bName] || THEMES[DEFAULT_THEME_KEY];
      const state = getState();
      const inputTheme = composerPreset(THEMES[state.themeName] || activeTh, activeTh);
      container.querySelectorAll('.agy-input-card').forEach(card => {
        const key = card.dataset.style;
        const input = composerLook(inputTheme, key);
        const isSelected = key === state.inputStyle;
        card.style.border = isSelected ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
        card.style.background = isSelected ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
        const slot = card.querySelector('.agy-card-check-slot');
        if (slot) slot.innerHTML = isSelected ? CHECK_SVG : '';
        const outer = card.querySelector('.agy-input-preview-outer');
        if (outer) {
          outer.style.background = input.frame;
          outer.style.borderRadius = `${input.radius}px`;
        }
        const inner = card.querySelector('.agy-input-preview-inner');
        if (inner) {
          inner.style.background = input.preview;
          inner.style.borderRadius = `${input.radius - 1.5}px`;
          inner.style.color = input.ink;
        }
        const sticker = card.querySelector('.agy-input-preview-sticker');
        if (sticker) {
          if (key !== 'minimal' && activeTh.sticker) {
            sticker.style.display = 'block';
            sticker.style.backgroundImage = `url('${activeTh.sticker}')`;
            if (activeTh.isOrnament) {
              sticker.style.top = '-12px';
              sticker.style.width = '72px';
              sticker.style.height = '22px';
              sticker.style.backgroundPosition = 'center';
            } else {
              sticker.style.top = '-22px';
              sticker.style.width = '32px';
              sticker.style.height = '28px';
              sticker.style.backgroundPosition = 'bottom center';
            }
          } else {
            sticker.style.display = 'none';
          }
        }
        const turbo = card.querySelector('.agy-input-preview-turbo');
        if (turbo) {
          turbo.style.color = input.accent;
        }
      });
    }

    const slider = container.querySelector('#agy-dim-slider');
    const valLabel = container.querySelector('#agy-dim-val');
    slider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      valLabel.textContent = v + '%';
      applyTheme({ dimming: v });
    });

    const wpToggle = container.querySelector('#agy-wp-toggle');
    const refreshWallpaperControls = bindStudioControls(container.querySelector('.agy-studio-controls'), wpToggle);
    wpToggle.addEventListener('change', (e) => {
      applyTheme({ wpEnabled: e.target.checked });
    });

    const wpUpload = container.querySelector('#agy-wp-upload');
    wpUpload?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        applyTheme({ customWp: reader.result, wallpaperMode: 'image', wpEnabled: true });
        const toggle = container.querySelector('#agy-wp-toggle');
        if (toggle) toggle.checked = true;
      };
      reader.readAsDataURL(file);
    });

    const userAvUpload = container.querySelector('#agy-user-av-upload');
    const userAvPreview = container.querySelector('#agy-user-av-preview');
    const userAvClear = container.querySelector('#agy-user-av-clear');
    const agentAvUpload = container.querySelector('#agy-agent-av-upload');
    const agentAvPreview = container.querySelector('#agy-agent-av-preview');
    const agentAvClear = container.querySelector('#agy-agent-av-clear');

    function syncAvPreview(el, url, fallbackText) {
      if (!el) return;
      if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = 'none';
        el.textContent = fallbackText;
      }
    }

    if (userAvUpload) {
      userAvUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        compressAvatarFile(file, (dataUrl) => {
          applyTheme({ userAvatar: dataUrl });
          syncAvPreview(userAvPreview, dataUrl, 'U');
        });
      });
    }
    if (userAvClear) {
      userAvClear.addEventListener('click', () => {
        applyTheme({ userAvatar: 'none' });
        syncAvPreview(userAvPreview, '', 'U');
      });
    }
    if (agentAvUpload) {
      agentAvUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        compressAvatarFile(file, (dataUrl) => {
          applyTheme({ agentAvatar: dataUrl });
          syncAvPreview(agentAvPreview, dataUrl, 'AI');
        });
      });
    }
    if (agentAvClear) {
      agentAvClear.addEventListener('click', () => {
        applyTheme({ agentAvatar: 'none' });
        syncAvPreview(agentAvPreview, '', 'AI');
      });
    }

    const blurSlider = container.querySelector('#agy-blur-slider');
    const blurLabel = container.querySelector('#agy-blur-val');
    if (blurSlider) {
      blurSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (blurLabel) blurLabel.textContent = v + 'px';
        applyTheme({ glassBlur: v });
      });
    }

    const avSizeSlider = container.querySelector('#agy-av-size');
    const avSizeVal = container.querySelector('#agy-av-size-val');
    if (avSizeSlider) {
      avSizeSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (avSizeVal) avSizeVal.textContent = v + 'px';
        applyTheme({ avatarSize: v });
      });
    }

    const avRadSlider = container.querySelector('#agy-av-rad');
    const avRadVal = container.querySelector('#agy-av-rad-val');
    if (avRadSlider) {
      avRadSlider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (avRadVal) avRadVal.textContent = v + '%';
        if (userAvPreview) userAvPreview.style.borderRadius = v + '%';
        if (agentAvPreview) agentAvPreview.style.borderRadius = v + '%';
        applyTheme({ avatarRadius: v });
      });
    }

    const exportBtn = container.querySelector('#agy-export-btn');
    const importToggle = container.querySelector('#agy-import-toggle');
    const importBox = container.querySelector('#agy-import-box');
    const importText = container.querySelector('#agy-import-text');
    const importApply = container.querySelector('#agy-import-apply');
    const importMsg = container.querySelector('#agy-import-msg');

    const soundToggle = container.querySelector('#agy-sound-toggle');
    if (soundToggle) {
      soundToggle.addEventListener('change', (e) => {
        const checked = e.target.checked;
        applyTheme({ soundEnabled: checked });
        if (checked) {
          playFeedbackSound('click');
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        playFeedbackSound('click');
        const json = JSON.stringify(getState(), null, 2);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(json).then(() => {
            exportBtn.textContent = 'Copied ✓';
            setTimeout(() => { exportBtn.textContent = 'Export JSON'; }, 1500);
          }).catch(() => {
            if (importBox && importText) {
              importBox.style.display = 'flex';
              importText.value = json;
              importText.select();
            }
          });
        } else if (importBox && importText) {
          importBox.style.display = 'flex';
          importText.value = json;
          importText.select();
        }
      });
    }
    if (importToggle && importBox) {
      importToggle.addEventListener('click', () => {
        playFeedbackSound('click');
        importBox.style.display = importBox.style.display === 'none' ? 'flex' : 'none';
        if (importMsg) importMsg.textContent = '';
      });
    }
    if (importApply && importText) {
      importApply.addEventListener('click', () => {
        try {
          const parsed = JSON.parse(importText.value.trim());
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Config must be a JSON object');
          }
          const allowed = {};
          const keys = Object.keys(getState());
          keys.forEach((k) => {
            if (parsed[k] !== undefined) allowed[k] = parsed[k];
          });
          applyTheme(allowed);
          playFeedbackSound('click');
          renderThemePanels(container);
        } catch (err) {
          if (importMsg) importMsg.textContent = 'Invalid JSON: ' + err.message;
        }
      });
    }

    const resetBtn = container.querySelector('#agy-reset-btn');
    resetBtn.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_CUSTOM_WP);
      localStorage.removeItem(STORAGE_USER_AVATAR);
      localStorage.removeItem(STORAGE_AGENT_AVATAR);
      localStorage.removeItem(STORAGE_GLASS_BLUR);
      localStorage.removeItem(STORAGE_AVATAR_SIZE);
      localStorage.removeItem(STORAGE_AVATAR_RADIUS);
      localStorage.removeItem(STORAGE_THEME);
      localStorage.removeItem(STORAGE_BUBBLE);
      localStorage.removeItem(STORAGE_INPUT);
      localStorage.removeItem(STORAGE_DIMMING);
      localStorage.removeItem(STORAGE_WP_ENABLED);
      localStorage.removeItem(STORAGE_SOUND_ENABLED);
      localStorage.removeItem(STORAGE_FONT_FAMILY);
      localStorage.removeItem(STORAGE_CODE_FONT_FAMILY);
      applyTheme({
        themeName: DEFAULT_THEME_KEY,
        bubbleName: DEFAULT_THEME_KEY,
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
        ...STUDIO_DEFAULTS
      });
      playFeedbackSound('click');
      renderThemePanels(container);
      container.querySelector('#agy-reset-btn').focus();
    });

    container.querySelectorAll('.agy-preset-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.name;
        const inputStyle = THEMES[name].inputStyle;
        applyTheme({ themeName: name, bubbleName: name, customWp: '', wallpaperMode: 'preset', wpEnabled: true,
          inputStyle: Object.hasOwn(INPUT_STYLES, inputStyle) ? inputStyle : getState().inputStyle });
        wpToggle.checked = true;
        refreshWallpaperControls();
        playFeedbackSound('click');

        container.querySelectorAll('.agy-preset-card').forEach(c => {
          const isSel = c.dataset.name === name;
          c.setAttribute('aria-pressed', String(isSel));
          c.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
          const slot = c.querySelector('.agy-card-check-slot');
          if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
        });

        container.querySelectorAll('.agy-bubble-card').forEach(b => {
          const isSel = b.dataset.name === name;
          b.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
          b.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
          const slot = b.querySelector('.agy-card-check-slot');
          if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
        });

        updateInputPreviews(name);
      });
    });

    container.querySelectorAll('.agy-bubble-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.name;
        applyTheme({ bubbleName: name });
        playFeedbackSound('click');

        container.querySelectorAll('.agy-bubble-card').forEach(b => {
          const isSel = b.dataset.name === name;
          b.style.border = isSel ? '1.5px solid #f4f4f5' : '1px solid rgba(255, 255, 255, 0.12)';
          b.style.background = isSel ? 'rgba(42, 34, 30, 0.68)' : 'rgba(14, 12, 12, 0.78)';
          const slot = b.querySelector('.agy-card-check-slot');
          if (slot) slot.innerHTML = isSel ? CHECK_SVG : '';
        });

        updateInputPreviews(name);
      });
    });

    container.querySelectorAll('.agy-input-card').forEach(card => {
      card.addEventListener('click', () => {
        const styleKey = card.dataset.style;
        applyTheme({ inputStyle: styleKey });
        playFeedbackSound('click');

        updateInputPreviews(getState().bubbleName);
      });
    });
  }

  function injectMainSidebarButton() {
    if (document.getElementById('agy-custom-theme-sidebar-btn')) return;

    const rows = document.querySelectorAll('.agy-shell .bg-sidebar :is(a, button, [role="button"])');
    const row = Array.from(rows).find(el => el.textContent.trim() === 'Customizations' && el.getClientRects().length);
    if (!row || !row.parentNode) return;

    const btn = document.createElement('button');
    btn.id = 'agy-custom-theme-sidebar-btn';
    btn.type = 'button';
    btn.className = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer select-none';
    btn.style.cssText = 'text-align: left;';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Custom theme</span>
    `;

    row.parentNode.insertBefore(btn, row.nextSibling);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.__ANTIGRAVITY_OPEN_THEME_MODAL__();
    });
  }

  function injectSettingsModalButton() {
    const modal = document.querySelector('.settings-modal-container');
    if (!modal || document.getElementById('agy-custom-theme-settings-btn')) return;

    const headers = Array.from(modal.querySelectorAll('h2, h3'));
    const appearanceHeader = headers.find(h => h.textContent?.trim() === 'Appearance');
    if (!appearanceHeader) return;

    let targetContainer = appearanceHeader.parentElement;
    while (targetContainer && !targetContainer.className.includes('justify-between') && targetContainer !== modal) {
      targetContainer = targetContainer.parentElement;
    }

    if (!targetContainer || !targetContainer.parentNode) return;

    Array.from(targetContainer.parentNode.children).forEach(child => {
      if (child.id === 'agy-custom-theme-settings-btn') child.remove();
    });

    const btn = document.createElement('button');
    btn.id = 'agy-custom-theme-settings-btn';
    btn.type = 'button';
    btn.className = 'select-none rounded px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer text-white';
    btn.style.cssText = 'background: linear-gradient(135deg, #e08e55 0%, #b45309 100%); border: 1px solid rgba(251, 191, 36, 0.4); box-shadow: 0 2px 10px rgba(224, 142, 85, 0.3); margin-top: 8px; margin-bottom: 8px; display: inline-flex; align-items: center; gap: 6px;';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
      <span>Open Custom Theme Studio</span>
    `;

    targetContainer.parentNode.insertBefore(btn, targetContainer.nextSibling);

    btn.addEventListener('click', () => {
      window.__ANTIGRAVITY_OPEN_THEME_MODAL__();
    });
  }

  function hookSidebarScroll() {
    if (!window.__AGY_SCROLL_AC__) return;
    const scrollers = document.querySelectorAll('.agy-shell .bg-sidebar .overflow-y-auto');
    scrollers.forEach(sc => {
      if (sc.dataset.agyScrollBound) return;
      sc.dataset.agyScrollBound = '1';
      const sync = () => sc.classList.toggle('agy-scrolled', sc.scrollTop > 2);
      sync();
      sc.addEventListener('scroll', sync, { passive: true, signal: window.__AGY_SCROLL_AC__.signal });
    });
  }

  function syncShellMetrics() {
    const shell = document.querySelector('.agy-shell');
    if (!shell) return;
    const split = shell.querySelector('[data-testid="sidebar-split"]');
    const sidebarPane = split ? split.firstElementChild : null;
    const titleBar = shell.querySelector('[class*="@container/titlebar"]');
    const sw = sidebarPane ? Math.round(sidebarPane.getBoundingClientRect().width) : 0;
    const shellRect = shell.getBoundingClientRect();
    const hdrBottom = titleBar ? Math.round(titleBar.getBoundingClientRect().bottom - shellRect.top) : 35;
    shell.style.setProperty('--agy-sidebar-w', sw + 'px');
    shell.style.setProperty('--agy-hdr-h', hdrBottom + 'px');

    const hasHoleAttr = document.body.getAttribute('data-has-browser-hole') === 'true';
    const holeEl = hasHoleAttr ? shell.querySelector('[data-browser-hole]:not([data-browser-hole="false"])') : null;
    if (holeEl) {
      if (window.__AGY_SHELL_RO__ && window.__AGY_HOLE_EL__ !== holeEl) {
        try { window.__AGY_SHELL_RO__.observe(holeEl); } catch (e) {}
        window.__AGY_HOLE_EL__ = holeEl;
      }
      const hRect = holeEl.getBoundingClientRect();
      if (hRect.width > 1 && hRect.height > 1) {
        const l = Math.max(0, Math.round(hRect.left - shellRect.left));
        const t = Math.max(0, Math.round(hRect.top - shellRect.top));
        const r = Math.max(l, Math.round(hRect.right - shellRect.left));
        const b = Math.max(t, Math.round(hRect.bottom - shellRect.top));
        shell.style.setProperty(
          '--agy-hole-clip',
          `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`
        );
        shell.dataset.agyHoleActive = '1';
        delete shell.dataset.agySideGlass;
        return;
      }
    }
    window.__AGY_HOLE_EL__ = null;
    delete shell.dataset.agyHoleActive;
    shell.style.removeProperty('--agy-hole-clip');

    const sideBody = shell.querySelector('[data-side-panel-body="true"]');
    if (sideBody) {
      if (window.__AGY_SHELL_RO__ && window.__AGY_SIDE_EL__ !== sideBody) {
        try { window.__AGY_SHELL_RO__.observe(sideBody); } catch (e) {}
        window.__AGY_SIDE_EL__ = sideBody;
      }
      const sRect = sideBody.getBoundingClientRect();
      const hasContent = sideBody.children.length > 0;
      if (hasContent && sRect.width > 24 && sRect.height > 24 && sRect.left < shellRect.right - 8 && sRect.right > shellRect.left + 8) {
        const sl = Math.max(sw, Math.round(sRect.left - shellRect.left));
        const st = Math.max(hdrBottom, Math.round(sRect.top - shellRect.top));
        const sr = Math.min(Math.round(shellRect.width), Math.max(sl, Math.round(sRect.right - shellRect.left)));
        const sb = Math.min(Math.round(shellRect.height), Math.max(st, Math.round(sRect.bottom - shellRect.top)));
        if (sr - sl > 20 && sb - st > 20) {
          shell.style.setProperty('--agy-side-l', sl + 'px');
          shell.style.setProperty('--agy-side-t', st + 'px');
          shell.style.setProperty('--agy-side-r', sr + 'px');
          shell.style.setProperty('--agy-side-b', sb + 'px');
          shell.dataset.agySideGlass = '1';
          return;
        }
      }
    }
    delete shell.dataset.agySideGlass;
  }

  function hookShellMetrics() {
    const shell = document.querySelector('.agy-shell');
    if (!shell) return;
    if (!shell.dataset.agyTboMounted) {
      shell.dataset.agyTboMounted = '1';
      scheduleTitleBarSync();
    }
    if (!window.__AGY_SHELL_RO__ && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(syncShellMetrics);
      ro.observe(shell);
      const sidebarPane = shell.querySelector('[data-testid="sidebar-split"]')?.firstElementChild;
      if (sidebarPane) ro.observe(sidebarPane);
      window.__AGY_SHELL_RO__ = ro;
    }
    syncShellMetrics();
  }

  let isGeneratingAssistant = false;
  let userAbortedGeneration = false;
  let taskTurn = 0, completionTimer;
  let lastTaskUrl = window.location?.href;
  const stopSelector = '[data-testid="input-cancel-button"], [data-testid="stop-button"], button[aria-label="Stop generating"], button[title="Stop generating"], .stop-button';
  document.addEventListener('click', event => {
    if (event.target.closest?.(stopSelector)) userAbortedGeneration = true;
  }, { capture: true, signal: studioScope.signal });
  studioScope.signal.addEventListener('abort', () => clearTimeout(completionTimer), { once: true });

  function monitorAssistantCompletion() {
    const url = window.location?.href;
    if (url !== lastTaskUrl) {
      lastTaskUrl = url;
      isGeneratingAssistant = false;
      taskTurn++;
      clearTimeout(completionTimer);
      stopTaskVoice();
    }
    const stopBtn = document.querySelector(stopSelector);
    if (stopBtn) {
      if (!isGeneratingAssistant) {
        isGeneratingAssistant = true;
        userAbortedGeneration = false;
        taskTurn++;
        clearTimeout(completionTimer);
        stopTaskVoice();
      }
    } else if (isGeneratingAssistant) {
      isGeneratingAssistant = false;
      const turn = taskTurn;
      const current = () => turn === taskTurn && window.location?.href === url && !document.querySelector(stopSelector);
      if (userAbortedGeneration) return;
      completionTimer = setTimeout(() => {
        const responses = document.querySelectorAll('[data-testid="agent-response"]');
        if (current() && responses[responses.length - 1]?.textContent.trim()) void playCompletionSound(current);
      }, 450);
    }
  }

  function tick() {
    const shell = document.querySelector('.agy-shell');
    if (shell !== liveBackdrop?.shell || (liveVideo && !liveLayer?.isConnected)) applyTheme({}, false);
    if (shell && !window.__AGY_BOOT_SEEN__) {
      showBoot();
      window.__AGY_BOOT_SEEN__ = true;
      maybeSketch();
    }
    syncEmptyGreeting();
    injectMainSidebarButton();
    injectSettingsModalButton();
    hookSidebarScroll();
    hookShellMetrics();
    monitorAssistantCompletion();
  }

  function scheduleTick() {
    if (window.__AGY_TICK_RAF__) return;
    window.__AGY_TICK_RAF__ = requestAnimationFrame(() => {
      window.__AGY_TICK_RAF__ = 0;
      tick();
    });
  }

  clearTitleBarTimers();
  if (window.__AGY_TICK_RAF__) {
    cancelAnimationFrame(window.__AGY_TICK_RAF__);
    window.__AGY_TICK_RAF__ = 0;
  }
  if (window.__AGY_SHELL_RO__) {
    try { window.__AGY_SHELL_RO__.disconnect(); } catch (e) {}
    window.__AGY_SHELL_RO__ = null;
  }
  if (window.__AGY_SCROLL_AC__) {
    try { window.__AGY_SCROLL_AC__.abort(); } catch (e) {}
  }
  window.__AGY_SCROLL_AC__ = new AbortController();
  window.addEventListener('load', () => scheduleTitleBarSync(), { signal: window.__AGY_SCROLL_AC__.signal });
  window.addEventListener('focus', () => syncTitleBarOverlay(), { signal: window.__AGY_SCROLL_AC__.signal });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncTitleBarOverlay();
  }, { signal: window.__AGY_SCROLL_AC__.signal });
  document.querySelectorAll('[data-agy-scroll-bound]').forEach(el => delete el.dataset.agyScrollBound);
  document.querySelectorAll('[data-agy-tbo-mounted]').forEach(el => delete el.dataset.agyTboMounted);
  const staleBackdrop = document.getElementById('agy-custom-theme-modal-backdrop');
  if (staleBackdrop) staleBackdrop.remove();
  const staleSidebarBtn = document.getElementById('agy-custom-theme-sidebar-btn');
  if (staleSidebarBtn) staleSidebarBtn.remove();
  const staleSettingsBtn = document.getElementById('agy-custom-theme-settings-btn');
  if (staleSettingsBtn) staleSettingsBtn.remove();

  window.__AGY_HOLE_EL__ = null;
  if (window.__AGY_MODAL_OBSERVER__) {
    window.__AGY_MODAL_OBSERVER__.disconnect();
  }
  window.__AGY_MODAL_OBSERVER__ = new MutationObserver(scheduleTick);
  window.__AGY_MODAL_OBSERVER__.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-has-browser-hole', 'data-browser-hole']
  });
  tick();

  return 'Antigravity Custom Theme Engine Ready!';
})();
