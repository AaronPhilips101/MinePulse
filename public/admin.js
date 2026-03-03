/* =============================================
   MinePulse Admin Panel — JavaScript Logic
   ============================================= */

const API = '';
let logAutoRefresh = null;
let ovRefreshTimer = null;
let etaTicker = null;   // ticks every second for countdown display
let selectedMode = 'online';
let selectedEta = null; // Unix ms timestamp or null

// ============ STARTUP ============

document.addEventListener('DOMContentLoaded', async () => {
    // Auth check via cookie — attempt to fetch protected config.
    // If the server returns 403, the cookie is absent/expired — show login.
    // No token stored in JS memory; the HttpOnly cookie handles everything.
    try {
        await apiFetch('/api/admin/config');
        showDashboard();
    } catch (e) {
        if (e.message !== 'Session expired') console.warn('[MinePulse] Not authenticated:', e.message);
        // Stay on login screen (default)
    }

    // Login
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('passwordInput').value;
        const btn = document.getElementById('loginBtn');
        btn.textContent = 'Signing in…'; btn.disabled = true;
        try {
            const res = await apiFetch('/api/admin/login', 'POST', { password });
            if (res.ok) {
                // Cookie is now set by the server — no token to store in JS
                showDashboard();
                if (res.needsPasswordChange) {
                    setTimeout(() => {
                        switchTab('security');
                        toast('Security Alert: Please change your default password immediately!', true);
                        el('cfgCurrentPassword').value = password;
                        el('cfgNewPassword').focus();
                    }, 500);
                }
            } else {
                showLoginError(res.error);
            }
        } catch (e) {
            console.error('[MinePulse] Login error:', e);
            showLoginError('Connection error. Is the server running?');
        } finally { btn.textContent = 'Sign In'; btn.disabled = false; }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try { await apiFetch('/api/admin/logout', 'POST'); } catch (e) { console.warn('[MinePulse] Logout error:', e); }
        // Cookie cleared by server; just reset the UI
        document.getElementById('adminDash').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('passwordInput').value = '';
        stopLogAutoRefresh(); stopEtaTicker();
        if (ovRefreshTimer) { clearInterval(ovRefreshTimer); ovRefreshTimer = null; }
    });

    // Tab nav
    document.querySelectorAll('.nav-btn').forEach(btn =>
        btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    );

    // Mode grid
    document.querySelectorAll('.mode-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedMode = btn.dataset.mode;
            updateEtaSectionVisibility();
        })
    );

    // ETA presets
    document.querySelectorAll('[data-eta]').forEach(btn =>
        btn.addEventListener('click', () => {
            const secs = parseInt(btn.dataset.eta);
            selectedEta = Date.now() + secs * 1000;
            updateEtaDisplay(); highlightActivePreset(btn, '[data-eta]');
        })
    );

    // Custom ETA
    document.getElementById('setCustomEtaBtn').addEventListener('click', () => {
        const mins = parseInt(document.getElementById('etaCustomMinutes').value);
        if (!mins || mins < 1) return toast('Enter a valid number of minutes', true);
        selectedEta = Date.now() + mins * 60 * 1000;
        updateEtaDisplay(); highlightActivePreset(null, '[data-eta]');
    });

    // Clear ETA
    document.getElementById('clearEtaBtn').addEventListener('click', () => {
        selectedEta = null; updateEtaDisplay(); highlightActivePreset(null, '[data-eta]');
    });

    // Poll interval presets
    document.querySelectorAll('[data-poll]').forEach(btn =>
        btn.addEventListener('click', async () => {
            const ms = parseInt(btn.dataset.poll);
            try {
                await apiFetch('/api/admin/config', 'POST', { pollIntervalMs: ms });
                toast(`Poll interval set to ${formatMs(ms)}`);
                updatePollDisplay(ms); highlightActivePreset(btn, '[data-poll]');
            } catch { toast('Failed to update', true); }
        })
    );

    // Announcement
    document.getElementById('announcementText').addEventListener('input', updateAnnouncementPreview);

    // Buttons
    document.getElementById('saveServerBtn').addEventListener('click', saveServerConfig);
    document.getElementById('saveBrandingBtn').addEventListener('click', saveBranding);
    document.getElementById('saveDowntimeBtn').addEventListener('click', saveDowntimeSettings);
    document.getElementById('saveModeBtn').addEventListener('click', saveMode);
    document.getElementById('savePasswordBtn').addEventListener('click', savePassword);
    document.getElementById('saveAnnouncementBtn').addEventListener('click', saveAnnouncement);
    document.getElementById('clearAnnouncementBtn').addEventListener('click', clearAnnouncement);
    document.getElementById('refreshLogsBtn').addEventListener('click', loadLogs);
    document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
    document.getElementById('autoRefreshLogs').addEventListener('change', (e) =>
        e.target.checked ? startLogAutoRefresh() : stopLogAutoRefresh()
    );
});

