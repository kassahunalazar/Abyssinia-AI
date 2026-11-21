(() => {
  const key = 'abyssinia-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  function apply(value) {
    preference = ['dark', 'light'].includes(value) ? value : 'system';
    document.documentElement.dataset.theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    const select = document.getElementById('theme-choice');
    if (select) select.value = preference;
  }
  try { apply(localStorage.getItem(key)); } catch { apply('system'); }
  system.addEventListener('change', () => apply(preference));
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(event.newValue); });
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('theme-choice');
    select.value = preference;
    select.addEventListener('change', () => {
      apply(select.value);
      try { localStorage.setItem(key, preference); } catch {}
    });
  });
})();
