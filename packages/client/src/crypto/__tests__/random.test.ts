import { describe, it, expect } from 'vitest';
import { randomBytes, randomHex, bytesToHex, hexToBytes } from '../random.js';

describe('randomBytes', () => {
  it('returns correct length', () => {
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(32).length).toBe(32);
    expect(randomBytes(0).length).toBe(0);
  });

  it('returns Uint8Array', () => {
    expect(randomBytes(8)).toBeInstanceOf(Uint8Array);
  });

  it('produces unique outputs', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(a).not.toEqual(b);
  });
});

describe('randomHex', () => {
  it('returns correct hex length', () => {
    expect(randomHex(16).length).toBe(32);
    expect(randomHex(32).length).toBe(64);
  });

  it('returns valid hex', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('bytesToHex / hexToBytes', () => {
  it('round-trips correctly', () => {
    const bytes = randomBytes(32);
    const hex = bytesToHex(bytes);
    const back = hexToBytes(hex);
    expect(back).toEqual(bytes);
  });

  it('handles known values', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x0a, 0xb3]);
    expect(bytesToHex(bytes)).toBe('00ff0ab3');
    expect(hexToBytes('00ff0ab3')).toEqual(bytes);
  });
});