// ============ AUTH ============
function showLoginError(msg) {
    const err = document.getElementById('loginError');
    err.textContent = msg || 'Invalid password/error.';
    err.style.display = 'block';
    setTimeout(() => err.style.display = 'none', 3000);
}

async function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminDash').style.display = 'grid';
    await loadAdminConfig();
    await loadOverview();
    switchTab('overview');
    startLogAutoRefresh();
    startEtaTicker();
    // Refresh overview every 30s
    ovRefreshTimer = setInterval(loadOverview, 30000);
}

// ============ API HELPERS ============
async function apiFetch(url, method = 'GET', body = null) {
    const opts = {
        method,
        credentials: 'same-origin', // ensures the HttpOnly cookie is sent with every request
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.status === 403) {
        // Cookie expired or invalidated — send back to login
        document.getElementById('adminDash').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        stopLogAutoRefresh(); stopEtaTicker();
        if (ovRefreshTimer) { clearInterval(ovRefreshTimer); ovRefreshTimer = null; }
        throw new Error('Session expired');
    }
    return res.json();
}

// ============ TABS ============
function switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
    if (tab === 'overview') loadOverview();
    if (tab === 'logs') loadLogs();
}

// ============ OVERVIEW ============
async function loadOverview() {
    try {
        const [status, cfg] = await Promise.all([
            fetch('/api/status').then(r => r.json()),
            fetch('/api/config').then(r => r.json()),
        ]);

        el('ov-host').textContent = `${cfg.host}:${cfg.port}`;
        el('ov-players').textContent = `${status.playerCount} / ${status.maxPlayers}`;
        el('ov-latency').textContent = status.latency != null ? `${status.latency} ms` : '—';
        el('ov-lastcheck').textContent = status.lastChecked
            ? new Date(status.lastChecked).toLocaleTimeString() : '—';
        el('ov-poll').textContent = formatMs(cfg.pollIntervalMs || 30000);

        const statusEl = el('ov-status');
        let statusDisp = capitalize(status.status);
        if (status.status === 'offline' && cfg.offlineLabel) statusDisp = cfg.offlineLabel;
        if (status.status === 'crashed' && cfg.crashedLabel) statusDisp = cfg.crashedLabel;
        statusEl.textContent = statusDisp;
        statusEl.style.color = status.status === 'online' ? '#4ade80' : status.status === 'crashed' ? '#fb923c' : '#f87171';

        const modeEl = el('ov-mode');
        modeEl.textContent = capitalize(cfg.mode);
        modeEl.style.color = cfg.mode === 'online' ? '#4ade80' : '#fbbf24';

        // ETA card
        const etaCard = el('ov-eta-card');
        if (cfg.eta && cfg.eta > Date.now()) {
            etaCard.style.display = 'block';
            el('ov-eta').textContent = formatCountdown(cfg.eta);
        } else {
            etaCard.style.display = 'none';
        }
    } catch (e) {
        console.error('[MinePulse] Overview load error:', e);
        if (el('ov-status')) el('ov-status').textContent = 'Connection error';
    }
}

// ============ LOAD ADMIN CONFIG ============
async function loadAdminConfig() {
    try {
        const cfg = await apiFetch('/api/admin/config');
        el('cfgHost').value = cfg.host || '';
        el('cfgPort').value = cfg.port || '';
        el('cfgCustomName').value = cfg.customName || '';
        if (el('cfgWebsiteName')) el('cfgWebsiteName').value = cfg.websiteName || 'MinePulse';
        if (el('cfgOfflineLabel')) el('cfgOfflineLabel').value = cfg.offlineLabel || 'Offline';
        if (el('cfgCrashedLabel')) el('cfgCrashedLabel').value = cfg.crashedLabel || 'Crashed';
        if (el('cfgCrashedMinutes')) el('cfgCrashedMinutes').value = cfg.crashedMinutes ?? 5;
        if (el('cfgFallbackMotd')) el('cfgFallbackMotd').value = cfg.fallbackMotd || '';

        el('modeMessage').value = cfg.modeMessage || '';
        el('announcementText').value = cfg.announcement || '';
        updateAnnouncementPreview();
        updatePollDisplay(cfg.pollIntervalMs || 30000);

        // ETA
        selectedEta = cfg.eta && cfg.eta > Date.now() ? cfg.eta : null;
        updateEtaDisplay();

        // Mode
        selectedMode = cfg.mode || 'online';
        document.querySelectorAll('.mode-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === selectedMode)
        );
        updateEtaSectionVisibility();

        if (cfg.needsPasswordChange && document.getElementById('tab-security') && !document.getElementById('tab-security').classList.contains('active')) {
            setTimeout(() => {
                switchTab('security');
                toast('Security Alert: Please change your default password immediately!', true);
            }, 500);
        }
    } catch (e) {
        console.error('[MinePulse] Admin config load error:', e);
        toast('Failed to load configuration from server.', true);
    }
}

