/**
 * ASCII fish school — animated background for the landing page.
 *
 * Generates schools (clusters) of identical small fish that move
 * together in sweeping arcs across the viewport. Each school shares
 * the same base trajectory with slight per-fish variation, producing
 * the fluid, breathing motion of a real minnow school.
 */

const FISH_RIGHT = [
  '><>',
  '=>>',
  '><))>',
  '>->',
  '>=>>',
  '>))>',
  '>>',
  '>-=>',
  '>~>',
  '~>',
  '}=>>',
  '>=>',
  '><=>',
  '>=)>',
  '>}}>',
  '>-}}>',
];
const FISH_LEFT = [
  '<><',
  '<<=',
  '<((><',
  '<-<',
  '<<=<',
  '<((<',
  '<<',
  '<=-<',
  '<~<',
  '<~',
  '<<={',
  '<=<',
  '<=><',
  '<(=<',
  '<{{<',
  '<{{-<',
];

interface SchoolConfig {
  art: string;
  count: number;
  /** Center Y of the school as % of viewport */
  centerY: number;
  /** Horizontal speed in seconds for full traverse */
  speed: number;
  direction: 1 | -1;
  /** Base opacity for the school */
  opacity: number;
  /** Font size in px */
  size: number;
  /** Vertical arc amplitude in vh */
  arcAmplitude: number;
  /** Vertical arc period multiplier (fraction of swim duration) */
  arcPhase: number;
}

function randomInt(min: number, max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + ((arr[0] as number) % (max - min + 1));
}

function randomFloat(min: number, max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + ((arr[0] as number) / 0xFFFFFFFF) * (max - min);
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)] as T;
}

function generateSchools(count: number): SchoolConfig[] {
  const schools: SchoolConfig[] = [];

  // Divide the viewport into vertical bands and place schools evenly.
  // Each band gets 1-2 schools so coverage is uniform top to bottom.
  const bandHeight = 90 / count; // usable range: 5% to 95%

  for (let i = 0; i < count; i++) {
    const direction: 1 | -1 = randomInt(0, 1) === 0 ? 1 : -1;
    const art = direction === 1 ? pickRandom(FISH_RIGHT) : pickRandom(FISH_LEFT);

    // Place school center within its assigned band, with some jitter
    const bandStart = 5 + i * bandHeight;
    const centerY = bandStart + randomFloat(0, bandHeight);

    schools.push({
      art,
      count: randomInt(12, 25),
      centerY,
      speed: randomFloat(45, 90),
      direction,
      opacity: randomFloat(0.1, 0.28),
      size: randomFloat(12, 16),
      arcAmplitude: randomFloat(4, 15),
      arcPhase: randomFloat(0.3, 0.8),
    });
  }

  return schools;
}

export function createFishBackground(container: HTMLElement): void {
  const schoolCount = Math.max(16, Math.floor(window.innerWidth / 50));
  const schools = generateSchools(schoolCount);

  const styleEl = document.getElementById('fish-styles') ?? (() => {
    const s = document.createElement('style');
    s.id = 'fish-styles';
    document.head.appendChild(s);
    return s;
  })();

  // Build unique keyframes per school — each has a custom arc path
  let css = '';
  let fishId = 0;

  for (let si = 0; si < schools.length; si++) {
    const school = schools[si] as SchoolConfig;
    const startX = school.direction === 1 ? -15 : 115;
    const endX = school.direction === 1 ? 115 : -15;

    // The school follows a sinusoidal vertical arc while swimming horizontally
    // Build a multi-step keyframe for a smooth curved path
    const steps = 20;
    let keyframe = `@keyframes school-${si.toString()} {\n`;
    for (let k = 0; k <= steps; k++) {
      const pct = k / steps;
      const x = startX + (endX - startX) * pct;
      // Sine wave creates the vertical arc
      const yOffset = Math.sin(pct * Math.PI * 2 * school.arcPhase) * school.arcAmplitude;
      keyframe += `  ${(pct * 100).toFixed(1)}% { transform: translate(${x.toFixed(1)}vw, ${yOffset.toFixed(1)}vh); }\n`;
    }
    keyframe += '}\n';
    css += keyframe;

    // Spawn individual fish within this school
    for (let fi = 0; fi < school.count; fi++) {
      const id = fishId++;
      // Each fish gets slight offsets from the school center for organic spread
      const ySpread = randomFloat(-3, 3);
      const timeJitter = randomFloat(-2, 2);
      const opacityJitter = randomFloat(-0.04, 0.04);
      const sizeJitter = randomFloat(-1.5, 1.5);

      const el = document.createElement('pre');
      el.className = 'fish';
      el.id = `f${id.toString()}`;
      el.textContent = school.art;
      el.setAttribute('aria-hidden', 'true');

      const fishY = school.centerY + ySpread;
      const fishOpacity = Math.max(0.04, Math.min(0.35, school.opacity + opacityJitter));
      const fishSize = Math.max(10, school.size + sizeJitter);
      const fishSpeed = school.speed + timeJitter;
      // Negative delay = start at random point along the path
      const offset = -randomFloat(0, fishSpeed);

      Object.assign(el.style, {
        position: 'absolute',
        top: `${fishY.toFixed(1)}%`,
        left: '0',
        margin: '0',
        padding: '0',
        lineHeight: '1',
        fontSize: `${fishSize.toFixed(1)}px`,
        opacity: fishOpacity.toFixed(3),
        color: '#ffffff',
        whiteSpace: 'pre',
        pointerEvents: 'none',
        userSelect: 'none',
        animation: `school-${si.toString()} ${fishSpeed.toFixed(1)}s linear ${offset.toFixed(1)}s infinite`,
        willChange: 'transform',
      });

      container.appendChild(el);
    }
  }

  styleEl.textContent = css;
}

export function destroyFishBackground(container: HTMLElement): void {
  const fish = container.querySelectorAll('.fish');
  for (const el of fish) {
    el.remove();
  }
}
