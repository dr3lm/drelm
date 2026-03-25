import { WebSocketServer } from 'ws';
import { RoomManager } from './room.js';
import { createConnectionHandler } from './handler.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const TOR_ENABLED = process.env['TOR_ENABLED'] === 'true';

const rooms = new RoomManager();
const wss = new WebSocketServer({
  port: PORT,
  // Hard limit on WebSocket frame size. CBR payloads are ~750 bytes
  // of JSON ({"type":"MESSAGE","payload":"...720 chars..."}). 2 KiB
  // gives generous headroom while rejecting oversized frames at the
  // transport layer before they reach application code.
  maxPayload: 2048,
});

const handleConnection = createConnectionHandler(rooms);

wss.on('connection', handleConnection);

wss.on('listening', () => {
  // Log to stderr only — no stdout logging of user data
  console.error(`drelm server listening on ws://localhost:${PORT.toString()}`);

  if (TOR_ENABLED) {
    loadOnionAddress();
  }
});

/**
 * If Tor is enabled, attempt to read the .onion hostname from the
 * Tor hidden service directory. This is logged once on startup and
 * never again. The operator communicates it to users out-of-band.
 *
 * Expected location: /var/lib/tor/drelm/hostname
 * Override with TOR_HOSTNAME_FILE env var.
 */
function loadOnionAddress(): void {
  const hostnameFile = process.env['TOR_HOSTNAME_FILE']
    ?? resolve('/var/lib/tor/drelm/hostname');

  if (existsSync(hostnameFile)) {
    const onion = readFileSync(hostnameFile, 'utf-8').trim();
    console.error(`drelm .onion address: ${onion}`);
    console.error('this address is logged once and never again.');
  } else {
    console.error('TOR_ENABLED=true but no hostname file found at: ' + hostnameFile);
    console.error('ensure Tor is running and the hidden service is configured.');
    console.error('see docs/SELF_HOST.md for setup instructions.');
  }
}

export { rooms, wss };
