// ============================================================
//  FM 42.9 — SillyTavern Extension
//  Vintage Radio: YouTube BG Audio + RP Saeyon Generator
//  Profile switching via /profile slash command (gotcha pattern)
// ============================================================

import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'fm429';

const defaultSettings = {
    enabled: true,
    volume: 70,
    saeyon_interval: '5',
    custom_interval: 10,
    saeyon_cards: [],
    message_counter: 0,
    last_url: '',
    apiProfile: '',
    position: 'left',   // 'left' | 'right'
    language: 'ko',     // 'ko' | 'en'
};

let isPlaying = false;
let currentVideoId = null;
let panelOpen = false;
let cardIndex = 0;

// ── i18n ──────────────────────────────────────────────────────
const I18N = {
    ko: {
        standby:        'STANDBY · FM 42.9',
        onair:          'ON AIR',
        urlPlaceholder: 'youtu.be/... 또는 youtube.com/watch?v=...',
        urlLabel:       'YOUTUBE URL',
        play:           'PLAY',
        stop:           '■ STOP',
        playingText:    '앱에서 재생 중',
        urlHint:        '유튜브 앱으로 열립니다',
        mailLabel:      '수신된 사연',
        mailUnit:       '건',
        emptyMsg:       '📡 아직 수신된 사연이 없어요.<br>채팅을 계속하면 사연이 도착합니다.',
        saeyonLabel:    '사연',
        deleteBtn:      '삭제',
        deleteConfirm:  '이 사연을 삭제할까요?',
        clearAll:       '전체 삭제',
        clearConfirm:   '사연을 모두 삭제할까요?',
        settingsTitle:  'FM 42.9 활성화',
        posLabel:       '패널 위치',
        posLeft:        '◧ 좌측 상단',
        posRight:       '◨ 우측 상단',
        profileLabel:   '사연 생성 연결 프로필',
        profileDefault: '메인 프로필 사용 (기본)',
        profileHint:    '별도 프로필을 지정하면 사연 생성 시 해당 프로필로 일시 전환 후<br>자동으로 원래 프로필로 복귀합니다.<br>지정하지 않으면 현재 메인 프로필을 그대로 사용합니다.',
        langLabel:      '사연 언어',
        badUrl:         '올바른 YouTube URL을 입력해주세요.',
    },
    en: {
        standby:        'STANDBY · FM 42.9',
        onair:          'ON AIR',
        urlPlaceholder: 'youtu.be/... or youtube.com/watch?v=...',
        urlLabel:       'YOUTUBE URL',
        play:           'PLAY',
        stop:           '■ STOP',
        playingText:    'Playing in app',
        urlHint:        'Opens in YouTube app',
        mailLabel:      'MAIL',
        mailUnit:       '',
        emptyMsg:       '📡 No letters received yet.<br>Keep chatting and one will arrive.',
        saeyonLabel:    'INTERVAL',
        deleteBtn:      'Delete',
        deleteConfirm:  'Delete this letter?',
        clearAll:       'Clear all',
        clearConfirm:   'Delete all letters?',
        settingsTitle:  'Enable FM 42.9',
        posLabel:       'Panel position',
        posLeft:        '◧ Top left',
        posRight:       '◨ Top right',
        profileLabel:   'Letter-gen API profile',
        profileDefault: 'Use main profile (default)',
        profileHint:    'When set, FM 42.9 temporarily switches to this profile for letter generation, then restores the original.<br>Leave blank to use the current profile.',
        langLabel:      'Letter language',
        badUrl:         'Please enter a valid YouTube URL.',
    },
};

function t(key) {
    const lang = getSettings().language || 'ko';
    return I18N[lang]?.[key] ?? I18N['ko'][key] ?? key;
}

// ── Settings ──────────────────────────────────────────────────
function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = extension_settings[MODULE_NAME];
    Object.keys(defaultSettings).forEach(k => {
        if (s[k] === undefined) s[k] = defaultSettings[k];
    });
    return s;
}

function getSTContext() {
    return window.SillyTavern?.getContext() || {};
}

