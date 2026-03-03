/* =============================================
   MinePulse - Frontend Application Logic
   ============================================= */

const API_BASE = '';  // same origin
let POLL_MS = 30000;

// --- State ---
let currentRange = 1;
let pollTimer = null;
let etaTicker = null; // live 1-second countdown
let currentEta = null; // current ETA timestamp (ms)

// --- DOM refs ---
const $ = id => document.getElementById(id);

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
    spawnParticles();
    setupRangeButtons();
    setupRefreshButton();
    loadAll();
    pollTimer = setInterval(loadAll, POLL_MS);
    $('pollInterval').textContent = POLL_MS / 1000;

    // Announcement close
    const annClose = $('annClose');
    if (annClose) annClose.addEventListener('click', () => {
        const bar = $('announcementBar');
        if (bar) bar.style.display = 'none';
    });

    // Start ETA tick
    etaTicker = setInterval(tickEta, 1000);
});

function tickEta() {
    const etaEl = $('modeBannerEta');
    const chip = $('etaChip');
    const chipLbl = $('etaChipLabel');

    if (!currentEta || currentEta <= Date.now()) {
        if (etaEl) etaEl.style.display = 'none';
        if (chip) chip.style.display = 'none';
        currentEta = null;
        return;
    }

    const cd = formatCountdown(currentEta);

    // Full-width banner ETA line
    if (etaEl) { etaEl.textContent = `⏱ Back in ${cd}`; etaEl.style.display = 'block'; }

    // Inline chip next to mode badge (only show when mode is active)
    if (chip) {
        chip.style.display = 'inline-flex';
        if (chipLbl) chipLbl.textContent = cd;
    }
}

