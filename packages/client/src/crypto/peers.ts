/**
 * Pairwise peer session management with Double Ratchet.
 *
 * Each peer pair establishes an independent ECDH shared secret,
 * then initializes a Double Ratchet session for per-message
 * forward secrecy.
 *
 * Security properties:
 * - Each message encrypted with a unique, one-time key
 * - Compromise of one message key reveals nothing about others
 * - DH ratchet provides post-compromise security
 * - Pairwise: compromise of one peer pair doesn't affect others
 * - Usernames inside ciphertext — server never sees them
 */

import { exportPublicKey, importPublicKey } from './keypair.js';
import { deriveSharedBits } from './exchange.js';
import { bytesToHex, hexToBytes } from './random.js';
import { generateFingerprint } from './fingerprint.js';
import {
  RatchetSession,
  serializeRatchetMessage,
  deserializeRatchetMessage,
} from './ratchet.js';

export interface PeerSession {
  publicKeyHex: string;
  publicKeyRaw: Uint8Array;
  ratchet: RatchetSession;
  fingerprint: string;
  name: string | null;
}

/** Per-peer envelope sent over the wire as a single CBR packet. */
interface WirePayload {
  f: string;                // sender's public key hex
  t: string;                // recipient's public key hex
  m: Record<string, unknown>; // serialized RatchetMessage
}

/** Decrypted inner message content. */
export interface DecryptedMessage {
  sender: string;
  text: string;
}

export class PeerManager {
  private sessions: Map<string, PeerSession> = new Map();
  private ownKeypair: CryptoKeyPair;
  private ownPubKeyRaw: Uint8Array;
  readonly ownPubKeyHex: string;

  private constructor(
    keypair: CryptoKeyPair,
    pubRaw: Uint8Array,
    pubHex: string,
  ) {
    this.ownKeypair = keypair;
    this.ownPubKeyRaw = pubRaw;
    this.ownPubKeyHex = pubHex;
  }

  static async create(keypair: CryptoKeyPair): Promise<PeerManager> {
    const pubRaw = await exportPublicKey(keypair);
    const pubHex = bytesToHex(pubRaw);
    return new PeerManager(keypair, pubRaw, pubHex);
  }

  /**
   * Establish a pairwise ratchet session with a peer.
   * Both sides derive the same ECDH shared secret independently,
   * then init a symmetric ratchet (both can send immediately).
   * Role is determined by public key ordering.
   */
  async addPeer(publicKeyHex: string): Promise<PeerSession> {
    const existing = this.sessions.get(publicKeyHex);
    if (existing) return existing;

    const publicKeyRaw = hexToBytes(publicKeyHex);
    const remotePub = await importPublicKey(publicKeyRaw);

    const sharedSecret = await deriveSharedBits(this.ownKeypair.privateKey, remotePub);

    // Deterministic role assignment: lower public key hex = "lower" role
    const isLower = this.ownPubKeyHex < publicKeyHex;

    const ratchet = new RatchetSession();
    await ratchet.initSymmetric(sharedSecret, this.ownKeypair, publicKeyRaw, isLower);

    const fingerprint = await generateFingerprint(publicKeyRaw);

    // Zero the shared secret — no longer needed after ratchet init.
    // Retaining it would weaken forward secrecy if memory is compromised.
    sharedSecret.fill(0);

    const session: PeerSession = {
      publicKeyHex,
      publicKeyRaw,
      ratchet,
      fingerprint,
      name: null,
    };

    this.sessions.set(publicKeyHex, session);
    return session;
  }

  removePeer(publicKeyHex: string): void {
    this.sessions.delete(publicKeyHex);
  }

  getSession(publicKeyHex: string): PeerSession | undefined {
    return this.sessions.get(publicKeyHex);
  }

  getAllSessions(): PeerSession[] {
    return [...this.sessions.values()];
  }

  get peerCount(): number {
    return this.sessions.size;
  }

  /**
   * Encrypt a message for all current peers using their ratchet sessions.
   * Returns an array of per-peer JSON payloads — one CBR packet per peer.
   * Each peer gets a unique ciphertext from a unique ratcheted key.
   */
  async encryptForPeers(senderName: string, text: string): Promise<string[]> {
    const envelope = JSON.stringify({ sender: senderName, text });
    const plaintext = new TextEncoder().encode(envelope);

    const entries = [...this.sessions.entries()];
    const payloads = await Promise.all(
      entries.map(async ([hex, session]) => {
        const ratchetMsg = await session.ratchet.encrypt(plaintext);
        const wire: WirePayload = {
          f: this.ownPubKeyHex,
          t: hex,
          m: serializeRatchetMessage(ratchetMsg) as Record<string, unknown>,
        };
        return JSON.stringify(wire);
      }),
    );

    return payloads;
  }

  /**
   * Decrypt a per-peer wire payload.
   * Identifies the sender, decrypts with their ratchet, returns the message.
   * Returns null for chaff, wrong recipient, or undecryptable.
   */
  async decryptMessage(
    payload: string,
  ): Promise<{ message: DecryptedMessage; session: PeerSession } | null> {
    let wire: WirePayload;
    try {
      wire = JSON.parse(payload) as WirePayload;
    } catch {
      return null;
    }

    if (!wire.f || !wire.t || !wire.m) return null;

    // Not for us — skip without touching ratchet state
    if (wire.t !== this.ownPubKeyHex) return null;

    const session = this.sessions.get(wire.f);
    if (!session) return null;

    const ratchetMsg = deserializeRatchetMessage(wire.m);
    if (!ratchetMsg) return null;

    try {
      const plaintext = await session.ratchet.decrypt(ratchetMsg);
      const message = JSON.parse(new TextDecoder().decode(plaintext)) as DecryptedMessage;

      if (session.name !== message.sender) {
        session.name = message.sender;
      }

      return { message, session };
    } catch {
      return null;
    }
  }

  clear(): void {
    this.sessions.clear();
  }
}
