/**
 * End-to-end crypto integration tests.
 *
 * Full pipeline: plaintext → ratchet encrypt → room-key encrypt →
 * wire (base64) → room-key decrypt → ratchet decrypt → plaintext.
 *
 * Tests use real X25519 keypairs, real ECDH, real Double Ratchet sessions,
 * and real AES-256-GCM room-key encryption. Nothing is mocked.
 */

import { describe, it, expect } from 'vitest';
import { generateKeypair, exportPublicKey } from '../keypair.js';
import { PeerManager } from '../peers.js';
import { encryptForWire, decryptFromWire, generateChaff, WIRE_PAYLOAD_SIZE } from '../cbr.js';
import { bytesToHex } from '../random.js';

// --- Helpers ---

async function makeRoomKey(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

interface Peer {
  manager: PeerManager;
  pubHex: string;
}

async function makePeer(): Promise<Peer> {
  const kp = await generateKeypair();
  const manager = await PeerManager.create(kp);
  return { manager, pubHex: manager.ownPubKeyHex };
}

/** Full send pipeline: encryptForPeers → encryptForWire for each. */
async function sendMessage(
  from: PeerManager,
  roomKey: CryptoKey,
  sender: string,
  text: string,
): Promise<string[]> {
  const payloads = await from.encryptForPeers(sender, text);
  const wires: string[] = [];
  for (const p of payloads) {
    const w = await encryptForWire(roomKey, p);
    expect(w).not.toBeNull();
    wires.push(w!);
  }
  return wires;
}

/** Full receive pipeline: decryptFromWire → decryptMessage. */
async function receiveMessage(
  to: PeerManager,
  roomKey: CryptoKey,
  wire: string,
): Promise<{ sender: string; text: string } | null> {
  const inner = await decryptFromWire(roomKey, wire);
  if (!inner) return null;
  const result = await to.decryptMessage(inner);
  if (!result) return null;
  return result.message;
}

// --- Tests ---

describe('full crypto pipeline — two peers', () => {
  it('Alice sends, Bob receives', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const wires = await sendMessage(alice.manager, roomKey, 'alice', 'hello bob');
    expect(wires.length).toBe(1);
    expect(wires[0]!.length).toBe(WIRE_PAYLOAD_SIZE);

    const msg = await receiveMessage(bob.manager, roomKey, wires[0]!);
    expect(msg).not.toBeNull();
    expect(msg!.sender).toBe('alice');
    expect(msg!.text).toBe('hello bob');
  });

  it('Bob replies, Alice receives', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    // Alice sends first
    const w1 = await sendMessage(alice.manager, roomKey, 'alice', 'hello');
    await receiveMessage(bob.manager, roomKey, w1[0]!);

    // Bob replies
    const w2 = await sendMessage(bob.manager, roomKey, 'bob', 'hi alice');
    const msg = await receiveMessage(alice.manager, roomKey, w2[0]!);
    expect(msg).not.toBeNull();
    expect(msg!.sender).toBe('bob');
    expect(msg!.text).toBe('hi alice');
  });

  it('10-message conversation with direction changes', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const conversation = [
      { from: alice, to: bob, name: 'alice', text: 'hey' },
      { from: bob, to: alice, name: 'bob', text: 'sup' },
      { from: alice, to: bob, name: 'alice', text: 'not much' },
      { from: alice, to: bob, name: 'alice', text: 'you?' },
      { from: bob, to: alice, name: 'bob', text: 'same' },
      { from: bob, to: alice, name: 'bob', text: 'quiet day' },
      { from: bob, to: alice, name: 'bob', text: 'any plans?' },
      { from: alice, to: bob, name: 'alice', text: 'nope' },
      { from: bob, to: alice, name: 'bob', text: 'cool' },
      { from: alice, to: bob, name: 'alice', text: 'later' },
    ];

    for (const turn of conversation) {
      const wires = await sendMessage(turn.from.manager, roomKey, turn.name, turn.text);
      const msg = await receiveMessage(turn.to.manager, roomKey, wires[0]!);
      expect(msg).not.toBeNull();
      expect(msg!.sender).toBe(turn.name);
      expect(msg!.text).toBe(turn.text);
    }
  });
});

