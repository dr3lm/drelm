/**
 * Double Ratchet protocol implementation.
 * Uses WebCrypto primitives for all operations.
 *
 * Security reasoning:
 * - Each message gets a unique key derived from a ratcheting chain
 * - DH ratchet provides forward secrecy: new keypair per direction change
 * - Skipped message keys are cached for out-of-order delivery
 * - Max skip limit prevents memory exhaustion attacks
 * - initSymmetric allows both sides to send immediately (no bootstrap delay)
 */

import { generateKeypair, exportPublicKey, importPublicKey } from './keypair.js';

const MAX_SKIP = 100;
const MAX_TOTAL_SKIPPED_KEYS = 1000;

/**
 * Constants for chain key derivation, matching Signal spec:
 * - 0x01 → message key
 * - 0x02 → next chain key
 */
const MESSAGE_KEY_CONSTANT = new Uint8Array([0x01]);
const CHAIN_KEY_CONSTANT = new Uint8Array([0x02]);

/** Cast Uint8Array to ArrayBuffer for WebCrypto strict typing */
function buf(arr: Uint8Array): ArrayBuffer {
  return arr.buffer as ArrayBuffer;
}

export interface MessageHeader {
  publicKey: Uint8Array;
  messageNumber: number;
  previousChainLength: number;
}

export interface RatchetMessage {
  header: MessageHeader;
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/**
 * Serialize a RatchetMessage to a JSON-safe object for wire transport.
 */
export function serializeRatchetMessage(msg: RatchetMessage): object {
  return {
    h: {
      pk: uint8ToBase64(msg.header.publicKey),
      n: msg.header.messageNumber,
      pn: msg.header.previousChainLength,
    },
    c: uint8ToBase64(msg.ciphertext),
    iv: uint8ToBase64(msg.iv),
  };
}

/**
 * Deserialize a wire object back to a RatchetMessage.
 */
export function deserializeRatchetMessage(obj: unknown): RatchetMessage | null {
  try {
    const o = obj as Record<string, unknown>;
    const h = o['h'] as Record<string, unknown>;
    return {
      header: {
        publicKey: base64ToUint8(h['pk'] as string),
        messageNumber: h['n'] as number,
        previousChainLength: h['pn'] as number,
      },
      ciphertext: base64ToUint8(o['c'] as string),
      iv: base64ToUint8(o['iv'] as string),
    };
  } catch {
    return null;
  }
}

function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i] as number);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

/**
 * Derive a root key and chain key from input key material using HKDF.
 * Returns [newRootKey, chainKey] as raw Uint8Arrays.
 */
async function kdfRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array,
): Promise<[Uint8Array, Uint8Array]> {
  const hkdfKey = await crypto.subtle.importKey('raw', buf(dhOutput), 'HKDF', false, ['deriveBits']);

  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: buf(rootKey),
        info: new TextEncoder().encode('drelm-ratchet'),
      },
      hkdfKey,
      512,
    ),
  );

  return [derived.slice(0, 32), derived.slice(32, 64)];
}

/**
 * Derive initial send and receive chain keys from a shared secret.
 * Uses HKDF with a label to split the secret into two independent chains.
 * The 'lower' role gets chainA for send and chainB for recv; 'higher' gets the reverse.
 */
async function deriveInitialChains(
  sharedSecret: Uint8Array,
): Promise<[Uint8Array, Uint8Array]> {
  const hkdfKey = await crypto.subtle.importKey('raw', buf(sharedSecret), 'HKDF', false, ['deriveBits']);

  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('drelm-init-chains'),
        info: new TextEncoder().encode('chain-a-chain-b'),
      },
      hkdfKey,
      512,
    ),
  );

  // chainA = bytes 0..31, chainB = bytes 32..63
  return [derived.slice(0, 32), derived.slice(32, 64)];
}

/**
 * Advance a symmetric chain key, returning [newChainKey, messageKey].
 */
