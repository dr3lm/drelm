import { describe, it, expect } from 'vitest';
import { generateKeypair, exportPublicKey, importPublicKey } from '../keypair.js';
import { deriveSharedKey } from '../exchange.js';

describe('deriveSharedKey', () => {
  it('derives identical keys for both parties', async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();

    const alicePubRaw = await exportPublicKey(alice);
    const bobPubRaw = await exportPublicKey(bob);

    const bobPubImported = await importPublicKey(bobPubRaw);
    const alicePubImported = await importPublicKey(alicePubRaw);

    const aliceKey = await deriveSharedKey(alice.privateKey, bobPubImported);
    const bobKey = await deriveSharedKey(bob.privateKey, alicePubImported);

    // Verify keys are equivalent: encrypt with one, decrypt with the other
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode('test message');

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aliceKey,
      plaintext,
    );

    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        bobKey,
        ciphertext,
      ),
    );

    expect(decrypted).toEqual(plaintext);
  });

  it('derives a usable AES-GCM key', async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();

    const bobPub = await importPublicKey(await exportPublicKey(bob));
    const key = await deriveSharedKey(alice.privateKey, bobPub);

    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
    expect(key.extractable).toBe(false);
  });

  it('different keypairs produce different shared keys', async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const charlie = await generateKeypair();

    const bobPub = await importPublicKey(await exportPublicKey(bob));
    const charliePub = await importPublicKey(await exportPublicKey(charlie));

    const key1 = await deriveSharedKey(alice.privateKey, bobPub);
    const key2 = await deriveSharedKey(alice.privateKey, charliePub);

    // Encrypt with key1, verify key2 cannot decrypt (different shared secret)
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode('test');

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key1,
      plaintext,
    );

    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, ciphertext),
    ).rejects.toThrow();
  });
});