// ── API Profiles ──────────────────────────────────────────────
function getApiProfiles() {
    const profiles = [];
    try {
        const p = extension_settings?.connectionManager?.profiles;
        if (Array.isArray(p)) {
            p.forEach(x => x?.name && profiles.push({ name: x.name, label: x.name }));
        }
    } catch (_) {}
    if (!profiles.length) {
        try {
            const p = extension_settings?.connection_profiles;
            if (Array.isArray(p)) {
                p.forEach(x => x?.name && profiles.push({ name: x.name, label: x.name }));
            }
        } catch (_) {}
    }
    return profiles;
}

function populateProfileSelect() {
    const s = getSettings();
    const $sel = $('#fm429-profile-select');
    if (!$sel.length) return;
    $sel.find('option:not([value=""])').remove();
    getApiProfiles().forEach(({ name, label }) => {
        $sel.append(`<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`);
    });
    if (s.apiProfile) $sel.val(s.apiProfile);
}

// ── LLM call ──────────────────────────────────────────────────
async function callLLM(prompt) {
    const context = getSTContext();
    const selectedProfile = getSettings().apiProfile;
    let previousProfile = null;

    if (selectedProfile) {
        try {
            // 프로필 전환 전에 현재 활성 프로필 이름을 먼저 캐싱 (다양한 경로 시도)
            const mgr = extension_settings?.connectionManager;
            const profiles = mgr?.profiles;
            if (Array.isArray(profiles)) {
                previousProfile =
                    profiles.find(x => x.isActive)?.name ??
                    profiles.find(x => x.id && x.id === mgr?.selectedProfile)?.name ??
                    profiles.find(x => x.name && x.name === mgr?.currentProfile)?.name ??
                    null;
            }
            // connectionManager에서 못 찾으면 context에서 시도
            if (!previousProfile) {
                previousProfile =
                    context?.activeProfile ??
                    context?.currentProfile ??
                    mgr?.selectedProfile ??
                    null;
            }

            console.log(`[FM 42.9] 현재 프로필: "${previousProfile}" → 사연 생성 프로필: "${selectedProfile}"`);

            if (context.executeSlashCommandsWithOptions) {
                await context.executeSlashCommandsWithOptions(
                    `/profile ${selectedProfile}`,
                    { showOutput: false }
                );
            }
        } catch (e) {
            console.warn('[FM 42.9] 프로필 전환 실패:', e);
        }
    }

    let result = '';
    try {
        // generateRaw: positional args → object 형식으로 수정 (ST 최신 API 대응)
        if (typeof context.generateRaw === 'function') {
            try {
                result = await context.generateRaw({ prompt, instructOverride: false });
            } catch (_) {
                // object 형식 미지원 구버전 ST 폴백
                result = await context.generateRaw(prompt, null, false, false, '');
            }
        }
    } finally {
        if (selectedProfile && context.executeSlashCommandsWithOptions) {
            if (previousProfile) {
                try {
                    console.log(`[FM 42.9] 프로필 복귀: "${previousProfile}"`);
                    await context.executeSlashCommandsWithOptions(
                        `/profile ${previousProfile}`,
                        { showOutput: false }
                    );
                } catch (_) {}
            } else {
                console.warn('[FM 42.9] 원래 프로필을 특정하지 못해 복귀 생략. connectionManager 상태:', extension_settings?.connectionManager);
            }
        }
    }
    return result || '';
}

// ── Helpers ───────────────────────────────────────────────────
function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function formatTime() {
    const d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function getEffectiveInterval() {
    const s = getSettings();
    if (s.saeyon_interval === 'custom') return Math.max(1, parseInt(s.custom_interval) || 10);
    return parseInt(s.saeyon_interval) || 5;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── YouTube IFrame Player API ─────────────────────────────────
let ytPlayer = null;
let ytReady  = false;

function loadYoutubeAPI() {
    if (document.getElementById('fm429-yt-api')) return;
    const tag = document.createElement('script');
    tag.id  = 'fm429-yt-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    if (window.__fm429_pendingVideoId) {
        createYTPlayer(window.__fm429_pendingVideoId);
        window.__fm429_pendingVideoId = null;
    }
};

function createYTPlayer(videoId) {
    const container = document.getElementById('fm429-yt-player');
    if (!container) return;
    container.innerHTML = '<div id="fm429-yt-iframe"></div>';

    ytPlayer = new YT.Player('fm429-yt-iframe', {
        width: '100%', height: '100%',
        videoId,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
            onReady: (e) => {
                e.target.playVideo();
                isPlaying = true;
                currentVideoId = videoId;
                updatePlayUI();
            },
            onError: (e) => {
                const msgs = { 2: '잘못된 영상 ID', 5: 'HTML5 오류', 100: '영상 없음', 101: 'embed 차단됨', 150: 'embed 차단됨' };
                toastr.error(`재생 실패: ${msgs[e.data] || `오류 코드 ${e.data}`}`, 'FM 42.9');
                stopYoutube();
            },
        },
    });
}

