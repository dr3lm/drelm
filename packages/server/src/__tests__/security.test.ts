/**
 * Security-focused server tests.
 * Tests rate limiting, room capacity, payload validation,
 * and room slot exhaustion protections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, MAX_CLIENTS_PER_ROOM, MAX_ROOMS } from '../room.js';
import { createConnectionHandler } from '../handler.js';
import type { ServerMessage } from '@drelm/types';
import { randomBytes } from 'node:crypto';

let wss: WebSocketServer;
let rooms: RoomManager;
let port: number;

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port.toString()}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString()) as ServerMessage);
    });
  });
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

function validRoomHash(): string {
  return randomBytes(32).toString('hex'); // 64 hex chars
}

function validPublicKey(): string {
  return randomBytes(32).toString('hex'); // 64 hex chars
}

beforeEach(async () => {
  rooms = new RoomManager();
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', createConnectionHandler(rooms));
  await new Promise<void>((resolve) => wss.on('listening', resolve));
  const addr = wss.address();
  if (typeof addr === 'object' && addr !== null) {
    port = addr.port;
  }
});

afterEach(async () => {
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

describe('payload size validation', () => {
  it('rejects MESSAGE with payload > 800 characters', async () => {
    const ws = await connectClient();
    const roomHash = validRoomHash();
    const join = waitForMessage(ws);
    send(ws, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
    await join;

    // Send oversized payload — isClientMessage returns false, server sends ERROR
    send(ws, { type: 'MESSAGE', payload: 'x'.repeat(801) });

    const err = await Promise.race([
      waitForMessage(ws),
      new Promise<ServerMessage>((_, reject) =>
        setTimeout(() => reject(new Error('no response')), 1000),
      ),
    ]);

    expect(err.type).toBe('ERROR');
    if (err.type === 'ERROR') {
      expect(err.code).toBe('INVALID_MESSAGE');
    }

    ws.close();
  });

  it('accepts MESSAGE with payload <= 800 characters', async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();
    const roomHash = validRoomHash();

    // Both join
    const j1 = waitForMessage(ws1);
    send(ws1, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
    await j1;

    const j2 = waitForMessage(ws2);
    const n1 = waitForMessage(ws1);
    send(ws2, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
    await j2;
    await n1;

    // Send valid-size payload
    const relayPromise = waitForMessage(ws2);
    send(ws1, { type: 'MESSAGE', payload: 'x'.repeat(400) });
    const msg = await relayPromise;

    expect(msg.type).toBe('MESSAGE');
    if (msg.type === 'MESSAGE') {
      expect(msg.payload.length).toBe(400);
    }

    ws1.close();
    ws2.close();
  });

  it('rejects JOIN with wrong roomHash length', async () => {
    const ws = await connectClient();
    const errPromise = waitForMessage(ws);

    // roomHash too short (should be 64 hex chars)
    send(ws, { type: 'JOIN', roomHash: 'abc', publicKey: validPublicKey() });
    const err = await errPromise;

    expect(err.type).toBe('ERROR');
    if (err.type === 'ERROR') {
      expect(err.code).toBe('INVALID_MESSAGE');
    }

    ws.close();
  });

  it('rejects JOIN with wrong publicKey length', async () => {
    const ws = await connectClient();
    const errPromise = waitForMessage(ws);

    send(ws, { type: 'JOIN', roomHash: validRoomHash(), publicKey: 'short' });
    const err = await errPromise;

    expect(err.type).toBe('ERROR');
    if (err.type === 'ERROR') {
      expect(err.code).toBe('INVALID_MESSAGE');
    }

    ws.close();
  });
});

describe('room capacity limits', () => {
  it('returns ROOM_FULL when room reaches MAX_CLIENTS_PER_ROOM', async () => {
    const roomHash = validRoomHash();
    const clients: WebSocket[] = [];

    // Fill the room to capacity
    for (let i = 0; i < MAX_CLIENTS_PER_ROOM; i++) {
      const ws = await connectClient();
      clients.push(ws);
      const joinMsg = waitForMessage(ws);
      send(ws, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
      const msg = await joinMsg;
      expect(msg.type).toBe('ROOM_JOINED');
      // Drain PEER_JOINED notifications
    }

    // Next client should be rejected
    const overflow = await connectClient();
    const errPromise = waitForMessage(overflow);
    send(overflow, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
    const err = await errPromise;

    expect(err.type).toBe('ERROR');
    if (err.type === 'ERROR') {
      expect(err.code).toBe('ROOM_FULL');
    }

    // Cleanup
    overflow.close();
    for (const c of clients) {
      c.terminate();
    }
  });
});

describe('room count limits', () => {
  it('RoomManager rejects new rooms beyond MAX_ROOMS', () => {
    const manager = new RoomManager();
    const mockWs = {} as never;

    // Fill to capacity
    for (let i = 0; i < MAX_ROOMS; i++) {
      const result = manager.joinRoom(
        `room-${i.toString().padStart(6, '0')}`,
        { ws: mockWs, publicKey: `pk-${i.toString()}`, ephemeralId: `eid-${i.toString()}` },
      );
      expect(result).not.toBeNull();
    }

    expect(manager.getRoomCount()).toBe(MAX_ROOMS);

    // Next room should be rejected
    const result = manager.joinRoom(
      'overflow-room',
      { ws: mockWs, publicKey: 'pk-overflow', ephemeralId: 'eid-overflow' },
    );
    expect(result).toBeNull();
  });
});

describe('rate limiting', () => {
  it('drops messages exceeding 15/second', async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();
    const roomHash = validRoomHash();

    // Both join
    const j1 = waitForMessage(ws1);
    send(ws1, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
    await j1;

    const j2 = waitForMessage(ws2);
    const n1 = waitForMessage(ws1);
    send(ws2, { type: 'JOIN', roomHash, publicKey: validPublicKey() });
    await j2;
    await n1;

    // Send 20 messages as fast as possible from ws1
    for (let i = 0; i < 20; i++) {
      send(ws1, { type: 'MESSAGE', payload: 'x'.repeat(400) });
    }

    // Collect messages received by ws2 within a short window
    const received: ServerMessage[] = [];
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ws2.off('message', handler);
        resolve();
      }, 200);

      const handler = (data: Buffer): void => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (msg.type === 'MESSAGE') {
          received.push(msg);
        }
      };

      ws2.on('message', handler);

      // Ensure we resolve even if timeout fires
      void timeout;
    });

    // Should receive at most 15 (rate limit)
    expect(received.length).toBeLessThanOrEqual(15);
    // Should receive at least some
    expect(received.length).toBeGreaterThan(0);

    ws1.close();
    ws2.close();
  });
});
