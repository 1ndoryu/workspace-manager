/* Enganche de enlaces externos (se inyecta en el HTML; ver `abrir.rs`).
 * [por que] El webview no tiene barras: `window.open` y `target="_blank"`
 * abririan una ventana de WebView2 vacia. Aqui se manda la URL al proceso Rust,
 * que la abre en el navegador del sistema. Solo http/https; lo interno no se
 * toca y el front no cambia ni una linea. */
(() => {
  const externa = (u) => /^https?:\/\//i.test(u);
  const abrir = (u) => {
    if (!externa(u)) return false;
    fetch('/__abrir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: u }),
      keepalive: true,
    }).catch(() => {});
    return true;
  };
  /* Fase de captura: nadie puede cancelar el enlace antes de llegar aqui. */
  const enlace = (ev) => {
    const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || a.target !== '_blank') return;
    if (abrir(a.href)) ev.preventDefault();
  };
  document.addEventListener('click', enlace, true);
  document.addEventListener('auxclick', enlace, true);
  window.open = (url) => {
    abrir(String(url || ''));
    return null;
  };
})();