function loadYoutube(videoId) {
    if (!ytReady) { window.__fm429_pendingVideoId = videoId; loadYoutubeAPI(); }
    else createYTPlayer(videoId);
}

function stopYoutube() {
    if (ytPlayer) { try { ytPlayer.stopVideo(); } catch (_) {} ytPlayer = null; }
    const container = document.getElementById('fm429-yt-player');
    if (container) container.innerHTML = `
        <div class="fm429-player-placeholder" id="fm429-player-placeholder">
            <div class="fm429-placeholder-icon">▶</div>
            <div class="fm429-placeholder-text">${t('urlLabel')} →</div>
            <div class="fm429-placeholder-sub">${t('urlHint')}</div>
        </div>`;
    isPlaying = false;
    currentVideoId = null;
    updatePlayUI();
}

// ── Play UI ───────────────────────────────────────────────────
function updatePlayUI() {
    const signal      = document.getElementById('fm429-signal');
    const playBtn     = document.getElementById('fm429-play-btn');
    const stopBtn     = document.getElementById('fm429-stop-btn');
    const statusBar   = document.getElementById('fm429-status-bar');
    const placeholder = document.getElementById('fm429-player-placeholder');

    if (isPlaying && currentVideoId) {
        signal?.classList.add('playing');
        if (playBtn) { playBtn.textContent = t('play'); playBtn.disabled = true; }
        if (stopBtn) stopBtn.style.display = '';
        if (statusBar) statusBar.textContent = `${t('onair')} · ${formatTime()}`;
        if (placeholder) {
            placeholder.querySelector('.fm429-placeholder-icon').textContent = '♪';
            placeholder.querySelector('.fm429-placeholder-text').textContent = t('playingText');
            placeholder.querySelector('.fm429-placeholder-sub').textContent  = `youtu.be/${currentVideoId}`;
            placeholder.classList.add('playing');
        }
    } else {
        signal?.classList.remove('playing');
        if (playBtn) { playBtn.textContent = t('play'); playBtn.disabled = false; }
        if (stopBtn) stopBtn.style.display = 'none';
        if (statusBar) statusBar.textContent = t('standby');
        if (placeholder) {
            placeholder.querySelector('.fm429-placeholder-icon').textContent = '▶';
            placeholder.querySelector('.fm429-placeholder-text').textContent = `${t('urlLabel')} →`;
            placeholder.querySelector('.fm429-placeholder-sub').textContent  = t('urlHint');
            placeholder.classList.remove('playing');
        }
    }
}