function formatCountdown(eta) {
    const diff = Math.max(0, eta - Date.now());
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

// ============ PARTICLES ============
function spawnParticles() {
    const container = $('bgParticles');
    const count = 18;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 200 + 80;
        p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      animation-duration: ${Math.random() * 20 + 15}s;
      animation-delay: ${Math.random() * -20}s;
      opacity: ${Math.random() * 0.4};
    `;
        container.appendChild(p);
    }
}

// ============ REFRESH BUTTON ============
function setupRefreshButton() {
    const btn = $('refreshBtn');
    btn.addEventListener('click', () => {
        if (btn.classList.contains('spinning')) return;
        btn.classList.add('spinning');
        loadAll().finally(() => {
            setTimeout(() => btn.classList.remove('spinning'), 500);
        });
    });
}

// ============ RANGE BUTTONS ============
function setupRangeButtons() {
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = parseInt(btn.dataset.hours);
            loadChart();
        });
    });
}

// ============ MAIN DATA LOAD ============
async function loadAll() {
    await Promise.allSettled([
        loadStatus(),
        loadChart(),
        loadUptime()
    ]);
}

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ============ STATUS ============
async function loadStatus() {
    try {
        const [data, cfg] = await Promise.all([
            fetchJSON(`${API_BASE}/api/status`),
            fetchJSON(`${API_BASE}/api/config`).catch(() => null)
        ]);
        window.__CFG = cfg;

        // Sync frontend poll interval with the backend config
        if (cfg && cfg.pollIntervalMs && cfg.pollIntervalMs !== POLL_MS) {
            POLL_MS = cfg.pollIntervalMs;
            clearInterval(pollTimer);
            pollTimer = setInterval(loadAll, POLL_MS);
            if ($('pollInterval')) $('pollInterval').textContent = POLL_MS / 1000;
        }

        renderStatus(data, cfg);
        updateLastUpdated(new Date());
    } catch (e) {
        renderError();
    }
}

function renderStatus(data, cfg) {
    const { status, playerCount, maxPlayers, players, motd, version, latency, currentStatusDuration } = data;

    // Banner glow color
    const glowMap = {
        online: 'radial-gradient(circle, rgba(74,222,128,0.15), transparent 70%)',
        offline: 'radial-gradient(circle, rgba(248,113,113,0.12), transparent 70%)',
        crashed: 'radial-gradient(circle, rgba(251,146,60,0.18), transparent 70%)',
        unknown: 'radial-gradient(circle, rgba(148,163,184,0.06), transparent 70%)',
    };
    $('bannerGlow').style.background = glowMap[status] || glowMap.unknown;

    // Badge
    const badge = $('statusBadge');
    badge.className = `status-badge ${status}`;
    $('statusText').textContent = statusLabel(status, cfg);

    // Dot color in header
    const dot = document.querySelector('.dot.pulse');
    dot.className = `dot pulse ${dotClass(status)}`;

    // Website Branding
    const wName = cfg?.websiteName || 'MinePulse';
    if ($('pageTitle')) $('pageTitle').textContent = `${wName} — Minecraft Server Monitor`;
    if ($('logoText')) $('logoText').textContent = wName;
    if ($('logoIcon')) {
        if (cfg?.websiteIcon) {
            $('logoIcon').innerHTML = `<img src="${cfg.websiteIcon}" alt="Logo" style="max-width:100%;max-height:100%;border-radius:6px;object-fit:cover" />`;
        } else {
            $('logoIcon').innerHTML = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="10" height="10" fill="#4ade80" rx="1" />
            <rect x="18" y="4" width="10" height="10" fill="#86efac" rx="1" />
            <rect x="4" y="18" width="10" height="10" fill="#86efac" rx="1" />
            <rect x="18" y="18" width="10" height="10" fill="#4ade80" rx="1" />
            <rect x="10" y="10" width="12" height="12" fill="#22c55e" rx="1" />
          </svg>`;
        }
    }

    // Sync favicon with the custom icon.
    // Browsers cache favicons aggressively and ignore href mutations on existing
    // <link> elements — we must remove the old one and insert a fresh element.
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(l => l.remove());
    const faviconEl = document.createElement('link');
    faviconEl.rel = 'icon';
    if (cfg?.websiteIcon) {
        // Detect MIME type from the data URL prefix
        if (cfg.websiteIcon.startsWith('data:image/png')) faviconEl.type = 'image/png';
        else if (cfg.websiteIcon.startsWith('data:image/jpeg')) faviconEl.type = 'image/jpeg';
        else if (cfg.websiteIcon.startsWith('data:image/gif')) faviconEl.type = 'image/gif';
        else if (cfg.websiteIcon.startsWith('data:image/webp')) faviconEl.type = 'image/webp';
        else faviconEl.type = 'image/png';
        faviconEl.href = cfg.websiteIcon;
    } else {
        // Default: green cube SVG favicon
        faviconEl.type = 'image/svg+xml';
        faviconEl.href = `data:image/svg+xml,<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="10" height="10" fill="%234ade80" rx="1"/><rect x="18" y="4" width="10" height="10" fill="%2386efac" rx="1"/><rect x="4" y="18" width="10" height="10" fill="%2386efac" rx="1"/><rect x="18" y="18" width="10" height="10" fill="%234ade80" rx="1"/><rect x="10" y="10" width="12" height="12" fill="%2322c55e" rx="1"/></svg>`;
    }
    document.head.appendChild(faviconEl);

    // Server address (or custom name from admin branding)
    const hostEl = $('serverAddress');
    const displayName = (cfg && cfg.customName) ? cfg.customName
        : (cfg && cfg.host) ? `${cfg.host}:${cfg.port}`
            : (window.location.hostname || 'your.server.ip');
    hostEl.textContent = displayName;

    // Admin mode banner + ETA
    renderModeBanner(cfg);

    $('serverMotd').textContent = motd || '';
    $('serverVersion').textContent = version ? `Minecraft ${version}` : '';

    // State duration
    $('stateDuration').textContent = currentStatusDuration != null
        ? formatDuration(currentStatusDuration)
        : '—';
    $('stateDurationLabel').textContent = `${statusLabel(status, cfg).toLowerCase()} since`;

    // Status since
    $('statusSince').textContent = currentStatusDuration != null
        ? `For ${formatDuration(currentStatusDuration)}`
        : '';

    // Player count
    $('playerCount').textContent = playerCount ?? '—';
    $('playerMax').textContent = maxPlayers ? `of ${maxPlayers} max` : '';

    // Latency
    $('latency').textContent = latency != null ? `${latency}` : '—';

    // Player list
    renderPlayerList(players || [], status);

    // Player badge
    $('playerBadge').textContent = playerCount ?? 0;
}

