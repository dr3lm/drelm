/**
 * Terminal-style blinking block cursor for input fields.
 * Replaces the native thin caret with a solid blinking rectangle.
 */

export function attachBlockCursor(
  input: HTMLInputElement,
  options?: { autoFocus?: boolean },
): void {
  const cursor = document.createElement('span');
  cursor.className = 'block-cursor';
  cursor.textContent = '\u2588'; // Full block character

  const wrapper = document.createElement('div');
  wrapper.className = 'input-cursor-wrap';
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  wrapper.appendChild(cursor);

  function update(): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const style = getComputedStyle(input);
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    const textWidth = ctx.measureText(input.value).width;
    const paddingLeft = parseFloat(style.paddingLeft);

    if (style.textAlign === 'center') {
      const inputWidth = input.clientWidth;
      const paddingRight = parseFloat(style.paddingRight);
      const contentWidth = inputWidth - paddingLeft - paddingRight;
      const textStart = paddingLeft + (contentWidth - textWidth) / 2;
      cursor.style.left = `${(textStart + textWidth).toFixed(0)}px`;
    } else {
      cursor.style.left = `${(paddingLeft + textWidth).toFixed(0)}px`;
    }
  }

  input.addEventListener('input', update);
  input.addEventListener('focus', () => {
    cursor.classList.add('visible');
    update();
  });
  input.addEventListener('blur', () => {
    cursor.classList.remove('visible');
  });

  if (options?.autoFocus) {
    input.focus();
    cursor.classList.add('visible');
  }
  update();
}
