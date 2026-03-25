// Client → Server messages
export type ClientMessage =
  | { type: 'JOIN'; roomHash: string; publicKey: string }
  | { type: 'MESSAGE'; payload: string }
  | { type: 'LEAVE' };

// Server → Client messages
export type ServerMessage =
  | { type: 'ROOM_JOINED'; peers: ReadonlyArray<{ publicKey: string }> }
  | { type: 'PEER_JOINED'; publicKey: string }
  | { type: 'PEER_LEFT'; publicKey: string }
  | { type: 'MESSAGE'; from: string; payload: string }
  | { type: 'ERROR'; code: ErrorCode };

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'ALREADY_JOINED'
  | 'NOT_JOINED'
  | 'ROOM_FULL';

/**
 * Maximum wire payload size in characters.
 * CBR packets are exactly 720 chars; allow a small margin for encoding variance.
 */
export const MAX_PAYLOAD_LENGTH = 800;

/** Room hashes are hex-encoded 32-byte HKDF output = 64 hex chars. */
export const ROOM_HASH_LENGTH = 64;

/** Public keys are hex-encoded 32-byte X25519 keys = 64 hex chars. */
export const PUBLIC_KEY_LENGTH = 64;

// Type guards
export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (typeof obj['type'] !== 'string') return false;

  switch (obj['type']) {
    case 'JOIN':
      return typeof obj['roomHash'] === 'string'
        && obj['roomHash'].length === ROOM_HASH_LENGTH
        && typeof obj['publicKey'] === 'string'
        && obj['publicKey'].length === PUBLIC_KEY_LENGTH;
    case 'MESSAGE':
      return typeof obj['payload'] === 'string'
        && obj['payload'].length <= MAX_PAYLOAD_LENGTH;
    case 'LEAVE':
      return true;
    default:
      return false;
  }
}
