const STORAGE_KEY = 'drelm-theme';

export function applyStoredTheme(): void {
  if (localStorage.getItem(STORAGE_KEY) === 'light') {
    document.documentElement.classList.add('light');
  }
}

export function attachThemeToggle(): void {
  applyStoredTheme();
  document.querySelectorAll('.theme-switch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isLight = document.documentElement.classList.toggle('light');
      localStorage.setItem(STORAGE_KEY, isLight ? 'light' : 'dark');
    });
  });
}
