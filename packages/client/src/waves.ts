/**
 * ASCII fluid waves — 2D sine interference field.
 *
 * Computes a scalar field from overlapping 2D sine waves at every
 * character cell in the viewport. The field value maps to a character
 * density ramp: peaks use heavy glyphs (@#%*), troughs use light
 * glyphs (.,  ) or blanks. The result is animated interference bands
 * that sweep and curve across the full screen like ocean swells.
 *
 * Purely decorative. No external requests. Uses requestAnimationFrame.
 */

// Character density ramp — more space, softer peaks (no heavy glyphs)
const RAMP = '                        .....,,,,====++';

// Wave layer definition — each contributes to the 2D scalar field
interface WaveLayer {
  /** X-direction frequency */
  kx: number;
  /** Y-direction frequency */
  ky: number;
  /** Phase velocity (radians/sec) */
  speed: number;
  /** Base amplitude weight */
  amp: number;
  /** Initial phase offset */
  phase: number;
  /** Amplitude breath rate — how fast this layer swells/recedes (rad/s) */
  breathRate: number;
  /** Amplitude breath depth — 0=constant, 1=fades to zero at minimum */
  breathDepth: number;
  /** Frequency breath rate — wave bands widen/narrow as they roll */
  freqBreathRate: number;
  /** Frequency breath depth — how much kx/ky oscillate (fraction of base) */
  freqBreathDepth: number;
}

export function createWaves(container: HTMLElement): () => void {
  const el = document.createElement('pre');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    margin: '0',
    padding: '0',
    lineHeight: '1.05',
    fontSize: '13px',
    fontFamily: 'inherit',
    color: '#ffffff',
    opacity: '0.09',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    userSelect: 'none',
    overflow: 'hidden',
  });
  container.appendChild(el);

  // Approximate character cell size
  const cellW = 7.8;
  const cellH = 13.6;

  let cols = 0;
  let rows = 0;
  let raf = 0;

  function measure(): void {
    cols = Math.ceil(window.innerWidth / cellW) + 2;
    rows = Math.ceil(window.innerHeight / cellH) + 2;
  }
  measure();

  // Generate wave layers — wide range of scales and speeds.
  // Each layer breathes: amplitude swells up and recedes, frequency
  // widens and tightens, so wave bands expand as they crest then
  // thin out as they pass — like real rolling water.
  const layers: WaveLayer[] = [
    // Long slow groundswell — nearly vanishes at trough, blooms at peak
    { kx: 0.04,  ky: 0.01,   speed: 0.3,  amp: 1.0,  phase: 0,   breathRate: 0.13, breathDepth: 0.90, freqBreathRate: 0.06,  freqBreathDepth: 0.3 },
    { kx: 0.035, ky: -0.02,  speed: 0.25, amp: 0.7,  phase: 3.1, breathRate: 0.11, breathDepth: 0.88, freqBreathRate: 0.05,  freqBreathDepth: 0.25 },
    // Medium swells — main visual rhythm, quick fade
    { kx: 0.09,  ky: 0.025,  speed: 0.7,  amp: 0.6,  phase: 1.8, breathRate: 0.18, breathDepth: 0.92, freqBreathRate: 0.09,  freqBreathDepth: 0.2 },
    { kx: 0.12,  ky: -0.018, speed: 0.85, amp: 0.5,  phase: 4.5, breathRate: 0.22, breathDepth: 0.90, freqBreathRate: 0.11,  freqBreathDepth: 0.2 },
    { kx: 0.08,  ky: 0.045,  speed: 0.6,  amp: 0.45, phase: 2.6, breathRate: 0.16, breathDepth: 0.91, freqBreathRate: 0.08,  freqBreathDepth: 0.15 },
    // Short wind chop — fast pulse, almost fully disappears between beats
    { kx: 0.2,   ky: 0.03,   speed: 1.3,  amp: 0.25, phase: 5.6, breathRate: 0.30, breathDepth: 0.93, freqBreathRate: 0.15,  freqBreathDepth: 0.15 },
    { kx: 0.17,  ky: -0.04,  speed: 1.5,  amp: 0.2,  phase: 0.4, breathRate: 0.36, breathDepth: 0.92, freqBreathRate: 0.18,  freqBreathDepth: 0.1 },
    { kx: 0.25,  ky: 0.02,   speed: 1.7,  amp: 0.15, phase: 3.8, breathRate: 0.32, breathDepth: 0.93, freqBreathRate: 0.2,   freqBreathDepth: 0.1 },
    // Cross-swell — slow diagonal, deep fade
    { kx: 0.06,  ky: 0.07,   speed: 0.5,  amp: 0.3,  phase: 1.1, breathRate: 0.12, breathDepth: 0.88, freqBreathRate: 0.05,  freqBreathDepth: 0.2 },
  ];

  // Normalize amplitudes so total range is -1..1
  const totalAmp = layers.reduce((s, l) => s + l.amp, 0);
  for (const l of layers) {
    l.amp /= totalAmp;
  }

  const rampLen = RAMP.length;

  function render(time: number): void {
    const sec = time / 1000;
    let out = '';

    // Pre-compute per-layer breathing state for this frame
    const layerCount = layers.length;
    const amps = new Float64Array(layerCount);
    const kxs = new Float64Array(layerCount);
    const kys = new Float64Array(layerCount);

    let totalAmpNow = 0;
    for (let i = 0; i < layerCount; i++) {
      const l = layers[i] as WaveLayer;
      // Amplitude breathes: swells up then recedes
      const breathCycle = Math.sin(sec * l.breathRate + l.phase * 0.7);
      amps[i] = l.amp * (1 - l.breathDepth * 0.5 + l.breathDepth * 0.5 * breathCycle);
      totalAmpNow += amps[i] as number;

      // Frequency breathes: bands widen at crest (lower freq), tighten in trough
      const freqCycle = Math.sin(sec * l.freqBreathRate + l.phase * 0.4);
      kxs[i] = l.kx * (1 - l.freqBreathDepth * 0.5 * freqCycle);
      kys[i] = l.ky * (1 - l.freqBreathDepth * 0.5 * freqCycle);
    }

    // Normalize so we stay in -1..1 range
    const normInv = totalAmpNow > 0 ? 1 / totalAmpNow : 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let value = 0;
        for (let i = 0; i < layerCount; i++) {
          const l = layers[i] as WaveLayer;
          value += (amps[i] as number) * Math.sin(
            c * (kxs[i] as number) + r * (kys[i] as number) + sec * l.speed + l.phase,
          );
        }
        value *= normInv;

        const idx = Math.floor(((value + 1) / 2) * (rampLen - 1));
        out += RAMP[idx] as string;
      }
      out += '\n';
    }

    el.textContent = out;
    raf = requestAnimationFrame(render);
  }

  function onResize(): void {
    measure();
  }
  window.addEventListener('resize', onResize);

  raf = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    el.remove();
  };
}
