<div align="center">

<img src="https://img.shields.io/badge/MinePulse-Minecraft%20Monitor-22c55e?style=for-the-badge&logo=minecraft&logoColor=white" alt="MinePulse" />

# MinePulse 🟢

**A beautiful, real-time Minecraft server status monitor with a powerful admin panel.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue?style=flat-square)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

</div>

---

## 📖 Overview

MinePulse is a self-hosted, real-time Minecraft server status monitor. It polls your Minecraft server at configurable intervals and presents players, uptime history, latency, and more in a sleek, animated dark-themed dashboard — no client mods or plugins needed.

An optional **password-protected Admin Panel** lets you manage everything without touching a config file: change the server target, customize branding, display maintenance banners with ETAs, post announcements, and more. All settings persist across restarts via an auto-generated `config.json`.

---

## ✨ Features

### Public Dashboard
- 🟢 **Live server status** — Online, Offline, Crashed states with custom labels
- 👥 **Player list** with Minecraft avatars and session duration
- 📊 **Uptime heartbeat chart** (Uptime Kuma-style) with 1h / 6h / 12h / 24h range views
- ⏱️ **Latency & version** display
- 📣 **Announcement banner** — shown when set by admin
- 🔧 **Admin mode banners** — Maintenance / Updating / Restarting with live countdown
- ✨ **Animated dark UI** with glassmorphism and live particle effects

