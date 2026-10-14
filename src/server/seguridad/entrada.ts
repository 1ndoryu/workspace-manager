/* Guardia global de entrada del manager (F9.1). Se aplica a toda petición antes del
 * enrutado: Host, Origin y, en la API, token de portador. [por que] Las guardas del
 * Guardián solo cubrían sus escrituras; el resto (p. ej. /api/dev/up o el doctor) lanza
 * procesos y quedaba abierto a cualquier POST local. Sin CORS: el navegador ajeno no
 * puede leer respuestas. */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { HOST_LOCAL, ORIGIN_LOCAL } from '../guardian/operacion/seguridad.js';

/* Única ruta de la API sin token: la sonda de vida de los scripts y del arranque. */
const RUTAS_PUBLICAS = new Set(['/api/ping']);
const PREFIJO_BEARER = 'Bearer ';

export type VeredictoEntrada = { ok: true } | { ok: false; status: 401 | 403; motivo: string };
const PERMITIDO: VeredictoEntrada = { ok: true };

function cabecera(valor: string | string[] | undefined): string | null {
  return typeof valor === 'string' ? valor : null;
}

/* Compara en tiempo constante; un token de otra longitud se rechaza sin comparar. */
function tokenCoincide(cabeceraAuth: string | null, esperado: string): boolean {
  if (cabeceraAuth === null || !cabeceraAuth.startsWith(PREFIJO_BEARER)) return false;
  const recibido = Buffer.from(cabeceraAuth.slice(PREFIJO_BEARER.length));
  const referencia = Buffer.from(esperado);
  return recibido.length === referencia.length && timingSafeEqual(recibido, referencia);
}

export function verificarEntrada(
  ruta: string,
  headers: IncomingHttpHeaders,
  tokenEsperado: string,
): VeredictoEntrada {
  const host = cabecera(headers.host);
  if (host === null || !HOST_LOCAL.test(host.toLowerCase())) {
    return { ok: false, status: 403, motivo: 'Host no permitido' };
  }

  /* Sin Origin (curl, scripts) se admite: la exigencia es el token. Con Origin, debe ser
   * una pestaña del tablero. */
  const origin = cabecera(headers.origin);
  if (origin !== null && !ORIGIN_LOCAL.test(origin.toLowerCase())) {
    return { ok: false, status: 403, motivo: 'Origin no permitido' };
  }

  /* El estático del cliente (no es /api/) va sin token: no tiene secretos. */
  if (!ruta.startsWith('/api/') || RUTAS_PUBLICAS.has(ruta)) return PERMITIDO;

  if (!tokenCoincide(cabecera(headers.authorization), tokenEsperado)) {
    return { ok: false, status: 401, motivo: 'Falta el token de portador o no es válido' };
  }
  return PERMITIDO;
}
