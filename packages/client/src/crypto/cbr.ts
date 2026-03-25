/**
 * Constant Bitrate Noise Generation.
 *
 * Defeats traffic analysis by making the connection a flat line of
 * fixed-size packets at a fixed rate. Real messages are indistinguishable
 * from chaff BOTH on the transport layer AND at the application layer.
 *
 * Design:
 * - Fixed rate: 10 packets/s, ~5.4 KB/s (~19 MB/hour)
 * - Every MESSAGE payload is exactly WIRE_PAYLOAD_SIZE characters
 * - Real messages are encrypted with the room transport key (AES-GCM)
 *   before being placed in the CBR stream. The output is base64 —
 *   uniformly random-looking bytes.
 * - Chaff is random base64 — also uniformly random-looking bytes.
 * - The server CANNOT distinguish them: both are random-looking strings
 *   of identical length. JSON.parse, pattern matching, entropy analysis
 *   — none of it works because real messages are encrypted.
 * - Recipients try room-key decrypt → if success, ratchet decrypt → display.
 *   If room-key decrypt fails → chaff → silently discard.
 *
 * Each peer receives a separate CBR packet (per-peer payloads). For N peers,
 * sending one message enqueues N packets over the next N ticks — invisible
 * to the server within the constant stream.
 *
 * The rate is a global constant, never configurable — configurable rates
 * are a fingerprinting vector.
 */

import { randomBytes } from './random.js';
import { encrypt, packPayload } from './aes.js';

/** Interval between packets in milliseconds. 100ms = 10 packets/s. */
export const PACKET_INTERVAL_MS = 100;

/**
 * Fixed wire payload size in characters.
 *
 * The inner plaintext for room-key encryption is sized so that after
 * AES-GCM (adds 16-byte auth tag) + 12-byte IV prefix + base64 encoding,
 * the output is exactly WIRE_PAYLOAD_SIZE characters.
 *
 * base64 output = ceil((12 + plaintext + 16) / 3) * 4
 * For 720 chars: (12 + plaintext + 16) = 540 bytes → plaintext = 512 bytes
 *
 * 512 bytes accommodates a single per-peer ratchet payload (~350 bytes)
 * with room for message text up to ~170 characters.
 */
export const WIRE_PAYLOAD_SIZE = 720;
const INNER_PLAINTEXT_SIZE = 512;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a chaff payload: random base64 of exactly WIRE_PAYLOAD_SIZE.
 * Uses crypto.getRandomValues() — never Math.random().
 *
 * This is indistinguishable from an AES-GCM ciphertext because both
 * are uniformly random bytes encoded as base64.
 */
export function generateChaff(): string {
  // 540 random bytes → 720 base64 chars
  const raw = randomBytes(540);
  return toBase64(raw);
}

/**
 * Encrypt a real message payload with the room transport key.
 * The output is base64 of exactly WIRE_PAYLOAD_SIZE characters.
 *
 * The plaintext is padded to INNER_PLAINTEXT_SIZE before encryption
 * to ensure the ciphertext (and thus base64) is always the same length.
 *
 * Returns null if the payload is too large for a single packet.
 */
export async function encryptForWire(
  roomKey: CryptoKey,
  payload: string,
): Promise<string | null> {
  const payloadBytes = new TextEncoder().encode(payload);

  if (payloadBytes.length > INNER_PLAINTEXT_SIZE) return null;

  // Pad plaintext to fixed size with random bytes
  // Format: [2-byte big-endian length] [payload bytes] [random padding]
  const padded = new Uint8Array(INNER_PLAINTEXT_SIZE);
  // Write payload length as 2-byte BE
  padded[0] = (payloadBytes.length >> 8) & 0xff;
  padded[1] = payloadBytes.length & 0xff;
  // Copy payload
  padded.set(payloadBytes, 2);
  // Fill remainder with random bytes (not a fixed char — no pattern)
  const paddingStart = 2 + payloadBytes.length;
  if (paddingStart < INNER_PLAINTEXT_SIZE) {
    const randomPad = randomBytes(INNER_PLAINTEXT_SIZE - paddingStart);
    padded.set(randomPad, paddingStart);
  }

  // AES-GCM encrypt with room key
  const encrypted = await encrypt(roomKey, padded);
  const packed = packPayload(encrypted);

  // packed = 12-byte IV + (512 + 16)-byte ciphertext = 540 bytes
  // base64(540) = 720 chars
  return toBase64(packed);
}

/**
 * Decrypt a wire payload with the room transport key.
 * Returns the inner payload string, or null if decryption fails (chaff).
 */
export async function decryptFromWire(
  roomKey: CryptoKey,
  wirePayload: string,
): Promise<string | null> {
  try {
    const packed = fromBase64(wirePayload);

    // Unpack IV + ciphertext
    const iv = packed.slice(0, 12);
    const ciphertext = packed.slice(12);

    // Decrypt
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        roomKey,
        ciphertext.buffer as ArrayBuffer,
      ),
    );

    // Read 2-byte BE length prefix
    const payloadLen = ((plaintext[0] as number) << 8) | (plaintext[1] as number);
    if (payloadLen > INNER_PLAINTEXT_SIZE - 2) return null;

    // Extract payload (discard random padding)
    const payloadBytes = plaintext.slice(2, 2 + payloadLen);
    return new TextDecoder().decode(payloadBytes);
  } catch {
    // Decryption failed — this is chaff. Silently discard.
    return null;
  }
}

/**
 * CBR engine. Drives a fixed-rate packet stream.
 *
 * Every tick sends exactly one WIRE_PAYLOAD_SIZE payload.
 * Real messages (already encrypted via encryptForWire) replace chaff.
 * The server sees only random-looking strings of identical length.
 */
export class CBREngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private queue: string[] = [];
  private sendFn: (payload: string) => void;

  constructor(sendFn: (payload: string) => void) {
    this.sendFn = sendFn;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => {
      this.tick();
    }, PACKET_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.queue = [];
  }

  /**
   * Enqueue a real message payload (already encrypted via encryptForWire,
   * exactly WIRE_PAYLOAD_SIZE characters).
   */
  enqueue(encryptedPayload: string): void {
    if (encryptedPayload.length !== WIRE_PAYLOAD_SIZE) {
      throw new Error(
        `CBR payload must be exactly ${WIRE_PAYLOAD_SIZE.toString()} chars, got ${encryptedPayload.length.toString()}`,
      );
    }
    this.queue.push(encryptedPayload);
  }

  get running(): boolean {
    return this.intervalId !== null;
  }

  private tick(): void {
    const payload = this.queue.length > 0
      ? this.queue.shift() as string
      : generateChaff();

    this.sendFn(payload);
  }
}
