import { describe, it, expect } from 'vitest';
import { generateKeypair, exportPublicKey, importPublicKey } from '../keypair.js';

describe('generateKeypair', () => {
  it('generates a CryptoKeyPair', async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();
    expect(kp.publicKey.type).toBe('public');
    expect(kp.privateKey.type).toBe('private');
  });

  it('generates unique keypairs', async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    const pubA = await exportPublicKey(a);
    const pubB = await exportPublicKey(b);
    expect(pubA).not.toEqual(pubB);
  });
});

describe('exportPublicKey', () => {
  it('exports 32-byte raw key', async () => {
    const kp = await generateKeypair();
    const pub = await exportPublicKey(kp);
    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub.length).toBe(32);
  });
});

describe('importPublicKey', () => {
  it('round-trips with export', async () => {
    const kp = await generateKeypair();
    const raw = await exportPublicKey(kp);
    const imported = await importPublicKey(raw);
    expect(imported.type).toBe('public');
    expect(imported.algorithm.name).toBe('X25519');
  });
});
