/**
 * Phrase input masking.
 * Characters appear briefly then turn into bullets (•),
 * like a mobile password field. The real value is stored
 * separately and never displayed after masking.
 */

const MASK_CHAR = '\u2022'; // bullet •
const FLASH_MS = 600;

export function attachPhraseMask(input: HTMLInputElement): {
  getValue: () => string;
  clear: () => void;
} {
  let realValue = '';
  let maskTimeout: ReturnType<typeof setTimeout> | null = null;

  function maskAll(): void {
    input.value = MASK_CHAR.repeat(realValue.length);
  }

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    // Let Enter, Tab, etc. pass through without modifying value
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') return;

    // Handle backspace
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (realValue.length > 0) {
        realValue = realValue.slice(0, -1);
        maskAll();
      }
      // Trigger input event so cursor updates
      input.dispatchEvent(new Event('input'));
      return;
    }

    // Ignore modifier keys and special keys
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    e.preventDefault();
    realValue += e.key;

    // Show all bullets except the last char (briefly visible)
    const masked = MASK_CHAR.repeat(realValue.length - 1) + realValue.slice(-1);
    input.value = masked;
    input.dispatchEvent(new Event('input'));

    // After a delay, mask the last character too
    if (maskTimeout !== null) clearTimeout(maskTimeout);
    maskTimeout = setTimeout(() => {
      maskAll();
      input.dispatchEvent(new Event('input'));
      maskTimeout = null;
    }, FLASH_MS);
  });

  // Prevent paste from bypassing mask
  input.addEventListener('paste', (e: ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData?.getData('text') ?? '';
    realValue += pasted;
    maskAll();
    input.dispatchEvent(new Event('input'));
  });

  return {
    getValue: () => realValue,
    clear: () => {
      realValue = '';
      if (maskTimeout !== null) {
        clearTimeout(maskTimeout);
        maskTimeout = null;
      }
      input.value = '';
    },
  };
}
