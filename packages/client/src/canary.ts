import { attachThemeToggle } from './theme.js';

attachThemeToggle();

const el = document.getElementById('canary-text') as HTMLElement;
const status = document.getElementById('canary-status') as HTMLElement;

fetch('/canary.txt')
  .then((r) => r.text())
  .then((text) => {
    el.textContent = text;

    const match = text.match(/As of (\d{4}-\d{2}-\d{2})/);
    if (match?.[1]) {
      const canaryDate = new Date(match[1] + 'T00:00:00Z');
      const now = new Date();
      const daysSince = Math.floor((now.getTime() - canaryDate.getTime()) / 86400000);

      if (daysSince <= 60) {
        status.className = 'ok';
        status.textContent = `canary is current — last signed ${match[1]} (${daysSince} days ago)`;
      } else {
        status.className = 'stale';
        status.textContent = `WARNING: canary is ${daysSince} days old — last signed ${match[1]}`;
      }
    } else {
      status.className = 'unknown';
      status.textContent = 'could not parse canary date';
    }
  })
  .catch(() => {
    el.textContent = 'failed to load canary.txt';
    status.className = 'stale';
    status.textContent = 'WARNING: canary could not be loaded';
  });
