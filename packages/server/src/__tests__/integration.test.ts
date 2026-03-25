/**
 * End-to-end integration tests.
 * Two real WebSocket clients, one server, full encrypted message flow.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from '../room.js';
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

function waitForMessageType(ws: WebSocket, type: string): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const handler = (data: Buffer): void => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
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

describe('end-to-end integration', () => {
  it('two clients join same room and exchange messages', async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const roomHash = randomBytes(32).toString('hex');
    const alicePubKey = randomBytes(32).toString('hex');
    const bobPubKey = randomBytes(32).toString('hex');

    // Alice joins
    const aliceJoin = waitForMessage(alice);
    send(alice, { type: 'JOIN', roomHash, publicKey: alicePubKey });
    const aliceJoined = await aliceJoin;
    expect(aliceJoined.type).toBe('ROOM_JOINED');
    if (aliceJoined.type === 'ROOM_JOINED') {
      expect(aliceJoined.peers).toEqual([]);
    }

    // Bob joins — Alice sees PEER_JOINED, Bob sees ROOM_JOINED with Alice
    const alicePeerJoin = waitForMessage(alice);
    const bobJoin = waitForMessage(bob);
    send(bob, { type: 'JOIN', roomHash, publicKey: bobPubKey });
    const [bobJoined, peerJoined] = await Promise.all([bobJoin, alicePeerJoin]);

    expect(bobJoined.type).toBe('ROOM_JOINED');
    if (bobJoined.type === 'ROOM_JOINED') {
      expect(bobJoined.peers.length).toBe(1);
      expect(bobJoined.peers[0]?.publicKey).toBe(alicePubKey);
    }
    expect(peerJoined.type).toBe('PEER_JOINED');
    if (peerJoined.type === 'PEER_JOINED') {
      expect(peerJoined.publicKey).toBe(bobPubKey);
    }

    // Alice sends a message — Bob receives it with identical payload
    const bobReceive = waitForMessage(bob);
    const payload = 'encrypted-payload-' + randomBytes(16).toString('hex');
    send(alice, { type: 'MESSAGE', payload });
    const relayed = await bobReceive;
    expect(relayed.type).toBe('MESSAGE');
    if (relayed.type === 'MESSAGE') {
      expect(relayed.payload).toBe(payload);
    }

    // Bob sends back — Alice receives
    const aliceReceive = waitForMessage(alice);
    const reply = 'reply-' + randomBytes(16).toString('hex');
    send(bob, { type: 'MESSAGE', payload: reply });
    const relayed2 = await aliceReceive;
    expect(relayed2.type).toBe('MESSAGE');
    if (relayed2.type === 'MESSAGE') {
      expect(relayed2.payload).toBe(reply);
    }

    alice.close();
    bob.close();
  });

  it('fixed-size payloads pass through server unchanged', async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const roomHash = randomBytes(32).toString('hex');
    send(alice, { type: 'JOIN', roomHash, publicKey: 'a'.repeat(64) });
    await waitForMessage(alice);

    const bobJoinNotify = waitForMessage(alice);
    send(bob, { type: 'JOIN', roomHash, publicKey: 'b'.repeat(64) });
    await waitForMessage(bob);
    await bobJoinNotify;

    // Send a fixed-size payload (simulating CBR) — must arrive unchanged
    const fixedPayload = 'x'.repeat(720);
    const bobReceive = waitForMessage(bob);
    send(alice, { type: 'MESSAGE', payload: fixedPayload });
    const msg = await bobReceive;
    expect(msg.type).toBe('MESSAGE');
    if (msg.type === 'MESSAGE') {
      expect(msg.payload).toBe(fixedPayload);
      expect(msg.payload.length).toBe(720);
    }

    alice.close();
    bob.close();
  });

  it('messages from non-joined client are silently dropped', async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const roomHash = randomBytes(32).toString('hex');
    send(alice, { type: 'JOIN', roomHash, publicKey: 'a'.repeat(64) });
    await waitForMessage(alice);

    const bobJoinNotify = waitForMessage(alice);
    send(bob, { type: 'JOIN', roomHash, publicKey: 'b'.repeat(64) });
    await waitForMessage(bob);
    await bobJoinNotify;

    // Third client sends MESSAGE without joining — should be dropped
    const rogue = await connectClient();
    send(rogue, { type: 'MESSAGE', payload: 'rogue-chaff' });

    // Send a real message from Alice to confirm Bob's connection still works
    const bobReceive = waitForMessage(bob);
    send(alice, { type: 'MESSAGE', payload: 'legit' });
    const msg = await bobReceive;
    expect(msg.type).toBe('MESSAGE');
    if (msg.type === 'MESSAGE') {
      expect(msg.payload).toBe('legit');
    }

    rogue.close();
    alice.close();
    bob.close();
  });

  it('room is cleaned up when all clients leave', async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const roomHash = randomBytes(32).toString('hex');
    send(alice, { type: 'JOIN', roomHash, publicKey: 'a'.repeat(64) });
    await waitForMessage(alice);

    const notify = waitForMessage(alice);
    send(bob, { type: 'JOIN', roomHash, publicKey: 'b'.repeat(64) });
    await waitForMessage(bob);
    await notify;

    expect(rooms.getRoomCount()).toBe(1);

    // Both leave
    const aliceLeft = waitForMessageType(bob, 'PEER_LEFT');
    alice.close();
    await aliceLeft;

    bob.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(rooms.getRoomCount()).toBe(0);
  });

  it('three clients in a room — messages reach all peers', async () => {
    const alice = await connectClient();
    const bob = await connectClient();
    const charlie = await connectClient();

    const roomHash = randomBytes(32).toString('hex');

    // All join
    send(alice, { type: 'JOIN', roomHash, publicKey: 'a'.repeat(64) });
    await waitForMessage(alice);

    const n1 = waitForMessage(alice);
    send(bob, { type: 'JOIN', roomHash, publicKey: 'b'.repeat(64) });
    await waitForMessage(bob);
    await n1;

    const n2a = waitForMessage(alice);
    const n2b = waitForMessage(bob);
    send(charlie, { type: 'JOIN', roomHash, publicKey: 'c'.repeat(64) });
    await waitForMessage(charlie);
    await n2a;
    await n2b;

    // Alice sends — both Bob and Charlie receive
    const bobRecv = waitForMessage(bob);
    const charlieRecv = waitForMessage(charlie);
    send(alice, { type: 'MESSAGE', payload: 'hello-all' });

    const [bobMsg, charlieMsg] = await Promise.all([bobRecv, charlieRecv]);
    expect(bobMsg.type).toBe('MESSAGE');
    expect(charlieMsg.type).toBe('MESSAGE');
    if (bobMsg.type === 'MESSAGE') expect(bobMsg.payload).toBe('hello-all');
    if (charlieMsg.type === 'MESSAGE') expect(charlieMsg.payload).toBe('hello-all');

    alice.close();
    bob.close();
    charlie.close();
  });

  it('message relay within rate limit works correctly', async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const roomHash = randomBytes(32).toString('hex');
    send(alice, { type: 'JOIN', roomHash, publicKey: 'a'.repeat(64) });
    await waitForMessage(alice);

    const n = waitForMessage(alice);
    send(bob, { type: 'JOIN', roomHash, publicKey: 'b'.repeat(64) });
    await waitForMessage(bob);
    await n;

    // Send 10 fixed-size messages (within rate limit of 15/s)
    const PACKET_COUNT = 10;
    const PAYLOAD_SIZE = 720;
    let received = 0;

    const allReceived = new Promise<void>((resolve) => {
      bob.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (msg.type === 'MESSAGE') {
          expect(msg.payload.length).toBe(PAYLOAD_SIZE);
          received++;
          if (received === PACKET_COUNT) resolve();
        }
      });
    });

    for (let i = 0; i < PACKET_COUNT; i++) {
      send(alice, { type: 'MESSAGE', payload: 'p'.repeat(PAYLOAD_SIZE) });
    }

    await allReceived;
    expect(received).toBe(PACKET_COUNT);

    alice.close();
    bob.close();
  });
});
