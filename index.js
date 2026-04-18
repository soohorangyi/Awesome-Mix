// ============================================================
//  FM 42.9 — SillyTavern Extension
//  Vintage Radio: YouTube BG Audio + RP Saeyon Generator
//  Profile switching via /profile slash command (gotcha pattern)
// ============================================================

import { saveSettingsDebounced } from '../../../../script.js';
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
};

let isPlaying = false;
let currentVideoId = null;
let panelOpen = false;
let cardIndex = 0;

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

// ── API Profiles (gotcha 패턴) ────────────────────────────────
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

// ── LLM call (gotcha 패턴) ────────────────────────────────────
async function callLLM(prompt) {
    const context = getSTContext();
    const selectedProfile = getSettings().apiProfile;
    let previousProfile = null;

    // 프로필 전환
    if (selectedProfile) {
        try {
            const p = extension_settings?.connectionManager?.profiles;
            if (Array.isArray(p)) {
                previousProfile = p.find(x => x.isActive)?.name ?? null;
            }
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
        result = await context.generateRaw(prompt, null, false, false, '');
    } finally {
        // 프로필 복원
        if (selectedProfile && previousProfile && context.executeSlashCommandsWithOptions) {
            try {
                await context.executeSlashCommandsWithOptions(
                    `/profile ${previousProfile}`,
                    { showOutput: false }
                );
            } catch (_) {}
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

// ── 서버 URL (배포 후 본인 Vercel URL로 교체) ────────────────
const FM429_SERVER = 'https://fm429-server-v2.vercel.app';

// ── YouTube (프록시 서버 → <audio> 재생) ─────────────────────
function loadYoutube(videoId) {
    const audioEl = document.getElementById('fm429-audio');
    if (!audioEl) return;

    const proxyUrl = `${FM429_SERVER}/api/audio?v=${videoId}`;

    audioEl.src = proxyUrl;
    audioEl.load();

    audioEl.play().then(() => {
        isPlaying = true;
        currentVideoId = videoId;
        updatePlayUI();
    }).catch(err => {
        console.warn('[FM 42.9] 재생 실패:', err);
        toastr.error('재생에 실패했습니다. 서버 URL을 확인해주세요.', 'FM 42.9');
    });
}

function stopYoutube() {
    const audioEl = document.getElementById('fm429-audio');
    if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
    }
    isPlaying = false;
    currentVideoId = null;
    updatePlayUI();
}

function setYoutubeVolume(_vol) {}

// ── Play UI ───────────────────────────────────────────────────
function updatePlayUI() {
    const signal      = document.getElementById('fm429-signal');
    const playBtn     = document.getElementById('fm429-play-btn');
    const stopBtn     = document.getElementById('fm429-stop-btn');
    const statusBar   = document.getElementById('fm429-status-bar');
    const placeholder = document.getElementById('fm429-player-placeholder');

    if (isPlaying && currentVideoId) {
        signal?.classList.add('playing');
        if (playBtn) { playBtn.textContent = 'PLAY'; playBtn.disabled = true; }
        if (stopBtn) stopBtn.style.display = '';
        if (statusBar) statusBar.textContent = `ON AIR · ${formatTime()}`;
        if (placeholder) {
            placeholder.querySelector('.fm429-placeholder-icon').textContent = '♪';
            placeholder.querySelector('.fm429-placeholder-text').textContent = '앱에서 재생 중';
            placeholder.querySelector('.fm429-placeholder-sub').textContent = `youtu.be/${currentVideoId}`;
            placeholder.classList.add('playing');
        }
    } else {
        signal?.classList.remove('playing');
        if (playBtn) { playBtn.textContent = 'PLAY'; playBtn.disabled = false; }
        if (stopBtn) stopBtn.style.display = 'none';
        if (statusBar) statusBar.textContent = 'STANDBY · FM 42.9';
        if (placeholder) {
            placeholder.querySelector('.fm429-placeholder-icon').textContent = '▶';
            placeholder.querySelector('.fm429-placeholder-text').textContent = 'URL 입력 후 PLAY';
            placeholder.querySelector('.fm429-placeholder-sub').textContent = '유튜브 앱으로 열립니다';
            placeholder.classList.remove('playing');
        }
    }
}

// ── Cards ─────────────────────────────────────────────────────
function renderCards() {
    const container = document.getElementById('fm429-cards-container');
    if (!container) return;
    const s = getSettings();
    const cards = s.saeyon_cards || [];

    const countEl = document.getElementById('fm429-mail-count');
    if (countEl) countEl.textContent = `${cards.length}건`;

    if (cards.length === 0) {
        container.innerHTML = `
            <div class="fm429-empty">
                📡 아직 수신된 사연이 없어요.<br>
                채팅을 계속하면 사연이 도착합니다.
            </div>`;
        return;
    }

    if (cardIndex >= cards.length) cardIndex = cards.length - 1;
    if (cardIndex < 0) cardIndex = 0;
    const card = cards[cardIndex];

    container.innerHTML = `
        <div class="fm429-card">
            <div class="fm429-card-from">${escapeHtml(card.from)}</div>
            <div class="fm429-card-body">${escapeHtml(card.body)}</div>
            ${card.dj ? `<div class="fm429-card-dj">💬 ${escapeHtml(card.dj)}</div>` : ''}
        </div>
        <div class="fm429-card-nav">
            <button class="fm429-nav-btn" id="fm429-prev-btn" ${cardIndex === 0 ? 'disabled' : ''}>◄</button>
            <span class="fm429-card-index">${cardIndex + 1} / ${cards.length}</span>
            <button class="fm429-nav-btn" id="fm429-next-btn" ${cardIndex === cards.length - 1 ? 'disabled' : ''}>►</button>
        </div>`;

    document.getElementById('fm429-prev-btn')?.addEventListener('click', () => { cardIndex--; renderCards(); });
    document.getElementById('fm429-next-btn')?.addEventListener('click', () => { cardIndex++; renderCards(); });
}

// ── 사연 생성 ─────────────────────────────────────────────────
async function generateSaeyon() {
    const context = getSTContext();
    if (!context.generateRaw) {
        console.warn('[FM 42.9] generateRaw 없음');
        return;
    }
    const chat = context.chat;
    if (!chat || chat.length < 3) return;

    const charName = context.name2 || 'char';
    const snippet = chat.slice(-20)
        .map(m => `[${m.is_user ? 'User' : charName}]: ${(m.mes || '').slice(0, 300)}`)
        .join('\n');

    const prompt = `당신은 감성적인 심야 라디오 DJ입니다. 아래의 RP 대화를 읽고, 등장인물 중 한 명이 라디오 방송국에 보낸 사연을 한 개 만들어 주세요.

RP 대화:
${snippet}

아래 JSON 형식으로만 응답하세요. 마크다운 없이 중괄호로 시작하세요:
{
  "from": "사연자 이름 (캐릭터 이름, 익명, 또는 청취자 OOO 중 자연스러운 것)",
  "body": "사연 내용 (2~4문장, 감성적인 라디오 사연 느낌)",
  "dj": "DJ 멘트 (1~2문장, 따뜻한 공감 코멘트, 없으면 null)"
}`;

    try {
        const raw = await callLLM(prompt);
        if (!raw?.trim()) return;

        const jsonMatch = raw.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) throw new Error('JSON 없음');
        const card = JSON.parse(jsonMatch[0]);
        if (!card.from || !card.body) throw new Error('카드 형식 오류');

        const s = getSettings();
        if (!s.saeyon_cards) s.saeyon_cards = [];
        s.saeyon_cards.push({ from: card.from, body: card.body, dj: card.dj || null, time: formatTime() });
        if (s.saeyon_cards.length > 30) s.saeyon_cards = s.saeyon_cards.slice(-30);

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
    dot.style.boxShadow = '0 0 8px #39ff14';
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
    <audio id="fm429-audio" preload="none"></audio>

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
            <button class="fm429-tab" data-tab="mail">✉ MAIL</button>
        </div>

        <div class="fm429-content">
            <div class="fm429-tab-pane active" id="fm429-pane-play">
                <!-- 상태 표시 영역 (딥링크 방식) -->
                <div id="fm429-yt-player">
                    <div class="fm429-player-placeholder" id="fm429-player-placeholder">
                        <div class="fm429-placeholder-icon">▶</div>
                        <div class="fm429-placeholder-text">URL 입력 후 PLAY</div>
                        <div class="fm429-placeholder-sub">유튜브 앱으로 열립니다</div>
                    </div>
                </div>
                <div class="fm429-status-row">
                    <span id="fm429-status-bar">STANDBY · FM 42.9</span>
                </div>
                <div class="fm429-label">YOUTUBE URL</div>
                <div class="fm429-input-row">
                    <input class="fm429-input" id="fm429-url-input" type="text"
                        placeholder="youtu.be/... 또는 youtube.com/watch?v=..."
                        value="${escapeHtml(s.last_url || '')}">
                </div>
                <div class="fm429-input-row">
                    <button class="fm429-btn primary" id="fm429-play-btn">PLAY</button>
                    <button class="fm429-btn stop" id="fm429-stop-btn" style="display:none;">■ STOP</button>
                </div>

            </div>

            <div class="fm429-tab-pane" id="fm429-pane-mail">
                <div class="fm429-mail-header">
                    <span class="fm429-label">수신된 사연</span>
                    <span class="fm429-mail-count" id="fm429-mail-count">${(s.saeyon_cards || []).length}건</span>
                </div>
                <div id="fm429-cards-container"></div>
            </div>
        </div>

        <div class="fm429-footer">
            <span class="fm429-footer-label">사연</span>
            <select class="fm429-select" id="fm429-interval-select">
                <option value="5"      ${s.saeyon_interval == '5'      ? 'selected' : ''}>5 msg</option>
                <option value="10"     ${s.saeyon_interval == '10'     ? 'selected' : ''}>10 msg</option>
                <option value="20"     ${s.saeyon_interval == '20'     ? 'selected' : ''}>20 msg</option>
                <option value="custom" ${s.saeyon_interval === 'custom' ? 'selected' : ''}>직접</option>
            </select>
            <input class="fm429-footer-custom ${s.saeyon_interval === 'custom' ? 'show' : ''}"
                   id="fm429-custom-interval" type="number" min="1" max="999"
                   value="${s.custom_interval || 10}">
        </div>
    </div>`;
}

// ── Settings Panel HTML ───────────────────────────────────────
function buildSettingsHTML() {
    return `
    <div id="fm429-settings-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>📻 FM 42.9</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:12px; font-size:12px;">
                <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                    <input type="checkbox" id="fm429-enabled-checkbox">
                    <span>FM 42.9 활성화</span>
                </label>

                <div style="margin-bottom:4px; font-size:11px; opacity:0.6; letter-spacing:0.5px;">
                    사연 생성 연결 프로필
                </div>
                <select id="fm429-profile-select" class="text_pole" style="width:100%; margin-bottom:10px;">
                    <option value="">메인 프로필 사용 (기본)</option>
                </select>

                <div style="font-size:11px; opacity:0.5; line-height:1.7;">
                    별도 프로필을 지정하면 사연 생성 시 해당 프로필로 일시 전환 후<br>
                    자동으로 원래 프로필로 복귀합니다.<br>
                    지정하지 않으면 현재 메인 프로필을 그대로 사용합니다.
                </div>
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
        if (!vid) { toastr.warning('올바른 YouTube URL을 입력해주세요.', 'FM 42.9'); return; }
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

    $(document).on('change', '#fm429-profile-select', function () {
        getSettings().apiProfile = $(this).val();
        saveSettingsDebounced();
    });
}

// ── Visibility ────────────────────────────────────────────────
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
}

// ── Init ──────────────────────────────────────────────────────
jQuery(async () => {
    getSettings();

    $('#extensions_settings').append(buildSettingsHTML());
    bindSettingsEvents();

    $('#fm429-enabled-checkbox').prop('checked', getSettings().enabled);

    // 프로필 목록은 ST가 connectionManager를 초기화한 뒤 채워야 해서 약간 딜레이
    setTimeout(populateProfileSelect, 800);

    if (getSettings().enabled) injectPanel();

    $(document).on('CHARACTER_MESSAGE_RENDERED', onMessageReceived);
    $(document).on('generate_after_data', onMessageReceived);

    console.log('[FM 42.9] ON AIR 📻');
});