// ── Cards ─────────────────────────────────────────────────────
function renderCards() {
    const container = document.getElementById('fm429-cards-container');
    if (!container) return;
    const s     = getSettings();
    const cards = s.saeyon_cards || [];

    const countEl = document.getElementById('fm429-mail-count');
    if (countEl) countEl.textContent = `${cards.length}${t('mailUnit')}`;

    if (cards.length === 0) {
        container.innerHTML = `<div class="fm429-empty">${t('emptyMsg')}</div>`;
        return;
    }

    if (cardIndex >= cards.length) cardIndex = cards.length - 1;
    if (cardIndex < 0) cardIndex = 0;
    const card = cards[cardIndex];

    container.innerHTML = `
        <div class="fm429-card">
            <div class="fm429-card-meta">
                <span class="fm429-card-from">${escapeHtml(card.from)}</span>
                <span class="fm429-card-time">${escapeHtml(card.time || '')}</span>
            </div>
            <div class="fm429-card-body">${escapeHtml(card.body)}</div>
            ${card.dj ? `<div class="fm429-card-dj">💬 ${escapeHtml(card.dj)}</div>` : ''}
        </div>
        <div class="fm429-card-nav">
            <button class="fm429-nav-btn" id="fm429-prev-btn" ${cardIndex === 0 ? 'disabled' : ''}>◄</button>
            <span class="fm429-card-index">${cardIndex + 1} / ${cards.length}</span>
            <button class="fm429-nav-btn" id="fm429-next-btn" ${cardIndex === cards.length - 1 ? 'disabled' : ''}>►</button>
        </div>
        <div class="fm429-card-actions">
            <button class="fm429-btn fm429-delete-btn" id="fm429-delete-one">🗑 ${t('deleteBtn')}</button>
            <button class="fm429-btn fm429-clear-btn"  id="fm429-clear-all">✕ ${t('clearAll')}</button>
        </div>`;

    document.getElementById('fm429-prev-btn')?.addEventListener('click',   () => { cardIndex--; renderCards(); });
    document.getElementById('fm429-next-btn')?.addEventListener('click',   () => { cardIndex++; renderCards(); });
    document.getElementById('fm429-delete-one')?.addEventListener('click', () => deleteCard(cardIndex));
    document.getElementById('fm429-clear-all')?.addEventListener('click',  clearAllCards);
}

function deleteCard(idx) {
    if (!confirm(t('deleteConfirm'))) return;
    const s = getSettings();
    s.saeyon_cards.splice(idx, 1);
    if (cardIndex >= s.saeyon_cards.length) cardIndex = Math.max(0, s.saeyon_cards.length - 1);
    saveSettingsDebounced();
    renderCards();
}

function clearAllCards() {
    if (!confirm(t('clearConfirm'))) return;
    const s = getSettings();
    s.saeyon_cards = [];
    cardIndex = 0;
    saveSettingsDebounced();
    renderCards();
}