// ============ SERVER CONFIG ============
async function saveServerConfig() {
    const host = el('cfgHost').value.trim();
    const portRaw = el('cfgPort').value.trim();
    if (!host) return toast('Host cannot be empty', true);
    let finalHost = host, finalPort = portRaw ? parseInt(portRaw) : 25565;
    const lc = host.lastIndexOf(':');
    if (lc !== -1 && /^\d+$/.test(host.slice(lc + 1))) {
        finalHost = host.slice(0, lc); finalPort = parseInt(host.slice(lc + 1));
        el('cfgHost').value = finalHost; el('cfgPort').value = finalPort;
    }
    try {
        await apiFetch('/api/admin/config', 'POST', { host: finalHost, port: finalPort });
        toast(`Server updated to ${finalHost}:${finalPort}`); loadOverview();
    } catch { toast('Failed to save', true); }
}

// ============ BRANDING ============
async function saveBranding() {
    const customName = el('cfgCustomName').value.trim();
    const websiteName = el('cfgWebsiteName') ? el('cfgWebsiteName').value.trim() : 'MinePulse';
    const fileInput = el('cfgWebsiteIcon');

    const doSave = async (iconData) => {
        const fallbackMotd = el('cfgFallbackMotd') ? el('cfgFallbackMotd').value.trim() : '';
        const payload = { customName, websiteName, fallbackMotd };
        if (iconData !== undefined) payload.websiteIcon = iconData;
        try {
            await apiFetch('/api/admin/config', 'POST', payload);
            toast('Branding saved successfully');
        } catch { toast('Failed to save branding', true); }
    };

    if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) return toast('Icon file too large (max 5MB)', true);
        const reader = new FileReader();
        reader.onload = (e) => doSave(e.target.result);
        reader.onerror = () => toast('Error reading image', true);
        reader.readAsDataURL(file);
    } else {
        doSave(undefined);
    }
}

// ============ DOWNTIME ============
async function saveDowntimeSettings() {
    const offlineLabel = el('cfgOfflineLabel').value.trim();
    const crashedLabel = el('cfgCrashedLabel').value.trim();
    const crashedMinutes = el('cfgCrashedMinutes').value;

    try {
        await apiFetch('/api/admin/config', 'POST', {
            offlineLabel,
            crashedLabel,
            crashedMinutes: crashedMinutes ? parseInt(crashedMinutes) : 0
        });
        toast('Downtime settings saved');
    } catch { toast('Failed to save downtime settings', true); }
}

// ============ PASSWORD ============
async function savePassword() {
    const currentPassword = el('cfgCurrentPassword').value;
    const newPassword = el('cfgNewPassword').value;
    if (!currentPassword) return toast('Enter current password', true);
    if (!newPassword || newPassword.length < 8) return toast('New password must be at least 8 characters', true);

    try {
        const res = await apiFetch('/api/admin/password', 'POST', { currentPassword, newPassword });
        if (res.error) {
            toast(res.error, true);
        } else {
            toast('Password updated — please log in again');
            // Session is invalidated on server; force re-login
            setTimeout(() => {
                sessionStorage.removeItem('adminToken'); token = null;
                document.getElementById('adminDash').style.display = 'none';
                document.getElementById('loginScreen').style.display = 'flex';
                el('cfgCurrentPassword').value = '';
                el('cfgNewPassword').value = '';
                stopLogAutoRefresh(); stopEtaTicker();
            }, 1500);
        }
    } catch {
        toast('Failed to update password', true);
    }
}

// ============ MODE + ETA ============
function updateEtaSectionVisibility() {
    const sec = el('etaSection');
    if (!sec) return;
    sec.style.display = selectedMode !== 'online' ? 'block' : 'none';
}

function updateEtaDisplay() {
    const d = el('etaCurrentDisplay');
    if (!d) return;
    if (selectedEta && selectedEta > Date.now()) {
        d.textContent = `Set: ${formatCountdown(selectedEta)}`;
    } else {
        d.textContent = 'Not set';
        selectedEta = null;
    }
}

