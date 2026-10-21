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

  /* ---------------------------------------------------------------------------------------------
   * Toast del sistema (20AA-27). Se abre el MISMO canal que la campana y cada sobre va al proceso
   * Rust, que decide si sale fuera (nivel alto, ventana detras, tipo no callado, cupo) y lo pinta.
   * [por que aqui y no en el front] El front no sabe si corre dentro de la app o en el navegador:
   * en el navegador estas rutas no existen y no pasa nada. Y asi el bundle del tablero no gana ni
   * una linea de codigo de escritorio.
   * [por que un EventSource mas y no un sondeo] Una sola conexion abierta que manda lo que llega;
   * el motor no cambia y este enganche no consulta nada por su cuenta.
   * ------------------------------------------------------------------------------------------- */
  const alFrente = () => document.hasFocus() && document.visibilityState === 'visible';

  /* Un sobre al proceso Rust. Sin token: el servidor local ya lo pone al proxyar. */
  const avisar = (datos, atrasados) =>
    fetch('/__aviso', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ datos, al_frente: alFrente(), atrasados }),
      keepalive: true,
    }).catch(() => {});

  /* Lo que el cupo retuvo se cuenta al volver: un solo toast con cuantos hubo, no uno por aviso. */
  const recuperar = () =>
    fetch('/__pendiente')
      .then((r) => (r.ok ? r.json() : []))
      .then((lista) => {
        if (Array.isArray(lista) && lista.length) {
          avisar(JSON.stringify({ tipo: 'aviso', aviso: lista[0] }), lista.length - 1);
        }
      })
      .catch(() => {});

  let canal = null;
  let fallos = 0;
  const conectar = () => {
    canal = new EventSource('/api/notificaciones/eventos?sin-historia=1');
    canal.onopen = () => {
      fallos = 0;
    };
    /* `sinc` dice en que id va el servidor: asi al reconectar no se repite lo de ayer. */
    canal.onmessage = (ev) => {
      if (ev.data && ev.data.includes('"sinc"')) avisar(ev.data, 0);
    };
    canal.addEventListener('aviso', (ev) => avisar(ev.data, 0));
    /* `EventSource` reintenta solo y conserva `Last-Event-ID`, que es justo lo que hace falta
     * cuando el backend se reinicia. Pero sin backend reintentaria cada 3 s para siempre: tras
     * cinco fallos seguidos se calla hasta que la ventana vuelva al frente. */
    canal.onerror = () => {
      if (++fallos < 5) return;
      canal.close();
      canal = null;
    };
  };
  conectar();

  const despertar = () => {
    if (canal === null) conectar();
    if (document.visibilityState === 'visible') recuperar();
  };
  window.addEventListener('focus', despertar);
  document.addEventListener('visibilitychange', despertar);
})();