// ── 사연 생성 ─────────────────────────────────────────────────
async function generateSaeyon() {
    const context = getSTContext();
    if (!context.generateRaw) { console.warn('[FM 42.9] generateRaw 없음'); return; }
    const chat = context.chat;
    if (!chat || chat.length < 1) return;

    const lang     = getSettings().language || 'ko';
    const charName = context.name2 || 'char';
    const userName = context.name1 || 'User';

    // ── 캐릭터 시트 수집 ──
    let charSheet = '';
    try {
        const char  = context.characters?.[context.characterId];
        const parts = [];
        if (char?.description) parts.push(char.description.slice(0, 400));
        if (char?.personality) parts.push(char.personality.slice(0, 200));
        if (char?.scenario)    parts.push(char.scenario.slice(0, 200));
        if (parts.length) charSheet = parts.join('\n');
    } catch (_) {}

    // ── 로어북 수집 ──
    let lorebook = '';
    try {
        const entries = context.worldInfo?.entries || context.worldInfoData?.entries || [];
        const active  = Object.values(entries)
            .filter(e => !e.disable && e.content)
            .slice(0, 5)
            .map(e => e.content.slice(0, 150))
            .join('\n');
        if (active) lorebook = active;
    } catch (_) {}

    // ── 최근 대화 ──
    const snippet = chat.slice(-20)
        .map(m => `[${m.is_user ? userName : charName}]: ${(m.mes || '').slice(0, 300)}`)
        .join('\n');

    // ── 톤 목록 ──
    const tones = lang === 'ko'
        ? '다정한 / 따뜻한 / 장난스러운 / 퉁명스러운 / 쓸쓸한 / 설레는 / 화난 / 담담한 / 유쾌한 / 그리운'
        : 'warm / tender / playful / blunt / melancholic / excited / angry / calm / cheerful / nostalgic';

    const prompt = lang === 'ko' ? `
당신은 심야 감성 라디오 "FM 42.9"의 DJ입니다.
아래 RP 대화와 캐릭터 정보를 참고해, 등장인물 중 한 명(또는 익명의 청취자)이 방송국에 보낸 실제 라디오 사연 한 편을 창작하세요.

[캐릭터 정보]
${charSheet || '(없음)'}

[세계관/로어북]
${lorebook || '(없음)'}

[최근 대화]
${snippet}

규칙:
- "from" 필드: "○○에 사는 ○○", "익명의 청취자", "○○ 님" 등 자연스럽게. 캐릭터 시트와 대화 맥락 기반으로 결정.
- "body" 필드: 실제 라디오 사연처럼 작성. 길이는 자유(짧아도 길어도 OK). 아래 톤 중 맥락에 어울리는 것을 골라 씀:
  ${tones}
- "dj" 필드: DJ 멘트. 1~3문장. 사연에 맞는 분위기로. null도 가능.
- JSON 형식으로만 응답. 마크다운·백틱 없이 중괄호로 시작.

{
  "from": "...",
  "body": "...",
  "dj": "..."
}`.trim() : `
You are the DJ of a late-night radio show called "FM 42.9".
Using the RP conversation and character info below, write one listener letter sent to the station — as if it were a real radio letter.

[Character info]
${charSheet || '(none)'}

[World/Lorebook]
${lorebook || '(none)'}

[Recent conversation]
${snippet}

Rules:
- "from": e.g. "A listener from [place]", "Anonymous", "[Name] from [town]". Derive from character sheet and context.
- "body": Written like a real radio listener letter. Length is free. Pick a tone that fits the mood:
  ${tones}
- "dj": DJ comment, 1–3 sentences. Can be null.
- Respond ONLY in JSON. No markdown, no backticks. Start with {.

{
  "from": "...",
  "body": "...",
  "dj": "..."
}`.trim();

    try {
        const raw = await callLLM(prompt);
        if (!raw?.trim()) return;

        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON 없음');
        const card = JSON.parse(jsonMatch[0]);
        if (!card.from || !card.body) throw new Error('카드 형식 오류');

        const s = getSettings();
        if (!s.saeyon_cards) s.saeyon_cards = [];
        s.saeyon_cards.push({ from: card.from, body: card.body, dj: card.dj || null, time: formatTime() });
        if (s.saeyon_cards.length > 50) s.saeyon_cards = s.saeyon_cards.slice(-50);

        cardIndex = s.saeyon_cards.length - 1;
        saveSettingsDebounced();
        renderCards();
        showSaeyonNotification();
        console.log('[FM 42.9] 사연 생성:', card.from);
    } catch (e) {
        console.warn('[FM 42.9] 사연 생성 실패:', e);
    }
}

function showSaeyonNotification() {
    const dot = document.querySelector('#fm429-toggle-btn .fm429-btn-dot');
    if (!dot) return;
    dot.style.background = '#39ff14';
    dot.style.boxShadow  = '0 0 8px #39ff14';
    setTimeout(() => { dot.style.background = ''; dot.style.boxShadow = ''; }, 4000);
}

// ── Message Hook ──────────────────────────────────────────────
function onMessageReceived() {
    const s = getSettings();
    if (!s.enabled) return;
    s.message_counter = (s.message_counter || 0) + 1;
    if (s.message_counter >= getEffectiveInterval()) {
        s.message_counter = 0;
        generateSaeyon();
    }
    saveSettingsDebounced();
}

