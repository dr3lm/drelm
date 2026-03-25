import { describe, it, expect } from 'vitest';
import { RatchetSession } from '../ratchet.js';
import { generateKeypair, exportPublicKey, importPublicKey } from '../keypair.js';
import { deriveSharedBits } from '../exchange.js';
import { bytesToHex } from '../random.js';

// --- Legacy asymmetric setup (initiator/responder) ---

async function setupAsymmetricPair(): Promise<{ alice: RatchetSession; bob: RatchetSession }> {
  const aliceKp = await generateKeypair();
  const bobKp = await generateKeypair();

  const alicePubRaw = await exportPublicKey(aliceKp);
  const bobPubRaw = await exportPublicKey(bobKp);

  const bobPubImported = await importPublicKey(bobPubRaw);
  const alicePubImported = await importPublicKey(alicePubRaw);

  const aliceShared = await deriveSharedBits(aliceKp.privateKey, bobPubImported);
  const bobShared = await deriveSharedBits(bobKp.privateKey, alicePubImported);

  const alice = new RatchetSession();
  const bob = new RatchetSession();

  const bobRatchetKp = await generateKeypair();
  const bobRatchetPubRaw = await exportPublicKey(bobRatchetKp);

  await alice.initAsInitiator(aliceShared, bobRatchetPubRaw);
  await bob.initAsResponder(bobShared, bobRatchetKp);

  return { alice, bob };
}

// --- Symmetric setup (both can send immediately) ---

async function setupSymmetricPair(): Promise<{ alice: RatchetSession; bob: RatchetSession }> {
  const aliceKp = await generateKeypair();
  const bobKp = await generateKeypair();

  const alicePubRaw = await exportPublicKey(aliceKp);
  const bobPubRaw = await exportPublicKey(bobKp);

  const bobPubImported = await importPublicKey(bobPubRaw);
  const alicePubImported = await importPublicKey(alicePubRaw);

  const aliceShared = await deriveSharedBits(aliceKp.privateKey, bobPubImported);
  const bobShared = await deriveSharedBits(bobKp.privateKey, alicePubImported);

  // Determine roles by comparing public key hex
  const aliceHex = bytesToHex(alicePubRaw);
  const bobHex = bytesToHex(bobPubRaw);
  const aliceIsLower = aliceHex < bobHex;

  const alice = new RatchetSession();
  const bob = new RatchetSession();

  await alice.initSymmetric(aliceShared, aliceKp, bobPubRaw, aliceIsLower);
  await bob.initSymmetric(bobShared, bobKp, alicePubRaw, !aliceIsLower);

  return { alice, bob };
}

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('RatchetSession (asymmetric init)', () => {
  it('encrypts and decrypts a single message', async () => {
    const { alice, bob } = await setupAsymmetricPair();
    const msg = await alice.encrypt(encode('hello bob'));
    const plain = await bob.decrypt(msg);
    expect(decode(plain)).toBe('hello bob');
  });

  it('handles multiple messages in one direction', async () => {
    const { alice, bob } = await setupAsymmetricPair();
    const msg1 = await alice.encrypt(encode('message 1'));
    const msg2 = await alice.encrypt(encode('message 2'));
    const msg3 = await alice.encrypt(encode('message 3'));
    expect(decode(await bob.decrypt(msg1))).toBe('message 1');
    expect(decode(await bob.decrypt(msg2))).toBe('message 2');
    expect(decode(await bob.decrypt(msg3))).toBe('message 3');
  });

  it('handles ping-pong conversation', async () => {
    const { alice, bob } = await setupAsymmetricPair();
    const m1 = await alice.encrypt(encode('alice 1'));
    expect(decode(await bob.decrypt(m1))).toBe('alice 1');
    const m2 = await bob.encrypt(encode('bob 1'));
    expect(decode(await alice.decrypt(m2))).toBe('bob 1');
    const m3 = await alice.encrypt(encode('alice 2'));
    expect(decode(await bob.decrypt(m3))).toBe('alice 2');
  });

  it('handles out-of-order messages', async () => {
    const { alice, bob } = await setupAsymmetricPair();
    const msg1 = await alice.encrypt(encode('first'));
    const msg2 = await alice.encrypt(encode('second'));
    const msg3 = await alice.encrypt(encode('third'));
    expect(decode(await bob.decrypt(msg3))).toBe('third');
    expect(decode(await bob.decrypt(msg1))).toBe('first');
    expect(decode(await bob.decrypt(msg2))).toBe('second');
  });

  it('produces unique ciphertext for same plaintext', async () => {
    const { alice } = await setupAsymmetricPair();
    const msg1 = await alice.encrypt(encode('same'));
    const msg2 = await alice.encrypt(encode('same'));
    expect(msg1.ciphertext).not.toEqual(msg2.ciphertext);
  });

  it('fails to decrypt with wrong session', async () => {
    const { alice } = await setupAsymmetricPair();
    const { bob: wrongBob } = await setupAsymmetricPair();
    const msg = await alice.encrypt(encode('secret'));
    await expect(wrongBob.decrypt(msg)).rejects.toThrow();
  });
});