describe('full crypto pipeline — multi-peer rooms', () => {
  it('three peers: sender produces N-1 packets, each recipient gets theirs', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();
    const charlie = await makePeer();

    // Full mesh peer setup
    await alice.manager.addPeer(bob.pubHex);
    await alice.manager.addPeer(charlie.pubHex);
    await bob.manager.addPeer(alice.pubHex);
    await bob.manager.addPeer(charlie.pubHex);
    await charlie.manager.addPeer(alice.pubHex);
    await charlie.manager.addPeer(bob.pubHex);

    const wires = await sendMessage(alice.manager, roomKey, 'alice', 'group msg');
    expect(wires.length).toBe(2);

    // Simulate server broadcast: every recipient tries every packet
    let bobGot = false;
    let charlieGot = false;

    for (const w of wires) {
      const bobMsg = await receiveMessage(bob.manager, roomKey, w);
      if (bobMsg) {
        expect(bobMsg.sender).toBe('alice');
        expect(bobMsg.text).toBe('group msg');
        bobGot = true;
      }
      const charlieMsg = await receiveMessage(charlie.manager, roomKey, w);
      if (charlieMsg) {
        expect(charlieMsg.sender).toBe('alice');
        expect(charlieMsg.text).toBe('group msg');
        charlieGot = true;
      }
    }

    expect(bobGot).toBe(true);
    expect(charlieGot).toBe(true);
  });

  it('three peers: full round of conversation', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();
    const charlie = await makePeer();

    const peers = [alice, bob, charlie];
    // Full mesh
    for (const p of peers) {
      for (const other of peers) {
        if (p !== other) await p.manager.addPeer(other.pubHex);
      }
    }

    // Alice → everyone
    const w1 = await sendMessage(alice.manager, roomKey, 'alice', 'hello room');
    for (const w of w1) {
      await receiveMessage(bob.manager, roomKey, w);
      await receiveMessage(charlie.manager, roomKey, w);
    }

    // Bob → everyone
    const w2 = await sendMessage(bob.manager, roomKey, 'bob', 'hey all');
    for (const w of w2) {
      await receiveMessage(alice.manager, roomKey, w);
      await receiveMessage(charlie.manager, roomKey, w);
    }

    // Charlie → everyone
    const w3 = await sendMessage(charlie.manager, roomKey, 'charlie', 'yo');
    for (const w of w3) {
      const aMsg = await receiveMessage(alice.manager, roomKey, w);
      const bMsg = await receiveMessage(bob.manager, roomKey, w);
      // At least one of them gets each packet
      if (aMsg) {
        expect(aMsg.sender).toBe('charlie');
        expect(aMsg.text).toBe('yo');
      }
      if (bMsg) {
        expect(bMsg.sender).toBe('charlie');
        expect(bMsg.text).toBe('yo');
      }
    }
  });
});

describe('full crypto pipeline — forward secrecy properties', () => {
  it('same plaintext produces different ciphertext each time', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const w1 = await sendMessage(alice.manager, roomKey, 'alice', 'repeat');
    const w2 = await sendMessage(alice.manager, roomKey, 'alice', 'repeat');

    // Identical plaintext → different wire payloads (different ratchet keys + IVs)
    expect(w1[0]).not.toBe(w2[0]);

    // Both still decrypt correctly
    const m1 = await receiveMessage(bob.manager, roomKey, w1[0]!);
    const m2 = await receiveMessage(bob.manager, roomKey, w2[0]!);
    expect(m1!.text).toBe('repeat');
    expect(m2!.text).toBe('repeat');
  });

  it('each wire payload is unique even for the same message', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const wires = await sendMessage(alice.manager, roomKey, 'alice', 'x');
      expect(seen.has(wires[0]!)).toBe(false);
      seen.add(wires[0]!);

      await receiveMessage(bob.manager, roomKey, wires[0]!);
    }

    expect(seen.size).toBe(10);
  });

  it('compromised wire payload cannot be replayed', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const wires = await sendMessage(alice.manager, roomKey, 'alice', 'original');
    const msg = await receiveMessage(bob.manager, roomKey, wires[0]!);
    expect(msg!.text).toBe('original');

    // Replay the same wire payload — ratchet has advanced, should fail
    const replay = await receiveMessage(bob.manager, roomKey, wires[0]!);
    expect(replay).toBeNull();
  });
});

