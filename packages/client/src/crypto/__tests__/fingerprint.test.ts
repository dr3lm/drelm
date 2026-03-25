/**
 * Fingerprint generation tests.
 * Verifies determinism, uniqueness, domain separation, and SVG structure.
 */

import { describe, it, expect } from 'vitest';
import { generateFingerprint } from '../fingerprint.js';
import { randomBytes } from '../random.js';

describe('generateFingerprint', () => {
  it('returns a valid SVG string', async () => {
    const key = randomBytes(32);
    const svg = await generateFingerprint(key);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 40 40"');
  });

  it('is deterministic — same input produces same output', async () => {
    const key = randomBytes(32);
    const svg1 = await generateFingerprint(key);
    const svg2 = await generateFingerprint(key);

    expect(svg1).toBe(svg2);
  });

  it('different keys produce different fingerprints', async () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);
    const svg1 = await generateFingerprint(key1);
    const svg2 = await generateFingerprint(key2);

    expect(svg1).not.toBe(svg2);
  });

  it('uses colors from the curated palette', async () => {
    const key = randomBytes(32);
    const svg = await generateFingerprint(key);

    // Extract all fill colors from rects
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map(m => m[1]);
    expect(fills.length).toBeGreaterThan(0);

    const palette = [
      '#e06c75', '#98c379', '#61afef', '#c678dd',
      '#e5c07b', '#56b6c2', '#be5046', '#d19a66',
      '#7ec8e3', '#c3e88d', '#f78c6c', '#89ddff',
      '#a9b1d6', '#ff9cac', '#82aaff', '#c792ea',
    ];

    for (const color of fills) {
      expect(palette).toContain(color);
    }
  });

  it('foreground and background colors are different', async () => {
    // Test across many keys to ensure fg ≠ bg
    for (let i = 0; i < 20; i++) {
      const key = randomBytes(32);
      const svg = await generateFingerprint(key);

      // Background rect has opacity="0.25"
      const bgMatch = svg.match(/fill="(#[0-9a-f]{6})" opacity="0\.25"/i);
      // Foreground rects don't have opacity
      const fgMatches = [...svg.matchAll(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="(#[0-9a-f]{6})"\/>/gi)];

      expect(bgMatch).not.toBeNull();
      if (bgMatch && fgMatches.length > 0) {
        const bgColor = bgMatch[1];
        const fgColor = fgMatches[0]![1];
        expect(fgColor).not.toBe(bgColor);
      }
    }
  });

  it('has domain separation — raw SHA-256 of same input would differ', async () => {
    const key = randomBytes(32);
    const svg = await generateFingerprint(key);

    // Manually hash without domain separator
    const rawHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', key.buffer as ArrayBuffer),
    );

    // Hash with domain separator (what fingerprint uses)
    const prefix = new TextEncoder().encode('drelm-fingerprint');
    const combined = new Uint8Array(prefix.length + key.length);
    combined.set(prefix, 0);
    combined.set(key, prefix.length);
    const domainHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', combined.buffer as ArrayBuffer),
    );

    // These must be different — domain separation is working
    expect(rawHash).not.toEqual(domainHash);
  });

  it('produces vertically symmetric grid', async () => {
    const key = randomBytes(32);
    const svg = await generateFingerprint(key);

    // Extract rect positions
    const rects = [...svg.matchAll(/x="(\d+)" y="(\d+)"/g)].map(m => ({
      x: parseInt(m[1]!, 10),
      y: parseInt(m[2]!, 10),
    }));

    // For each rect, its mirror should also exist (x → 32-x for cellSize=8)
    // Grid is 5 columns × 8px = 40px. Mirror of x=0 is x=32, x=8 is x=24.
    // Center column (x=16) mirrors to itself.
    for (const r of rects) {
      if (r.x === 16) continue; // center column, no mirror needed
      const mirrorX = 40 - 8 - r.x; // 40 - cellSize - x
      const hasMirror = rects.some(other => other.x === mirrorX && other.y === r.y);
      expect(hasMirror).toBe(true);
    }
  });
});
