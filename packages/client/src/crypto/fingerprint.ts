/**
 * Deterministic visual fingerprint from a shared secret.
 * Used for out-of-band MITM verification — if both peers see the
 * same identicon, no key substitution occurred.
 *
 * Approach: SHA-256 the public key for domain separation,
 * then use hash bits to drive a symmetric 5x5 grid identicon
 * with a deterministic color palette. Each user has a unique
 * identicon derived from their public key.
 */

/**
 * Hash the input with domain separation.
 * Used with a public key to give each user a unique, deterministic identicon.
 */
async function fingerprintHash(input: Uint8Array): Promise<Uint8Array> {
  const prefix = new TextEncoder().encode('drelm-fingerprint');
  const combined = new Uint8Array(prefix.length + input.length);
  combined.set(prefix, 0);
  combined.set(input, prefix.length);
  const hash = await crypto.subtle.digest('SHA-256', combined.buffer as ArrayBuffer);
  return new Uint8Array(hash);
}

// Curated palette — high contrast, distinguishable on dark backgrounds
const PALETTE = [
  '#e06c75', '#98c379', '#61afef', '#c678dd',
  '#e5c07b', '#56b6c2', '#be5046', '#d19a66',
  '#7ec8e3', '#c3e88d', '#f78c6c', '#89ddff',
  '#a9b1d6', '#ff9cac', '#82aaff', '#c792ea',
];

/**
 * Generate a deterministic SVG identicon string.
 * The identicon is a 5x5 grid with vertical symmetry (like GitHub).
 * Size is 40x40, suitable for sidebar display.
 */
export async function generateFingerprint(sharedSecret: Uint8Array): Promise<string> {
  const hash = await fingerprintHash(sharedSecret);

  // Pick two colors from the palette using first 2 bytes
  const fgColor = PALETTE[(hash[0] as number) % PALETTE.length] as string;
  const bgColor = PALETTE[((hash[1] as number) % (PALETTE.length - 1) + 1 +
    (hash[0] as number) % PALETTE.length) % PALETTE.length] as string;

  const size = 40;
  const cells = 5;
  const cellSize = size / cells;

  // Build the 5x5 grid. Only compute left half + center (3 columns),
  // mirror for right half → vertical symmetry.
  // Use bytes 2-16 for cell fill decisions (15 cells in the left half+center).
  let rects = '';
  let byteIdx = 2;

  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < 3; col++) {
      const filled = ((hash[byteIdx] as number) >> (row % 8)) & 1;
      byteIdx = (byteIdx + 1) % 32;

      if (filled) {
        const x = col * cellSize;
        const y = row * cellSize;
        rects += `<rect x="${x.toString()}" y="${y.toString()}" width="${cellSize.toString()}" height="${cellSize.toString()}" fill="${fgColor}"/>`;

        // Mirror (skip center column)
        if (col < 2) {
          const mirrorX = (cells - 1 - col) * cellSize;
          rects += `<rect x="${mirrorX.toString()}" y="${y.toString()}" width="${cellSize.toString()}" height="${cellSize.toString()}" fill="${fgColor}"/>`;
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.toString()} ${size.toString()}" width="${size.toString()}" height="${size.toString()}">` +
    `<rect width="${size.toString()}" height="${size.toString()}" rx="4" fill="${bgColor}" opacity="0.25"/>` +
    rects +
    `</svg>`;
}
