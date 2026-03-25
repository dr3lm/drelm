import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, packPayload, unpackPayload } from '../aes.js';
import { generateKeypair, exportPublicKey, importPublicKey } from '../keypair.js';
import { deriveSharedKey } from '../exchange.js';

async function makeAesKey(): Promise<CryptoKey> {
  const alice = await generateKeypair();
  const bob = await generateKeypair();
  const bobPub = await importPublicKey(await exportPublicKey(bob));
  return deriveSharedKey(alice.privateKey, bobPub);
}

describe('encrypt / decrypt', () => {
  it('round-trips plaintext', async () => {
    const key = await makeAesKey();
    const plaintext = new TextEncoder().encode('hello drelm');
    const encrypted = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, encrypted.iv, encrypted.ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello drelm');
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const key = await makeAesKey();
    const plaintext = new TextEncoder().encode('same message');
    const a = await encrypt(key, plaintext);
    const b = await encrypt(key, plaintext);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.iv).not.toEqual(b.iv);
  });

  it('fails with wrong key', async () => {
    const key1 = await makeAesKey();
    const key2 = await makeAesKey();
    const plaintext = new TextEncoder().encode('secret');
    const encrypted = await encrypt(key1, plaintext);
    await expect(decrypt(key2, encrypted.iv, encrypted.ciphertext)).rejects.toThrow();
  });

  it('fails with tampered ciphertext', async () => {
    const key = await makeAesKey();
    const plaintext = new TextEncoder().encode('secret');
    const encrypted = await encrypt(key, plaintext);
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] as number) ^ 0xff;
    await expect(decrypt(key, encrypted.iv, encrypted.ciphertext)).rejects.toThrow();
  });

  it('handles empty plaintext', async () => {
    const key = await makeAesKey();
    const plaintext = new Uint8Array(0);
    const encrypted = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, encrypted.iv, encrypted.ciphertext);
    expect(decrypted.length).toBe(0);
  });
});

describe('packPayload / unpackPayload', () => {
  it('round-trips payload', async () => {
    const key = await makeAesKey();
    const plaintext = new TextEncoder().encode('pack test');
    const encrypted = await encrypt(key, plaintext);

    const packed = packPayload(encrypted);
    const unpacked = unpackPayload(packed);

    expect(unpacked.iv).toEqual(encrypted.iv);
    expect(unpacked.ciphertext).toEqual(encrypted.ciphertext);

    const decrypted = await decrypt(key, unpacked.iv, unpacked.ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('pack test');
  });
});