describe('full crypto pipeline — isolation and rejection', () => {
  it('wrong room key rejects at Layer 1', async () => {
    const roomKey1 = await makeRoomKey();
    const roomKey2 = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const wires = await sendMessage(alice.manager, roomKey1, 'alice', 'secret');

    // Wrong room key → Layer 1 decrypt fails → null (indistinguishable from chaff)
    const inner = await decryptFromWire(roomKey2, wires[0]!);
    expect(inner).toBeNull();
  });

  it('chaff is indistinguishable from real messages and rejected silently', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const realWires = await sendMessage(alice.manager, roomKey, 'alice', 'real');
    const chaff = generateChaff();

    // Same size
    expect(realWires[0]!.length).toBe(chaff.length);
    expect(realWires[0]!.length).toBe(WIRE_PAYLOAD_SIZE);

    // Both valid base64
    expect(() => atob(realWires[0]!)).not.toThrow();
    expect(() => atob(chaff)).not.toThrow();

    // Chaff fails Layer 1 silently
    const chaffResult = await decryptFromWire(roomKey, chaff);
    expect(chaffResult).toBeNull();

    // Real message succeeds
    const realResult = await receiveMessage(bob.manager, roomKey, realWires[0]!);
    expect(realResult!.text).toBe('real');
  });

  it('unrelated peer cannot decrypt messages between Alice and Bob', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();
    const eve = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    // Eve knows the room key (she has the phrase) but has no ratchet session with Alice
    const wires = await sendMessage(alice.manager, roomKey, 'alice', 'private');

    // Eve can strip Layer 1 (she has the room key)
    const inner = await decryptFromWire(roomKey, wires[0]!);
    expect(inner).not.toBeNull();

    // But Layer 2 fails — Eve has no session with Alice
    const eveResult = await eve.manager.decryptMessage(inner!);
    expect(eveResult).toBeNull();

    // Bob succeeds
    const bobResult = await bob.manager.decryptMessage(inner!);
    expect(bobResult).not.toBeNull();
    expect(bobResult!.message.text).toBe('private');
  });

  it('peer who joins after a message was sent cannot decrypt it', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    // Alice sends a message before Charlie joins
    const wires = await sendMessage(alice.manager, roomKey, 'alice', 'before charlie');
    await receiveMessage(bob.manager, roomKey, wires[0]!);

    // Charlie joins now, establishes sessions
    const charlie = await makePeer();
    await alice.manager.addPeer(charlie.pubHex);
    await charlie.manager.addPeer(alice.pubHex);

    // Charlie tries the old wire payload — Layer 1 succeeds but ratchet fails
    const inner = await decryptFromWire(roomKey, wires[0]!);
    expect(inner).not.toBeNull();
    const charlieResult = await charlie.manager.decryptMessage(inner!);
    expect(charlieResult).toBeNull();
  });
});

describe('full crypto pipeline — wire format properties', () => {
  it('all wire payloads are exactly WIRE_PAYLOAD_SIZE', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    // Short message
    const w1 = await sendMessage(alice.manager, roomKey, 'a', 'hi');
    expect(w1[0]!.length).toBe(WIRE_PAYLOAD_SIZE);
    await receiveMessage(bob.manager, roomKey, w1[0]!);

    // Longer message
    const w2 = await sendMessage(bob.manager, roomKey, 'bob-with-long-name', 'this is a longer message with more characters in it');
    expect(w2[0]!.length).toBe(WIRE_PAYLOAD_SIZE);
    const m2 = await receiveMessage(alice.manager, roomKey, w2[0]!);
    expect(m2!.text).toBe('this is a longer message with more characters in it');
  });

  it('username is hidden inside encryption — not visible in wire payload', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const wires = await sendMessage(alice.manager, roomKey, 'secret-identity', 'hello');

    // The wire payload is base64 — username is not visible
    expect(wires[0]!.includes('secret-identity')).toBe(false);

    // But Bob can see it after full decryption
    const msg = await receiveMessage(bob.manager, roomKey, wires[0]!);
    expect(msg!.sender).toBe('secret-identity');
  });

  it('public keys are not visible in the wire payload', async () => {
    const roomKey = await makeRoomKey();
    const alice = await makePeer();
    const bob = await makePeer();

    await alice.manager.addPeer(bob.pubHex);
    await bob.manager.addPeer(alice.pubHex);

    const wires = await sendMessage(alice.manager, roomKey, 'alice', 'test');

    // Neither public key appears in the wire payload (it's all ciphertext)
    expect(wires[0]!.includes(alice.pubHex)).toBe(false);
    expect(wires[0]!.includes(bob.pubHex)).toBe(false);
  });

  it('per-peer payload count matches peer count', async () => {
    const roomKey = await makeRoomKey();
    const sender = await makePeer();
    const peers: Peer[] = [];

    for (let i = 0; i < 5; i++) {
      const p = await makePeer();
      await sender.manager.addPeer(p.pubHex);
      await p.manager.addPeer(sender.pubHex);
      peers.push(p);
    }

    const wires = await sendMessage(sender.manager, roomKey, 'sender', 'broadcast');
    expect(wires.length).toBe(5);

    // Each peer decrypts exactly one of the 5 packets
    for (const peer of peers) {
      let decrypted = false;
      for (const w of wires) {
        const msg = await receiveMessage(peer.manager, roomKey, w);
        if (msg) {
          expect(msg.sender).toBe('sender');
          expect(msg.text).toBe('broadcast');
          expect(decrypted).toBe(false); // only one should succeed
          decrypted = true;
        }
      }
      expect(decrypted).toBe(true);
    }
  });
});
