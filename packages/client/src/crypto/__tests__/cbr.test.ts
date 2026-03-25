import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateChaff,
  encryptForWire,
  decryptFromWire,
  CBREngine,
  WIRE_PAYLOAD_SIZE,
  PACKET_INTERVAL_MS,
} from '../cbr.js';

// Helper: create a test AES-256-GCM key
async function makeTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

describe('generateChaff', () => {
  it('produces exactly WIRE_PAYLOAD_SIZE characters', () => {
    const chaff = generateChaff();
    expect(chaff.length).toBe(WIRE_PAYLOAD_SIZE);
  });

  it('produces unique output each call', () => {
    const a = generateChaff();
    const b = generateChaff();
    expect(a).not.toBe(b);
  });

  it('is valid base64', () => {
    const chaff = generateChaff();
    expect(() => atob(chaff)).not.toThrow();
  });
});

describe('encryptForWire / decryptFromWire', () => {
  it('round-trips a payload through room-key encryption', async () => {
    const key = await makeTestKey();
    const payload = '{"from":"abc","enc":{"def":"ciphertext"}}';

    const encrypted = await encryptForWire(key, payload);
    expect(encrypted).not.toBeNull();
    expect(encrypted!.length).toBe(WIRE_PAYLOAD_SIZE);

    const decrypted = await decryptFromWire(key, encrypted!);
    expect(decrypted).toBe(payload);
  });

  it('encrypted output is exactly WIRE_PAYLOAD_SIZE', async () => {
    const key = await makeTestKey();

    // Short payload
    const short = await encryptForWire(key, 'hi');
    expect(short!.length).toBe(WIRE_PAYLOAD_SIZE);

    // Longer payload
    const longer = await encryptForWire(key, 'x'.repeat(200));
    expect(longer!.length).toBe(WIRE_PAYLOAD_SIZE);

    // Same size
    expect(short!.length).toBe(longer!.length);
  });

  it('encrypted output looks like random base64 (same as chaff)', async () => {
    const key = await makeTestKey();
    const encrypted = await encryptForWire(key, '{"from":"test","enc":{}}');

    // Both are valid base64
    expect(() => atob(encrypted!)).not.toThrow();
    expect(() => atob(generateChaff())).not.toThrow();

    // Both are WIRE_PAYLOAD_SIZE
    expect(encrypted!.length).toBe(WIRE_PAYLOAD_SIZE);
    expect(generateChaff().length).toBe(WIRE_PAYLOAD_SIZE);
  });

  it('chaff fails room-key decryption (returns null)', async () => {
    const key = await makeTestKey();
    const chaff = generateChaff();

    const result = await decryptFromWire(key, chaff);
    expect(result).toBeNull();
  });

  it('wrong key fails decryption (returns null)', async () => {
    const key1 = await makeTestKey();
    const key2 = await makeTestKey();

    const encrypted = await encryptForWire(key1, 'secret');
    const result = await decryptFromWire(key2, encrypted!);
    expect(result).toBeNull();
  });

  it('returns null for oversized payload', async () => {
    const key = await makeTestKey();
    const huge = 'x'.repeat(600); // exceeds INNER_PLAINTEXT_SIZE
    const result = await encryptForWire(key, huge);
    expect(result).toBeNull();
  });

  it('server cannot distinguish real from chaff by structure', async () => {
    const key = await makeTestKey();
    const real = await encryptForWire(key, '{"from":"abc","enc":{"def":"data"}}');
    const chaff = generateChaff();

    // Same length
    expect(real!.length).toBe(chaff.length);

    // Both are base64 — no JSON structure visible
    expect(real![0]).not.toBe('{');
    expect(chaff[0]).not.toBe('{');

    // Neither starts with a predictable prefix
    // (AES-GCM output is uniformly random)
  });
});

