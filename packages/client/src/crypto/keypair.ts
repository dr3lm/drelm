/**
 * X25519 keypair generation via WebCrypto.
 * Keys live only in memory — never serialized to persistent storage.
 */

export async function generateKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'X25519' },
    false, // not extractable — private key stays in WebCrypto
    ['deriveKey', 'deriveBits'],
  ) as Promise<CryptoKeyPair>;
}

export async function exportPublicKey(keypair: CryptoKeyPair): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', keypair.publicKey);
  return new Uint8Array(raw);
}

export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'X25519' },
    true,
    [],
  );
}