async function saveMode() {
    const modeMessage = el('modeMessage').value.trim();
    const payload = { mode: selectedMode, modeMessage, eta: selectedEta || null };
    try {
        await apiFetch('/api/admin/config', 'POST', payload);
        toast(`Mode set to: ${capitalize(selectedMode)}${selectedEta ? ` · ETA ${formatCountdown(selectedEta)}` : ''}`);
        loadOverview();
    } catch { toast('Failed to save', true); }
}

// ============ ANNOUNCEMENT ============
function updateAnnouncementPreview() {
    const txt = el('announcementText').value.trim();
    const preview = el('announcementPreview');
    const inner = el('announcementPreviewText');
    if (preview) preview.style.display = txt ? 'block' : 'none';
    if (inner) inner.textContent = txt;
}

async function saveAnnouncement() {
    const announcement = el('announcementText').value.trim();
    try {
        await apiFetch('/api/admin/config', 'POST', { announcement });
        toast(announcement ? 'Announcement updated' : 'Announcement cleared');
    } catch { toast('Failed to save', true); }
}

async function clearAnnouncement() {
    el('announcementText').value = ''; updateAnnouncementPreview(); await saveAnnouncement();
}

// ============ LOGS ============
async function loadLogs() {
    try {
        const logs = await apiFetch('/api/admin/logs?count=150');
        const terminal = el('logTerminal');
        if (!logs.length) { terminal.innerHTML = '<div class="log-empty">No logs yet</div>'; return; }
        el('logCount').textContent = `${logs.length} entries`;
        terminal.innerHTML = logs.map(l => {
            const time = new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const isAdmin = l.msg.includes('[ADMIN]');
            const isOnline = l.msg.includes('Server: online');
            const isOffline = l.msg.includes('Server: offline');
            const isCrash = l.msg.includes('Server: crashed');
            const cls = isAdmin ? 'admin-msg' : isOnline ? 'online' : isOffline ? 'offline' : isCrash ? 'crashed' : '';
            return `<div class="log-entry"><span class="log-ts">${time}</span><span class="log-msg ${cls}">${escHtml(l.msg)}</span></div>`;
        }).join('');
        terminal.scrollTop = terminal.scrollHeight;
    } catch { }
}

function startLogAutoRefresh() {
    stopLogAutoRefresh();
    if (document.getElementById('autoRefreshLogs')?.checked)
        logAutoRefresh = setInterval(loadLogs, 10000);
}
function stopLogAutoRefresh() { if (logAutoRefresh) { clearInterval(logAutoRefresh); logAutoRefresh = null; } }

// ============ ETA TICKER (overview countdown) ============
function startEtaTicker() {
    stopEtaTicker();
    etaTicker = setInterval(() => {
        const ovEta = el('ov-eta');
        const etaCard = el('ov-eta-card');
        if (ovEta && etaCard) {
            fetch('/api/config').then(r => r.json()).then(cfg => {
                if (cfg.eta && cfg.eta > Date.now()) {
                    etaCard.style.display = 'block';
                    ovEta.textContent = formatCountdown(cfg.eta);
                } else {
                    etaCard.style.display = 'none';
                }
            }).catch(() => { });
        }
        updateEtaDisplay(); // also refresh the mode tab ETA display
    }, 1000);
}
function stopEtaTicker() { if (etaTicker) { clearInterval(etaTicker); etaTicker = null; } }

// ============ DATA ============
async function clearHistory() {
    if (!confirm('Clear all status history? This cannot be undone.')) return;
    try { await apiFetch('/api/admin/history', 'DELETE'); toast('History cleared'); }
    catch { toast('Failed to clear', true); }
}

// ============ HELPERS ============
function el(id) { return document.getElementById(id); }
function capitalize(str) { return !str ? '—' : str.charAt(0).toUpperCase() + str.slice(1); }

function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function formatMs(ms) {
    if (!ms) return '—';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}

function formatCountdown(eta) {
    if (!eta) return '—';
    const diff = Math.max(0, eta - Date.now());
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

function updatePollDisplay(ms) {
    const d = el('currentPollDisplay');
    if (d) d.textContent = formatMs(ms);
}

function highlightActivePreset(activeBtn, selector) {
    document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');
}

let toastTimer = null;
function toast(msg, isError = false) {
    const toastEl = el('toast');
    toastEl.textContent = isError ? '✖ ' + msg : '✔ ' + msg;
    toastEl.className = `toast show${isError ? ' error' : ''}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}
