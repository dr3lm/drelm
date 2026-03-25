/**
 * AES-256-GCM encrypt/decrypt primitives.
 * IV is random 12 bytes per encryption — never reused.
 */

import { randomBytes } from './random.js';

const IV_LENGTH = 12;

export interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext.buffer as ArrayBuffer,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  );
  return new Uint8Array(plaintext);
}

/**
 * Serialize encrypted payload to a single Uint8Array: [iv | ciphertext]
 */
export function packPayload(payload: EncryptedPayload): Uint8Array {
  const packed = new Uint8Array(IV_LENGTH + payload.ciphertext.length);
  packed.set(payload.iv, 0);
  packed.set(payload.ciphertext, IV_LENGTH);
  return packed;
}

/**
 * Deserialize a packed payload back to iv + ciphertext.
 */
export function unpackPayload(packed: Uint8Array): EncryptedPayload {
  return {
    iv: packed.slice(0, IV_LENGTH),
    ciphertext: packed.slice(IV_LENGTH),
  };
}
