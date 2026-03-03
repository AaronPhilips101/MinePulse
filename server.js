const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { status: mcPing } = require('minecraft-server-util');

const SALT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'admin';

// Migrate a plain/SHA-256 password to a bcrypt hash on first boot.
// Returns a promise that resolves to a bcrypt hash string.
async function ensureBcryptHash(raw) {
  // Already a bcrypt hash (starts with $2b$ or $2a$)
  if (raw && /^\$2[ab]\$/.test(raw)) return raw;
  // Legacy SHA-256 hash or plain text — re-hash with bcrypt
  const plain = (raw && raw.length === 64 && /^[0-9a-f]+$/.test(raw))
    ? raw           // was stored as sha256 — reuse as plain input (not ideal, but maintains compatibility)
    : (raw || DEFAULT_PASSWORD);
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(input, storedHash) {
  return bcrypt.compare(input, storedHash);
}

const app = express();
const PORT = process.env.PORT || 3000;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30000'); // 30s default
const HISTORY_MAX = 288; // 24h at 5-min intervals

const CONFIG_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
let savedConfig = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Error reading config file:', e);
}

// Parse MC_HOST — supports "host:port" shorthand (e.g. play.eu.org:5080)
const _rawHost = process.env.MC_HOST || 'localhost';
let MC_HOST, MC_PORT;
{
  // Handle IPv6 bracket notation: [::1]:25565
  const ipv6Match = _rawHost.match(/^\[(.+)\](?::(\d+))?$/);
  if (ipv6Match) {
    MC_HOST = ipv6Match[1];
    MC_PORT = ipv6Match[2] ? parseInt(ipv6Match[2]) : parseInt(process.env.MC_PORT || '25565');
  } else {
    const lastColon = _rawHost.lastIndexOf(':');
    if (lastColon !== -1) {
      const potentialPort = _rawHost.slice(lastColon + 1);
      if (/^\d+$/.test(potentialPort)) {
        // Has an embedded port like play.eu.org:5080
        MC_HOST = _rawHost.slice(0, lastColon);
        MC_PORT = parseInt(potentialPort);
      } else {
        MC_HOST = _rawHost;
        MC_PORT = parseInt(process.env.MC_PORT || '25565');
      }
    } else {
      MC_HOST = _rawHost;
      MC_PORT = parseInt(process.env.MC_PORT || '25565');
    }
  }
}

if (savedConfig.host) MC_HOST = savedConfig.host;
if (savedConfig.port) MC_PORT = savedConfig.port;

