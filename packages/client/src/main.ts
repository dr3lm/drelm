import { getElements } from './ui.js';
import { createApp } from './app.js';
import { createFishBackground } from './fish.js';
import { createWaves } from './waves.js';
import { attachBlockCursor } from './cursor.js';
import { attachThemeToggle } from './theme.js';

document.addEventListener('DOMContentLoaded', () => {
  const el = getElements();
  createApp(el);
  attachThemeToggle();

  // Terminal block cursors
  attachBlockCursor(el.phraseInput);
  attachBlockCursor(el.messageInput);

  // Spawn the fish school in the landing background
  const fishBg = document.getElementById('fish-bg');
  if (fishBg) {
    createFishBackground(fishBg);
  }

  // Spawn ASCII waves across the landing background
  const wavesBg = document.getElementById('waves');
  if (wavesBg) {
    createWaves(wavesBg);
  }
});