describe('CBREngine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends packets at fixed interval', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));

    engine.start();
    vi.advanceTimersByTime(PACKET_INTERVAL_MS * 5);
    expect(sent.length).toBe(5);

    for (const pkt of sent) {
      expect(pkt.length).toBe(WIRE_PAYLOAD_SIZE);
    }

    engine.stop();
  });

  it('sends real messages in place of chaff when queued', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));
    const key = await makeTestKey();

    engine.start();

    const encrypted = await encryptForWire(key, 'real message');
    engine.enqueue(encrypted!);

    // Tick 1: real message (encrypted)
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(1);

    // Verify it decrypts back
    const decrypted = await decryptFromWire(key, sent[0] as string);
    expect(decrypted).toBe('real message');

    // Tick 2: chaff
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(2);

    // Chaff doesn't decrypt
    const chaffResult = await decryptFromWire(key, sent[1] as string);
    expect(chaffResult).toBeNull();

    // Both same size
    expect((sent[0] as string).length).toBe((sent[1] as string).length);

    engine.stop();
  });

  it('stops sending after stop()', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));

    engine.start();
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(1);

    engine.stop();
    vi.advanceTimersByTime(PACKET_INTERVAL_MS * 10);
    expect(sent.length).toBe(1);
  });

  it('maintains constant rate regardless of queue depth', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));

    engine.start();

    // Enqueue 3 messages at once
    for (let i = 0; i < 3; i++) {
      engine.enqueue('m'.repeat(WIRE_PAYLOAD_SIZE));
    }

    // After 5 ticks: exactly 5 packets (3 real + 2 chaff), not a burst
    vi.advanceTimersByTime(PACKET_INTERVAL_MS * 5);
    expect(sent.length).toBe(5);

    // All same size
    for (const pkt of sent) {
      expect(pkt.length).toBe(WIRE_PAYLOAD_SIZE);
    }

    engine.stop();
  });

  it('queued messages are drained one per tick (no batching)', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));

    const real = 'r'.repeat(WIRE_PAYLOAD_SIZE);
    const isReal = (p: string): boolean => p === real;

    engine.start();

    // Enqueue 3 real messages
    engine.enqueue(real);
    engine.enqueue(real);
    engine.enqueue(real);

    // Tick 1: first real
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(1);
    expect(isReal(sent[0] as string)).toBe(true);

    // Tick 2: second real
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(2);
    expect(isReal(sent[1] as string)).toBe(true);

    // Tick 3: third real
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(3);
    expect(isReal(sent[2] as string)).toBe(true);

    // Tick 4: queue empty, chaff
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(4);
    expect(isReal(sent[3] as string)).toBe(false);

    engine.stop();
  });

  it('rejects payloads that are not exactly WIRE_PAYLOAD_SIZE', () => {
    const engine = new CBREngine(() => {});

    expect(() => engine.enqueue('too-short')).toThrow();
    expect(() => engine.enqueue('x'.repeat(WIRE_PAYLOAD_SIZE + 1))).toThrow();
    expect(() => engine.enqueue('x'.repeat(WIRE_PAYLOAD_SIZE - 1))).toThrow();

    // Exact size works
    expect(() => engine.enqueue('x'.repeat(WIRE_PAYLOAD_SIZE))).not.toThrow();
  });

  it('stop() discards queued messages', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));

    engine.start();
    engine.enqueue('x'.repeat(WIRE_PAYLOAD_SIZE));
    engine.enqueue('x'.repeat(WIRE_PAYLOAD_SIZE));

    engine.stop();

    // Restart — should send chaff, not old queued messages
    engine.start();
    vi.advanceTimersByTime(PACKET_INTERVAL_MS);
    expect(sent.length).toBe(1);

    // The sent packet should be chaff (random), not 'xxx...'
    expect(sent[0] !== 'x'.repeat(WIRE_PAYLOAD_SIZE)).toBe(true);

    engine.stop();
  });

  it('all packets are valid base64 of identical length over 100 ticks', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const engine = new CBREngine((payload) => sent.push(payload));

    engine.start();

    // Sprinkle in some real messages at random ticks
    engine.enqueue('a'.repeat(WIRE_PAYLOAD_SIZE));
    vi.advanceTimersByTime(PACKET_INTERVAL_MS * 30);
    engine.enqueue('b'.repeat(WIRE_PAYLOAD_SIZE));
    vi.advanceTimersByTime(PACKET_INTERVAL_MS * 70);

    expect(sent.length).toBe(100);

    for (const pkt of sent) {
      // Identical length
      expect(pkt.length).toBe(WIRE_PAYLOAD_SIZE);
      // Valid base64 (won't throw)
      expect(() => atob(pkt)).not.toThrow();
    }

    engine.stop();
  });
});