### Admin Panel
- 🔒 **Secure login** — passwords verified with bcrypt (12 rounds) server-side
- 🧠 **First-login prompt** — auto-redirects to password change on default credentials
- 🌐 **Server Config** — change target host/port on the fly without restarting
- 🎨 **Branding** — set website name, custom display name, and upload a custom logo
- 📢 **Announcement** — post/clear banners visible on the public dashboard
- ⚠️ **Server Mode** — set Maintenance / Updating / Restarting modes with optional message and ETA countdown
- ⏳ **ETA timer** — auto-resets mode back to "Online" when timer expires
- 📋 **Live Logs** — real-time view of all server poll and admin action logs
- 🗑️ **Data Management** — clear status history
- 🔄 **Poll Interval** — dynamically adjust how often the server is polled (min 10s)
- 💾 **Persistent config** — all settings saved to `data/config.json` and survive restarts
- 🛡️ **Rate limiting** — brute-force protection on all endpoints
- 🪖 **Security headers** — helmet applied on all responses

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Web Framework | Express 5.x |
| MC Polling | [minecraft-server-util](https://www.npmjs.com/package/minecraft-server-util) — direct TCP ping, no external API |
| Frontend | Vanilla HTML + CSS + JavaScript |
| Password Hashing | bcrypt (12 rounds) |
| Security Headers | helmet |
| Rate Limiting | express-rate-limit |
| Container | Docker / Docker Compose |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ **or** [Docker](https://www.docker.com/)
- A Minecraft server reachable from the machine running MinePulse

---

### Method 1: NPM (Local / Dev)

**1. Clone the repository**
```bash
git clone https://github.com/your-username/minepulse.git
cd minepulse
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the server**
```bash
MC_HOST=play.your-server.com node server.js
```

Or use the built-in `dev` script (edit `package.json` to set your host first):
```bash
npm run dev
```

**4. Open in browser**
```
http://localhost:3000
```

#### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | `localhost` | Minecraft server address. Supports `host:port` shorthand |
| `MC_PORT` | `25565` | Minecraft server port (if not embedded in `MC_HOST`) |
| `PORT` | `3000` | Port MinePulse web server listens on |
| `POLL_INTERVAL` | `30000` | Polling interval in milliseconds (can be changed live in Admin Panel) |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS allowed origin — set to your public domain in production |

---

### Method 2: Docker (Named Volume — Recommended)

**1. Clone the repository**
```bash
git clone https://github.com/AaronPhilips101/minepulse.git
cd minepulse
```

**2. Build the Docker image**
```bash
docker build -t minepulse .
```

**3. Create the named volume (one-time setup)**
```bash
docker volume create minepulse-data
```

**4. Run the container**
```bash
docker run -d \
  --name minepulse \
  -p 3000:3000 \
  -e MC_HOST=play.your-server.com \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -v minepulse-data:/app/data \
  --restart unless-stopped \
  minepulse
```

> **Why a named volume?** Docker manages the storage at `/var/lib/docker/volumes/minepulse-data/`. It survives container restarts, removals, and re-creates — and doesn't depend on what directory you run Docker from.

**5. Open in browser**
```
http://localhost:3000
```

---

### Method 3: Docker Compose (Easiest — Recommended)

A `docker-compose.yml` is included in the repository. Edit the `MC_HOST` and `ALLOWED_ORIGIN` environment variables first, then:

```bash
# Start (builds image automatically on first run)
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Stop AND remove the named volume (⚠️ deletes all config permanently)
docker compose down -v
```

The compose file uses a **named Docker volume** (`minepulse-data`) by default. To switch to a bind mount instead (e.g. for easier local inspection), edit `docker-compose.yml`:
```yaml
volumes:
  # Comment out the named volume:
  # - minepulse-data:/app/data
  # Uncomment the bind mount:
  - ./data:/app/data
```

---

## 💾 Volume Management

### Inspect the config inside the volume
```bash
docker run --rm -v minepulse-data:/data alpine cat /data/config.json
```

### Back up the volume to a tar file
```bash
docker run --rm \
  -v minepulse-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/minepulse-backup.tar.gz -C / data
```

### Restore from a backup
```bash
docker run --rm \
  -v minepulse-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/minepulse-backup.tar.gz -C /
```

### List all MinePulse-related volumes
```bash
docker volume ls | grep minepulse
```

### Reset everything (⚠️ deletes all config)
```bash
docker stop minepulse && docker rm minepulse
docker volume rm minepulse-data
```

---

## 🔐 Admin Panel

### Accessing the Panel

Navigate to:
```
http://localhost:3000/admin
```

### Default Credentials

| Field | Value |
|---|---|
| Password | `admin` |

> ⚠️ **On first login with the default password, you will be automatically redirected to the Security tab and prompted to set a new password. You should do this immediately.**

### Security Model

- Passwords are verified using **bcrypt** (12 salt rounds) — industry-standard, GPU-resistant hashing. The plain-text password is never stored anywhere.
- On first boot, if a legacy plain-text or SHA-256 password is found in `config.json`, it is **automatically migrated to bcrypt** and re-saved.
- After **3 failed login attempts**, the panel locks out for 1 minute, then 5 minutes on subsequent failures.
- **Rate limiting** is enforced globally (120 req/min) and strictly on login (10 req/min per IP).
- **HTTP security headers** are applied to all responses via [helmet](https://helmetjs.github.io/) (CSP, X-Frame-Options, HSTS, etc.).
- **CORS** is restricted to the configured `ALLOWED_ORIGIN` — not open to all domains.
- Admin sessions are stored in `sessionStorage` (cleared automatically on tab close).
- After a password change, the server **invalidates the current session** and forces re-login.
- Admin token is **only accepted via HTTP headers** (`x-admin-token`) — never via URL parameters.

---

## ⚙️ Admin Panel Features

### 📋 Overview Tab
A live summary of server address, real-time status, admin mode, player count, latency, last poll time, and active ETA countdown.

### 🌐 Server Config Tab

| Setting | Description |
|---|---|
| **Host / IP** | Minecraft server address to monitor |
| **Port** | Server port (default: 25565) |
| **Website Name** | Name shown in the page title and logo |
| **Custom Display Name** | Overrides the server address shown on the public dashboard |
| **Website Icon** | Upload a custom PNG/JPG logo (max 5MB) |
| **Offline Label** | Custom text for the "Offline" state (e.g., "Down for Maintenance") |
| **Crashed Label** | Custom text for the "Crashed" state |
| **Crashed Timeout** | Minutes offline before state switches from "Offline" to "Crashed" (0 = disabled) |
| **Poll Interval** | How often to ping the server (min 10s). Presets: 15s, 30s, 1m, 2m, 5m |

### ⚠️ Server Mode Tab
Override the public display with a status banner. Options:
- 🟢 **Online** — Normal operation (default)
- 🔧 **Maintenance** — Shows a yellow maintenance banner
- 🔄 **Updating** — Shows a blue updating banner
- ⚡ **Restarting** — Shows a purple restarting banner

Each mode supports an optional **custom message** and an **ETA countdown**. When the ETA timer expires, the mode automatically resets back to Online.

### 📢 Announcement Tab
Post a notification banner that appears at the very top of the public dashboard. Leave blank to hide it. Supports live preview before saving.

### 🔒 Security Tab
Change the admin password. You must provide your current password to confirm. The new password must be **at least 8 characters**. After a successful change, your current session is invalidated and you are logged out automatically.

### 📋 Logs Tab
Real-time scrollable log of:
- Server poll results (online/offline/crashed transitions)
- Admin actions (config changes, logins, mode changes)
- Auto-refresh every 10 seconds (can be disabled)

### 🗃️ Data Tab
Clear the entire status history. This resets the uptime heartbeat chart. **This action cannot be undone.**

---

## 📁 Project Structure

```
minepulse/
├── server.js              # Express backend — polling, API routes, admin logic
├── package.json
├── Dockerfile
├── docker-compose.yml     # (you create this — example above)
├── .gitignore
├── .dockerignore
├── data/                  # Auto-created at runtime — DO NOT commit
│   └── config.json        # Persisted admin config and hashed password
└── public/
    ├── index.html         # Public status dashboard
    ├── app.js             # Dashboard frontend logic
    ├── style.css          # Dashboard styles
    ├── admin.html         # Admin panel UI
    ├── admin.js           # Admin panel frontend logic
    └── admin.css          # Admin panel styles
```

---

## 🔄 Updating

### With Docker

```bash
# Pull latest code
git pull

# Rebuild image
docker build -t minepulse .

# Restart container — named volume is preserved automatically
docker stop minepulse && docker rm minepulse

docker run -d \
  --name minepulse \
  -p 3000:3000 \
  -e MC_HOST=play.your-server.com \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -v minepulse-data:/app/data \
  --restart unless-stopped \
  minepulse
```

### With Docker Compose

```bash
git pull
docker compose up -d --build
```

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

---

## 📄 License

This project is licensed under the **GNU General Public License v2.0 (GPL-2.0)**.

See the [LICENSE](LICENSE) file for full details.

© 2026 [AaronPhilips101](https://github.com/AaronPhilips101)