// --- Security middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      // mc-heads.net and crafatar.com supply Minecraft player head avatars
      imgSrc: ["'self'", "data:", "https://mc-heads.net", "https://minotar.net"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.disable('x-powered-by');
app.use(cookieParser());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 3000}`,
  methods: ['GET', 'POST', 'DELETE'],
}));

// Global rate limit: 60 req/min per IP (status page doesn't need more)
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Strict login rate limit: 10 attempts/min per IP
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again in a minute.' },
});

// Body parsing: apply a small limit globally, but the admin/config route
// overrides to 6mb at the route level (handled there, not here).
// We use a conditional middleware so the global parser does NOT run on
// the icon upload route — avoids the body being rejected before the
// route-specific parser can use the higher limit.
const jsonSmall = express.json({ limit: '50kb' });
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/admin/config') return next();
  jsonSmall(req, res, next);
});
app.use(express.static(path.join(__dirname, 'public')));

// In-memory status history
let statusHistory = []; // { timestamp, status, playerCount }
let currentStatus = {
  status: 'unknown',
  playerCount: 0,
  maxPlayers: 0,
  players: [],
  motd: '',
  version: '',
  latency: null,
  lastChecked: null,
  uptimeSeconds: 0,
  downtimeSeconds: 0
};

let lastOnlineTime = Date.now();
let lastOfflineTime = null;
let statusChangeTime = Date.now();

// Direct TCP ping to the Minecraft server — no external API needed.
// Returns a normalised object matching the shape the rest of the code expects,
// or null if the server is unreachable.
async function fetchMCStatus() {
  try {
    const result = await mcPing(MC_HOST, MC_PORT, { timeout: 10000, enableSRV: true });

    // Extract clean MOTD — try .clean first, fall back to stripping § codes from .raw
    const rawMotd = result.motd?.raw ?? '';
    const cleanMotd = (result.motd?.clean ?? rawMotd.replace(/§[0-9a-fk-or]/gi, ''))
      .split('\n').map(l => l.trim()).filter(Boolean).join(' | ');

    return {
      online: true,
      players: {
        online: result.players.online,
        max: result.players.max,
        list: (result.players.sample || []).map(p => ({
          name_clean: p.name,
          uuid: p.id,
        })),
      },
      motd: { clean: cleanMotd },
      version: { name_clean: result.version?.name ?? '' },
      latency: result.roundTripLatency ?? null,
    };
  } catch {
    return null; // server offline or unreachable
  }
}


const playerSessions = {}; // track { identifier: joinedAtMs }

async function pollStatus() {
  const raw = await fetchMCStatus();
  const now = Date.now();
  const currentPlayerIds = new Set();

  let newStatus;
  if (raw && raw.online === true) {
    newStatus = 'online';
    lastOnlineTime = now;
  } else {
    // Determine if it's been offline long enough to be 'crashed'
    const downMinutes = (now - lastOnlineTime) / 60000;
    if (downMinutes >= (adminConfig.crashedMinutes || 5)) {
      newStatus = 'crashed';
    } else {
      newStatus = 'offline';
    }
  }

  // Track uptime/downtime durations
  const previousStatus = currentStatus.status;
  if (previousStatus !== 'unknown' && previousStatus !== newStatus) {
    statusChangeTime = now;
  }

  const elapsed = Math.floor((now - statusChangeTime) / 1000);

  currentStatus = {
    status: newStatus,
    playerCount: raw?.players?.online ?? 0,
    maxPlayers: raw?.players?.max ?? 0,
    players: (raw?.players?.list ?? []).map(p => {
      const identifier = p.uuid || p.name_clean || p.name || 'Unknown';
      if (!playerSessions[identifier]) playerSessions[identifier] = now;
      currentPlayerIds.add(identifier);
      return {
        name: p.name_clean || p.name || 'Unknown',
        uuid: p.uuid || null,
        onlineSince: playerSessions[identifier]
      };
    }),
    motd: raw?.motd?.clean || adminConfig.fallbackMotd || '',
    version: raw?.version?.name_clean ?? raw?.version?.name ?? '',
    latency: raw?.latency ?? null,
    lastChecked: now,
    currentStatusDuration: elapsed
  };

  // Push to history (include current admin mode so chart can colour bars correctly)
  statusHistory.push({
    timestamp: now,
    status: newStatus,
    playerCount: currentStatus.playerCount,
    adminMode: (adminConfig && adminConfig.mode !== 'online') ? adminConfig.mode : null
  });

  // Clean up disconnected players
  for (const id in playerSessions) {
    if (!currentPlayerIds.has(id)) {
      delete playerSessions[id];
    }
  }

  // Keep only max entries
  if (statusHistory.length > HISTORY_MAX) {
    statusHistory = statusHistory.slice(statusHistory.length - HISTORY_MAX);
  }
}


// ========= ADMIN CONFIG =========
// ADMIN_PASSWORD is always a bcrypt hash. Initialised async below.
let ADMIN_PASSWORD = '';
let adminPasswordReady = false;

(async () => {
  const raw = savedConfig.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
  ADMIN_PASSWORD = await ensureBcryptHash(raw);
  adminPasswordReady = true;
  // Re-save if we migrated from a legacy format
  if (!savedConfig.ADMIN_PASSWORD || !/^\$2[ab]\$/.test(savedConfig.ADMIN_PASSWORD)) {
    saveConfig();
  }
  addLog('[SERVER] Password initialised' + (ADMIN_PASSWORD === savedConfig.ADMIN_PASSWORD ? '' : ' (migrated to bcrypt)'));
})();

let adminToken = null; // single active session token
let failedLoginAttempts = 0;
let lockoutUntil = 0;

// Admin-controlled overrides
let adminConfig = {
  host: savedConfig.host || MC_HOST,
  port: savedConfig.port || MC_PORT,
  mode: savedConfig.mode || 'online',      // 'online' | 'maintenance' | 'updating' | 'restarting'
  modeMessage: savedConfig.modeMessage !== undefined ? savedConfig.modeMessage : '',            // custom message shown on public page
  announcement: savedConfig.announcement !== undefined ? savedConfig.announcement : '',            // top-of-page banner
  eta: savedConfig.eta || null,          // Unix ms timestamp — when mode auto-resets to 'online'
  customName: savedConfig.customName !== undefined ? savedConfig.customName : '',            // override display name shown on public dashboard
  pollIntervalMs: savedConfig.pollIntervalMs || POLL_INTERVAL, // dynamic poll interval
  websiteName: savedConfig.websiteName || 'MinePulse',     // dynamic website title
  websiteIcon: savedConfig.websiteIcon || null,          // base64 image data url
  crashedMinutes: savedConfig.crashedMinutes !== undefined ? savedConfig.crashedMinutes : 5,             // minutes offline before entering crashed state
  offlineLabel: savedConfig.offlineLabel || 'Offline',     // custom string for offline state
  crashedLabel: savedConfig.crashedLabel || 'Crashed',     // custom string for crashed state
  fallbackMotd: savedConfig.fallbackMotd !== undefined ? savedConfig.fallbackMotd : '', // shown when MC server sends no MOTD
};

function saveConfig() {
  const configToSave = {
    ...adminConfig,
    ADMIN_PASSWORD
  };
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving config file:', e);
  }
}

// Auto-generate config file if missing or empty
if (!fs.existsSync(CONFIG_FILE) || Object.keys(savedConfig).length === 0) {
  saveConfig();
}

// Auto-reset mode when ETA passes
let etaCheckInterval = setInterval(() => {
  if (adminConfig.eta && Date.now() >= adminConfig.eta) {
    addLog(`[ADMIN] ETA reached — auto-resetting mode to online`);
    adminConfig.mode = 'online';
    adminConfig.eta = null;
    saveConfig();
  }
}, 15000);

// Keeps track of the polling interval so we can reschedule it dynamically
let pollIntervalHandle = null;
function startPolling(ms) {
  if (pollIntervalHandle) clearInterval(pollIntervalHandle);
  pollIntervalHandle = setInterval(pollStatus, ms);
}

// In-memory log buffer (last 200 entries)
const LOG_MAX = 200;
let logBuffer = [];
function addLog(msg) {
  const entry = { ts: Date.now(), msg };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_MAX) logBuffer.shift();
  console.log(msg);
}

// =========  API Routes  =========
// Public endpoints serve cached in-memory data.
// Cache-Control: browser caches for 15s — prevents redundant requests from rapid refreshes.
const PUBLIC_CACHE = 'public, max-age=15, stale-while-revalidate=10';

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', PUBLIC_CACHE);
  res.json({
    host: adminConfig.host,
    port: adminConfig.port,
    mode: adminConfig.mode,
    modeMessage: adminConfig.modeMessage,
    announcement: adminConfig.announcement,
    eta: adminConfig.eta,
    customName: adminConfig.customName,
    pollIntervalMs: adminConfig.pollIntervalMs,
    websiteName: adminConfig.websiteName,
    websiteIcon: adminConfig.websiteIcon,
    crashedMinutes: adminConfig.crashedMinutes,
    offlineLabel: adminConfig.offlineLabel,
    crashedLabel: adminConfig.crashedLabel,
    fallbackMotd: adminConfig.fallbackMotd,
  });
});

app.get('/api/status', (req, res) => {
  res.set('Cache-Control', PUBLIC_CACHE);
  res.json({ ...currentStatus, adminMode: adminConfig.mode, modeMessage: adminConfig.modeMessage });
});

app.get('/api/history', (req, res) => {
  res.set('Cache-Control', PUBLIC_CACHE);
  const range = parseInt(req.query.range) || 24;
  const cutoff = Date.now() - (range * 60 * 60 * 1000);
  res.json(statusHistory.filter(h => h.timestamp >= cutoff));
});

app.get('/api/uptime', (req, res) => {
  res.set('Cache-Control', PUBLIC_CACHE);
  const range = parseInt(req.query.range) || 24;
  const cutoff = Date.now() - (range * 60 * 60 * 1000);
  const filtered = statusHistory.filter(h => h.timestamp >= cutoff);
  const onlineCount = filtered.filter(h => h.status === 'online').length;
  const total = filtered.length;
  const uptimePct = total > 0 ? ((onlineCount / total) * 100).toFixed(1) : 0;
  res.json({ uptimePercent: parseFloat(uptimePct), totalDataPoints: total, onlineDataPoints: onlineCount, rangeHours: range });
});

// --------- Admin Auth ---------
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  const now = Date.now();

  if (!adminPasswordReady) return res.status(503).json({ error: 'Server is starting up, try again shortly.' });

  if (now < lockoutUntil) {
    const remaining = Math.ceil((lockoutUntil - now) / 1000);
    return res.status(429).json({ error: `Locked out. Try again in ${remaining}s.` });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }

  const match = await verifyPassword(password, ADMIN_PASSWORD);
  if (match) {
    failedLoginAttempts = 0;
    adminToken = crypto.randomBytes(24).toString('hex');
    addLog(`[ADMIN] Login successful`);
    const needsPasswordChange = await verifyPassword(DEFAULT_PASSWORD, ADMIN_PASSWORD);
    // Set HttpOnly cookie — invisible to JS, immune to XSS token theft
    res.cookie('adminSession', adminToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    res.json({ ok: true, needsPasswordChange });
  } else {
    failedLoginAttempts++;
    if (failedLoginAttempts >= 3) {
      lockoutUntil = now + (failedLoginAttempts === 3 ? 60000 : 300000);
      const remaining = Math.ceil((lockoutUntil - now) / 1000);
      return res.status(429).json({ error: `Locked out. Try again in ${remaining}s.` });
    }
    res.status(401).json({ error: 'Invalid password' });
  }
});

function requireAdmin(req, res, next) {
  // Read token from HttpOnly cookie — never from headers or URL
  const auth = req.cookies?.adminSession;
  if (!adminToken || auth !== adminToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  adminToken = null;
  res.clearCookie('adminSession', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'Current password required' });
  }
  const match = await verifyPassword(currentPassword, ADMIN_PASSWORD);
  if (!match) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  ADMIN_PASSWORD = await bcrypt.hash(newPassword, SALT_ROUNDS);
  saveConfig();
  adminToken = null; // invalidate existing session
  res.clearCookie('adminSession', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  addLog(`[ADMIN] Password changed successfully — all sessions invalidated`);
  res.json({ ok: true });
});

// GET admin config (protected)
app.get('/api/admin/config', requireAdmin, (req, res) => {
  res.json(adminConfig);
});

// POST admin config — update host/port/mode/messages/eta/customName/pollInterval
// M2: Large body limit only on this route (for base64 icon uploads)
app.post('/api/admin/config', requireAdmin, express.json({ limit: '6mb' }), (req, res) => {
  const VALID_MODES = ['online', 'maintenance', 'updating', 'restarting'];
  const {
    host, port, mode, modeMessage, announcement, eta,
    customName, pollIntervalMs, websiteName, websiteIcon,
    crashedMinutes, offlineLabel, crashedLabel, fallbackMotd
  } = req.body || {};
  let changed = false;

  if (host !== undefined) { adminConfig.host = String(host).slice(0, 253); changed = true; }
  if (port !== undefined) { adminConfig.port = Math.min(65535, Math.max(1, parseInt(port) || 25565)); changed = true; }
  if (mode !== undefined) {
    if (!VALID_MODES.includes(mode)) return res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
    adminConfig.mode = mode; changed = true;
  }
  if (modeMessage !== undefined) { adminConfig.modeMessage = String(modeMessage).slice(0, 200); changed = true; }
  if (announcement !== undefined) { adminConfig.announcement = String(announcement).slice(0, 500); changed = true; }
  if (customName !== undefined) { adminConfig.customName = String(customName).slice(0, 80); changed = true; }
  if (websiteName !== undefined) { adminConfig.websiteName = String(websiteName).slice(0, 50) || 'MinePulse'; changed = true; }
  if (websiteIcon !== undefined) { adminConfig.websiteIcon = websiteIcon; changed = true; }
  if (crashedMinutes !== undefined) { adminConfig.crashedMinutes = Math.max(0, Math.min(1440, parseInt(crashedMinutes) || 0)); changed = true; }
  if (offlineLabel !== undefined) { adminConfig.offlineLabel = String(offlineLabel).slice(0, 30) || 'Offline'; changed = true; }
  if (crashedLabel !== undefined) { adminConfig.crashedLabel = String(crashedLabel).slice(0, 30) || 'Crashed'; changed = true; }
  if (fallbackMotd !== undefined) { adminConfig.fallbackMotd = String(fallbackMotd).slice(0, 120); changed = true; }
  if (eta !== undefined) { adminConfig.eta = eta; changed = true; }
  if (pollIntervalMs !== undefined) {
    const ms = Math.max(10000, parseInt(pollIntervalMs));
    adminConfig.pollIntervalMs = ms;
    startPolling(ms);
    addLog(`[ADMIN] Poll interval changed to ${ms / 1000}s`);
    changed = true;
  }

  // If host/port changed, update polling target
  if (host !== undefined || port !== undefined) {
    MC_HOST = adminConfig.host;
    MC_PORT = adminConfig.port;
    addLog(`[ADMIN] Server target changed to ${MC_HOST}:${MC_PORT}`);
    pollStatus();
  }

  if (changed) {
    addLog(`[ADMIN] Config updated: mode=${adminConfig.mode}${adminConfig.eta ? ', eta=' + new Date(adminConfig.eta).toISOString() : ''}`);
    saveConfig();
  }
  res.json({ ok: true, config: adminConfig });
});

// GET logs
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const count = parseInt(req.query.count) || 100;
  res.json(logBuffer.slice(-count));
});

// DELETE history (clear)
app.delete('/api/admin/history', requireAdmin, (req, res) => {
  statusHistory = [];
  addLog('[ADMIN] Status history cleared');
  res.json({ ok: true });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve index.html for all other routes (SPA fallback)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  addLog(`MinePulse server running on http://localhost:${PORT}`);
  addLog(`Monitoring Minecraft server: ${MC_HOST}:${MC_PORT}`);
  addLog(`Admin panel: http://localhost:${PORT}/admin`);
});

// Initial poll + interval
pollStatus();
startPolling(POLL_INTERVAL);

