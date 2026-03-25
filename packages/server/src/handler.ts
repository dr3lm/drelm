import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@drelm/types';
import { isClientMessage } from '@drelm/types';
import type { RoomManager, Client } from './room.js';
import { randomBytes } from 'node:crypto';

/**
 * Per-client rate limiting.
 * CBR sends 10 packets/s; allow 15/s with burst headroom.
 */
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 15;

interface ConnectionState {
  ephemeralId: string;
  roomHash: string | null;
  publicKey: string | null;
  messageTimestamps: number[];
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function generateEphemeralId(): string {
  return randomBytes(16).toString('hex');
}

export function createConnectionHandler(rooms: RoomManager) {
  return function handleConnection(ws: WebSocket): void {
    const state: ConnectionState = {
      ephemeralId: generateEphemeralId(),
      roomHash: null,
      publicKey: null,
      messageTimestamps: [],
    };

    ws.on('message', (data: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString()) as unknown;
      } catch {
        send(ws, { type: 'ERROR', code: 'INVALID_MESSAGE' });
        return;
      }

      if (!isClientMessage(parsed)) {
        send(ws, { type: 'ERROR', code: 'INVALID_MESSAGE' });
        return;
      }

      handleMessage(ws, state, parsed, rooms);
    });

    ws.on('close', () => {
      handleDisconnect(state, rooms);
    });
  };
}

function handleMessage(
  ws: WebSocket,
  state: ConnectionState,
  message: ClientMessage,
  rooms: RoomManager,
): void {
  switch (message.type) {
    case 'JOIN':
      handleJoin(ws, state, message.roomHash, message.publicKey, rooms);
      break;
    case 'MESSAGE':
      handleChatMessage(ws, state, message.payload, rooms);
      break;
    case 'LEAVE':
      handleLeave(ws, state, rooms);
      break;
  }
}

function handleJoin(
  ws: WebSocket,
  state: ConnectionState,
  roomHash: string,
  publicKey: string,
  rooms: RoomManager,
): void {
  if (state.roomHash !== null) {
    send(ws, { type: 'ERROR', code: 'ALREADY_JOINED' });
    return;
  }

  const client: Client = {
    ws,
    publicKey,
    ephemeralId: state.ephemeralId,
  };

  const room = rooms.joinRoom(roomHash, client);
  if (!room) {
    send(ws, { type: 'ERROR', code: 'ROOM_FULL' });
    return;
  }

  state.roomHash = roomHash;
  state.publicKey = publicKey;

  // Get existing peers (excluding self)
  const peers: Array<{ publicKey: string }> = [];
  for (const [id, peer] of room.clients) {
    if (id !== state.ephemeralId) {
      peers.push({ publicKey: peer.publicKey });
    }
  }

  // Tell the joining client about existing peers
  send(ws, { type: 'ROOM_JOINED', peers });

  // Notify existing peers about the new client
  for (const [id, peer] of room.clients) {
    if (id !== state.ephemeralId) {
      send(peer.ws, { type: 'PEER_JOINED', publicKey });
    }
  }
}

function isRateLimited(state: ConnectionState): boolean {
  const now = Date.now();
  // Remove timestamps outside the window
  state.messageTimestamps = state.messageTimestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (state.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    return true;
  }
  state.messageTimestamps.push(now);
  return false;
}

function handleChatMessage(
  ws: WebSocket,
  state: ConnectionState,
  payload: string,
  rooms: RoomManager,
): void {
  if (state.roomHash === null) return;

  if (isRateLimited(state)) {
    // Silently drop — do not send error (rate-limited chaff is expected)
    return;
  }

  const room = rooms.getRoom(state.roomHash);
  if (!room) return;

  // Relay encrypted payload to all other clients — server is blind
  for (const [id, peer] of room.clients) {
    if (id !== state.ephemeralId) {
      send(peer.ws, { type: 'MESSAGE', from: state.ephemeralId, payload });
    }
  }
}

function handleLeave(
  ws: WebSocket,
  state: ConnectionState,
  rooms: RoomManager,
): void {
  handleDisconnect(state, rooms);
  // Acknowledge by closing the connection
  ws.close();
}

function handleDisconnect(
  state: ConnectionState,
  rooms: RoomManager,
): void {
  if (state.roomHash === null) return;

  const room = rooms.getRoom(state.roomHash);

  rooms.leaveRoom(state.roomHash, state.ephemeralId);

  // Notify remaining peers
  if (room) {
    for (const [id, peer] of room.clients) {
      if (id !== state.ephemeralId) {
        send(peer.ws, { type: 'PEER_LEFT', publicKey: state.publicKey ?? '' });
      }
    }
  }

  state.roomHash = null;
  state.publicKey = null;
}