// ── Panel HTML ────────────────────────────────────────────────
function buildPanelHTML() {
    const s = getSettings();
    return `
    <button id="fm429-toggle-btn" title="FM 42.9 라디오">
        <span class="fm429-btn-dot"></span>
        <span class="fm429-btn-label">FM</span>
    </button>

    <div id="fm429-panel">
        <div class="fm429-header">
            <span class="fm429-title">FM 42.9</span>
            <div class="fm429-signal" id="fm429-signal">
                <span></span><span></span><span></span><span></span>
            </div>
        </div>

        <div class="fm429-tabs">
            <button class="fm429-tab active" data-tab="play">▶ PLAY</button>
            <button class="fm429-tab" data-tab="mail">✉ ${t('mailLabel')}</button>
        </div>

        <div class="fm429-content">
            <div class="fm429-tab-pane active" id="fm429-pane-play">
                <div id="fm429-yt-player">
                    <div class="fm429-player-placeholder" id="fm429-player-placeholder">
                        <div class="fm429-placeholder-icon">▶</div>
                        <div class="fm429-placeholder-text">${t('urlLabel')} →</div>
                        <div class="fm429-placeholder-sub">${t('urlHint')}</div>
                    </div>
                </div>
                <div class="fm429-status-row">
                    <span id="fm429-status-bar">${t('standby')}</span>
                </div>
                <div class="fm429-label">${t('urlLabel')}</div>
                <div class="fm429-input-row">
                    <input class="fm429-input" id="fm429-url-input" type="text"
                        placeholder="${t('urlPlaceholder')}"
                        value="${escapeHtml(s.last_url || '')}">
                </div>
                <div class="fm429-input-row">
                    <button class="fm429-btn primary" id="fm429-play-btn">${t('play')}</button>
                    <button class="fm429-btn stop"    id="fm429-stop-btn" style="display:none;">${t('stop')}</button>
                </div>
            </div>

            <div class="fm429-tab-pane" id="fm429-pane-mail">
                <div class="fm429-mail-header">
                    <span class="fm429-label">${t('mailLabel')}</span>
                    <span class="fm429-mail-count" id="fm429-mail-count">${(s.saeyon_cards || []).length}${t('mailUnit')}</span>
                </div>
                <div id="fm429-cards-container"></div>
            </div>
        </div>

        <div class="fm429-footer">
            <span class="fm429-footer-label">${t('saeyonLabel')}</span>
            <select class="fm429-select" id="fm429-interval-select">
                <option value="5"      ${s.saeyon_interval == '5'      ? 'selected' : ''}>5 msg</option>
                <option value="10"     ${s.saeyon_interval == '10'     ? 'selected' : ''}>10 msg</option>
                <option value="20"     ${s.saeyon_interval == '20'     ? 'selected' : ''}>20 msg</option>
                <option value="custom" ${s.saeyon_interval === 'custom' ? 'selected' : ''}>…</option>
            </select>
            <input class="fm429-footer-custom ${s.saeyon_interval === 'custom' ? 'show' : ''}"
                   id="fm429-custom-interval" type="number" min="1" max="999"
                   value="${s.custom_interval || 10}">
        </div>
    </div>`;
}

// ── Settings Panel HTML ───────────────────────────────────────
function buildSettingsHTML() {
    const s = getSettings();
    return `
    <div id="fm429-settings-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>📻 FM 42.9</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:12px; font-size:12px;">

                <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                    <input type="checkbox" id="fm429-enabled-checkbox" ${s.enabled ? 'checked' : ''}>
                    <span>${t('settingsTitle')}</span>
                </label>

                <div style="margin-bottom:4px; font-size:11px; opacity:0.6; letter-spacing:0.5px;">${t('posLabel')}</div>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="radio" name="fm429-position" value="left"  ${(s.position || 'left') === 'left'  ? 'checked' : ''}>
                        <span>${t('posLeft')}</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="radio" name="fm429-position" value="right" ${s.position === 'right' ? 'checked' : ''}>
                        <span>${t('posRight')}</span>
                    </label>
                </div>

                <div style="margin-bottom:4px; font-size:11px; opacity:0.6; letter-spacing:0.5px;">${t('langLabel')}</div>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="radio" name="fm429-language" value="ko" ${(s.language || 'ko') === 'ko' ? 'checked' : ''}>
                        <span>🇰🇷 한국어</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="radio" name="fm429-language" value="en" ${s.language === 'en' ? 'checked' : ''}>
                        <span>🇺🇸 English</span>
                    </label>
                </div>

                <div style="margin-bottom:4px; font-size:11px; opacity:0.6; letter-spacing:0.5px;">${t('profileLabel')}</div>
                <select id="fm429-profile-select" class="text_pole" style="width:100%; margin-bottom:10px;">
                    <option value="">${t('profileDefault')}</option>
                </select>

                <div style="font-size:11px; opacity:0.5; line-height:1.7;">${t('profileHint')}</div>
            </div>
        </div>
    </div>`;
}

