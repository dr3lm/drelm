/**
 * Phrase hashing with Argon2id.
 * The phrase is the room address AND the key material.
 * Parameters are constants — not configurable.
 */

import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

const ARGON2_SALT = 'drelm-v1';

export async function hashPhrase(phrase: string): Promise<Uint8Array> {
  const result = await argon2.hash({
    pass: phrase,
    salt: ARGON2_SALT,
    time: 3,
    mem: 65536,
    parallelism: 1,
    hashLen: 32,
    type: argon2.ArgonType.Argon2id,
  });

  return result.hash;
}

/**
 * Hash the phrase and return hex string for use as room identifier.
 *
 * Security: the room hash is derived via HKDF with info='room-identifier',
 * cryptographically independent from the room transport key (info='room-key').
 * The server receives only this HKDF output — it cannot reverse HKDF to
 * recover the Argon2 hash, and therefore cannot derive the room key.
 */
export async function phraseToRoomHash(phrase: string): Promise<string> {
  const hash = await hashPhrase(phrase);

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    hash.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits'],
  );

  const roomHashBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('drelm-room-hash'),
        info: new TextEncoder().encode('room-identifier'),
      },
      hkdfKey,
      256,
    ),
  );

  let hex = '';
  for (let i = 0; i < roomHashBits.length; i++) {
    hex += (roomHashBits[i] as number).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Derive an AES-256-GCM room encryption key from the phrase hash.
 *
 * Security: uses HKDF with info='room-key', cryptographically independent
 * from the room hash (info='room-identifier'). The server never receives
 * the Argon2 hash directly — only the HKDF-derived room hash — so it
 * cannot derive this key.
 */
export async function deriveRoomKey(phrase: string): Promise<CryptoKey> {
  const hash = await hashPhrase(phrase);

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    hash.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('drelm-room-key'),
      info: new TextEncoder().encode('room-key'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