async function kdfChainKey(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    buf(chainKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const newChainRaw = await crypto.subtle.sign('HMAC', hmacKey, buf(CHAIN_KEY_CONSTANT));
  const messageKeyRaw = await crypto.subtle.sign('HMAC', hmacKey, buf(MESSAGE_KEY_CONSTANT));

  return [new Uint8Array(newChainRaw), new Uint8Array(messageKeyRaw)];
}

export class RatchetSession {
  private dhKeypair: CryptoKeyPair | null = null;
  private remotePubKey: CryptoKey | null = null;
  private remotePubKeyRaw: Uint8Array | null = null;

  private rootKey: Uint8Array = new Uint8Array(32);
  private sendChainKey: Uint8Array | null = null;
  private recvChainKey: Uint8Array | null = null;

  private sendMessageNumber = 0;
  private recvMessageNumber = 0;
  private previousSendChainLength = 0;

  private skippedKeys: Map<string, Uint8Array> = new Map();

  /**
   * Symmetric initialization — both peers can send immediately.
   *
   * Both sides call this with the same sharedSecret and their respective
   * keypairs. The `isLower` flag (determined by comparing public keys)
   * ensures the send/receive chains are swapped correctly:
   *   lower  → sends on chainA, receives on chainB
   *   higher → sends on chainB, receives on chainA
   *
   * The DH ratchet engages on the first message exchange,
   * providing forward secrecy from that point on.
   */
  async initSymmetric(
    sharedSecret: Uint8Array,
    ownKeypair: CryptoKeyPair,
    remotePublicKeyRaw: Uint8Array,
    isLower: boolean,
  ): Promise<void> {
    this.dhKeypair = ownKeypair;
    this.remotePubKey = await importPublicKey(remotePublicKeyRaw);
    this.remotePubKeyRaw = remotePublicKeyRaw;
    this.rootKey = sharedSecret;

    const [chainA, chainB] = await deriveInitialChains(sharedSecret);

    if (isLower) {
      this.sendChainKey = chainA;
      this.recvChainKey = chainB;
    } else {
      this.sendChainKey = chainB;
      this.recvChainKey = chainA;
    }
  }

  /**
   * Initialize as the session initiator (Alice).
   * Kept for backward compatibility with existing tests.
   */
  async initAsInitiator(
    sharedSecret: Uint8Array,
    remotePublicKeyRaw: Uint8Array,
  ): Promise<void> {
    this.dhKeypair = await generateKeypair();
    this.remotePubKey = await importPublicKey(remotePublicKeyRaw);
    this.remotePubKeyRaw = remotePublicKeyRaw;
    this.rootKey = sharedSecret;

    const dhOutput = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'X25519', public: this.remotePubKey },
        this.dhKeypair.privateKey,
        256,
      ),
    );

    const [newRootKey, sendChainKey] = await kdfRootKey(this.rootKey, dhOutput);
    this.rootKey = newRootKey;
    this.sendChainKey = sendChainKey;
  }

  /**
   * Initialize as the session responder (Bob).
   * Kept for backward compatibility with existing tests.
   */
  async initAsResponder(
    sharedSecret: Uint8Array,
    ownKeypair: CryptoKeyPair,
  ): Promise<void> {
    this.dhKeypair = ownKeypair;
    this.rootKey = sharedSecret;
  }

  /**
   * Encrypt a plaintext message.
   */
  async encrypt(plaintext: Uint8Array): Promise<RatchetMessage> {
    if (!this.sendChainKey || !this.dhKeypair) {
      throw new Error('Session not initialized for sending');
    }

    const [newChainKey, messageKeyRaw] = await kdfChainKey(this.sendChainKey);
    this.sendChainKey = newChainKey;

    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const aesKey = await crypto.subtle.importKey(
      'raw',
      buf(messageKeyRaw),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );

    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, aesKey, buf(plaintext)),
    );

    const publicKeyRaw = await exportPublicKey(this.dhKeypair);

    const header: MessageHeader = {
      publicKey: publicKeyRaw,
      messageNumber: this.sendMessageNumber,
      previousChainLength: this.previousSendChainLength,
    };

    this.sendMessageNumber++;

    return { header, ciphertext, iv };
  }

  /**
   * Decrypt a received message.
   */
  async decrypt(message: RatchetMessage): Promise<Uint8Array> {
    const skipKey = this.makeSkipKey(message.header.publicKey, message.header.messageNumber);
    const skipped = this.skippedKeys.get(skipKey);
    if (skipped) {
      this.skippedKeys.delete(skipKey);
      return this.decryptWithKey(skipped, message);
    }

    const needsRatchet = !this.remotePubKeyRaw || !arraysEqual(message.header.publicKey, this.remotePubKeyRaw);

    if (needsRatchet) {
      if (this.recvChainKey !== null) {
        await this.skipMessages(message.header.previousChainLength);
      }

      this.remotePubKeyRaw = message.header.publicKey;
      this.remotePubKey = await importPublicKey(message.header.publicKey);
      this.previousSendChainLength = this.sendMessageNumber;
      this.sendMessageNumber = 0;
      this.recvMessageNumber = 0;

      if (!this.dhKeypair) throw new Error('No DH keypair');

      const dhOutput = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'X25519', public: this.remotePubKey },
          this.dhKeypair.privateKey,
          256,
        ),
      );

      const [newRootKey, recvChainKey] = await kdfRootKey(this.rootKey, dhOutput);
      this.rootKey = newRootKey;
      this.recvChainKey = recvChainKey;

      this.dhKeypair = await generateKeypair();

      const dhOutput2 = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'X25519', public: this.remotePubKey },
          this.dhKeypair.privateKey,
          256,
        ),
      );

      const [newRootKey2, sendChainKey] = await kdfRootKey(this.rootKey, dhOutput2);
      this.rootKey = newRootKey2;
      this.sendChainKey = sendChainKey;
    }

    await this.skipMessages(message.header.messageNumber);

    if (!this.recvChainKey) throw new Error('No receive chain key');
    const [newChainKey, messageKeyRaw] = await kdfChainKey(this.recvChainKey);
    this.recvChainKey = newChainKey;
    this.recvMessageNumber++;

    return this.decryptWithKey(messageKeyRaw, message);
  }

  getPublicKey(): Promise<Uint8Array> {
    if (!this.dhKeypair) throw new Error('No keypair');
    return exportPublicKey(this.dhKeypair);
  }

  private async decryptWithKey(messageKeyRaw: Uint8Array, message: RatchetMessage): Promise<Uint8Array> {
    const aesKey = await crypto.subtle.importKey(
      'raw',
      buf(messageKeyRaw),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(message.iv) }, aesKey, buf(message.ciphertext)),
    );
  }

  private async skipMessages(until: number): Promise<void> {
    if (!this.recvChainKey) return;
    if (until - this.recvMessageNumber > MAX_SKIP) {
      throw new Error('Too many skipped messages');
    }

    while (this.recvMessageNumber < until) {
      // Enforce global skipped key limit to prevent memory exhaustion
      if (this.skippedKeys.size >= MAX_TOTAL_SKIPPED_KEYS) {
        // Evict oldest entry (first key in insertion order)
        const oldest = this.skippedKeys.keys().next().value;
        if (oldest !== undefined) {
          this.skippedKeys.delete(oldest);
        }
      }

      const [newChainKey, messageKeyRaw] = await kdfChainKey(this.recvChainKey);
      this.recvChainKey = newChainKey;

      const skipKey = this.makeSkipKey(this.remotePubKeyRaw ?? new Uint8Array(32), this.recvMessageNumber);
      this.skippedKeys.set(skipKey, messageKeyRaw);
      this.recvMessageNumber++;
    }
  }

  private makeSkipKey(publicKey: Uint8Array, messageNumber: number): string {
    let hex = '';
    for (let i = 0; i < publicKey.length; i++) {
      hex += (publicKey[i] as number).toString(16).padStart(2, '0');
    }
    return `${hex}:${messageNumber}`;
  }
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
