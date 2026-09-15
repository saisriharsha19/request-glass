(() => {
  const key = 'tuckday:theme:v1';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  try { preference = valid(localStorage.getItem(key)); } catch {}
  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#30382e' : '#e4e8d8');
    document.querySelectorAll('[data-theme-picker]').forEach(select => { select.value = preference; });
  }
  apply();
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); } });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-theme-picker]').forEach(select => select.addEventListener('change', () => {
      preference = valid(select.value);
      try { localStorage.setItem(key, preference); } catch {}
      apply();
    }));
  });
})();