function statusLabel(status, cfg) {
    const offlineL = cfg?.offlineLabel || 'Offline';
    const crashedL = cfg?.crashedLabel || 'Crashed';
    const map = { online: 'Online', offline: offlineL, crashed: crashedL, unknown: 'Unknown' };
    return map[status] || 'Unknown';
}

function dotClass(status) {
    const map = { online: '', offline: 'red', crashed: 'orange', unknown: 'grey' };
    return map[status] || 'grey';
}

function renderError() {
    $('statusBadge').className = 'status-badge unknown';
    $('statusText').textContent = 'Error';
    $('playerCount').textContent = '—';
}

function renderModeBanner(cfg) {
    const banner = $('modeBanner');
    const annBar = $('announcementBar');
    const chip = $('modechip');
    if (!cfg) return;

    // Announcement bar
    if (annBar) {
        if (cfg.announcement) {
            $('announcementBarText').textContent = cfg.announcement;
            annBar.style.display = 'flex';
        } else {
            annBar.style.display = 'none';
        }
    }

    const mode = cfg.mode || 'online';

    // --- Inline mode chip (next to status badge) ---
    const chipMeta = {
        maintenance: { icon: '🔧', label: 'Maintenance', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)' },
        updating: { icon: '🔄', label: 'Updating', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' },
        restarting: { icon: '⚡', label: 'Restarting', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
    };
    if (chip) {
        if (mode !== 'online' && chipMeta[mode]) {
            const cm = chipMeta[mode];
            $('modechipIcon').textContent = cm.icon;
            $('modechipLabel').textContent = cm.label;
            chip.style.color = cm.color;
            chip.style.background = cm.bg;
            chip.style.borderColor = cm.border;
            chip.style.display = 'inline-flex';
        } else {
            chip.style.display = 'none';
        }
    }

    // --- Full-width mode banner ---
    if (!banner) return;
    if (mode === 'online') {
        banner.style.display = 'none';
        currentEta = null;
        return;
    }
    const modeData = {
        maintenance: { icon: '🔧', title: 'Server Under Maintenance', color: '#fbbf24' },
        updating: { icon: '🔄', title: 'Server Updating', color: '#60a5fa' },
        restarting: { icon: '⚡', title: 'Server Restarting', color: '#a78bfa' },
    };
    const md = modeData[mode] || { icon: '⚠️', title: 'Server Unavailable', color: '#f87171' };
    banner.dataset.mode = mode;
    banner.style.display = 'flex';
    $('modeBannerIcon').textContent = md.icon;
    $('modeBannerTitle').textContent = md.title;
    $('modeBannerTitle').style.color = md.color;
    $('modeBannerMsg').textContent = cfg.modeMessage || '';

    // ETA countdown
    currentEta = (cfg.eta && cfg.eta > Date.now()) ? cfg.eta : null;
    tickEta(); // immediate tick — no 1s delay
}



// ============ PLAYER LIST ============
function renderPlayerList(players, status) {
    const list = $('playerList');
    const empty = $('playerListEmpty');
    const wrap = $('playerListWrap');

    // Remove existing player items
    list.querySelectorAll('.player-item').forEach(el => el.remove());

    if (!players.length) {
        empty.style.display = 'flex';
        if (status !== 'online') {
            empty.querySelector('p').textContent = status === 'offline' ? 'Server is offline' : status === 'crashed' ? 'Server crashed' : 'No players online';
        } else {
            empty.querySelector('p').textContent = 'No players online';
        }
        if (wrap) wrap.classList.remove('has-overflow');
        return;
    }

    empty.style.display = 'none';

    players.forEach((player, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        item.style.animationDelay = `${idx * 40}ms`;

        const identifier = player.uuid || player.name;
        const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/32`;
        const avatarFallback = `https://minotar.net/avatar/${encodeURIComponent(player.name)}/32`;
        const onerrorAttr = `this.onerror=function(){this.style.display='none'};this.src='${avatarFallback}'`;

        let durationHtml = '';
        if (player.onlineSince) {
            const ms = Date.now() - player.onlineSince;
            const diff = Math.max(0, ms);
            const hm = Math.floor(diff / 3600000);
            const mm = Math.floor((diff % 3600000) / 60000);
            let timeStr = '';
            if (hm > 0) timeStr = `${hm}h ${mm}m`;
            else if (mm > 0) timeStr = `${mm}m`;
            else timeStr = '<1m';
            durationHtml = `<span class="player-time" title="Online for ${timeStr}">⏱ ${timeStr}</span>`;
        }

        item.innerHTML = `
      <div class="player-avatar">
        <img src="${avatarUrl}" alt="${escHtml(player.name)}" loading="lazy" onerror="${onerrorAttr}" />
      </div>
      <span class="player-name">${escHtml(player.name)}</span>
      ${durationHtml}
    `;
        list.appendChild(item);
    });

    // Show fade-out hint only when the list is actually scrollable
    if (wrap) {
        requestAnimationFrame(() => {
            wrap.classList.toggle('has-overflow', list.scrollHeight > list.clientHeight);
        });
    }

    // Hide the fade hint when the user scrolls to the bottom
    list.onscroll = () => {
        if (!wrap) return;
        const atBottom = list.scrollHeight - list.scrollTop <= list.clientHeight + 4;
        wrap.classList.toggle('has-overflow', !atBottom);
    };
}

function escHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============ UPTIME ============
async function loadUptime() {
    try {
        const data = await fetchJSON(`${API_BASE}/api/uptime?range=${currentRange}`);
        $('uptimePct').textContent = `${data.uptimePercent}%`;
        // Update chart card uptime display
        const pctEl = $('chartUptimePct');
        if (pctEl) {
            pctEl.textContent = `${data.uptimePercent}%`;
            // Color by value
            pctEl.style.color = data.uptimePercent >= 99 ? '#4ade80'
                : data.uptimePercent >= 90 ? '#fbbf24'
                    : '#f87171';
        }
    } catch {
        $('uptimePct').textContent = '—';
    }
}

// ============ HEARTBEAT CHART ============
const HB_BAR_COUNT = 60; // number of columns shown

async function loadChart() {
    try {
        const history = await fetchJSON(`${API_BASE}/api/history?range=${currentRange}`);
        renderHeartbeat(history);

        // Update range label
        const rangeLabels = { 1: 'Last 1 hour', 6: 'Last 6 hours', 12: 'Last 12 hours', 24: 'Last 24 hours' };
        const rl = $('uptimeRangeLabel');
        if (rl) rl.textContent = rangeLabels[currentRange] || `Last ${currentRange}h`;

    } catch (e) {
        showHeartbeatEmpty(true);
    }
}

function renderHeartbeat(history) {
    const barsEl = $('heartbeatBars');
    const axisEl = $('heartbeatAxis');
    const emptyEl = $('heartbeatEmpty');

    if (!history || history.length === 0) {
        showHeartbeatEmpty(true);
        return;
    }

    showHeartbeatEmpty(false);

    const now = Date.now();
    const rangeMs = currentRange * 60 * 60 * 1000;
    const start = now - rangeMs;
    const bucketMs = rangeMs / HB_BAR_COUNT;

    // Build buckets
    const buckets = Array.from({ length: HB_BAR_COUNT }, (_, i) => ({
        t: start + i * bucketMs,
        status: 'empty',
        online: 0,
        offline: 0,
        crashed: 0,
        adminMode: null,
    }));


    history.forEach(h => {
        const idx = Math.floor((h.timestamp - start) / bucketMs);
        if (idx < 0 || idx >= HB_BAR_COUNT) return;
        const s = h.status === 'online' ? 'online' : h.status === 'crashed' ? 'crashed' : 'offline';
        buckets[idx][s]++;
        // Record the trailing adminMode for this bucket (last entry wins)
        if (h.adminMode) buckets[idx].adminMode = h.adminMode;
    });

    // Resolve dominant status/adminMode per bucket
    const ADMIN_MODE_COLOURS = {
        maintenance: 'maintenance',
        updating: 'updating',
        restarting: 'restarting',
    };

    buckets.forEach(b => {
        const total = b.online + b.offline + b.crashed;
        if (total === 0) {
            b.status = 'empty';
        } else {
            // Check if majority of entries have an admin mode override
            if (b.adminMode && ADMIN_MODE_COLOURS[b.adminMode]) {
                b.status = b.adminMode; // use the admin mode as status key
            } else if (b.crashed > 0 && b.crashed >= b.offline) {
                b.status = 'crashed';
            } else if (b.offline >= b.online) {
                b.status = 'offline';
            } else {
                b.status = 'online';
            }
        }
    });

    // Render bars
    barsEl.innerHTML = '';
    const tooltip = $('hbTooltip');

    buckets.forEach((b, i) => {
        const bar = document.createElement('div');
        bar.className = `hb-bar hb-${b.status}`;
        bar.style.animationDelay = `${i * 8}ms`;

        // Hover tooltip
        bar.addEventListener('mouseenter', (e) => {
            const rangeHours = currentRange;
            const showDate = rangeHours > 12; // for long ranges include the date
            const fmtOpts = showDate
                ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                : { hour: '2-digit', minute: '2-digit' };
            const timeStr = new Date(b.t).toLocaleString([], fmtOpts);
            const timeStr2 = new Date(b.t + bucketMs).toLocaleString([], fmtOpts);

            let statusStr = b.status === 'empty' ? 'No data' : b.status.charAt(0).toUpperCase() + b.status.slice(1);
            if (b.status === 'offline' && window.__CFG?.offlineLabel) statusStr = window.__CFG.offlineLabel;
            if (b.status === 'crashed' && window.__CFG?.crashedLabel) statusStr = window.__CFG.crashedLabel;

            const total = b.online + b.offline + b.crashed;
            const detail = total > 0 ? `${b.online} ✓  ${b.offline + b.crashed} ✗` : '';
            tooltip.innerHTML = `
                <div class="hbt-status hbt-${b.status}">${statusStr}</div>
                <div class="hbt-time">${timeStr} – ${timeStr2}</div>
                ${detail ? `<div class="hbt-detail">${detail}</div>` : ''}
            `;
            tooltip.classList.add('show');
            positionTooltip(e, bar);
        });
        bar.addEventListener('mouseleave', () => tooltip.classList.remove('show'));
        bar.addEventListener('mousemove', (e) => positionTooltip(e, bar));

        barsEl.appendChild(bar);
    });

    // Render axis labels — show date if range > 12h
    axisEl.innerHTML = '';
    const axisCount = 5;
    const showDateOnAxis = currentRange > 12;
    for (let i = 0; i < axisCount; i++) {
        const t = start + (rangeMs / (axisCount - 1)) * i;
        const lbl = document.createElement('span');
        if (showDateOnAxis) {
            // Two-line: date on top, time below
            const d = new Date(t);
            lbl.innerHTML = `<span style="display:block;font-size:0.6em;opacity:0.6">${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else {
            lbl.textContent = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        axisEl.appendChild(lbl);
    }
}

function positionTooltip(e, bar) {
    const tooltip = $('hbTooltip');
    const wrap = $('heartbeatWrap');
    const rect = wrap.getBoundingClientRect();
    const tRect = tooltip.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();

    let left = barRect.left - rect.left + barRect.width / 2 - tRect.width / 2;
    // Clamp within wrap
    left = Math.max(0, Math.min(left, rect.width - tRect.width));
    tooltip.style.left = `${left}px`;
    tooltip.style.bottom = `calc(100% + 10px)`;
}

function showHeartbeatEmpty(show) {
    const emptyEl = $('heartbeatEmpty');
    const barsEl = $('heartbeatBars');
    if (emptyEl) emptyEl.style.display = show ? 'flex' : 'none';
    if (barsEl) barsEl.style.opacity = show ? '0' : '1';
}

// ============ HELPERS ============
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m ${seconds % 60}s`;
}

function updateLastUpdated(date) {
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('lastUpdatedText').textContent = `Updated ${time}`;
}


