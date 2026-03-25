import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from '../room.js';
import { createConnectionHandler } from '../handler.js';
import type { ServerMessage } from '@drelm/types';

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

function sendMessage(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

beforeEach(async () => {
  rooms = new RoomManager();
  wss = new WebSocketServer({ port: 0 });
  const handler = createConnectionHandler(rooms);
  wss.on('connection', handler);

  await new Promise<void>((resolve) => wss.on('listening', resolve));
  const addr = wss.address();
  if (typeof addr === 'object' && addr !== null) {
    port = addr.port;
  }
});

afterEach(async () => {
  // Close all connections then the server
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

describe('WebSocket handler', () => {
  it('joins a room and receives ROOM_JOINED', async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    sendMessage(ws, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: 'b'.repeat(64) });
    const msg = await msgPromise;

    expect(msg.type).toBe('ROOM_JOINED');
    if (msg.type === 'ROOM_JOINED') {
      expect(msg.peers).toEqual([]);
    }

    ws.close();
  });

  it('notifies existing peer when new client joins', async () => {
    const ws1 = await connectClient();
    const join1 = waitForMessage(ws1);
    sendMessage(ws1, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '1'.repeat(64) });
    await join1;

    const peerJoinPromise = waitForMessage(ws1);
    const ws2 = await connectClient();
    const join2 = waitForMessage(ws2);
    sendMessage(ws2, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '2'.repeat(64) });

    const [joinMsg, peerMsg] = await Promise.all([join2, peerJoinPromise]);

    expect(joinMsg.type).toBe('ROOM_JOINED');
    if (joinMsg.type === 'ROOM_JOINED') {
      expect(joinMsg.peers).toEqual([{ publicKey: '1'.repeat(64) }]);
    }

    expect(peerMsg.type).toBe('PEER_JOINED');
    if (peerMsg.type === 'PEER_JOINED') {
      expect(peerMsg.publicKey).toBe('2'.repeat(64));
    }

    ws1.close();
    ws2.close();
  });

  it('relays messages between clients', async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    const join1 = waitForMessage(ws1);
    sendMessage(ws1, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '1'.repeat(64) });
    await join1;

    const join2 = waitForMessage(ws2);
    const peerNotify = waitForMessage(ws1);
    sendMessage(ws2, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '2'.repeat(64) });
    await join2;
    await peerNotify;

    // ws1 sends a message, ws2 should receive it
    const relayPromise = waitForMessage(ws2);
    sendMessage(ws1, { type: 'MESSAGE', payload: 'encrypted-data-here' });
    const relayed = await relayPromise;

    expect(relayed.type).toBe('MESSAGE');
    if (relayed.type === 'MESSAGE') {
      expect(relayed.payload).toBe('encrypted-data-here');
    }

    ws1.close();
    ws2.close();
  });

  it('notifies peers when client disconnects', async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    const join1 = waitForMessage(ws1);
    sendMessage(ws1, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '1'.repeat(64) });
    await join1;

    const join2 = waitForMessage(ws2);
    const peerNotify = waitForMessage(ws1);
    sendMessage(ws2, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '2'.repeat(64) });
    await join2;
    await peerNotify;

    const leftPromise = waitForMessage(ws1);
    ws2.close();
    const leftMsg = await leftPromise;

    expect(leftMsg.type).toBe('PEER_LEFT');
    if (leftMsg.type === 'PEER_LEFT') {
      expect(leftMsg.publicKey).toBe('2'.repeat(64));
    }

    ws1.close();
  });

  it('returns error for invalid messages', async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    sendMessage(ws, { type: 'INVALID' });
    const msg = await msgPromise;

    expect(msg.type).toBe('ERROR');
    if (msg.type === 'ERROR') {
      expect(msg.code).toBe('INVALID_MESSAGE');
    }

    ws.close();
  });

  it('returns error for duplicate join', async () => {
    const ws = await connectClient();
    const join = waitForMessage(ws);
    sendMessage(ws, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '1'.repeat(64) });
    await join;

    const errPromise = waitForMessage(ws);
    sendMessage(ws, { type: 'JOIN', roomHash: 'b'.repeat(64), publicKey: '1'.repeat(64) });
    const err = await errPromise;

    expect(err.type).toBe('ERROR');
    if (err.type === 'ERROR') {
      expect(err.code).toBe('ALREADY_JOINED');
    }

    ws.close();
  });

  it('cleans up room when last client leaves', async () => {
    const ws = await connectClient();
    const join = waitForMessage(ws);
    sendMessage(ws, { type: 'JOIN', roomHash: 'a'.repeat(64), publicKey: '1'.repeat(64) });
    await join;

    expect(rooms.getRoomCount()).toBe(1);

    ws.close();
    // Wait for close handler
    await new Promise((r) => setTimeout(r, 50));

    expect(rooms.getRoomCount()).toBe(0);
  });
});
