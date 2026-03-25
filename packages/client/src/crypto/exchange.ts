/**
 * ECDH key exchange + HKDF key derivation.
 * Derives an AES-256-GCM key from two X25519 keys.
 */

/**
 * Raw ECDH shared secret. Used by the ratchet for further derivation.
 */
export async function deriveSharedBits(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: publicKey },
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> {
  // ECDH to get shared bits, then HKDF to derive AES key
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: publicKey },
    privateKey,
    256,
  );

  // Import shared bits as HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );

  // Derive AES-256-GCM key via HKDF
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('drelm-v1'),
      info: encoder.encode('aes-256-gcm'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
