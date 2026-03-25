# Self-Hosting drelm

Run your own instance in 10 minutes on a $5 VPS.

---

## Prerequisites

- A Linux server (Ubuntu 22.04+ recommended)
- Docker and Docker Compose installed
- A domain name (optional, for HTTPS)

---

## Quick Start (Docker)

```bash
# Clone the repo
git clone https://github.com/CTC97/drelm.git
cd drelm

# Build the client
pnpm install
pnpm --filter @drelm/client build

# Start server + nginx
docker compose -f docker/docker-compose.yml up -d
```

The client is now served at `http://your-server-ip:80`.
The WebSocket server runs behind nginx at `/ws`.

---

## Quick Start (No Docker)

```bash
# Clone and install
git clone https://github.com/CTC97/drelm.git
cd drelm
pnpm install
pnpm -r build

# Run the server
node packages/server/dist/index.js
# → ws://localhost:3000

# Serve the client with any static file server
npx serve packages/client/dist -l 8080
# → http://localhost:8080
```

---

## HTTPS with Let's Encrypt

```bash
# Install certbot
apt install certbot

# Get a certificate
certbot certonly --standalone -d your-domain.com

# Copy certs to the docker ssl directory
mkdir -p docker/ssl
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem docker/ssl/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem docker/ssl/

# Edit docker/nginx.conf:
# - Uncomment the HTTPS server block
# - Uncomment the HTTP→HTTPS redirect
# - Update server_name to your domain

# Restart
docker compose -f docker/docker-compose.yml restart nginx
```

---

## Tor Hidden Service

To add a .onion address:

```bash
# Install Tor
apt install tor

# Configure hidden service
cat >> /etc/tor/torrc <<EOF
HiddenServiceDir /var/lib/tor/drelm/
HiddenServicePort 80 127.0.0.1:80
EOF

# Restart Tor
systemctl restart tor

# Get your .onion address
cat /var/lib/tor/drelm/hostname
```

Then start the drelm server with Tor enabled:

```bash
TOR_ENABLED=true TOR_HOSTNAME_FILE=/var/lib/tor/drelm/hostname \
  node packages/server/dist/index.js
```

Or in docker-compose, add the environment variables:

```yaml
services:
  server:
    environment:
      - PORT=3000
      - TOR_ENABLED=true
      - TOR_HOSTNAME_FILE=/var/lib/tor/drelm/hostname
    volumes:
      - /var/lib/tor/drelm/hostname:/var/lib/tor/drelm/hostname:ro
```

The .onion address is logged once on server startup and never again.
It is your responsibility to communicate it to users.

The client auto-detects when accessed via `.onion` and connects via
`ws://` (Tor provides transport encryption, so TLS is unnecessary
and would require a self-signed cert).

---

## Configuration

drelm has almost no configuration by design.
Configurable security parameters are a footgun.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | WebSocket server port |
| `TOR_ENABLED` | `false` | Log .onion address on startup |
| `TOR_HOSTNAME_FILE` | `/var/lib/tor/drelm/hostname` | Path to Tor hostname file |

That's it. There are no database URLs, no API keys, no feature flags.

---

## What gets stored on disk

Nothing. The server stores all state in memory. There is no database.
There are no log files (logging goes to stderr, not files). A server
restart erases all rooms and connections.

If you want to be thorough: run the server in a Docker container
with no volume mounts. There is physically nowhere for data to persist.

---

## Monitoring

The server exposes nothing for monitoring by default. If you need to
know it's alive, check that the WebSocket port is accepting connections.

Do not add logging middleware. Do not add metrics that track per-room
or per-connection data. The server's ignorance is a feature.

---

## Resource Requirements

- **RAM:** ~50MB base + ~1KB per active connection
- **CPU:** Negligible (JSON parse + WebSocket relay)
- **Bandwidth:** ~5.4 KB/s per client (CBR) + message relay overhead
- **Disk:** 0 bytes (no storage)

A $5/month VPS can handle hundreds of concurrent users.
