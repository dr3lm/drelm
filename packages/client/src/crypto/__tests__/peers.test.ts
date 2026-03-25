/**
 * PeerManager unit tests.
 * Tests session lifecycle, pairwise isolation, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../keypair.js';
import { PeerManager } from '../peers.js';

async function makePeerManager(): Promise<PeerManager> {
  const kp = await generateKeypair();
  return PeerManager.create(kp);
}

describe('PeerManager', () => {
  it('creates with correct public key hex', async () => {
    const pm = await makePeerManager();
    expect(pm.ownPubKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('starts with zero peers', async () => {
    const pm = await makePeerManager();
    expect(pm.peerCount).toBe(0);
    expect(pm.getAllSessions()).toEqual([]);
  });

  it('addPeer creates a session', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();

    const session = await alice.addPeer(bob.ownPubKeyHex);
    expect(session.publicKeyHex).toBe(bob.ownPubKeyHex);
    expect(session.name).toBeNull();
    expect(session.fingerprint).toContain('<svg');
    expect(alice.peerCount).toBe(1);
  });

  it('addPeer is idempotent — duplicate returns existing session', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();

    const s1 = await alice.addPeer(bob.ownPubKeyHex);
    const s2 = await alice.addPeer(bob.ownPubKeyHex);

    expect(s1).toBe(s2); // same object reference
    expect(alice.peerCount).toBe(1);
  });

  it('removePeer deletes the session', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    expect(alice.peerCount).toBe(1);

    alice.removePeer(bob.ownPubKeyHex);
    expect(alice.peerCount).toBe(0);
    expect(alice.getSession(bob.ownPubKeyHex)).toBeUndefined();
  });

  it('removePeer is safe for unknown keys', async () => {
    const alice = await makePeerManager();
    alice.removePeer('0'.repeat(64)); // should not throw
    expect(alice.peerCount).toBe(0);
  });

  it('getSession returns the correct session', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();
    const charlie = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    await alice.addPeer(charlie.ownPubKeyHex);

    const bobSession = alice.getSession(bob.ownPubKeyHex);
    const charlieSession = alice.getSession(charlie.ownPubKeyHex);

    expect(bobSession?.publicKeyHex).toBe(bob.ownPubKeyHex);
    expect(charlieSession?.publicKeyHex).toBe(charlie.ownPubKeyHex);
    expect(alice.getSession('0'.repeat(64))).toBeUndefined();
  });

  it('getAllSessions returns all peers', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();
    const charlie = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    await alice.addPeer(charlie.ownPubKeyHex);

    const sessions = alice.getAllSessions();
    expect(sessions.length).toBe(2);

    const hexes = sessions.map(s => s.publicKeyHex).sort();
    expect(hexes).toContain(bob.ownPubKeyHex);
    expect(hexes).toContain(charlie.ownPubKeyHex);
  });

  it('clear removes all sessions', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();
    const charlie = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    await alice.addPeer(charlie.ownPubKeyHex);
    expect(alice.peerCount).toBe(2);

    alice.clear();
    expect(alice.peerCount).toBe(0);
    expect(alice.getAllSessions()).toEqual([]);
  });

  it('each peer gets a unique fingerprint', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();
    const charlie = await makePeerManager();

    const s1 = await alice.addPeer(bob.ownPubKeyHex);
    const s2 = await alice.addPeer(charlie.ownPubKeyHex);

    expect(s1.fingerprint).not.toBe(s2.fingerprint);
  });

  it('encryptForPeers produces one payload per peer', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();
    const charlie = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    await alice.addPeer(charlie.ownPubKeyHex);

    const payloads = await alice.encryptForPeers('alice', 'hello');
    expect(payloads.length).toBe(2);

    // Each payload is valid JSON with f, t, m fields
    for (const p of payloads) {
      const parsed = JSON.parse(p) as { f: string; t: string; m: unknown };
      expect(parsed.f).toBe(alice.ownPubKeyHex);
      expect(typeof parsed.t).toBe('string');
      expect(parsed.t.length).toBe(64);
      expect(parsed.m).toBeDefined();
    }

    // "to" fields should be bob and charlie
    const tos = payloads.map(p => (JSON.parse(p) as { t: string }).t).sort();
    expect(tos).toContain(bob.ownPubKeyHex);
    expect(tos).toContain(charlie.ownPubKeyHex);
  });

  it('decryptMessage returns null for unknown sender', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();

    // Bob has no peers — any message should fail
    const payload = JSON.stringify({ f: alice.ownPubKeyHex, t: bob.ownPubKeyHex, m: {} });
    const result = await bob.decryptMessage(payload);
    expect(result).toBeNull();
  });

  it('decryptMessage returns null for wrong recipient', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();
    const charlie = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    await bob.addPeer(alice.ownPubKeyHex);
    await charlie.addPeer(alice.ownPubKeyHex);

    const payloads = await alice.encryptForPeers('alice', 'for bob only');
    expect(payloads.length).toBe(1);

    // Charlie tries to decrypt Bob's packet — should fail at "to" check
    const result = await charlie.decryptMessage(payloads[0]!);
    expect(result).toBeNull();
  });

  it('decryptMessage returns null for invalid JSON', async () => {
    const alice = await makePeerManager();
    const result = await alice.decryptMessage('not json');
    expect(result).toBeNull();
  });

  it('decryptMessage returns null for missing fields', async () => {
    const alice = await makePeerManager();

    expect(await alice.decryptMessage('{}')).toBeNull();
    expect(await alice.decryptMessage('{"f":"abc"}')).toBeNull();
    expect(await alice.decryptMessage('{"f":"abc","t":"def"}')).toBeNull();
  });

  it('name is updated from decrypted message', async () => {
    const alice = await makePeerManager();
    const bob = await makePeerManager();

    await alice.addPeer(bob.ownPubKeyHex);
    await bob.addPeer(alice.ownPubKeyHex);

    // Before any messages, Bob's session has no name for Alice
    const sessionBefore = bob.getSession(alice.ownPubKeyHex);
    expect(sessionBefore?.name).toBeNull();

    // Alice sends a message, Bob decrypts
    const payloads = await alice.encryptForPeers('alice-username', 'hi');
    const result = await bob.decryptMessage(payloads[0]!);
    expect(result).not.toBeNull();

    // Now Bob's session has Alice's username
    const sessionAfter = bob.getSession(alice.ownPubKeyHex);
    expect(sessionAfter?.name).toBe('alice-username');
  });
});
