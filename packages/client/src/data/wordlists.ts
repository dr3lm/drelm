export const adjectives = [
  'amber', 'arctic', 'ashen', 'azure', 'bitter', 'blazing', 'blind', 'bold',
  'bright', 'broken', 'bronze', 'buried', 'calm', 'carved', 'chrome', 'clean',
  'clear', 'clever', 'cold', 'coral', 'crisp', 'cross', 'cruel', 'crystal',
  'cyan', 'dark', 'dawn', 'deep', 'dense', 'dim', 'dire', 'distant',
  'double', 'dread', 'drift', 'dry', 'dusk', 'dusty', 'eager', 'early',
  'east', 'elder', 'empty', 'equal', 'even', 'faded', 'faint', 'false',
  'feral', 'fierce', 'final', 'first', 'flat', 'fleet', 'flint', 'foggy',
  'forge', 'fossil', 'found', 'frail', 'frank', 'free', 'fresh', 'frost',
  'full', 'ghost', 'glass', 'gleam', 'glow', 'gold', 'gone', 'grand',
  'grave', 'gray', 'great', 'green', 'grim', 'half', 'hard', 'harsh',
  'heavy', 'hidden', 'high', 'hollow', 'honest', 'humble', 'hushed', 'ice',
  'idle', 'inner', 'iron', 'ivory', 'jade', 'keen', 'kind', 'known',
  'lame', 'large', 'last', 'late', 'lean', 'left', 'light', 'lone',
  'long', 'lost', 'loud', 'low', 'lucid', 'lunar', 'mad', 'major',
  'maple', 'marble', 'mean', 'metal', 'mild', 'minor', 'misty', 'molar',
  'moss', 'mute', 'narrow', 'near', 'neat', 'new', 'next', 'nimble',
  'noble', 'noire', 'north', 'novel', 'null', 'oak', 'odd', 'old',
  'olive', 'open', 'orchid', 'other', 'outer', 'pale', 'past', 'pearl',
  'pine', 'plain', 'polar', 'prime', 'proof', 'proud', 'pure', 'quick',
  'quiet', 'rapid', 'rare', 'raw', 'ready', 'real', 'red', 'rich',
  'right', 'rigid', 'risen', 'river', 'rocky', 'rough', 'round', 'royal',
  'ruby', 'rude', 'ruled', 'rust', 'safe', 'sage', 'salt', 'satin',
  'sharp', 'short', 'shy', 'silent', 'silk', 'silver', 'sleek', 'slim',
  'slow', 'small', 'smart', 'smoke', 'smooth', 'snowy', 'soft', 'solar',
  'solid', 'sonic', 'sour', 'south', 'spare', 'stark', 'steel', 'steep',
  'stern', 'still', 'stone', 'stray', 'strong', 'sun', 'sure', 'swift',
] as const;

export const nouns = [
  'anchor', 'arrow', 'atlas', 'atom', 'badge', 'basin', 'blade', 'blaze',
  'bloom', 'bolt', 'bone', 'book', 'bow', 'brick', 'bridge', 'brook',
  'brush', 'cairn', 'candle', 'cape', 'card', 'cargo', 'chain', 'chalk',
  'charm', 'chest', 'choir', 'cipher', 'claim', 'cliff', 'clock', 'cloud',
  'clover', 'coal', 'coast', 'coil', 'coin', 'coral', 'core', 'crane',
  'creek', 'crest', 'cross', 'crown', 'crypt', 'curve', 'dawn', 'delta',
  'den', 'depth', 'dial', 'dock', 'dome', 'dove', 'draft', 'dream',
  'drum', 'dune', 'dust', 'dwarf', 'eagle', 'earth', 'echo', 'edge',
  'elm', 'ember', 'epoch', 'fable', 'fang', 'fault', 'fern', 'field',
  'finch', 'flame', 'flare', 'flask', 'fleet', 'flint', 'float', 'flood',
  'floor', 'flute', 'foam', 'forge', 'fork', 'fort', 'fox', 'frame',
  'frost', 'gale', 'gate', 'gaze', 'gear', 'ghost', 'glade', 'glass',
  'gleam', 'globe', 'glow', 'golem', 'gorge', 'grain', 'grape', 'graph',
  'grasp', 'grave', 'grove', 'guard', 'guide', 'guild', 'gull', 'gust',
  'haven', 'hawk', 'haze', 'heart', 'heath', 'hedge', 'heron', 'hinge',
  'hive', 'hollow', 'hood', 'hook', 'horn', 'hull', 'hymn', 'index',
  'inlet', 'iron', 'isle', 'ivory', 'jade', 'jar', 'jewel', 'joint',
  'judge', 'karma', 'keep', 'kelp', 'key', 'knack', 'knoll', 'knot',
  'lake', 'lance', 'latch', 'leaf', 'ledge', 'lens', 'lever', 'light',
  'lily', 'lime', 'link', 'lock', 'lodge', 'loom', 'lotus', 'lumen',
  'march', 'marsh', 'mast', 'maze', 'mesa', 'mill', 'mine', 'mint',
  'mist', 'moat', 'moon', 'moor', 'moss', 'mount', 'myth', 'nerve',
  'nest', 'node', 'north', 'notch', 'novel', 'oak', 'oar', 'orbit',
  'otter', 'owl', 'oxide', 'palm', 'patch', 'path', 'peak', 'pearl',
  'pier', 'pike', 'pilot', 'pine', 'pivot', 'plank', 'plume', 'point',
  'pond', 'port', 'prism', 'probe', 'pulse', 'quail', 'quartz', 'quest',
] as const;

export function generateUsername(): string {
  const values = new Uint32Array(3);
  crypto.getRandomValues(values);

  const adj = adjectives[(values[0] as number) % adjectives.length] as string;
  const noun = nouns[(values[1] as number) % nouns.length] as string;
  const num = ((values[2] as number) % 20).toString();

  return `${adj}-${noun}-${num}`;
}