describe('RatchetSession (symmetric init)', () => {
  it('both sides can send immediately', async () => {
    const { alice, bob } = await setupSymmetricPair();

    // Bob sends first (would fail with asymmetric init)
    const m1 = await bob.encrypt(encode('bob goes first'));
    expect(decode(await alice.decrypt(m1))).toBe('bob goes first');

    // Alice sends back
    const m2 = await alice.encrypt(encode('alice replies'));
    expect(decode(await bob.decrypt(m2))).toBe('alice replies');
  });

  it('handles multiple messages in one direction', async () => {
    const { alice, bob } = await setupSymmetricPair();
    const msg1 = await alice.encrypt(encode('a'));
    const msg2 = await alice.encrypt(encode('b'));
    const msg3 = await alice.encrypt(encode('c'));
    expect(decode(await bob.decrypt(msg1))).toBe('a');
    expect(decode(await bob.decrypt(msg2))).toBe('b');
    expect(decode(await bob.decrypt(msg3))).toBe('c');
  });

  it('handles ping-pong with DH ratchet steps', async () => {
    const { alice, bob } = await setupSymmetricPair();

    // Several round-trips to exercise DH ratcheting
    for (let i = 0; i < 5; i++) {
      const m1 = await alice.encrypt(encode(`alice-${i.toString()}`));
      expect(decode(await bob.decrypt(m1))).toBe(`alice-${i.toString()}`);

      const m2 = await bob.encrypt(encode(`bob-${i.toString()}`));
      expect(decode(await alice.decrypt(m2))).toBe(`bob-${i.toString()}`);
    }
  });

  it('handles out-of-order messages', async () => {
    const { alice, bob } = await setupSymmetricPair();
    const msg1 = await alice.encrypt(encode('first'));
    const msg2 = await alice.encrypt(encode('second'));
    const msg3 = await alice.encrypt(encode('third'));
    expect(decode(await bob.decrypt(msg3))).toBe('third');
    expect(decode(await bob.decrypt(msg1))).toBe('first');
    expect(decode(await bob.decrypt(msg2))).toBe('second');
  });

  it('produces unique keys per message (forward secrecy)', async () => {
    const { alice } = await setupSymmetricPair();
    const msg1 = await alice.encrypt(encode('same'));
    const msg2 = await alice.encrypt(encode('same'));
    // Same plaintext, different ciphertext = different keys
    expect(msg1.ciphertext).not.toEqual(msg2.ciphertext);
    expect(msg1.iv).not.toEqual(msg2.iv);
  });

  it('wrong session cannot decrypt', async () => {
    const { alice } = await setupSymmetricPair();
    const { bob: stranger } = await setupSymmetricPair();
    const msg = await alice.encrypt(encode('private'));
    await expect(stranger.decrypt(msg)).rejects.toThrow();
  });
});
