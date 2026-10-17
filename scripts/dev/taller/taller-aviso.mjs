/* Aviso de conformidad del taller (14AA-5) para la CLI del mando dev. Vive en su propio
 * módulo para que doctor, cierre y acciones lo compartan sin importarse entre sí.
 * [por que 14AA-5] Lo evalúa el manager (local, 8787), que es quien ve la 89 y el HTTP
 * público. Es solo aviso: no cambia el exit del comando que lo imprime. Si el manager no
 * responde, se dice en una línea en vez de fallar en silencio. */
import { cabeceraAutorizacion } from '../token.mjs';

export const URL_ESTADO_TALLER = 'http://127.0.0.1:8787/api/taller/estado';

export function resumenTaller(hallazgos) {
  const errores = hallazgos.filter((h) => h.severidad === 'error').length;
  const avisos = hallazgos.length - errores;
  const veredicto = errores ? 'con errores' : avisos ? 'con avisos' : 'conforme';
  return `taller: ${veredicto} (${errores} error(es), ${avisos} aviso(s)); detalle en el panel taller`;
}

/* Las dependencias van por parámetro para probarlo sin red ni manager. */
export async function avisoTaller({ fetchFn = fetch, log = console.log, url = URL_ESTADO_TALLER } = {}) {
  try {
    // [por que 14AA-5] connection: close. Con keep-alive el socket queda abierto al salir
    // por process.exit (dev.mjs) junto al del gate, y Node en Windows aborta con el assert
    // de libuv (exit 127) aunque el cierre sea correcto.
    const r = await fetchFn(url, {
      headers: { ...cabeceraAutorizacion(), connection: 'close' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    log(resumenTaller(d.hallazgos));
  } catch (e) {
    log(`taller: no consultado (${e.message}); arranca el manager: Arranque up "<id del manager>"`);
  }
}
