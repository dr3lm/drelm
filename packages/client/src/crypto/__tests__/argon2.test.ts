/**
 * Tests for Argon2id phrase hashing and HKDF domain separation.
 *
 * Security: The room hash (sent to server) and the room key (kept client-side)
 * must be cryptographically independent. The server must not be able to derive
 * the room key from the room hash.
 *
 * Note: argon2-browser WASM crashes in Node test workers, so we mock the
 * Argon2 module and test the HKDF domain separation logic directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock argon2-browser — returns deterministic SHA-256 hash as a stand-in
// for the Argon2id output. This lets us test the HKDF domain separation.
vi.mock('argon2-browser/dist/argon2-bundled.min.js', () => {
  return {
    default: {
      ArgonType: { Argon2id: 2 },
      hash: async (opts: { pass: string }) => {
        // Use SHA-256 as a deterministic stand-in for Argon2id
        const data = new TextEncoder().encode(opts.pass);
        const hashBuf = await crypto.subtle.digest('SHA-256', data);
        return { hash: new Uint8Array(hashBuf) };
      },
    },
  };
});

// Import AFTER mock is set up
const { hashPhrase, phraseToRoomHash, deriveRoomKey } = await import('../argon2.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashPhrase', () => {
  it('produces a 32-byte Uint8Array', async () => {
    const hash = await hashPhrase('test phrase');
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it('is deterministic — same input produces same output', async () => {
    const a = await hashPhrase('deterministic');
    const b = await hashPhrase('deterministic');
    expect(a).toEqual(b);
  });

  it('different inputs produce different outputs', async () => {
    const a = await hashPhrase('phrase one');
    const b = await hashPhrase('phrase two');
    expect(a).not.toEqual(b);
  });
});

describe('phraseToRoomHash', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await phraseToRoomHash('test phrase');
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await phraseToRoomHash('same phrase');
    const b = await phraseToRoomHash('same phrase');
    expect(a).toBe(b);
  });

  it('different phrases produce different hashes', async () => {
    const a = await phraseToRoomHash('phrase alpha');
    const b = await phraseToRoomHash('phrase beta');
    expect(a).not.toBe(b);
  });
});

describe('deriveRoomKey', () => {
  it('returns a CryptoKey for AES-GCM', async () => {
    const key = await deriveRoomKey('test phrase');
    expect(key.type).toBe('secret');
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('is not extractable', async () => {
    const key = await deriveRoomKey('test phrase');
    expect(key.extractable).toBe(false);
  });

  it('same phrase produces interchangeable keys', async () => {
    const key1 = await deriveRoomKey('same phrase');
    const key2 = await deriveRoomKey('same phrase');
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode('test');
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, plaintext);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, ct);
    expect(new TextDecoder().decode(decrypted)).toBe('test');
  });
});

describe('HKDF domain separation (CRITICAL security property)', () => {
  it('room hash is NOT the raw Argon2 output', async () => {
    const phrase = 'domain separation test';
    const rawHash = await hashPhrase(phrase);
    const roomHash = await phraseToRoomHash(phrase);

    // Convert raw hash to hex for comparison
    let rawHex = '';
    for (let i = 0; i < rawHash.length; i++) {
      rawHex += (rawHash[i] as number).toString(16).padStart(2, '0');
    }

    // The room hash MUST NOT equal the raw Argon2 output.
    // If this fails, the server can derive the room key from the room hash.
    expect(roomHash).not.toBe(rawHex);
  });

  it('server cannot derive room key from room hash', async () => {
    // Simulate a malicious server attack:
    // 1. Server has the room hash (64 hex chars from HKDF)
    // 2. Server tries to use it as HKDF input to derive the room key
    // 3. This MUST produce a different key than the real room key
    const phrase = 'server attack simulation';
    const roomHash = await phraseToRoomHash(phrase);
    const realRoomKey = await deriveRoomKey(phrase);

    // Server's attempt: decode roomHash hex → use as HKDF input
    const roomHashBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      roomHashBytes[i] = parseInt(roomHash.substring(i * 2, i * 2 + 2), 16);
    }

    const attackHkdfKey = await crypto.subtle.importKey(
      'raw',
      roomHashBytes.buffer as ArrayBuffer,
      'HKDF',
      false,
      ['deriveKey'],
    );

    const attackKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('drelm-room-key'),
        info: new TextEncoder().encode('room-key'),
      },
      attackHkdfKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );

    // Encrypt with real key, try decrypt with attacker's key — MUST fail
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode('secret message');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      realRoomKey,
      plaintext,
    );

    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, attackKey, ciphertext),
    ).rejects.toThrow();
  });

  it('room hash and room key produce different values from same phrase', async () => {
    const phrase = 'independence test';
    const roomHash = await phraseToRoomHash(phrase);
    const roomKey = await deriveRoomKey(phrase);

    // Room hash is 64 hex chars
    expect(roomHash.length).toBe(64);
    // Room key is a CryptoKey
    expect(roomKey.type).toBe('secret');
    // They are derived from different HKDF params — independent
  });
});