// ── Events ────────────────────────────────────────────────────
function bindPanelEvents() {
    $('#fm429-toggle-btn').on('click', () => {
        panelOpen = !panelOpen;
        $('#fm429-panel').toggleClass('open', panelOpen);
        $('#fm429-toggle-btn').toggleClass('active', panelOpen);
    });

    $(document).on('click', '.fm429-tab', function () {
        const tab = $(this).data('tab');
        $('.fm429-tab').removeClass('active');
        $('.fm429-tab-pane').removeClass('active');
        $(this).addClass('active');
        $(`#fm429-pane-${tab}`).addClass('active');
        if (tab === 'mail') renderCards();
    });

    $('#fm429-play-btn').on('click', () => {
        const url = $('#fm429-url-input').val().trim();
        if (!url) return;
        const vid = extractVideoId(url);
        if (!vid) { toastr.warning(t('badUrl'), 'FM 42.9'); return; }
        getSettings().last_url = url;
        saveSettingsDebounced();
        loadYoutube(vid);
    });

    $('#fm429-stop-btn').on('click', stopYoutube);

    $('#fm429-interval-select').on('change', function () {
        getSettings().saeyon_interval = $(this).val();
        $('#fm429-custom-interval').toggleClass('show', $(this).val() === 'custom');
        saveSettingsDebounced();
    });

    $('#fm429-custom-interval').on('change', function () {
        getSettings().custom_interval = parseInt($(this).val()) || 10;
        saveSettingsDebounced();
    });
}

function bindSettingsEvents() {
    $(document).on('change', '#fm429-enabled-checkbox', function () {
        getSettings().enabled = $(this).is(':checked');
        toggleRadioVisibility();
        saveSettingsDebounced();
    });

    $(document).on('change', 'input[name="fm429-position"]', function () {
        const pos = $(this).val();
        getSettings().position = pos;
        applyPosition(pos);
        saveSettingsDebounced();
    });

    // 언어 변경 시 패널 전체 재빌드 (UI 텍스트 일괄 반영)
    $(document).on('change', 'input[name="fm429-language"]', function () {
        getSettings().language = $(this).val();
        saveSettingsDebounced();
        rebuildPanel();
    });

    $(document).on('change', '#fm429-profile-select', function () {
        getSettings().apiProfile = $(this).val();
        saveSettingsDebounced();
    });
}

// ── Position ──────────────────────────────────────────────────
function applyPosition(pos) {
    const btn   = document.getElementById('fm429-toggle-btn');
    const panel = document.getElementById('fm429-panel');
    if (!btn || !panel) return;
    if (pos === 'right') {
        btn.style.removeProperty('left');    btn.style.setProperty('right', '8px');
        panel.style.removeProperty('left');  panel.style.setProperty('right', '8px');
    } else {
        btn.style.removeProperty('right');   btn.style.setProperty('left', '8px');
        panel.style.removeProperty('right'); panel.style.setProperty('left', '8px');
    }
}

// ── Visibility / Rebuild ──────────────────────────────────────
function toggleRadioVisibility() {
    if (getSettings().enabled) {
        if (!document.getElementById('fm429-toggle-btn')) injectPanel();
        else $('#fm429-toggle-btn').show();
    } else {
        $('#fm429-toggle-btn').hide();
        $('#fm429-panel').removeClass('open');
        panelOpen = false;
    }
}

function injectPanel() {
    if (document.getElementById('fm429-root')) return;
    $('<div id="fm429-root"></div>').html(buildPanelHTML()).appendTo('body');
    bindPanelEvents();
    updatePlayUI();
    renderCards();
    applyPosition(getSettings().position || 'left');
}

// 언어 전환 등 패널 전체 재생성이 필요할 때 사용
function rebuildPanel() {
    const wasOpen = panelOpen;
    $('#fm429-root').remove();
    panelOpen = false;
    injectPanel();
    if (wasOpen) {
        panelOpen = true;
        $('#fm429-panel').addClass('open');
        $('#fm429-toggle-btn').addClass('active');
    }
    if (isPlaying) updatePlayUI();
}

// ── Init ──────────────────────────────────────────────────────
jQuery(async () => {
    getSettings();

    $('#extensions_settings').append(buildSettingsHTML());
    bindSettingsEvents();

    setTimeout(populateProfileSelect, 800);

    if (getSettings().enabled) injectPanel();

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_SENT,     onMessageReceived);

    console.log('[FM 42.9] ON AIR 📻');
});
