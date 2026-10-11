/* Guardas de las peticiones de escritura del Guardián (10AA-2 F11.4): solo las
 * acepta el propio tablero. [por que] Una web ajena puede disparar un POST desde
 * el navegador (CSRF) y un nombre DNS puede apuntar a 127.0.0.1 (DNS rebinding);
 * ambos casos se rechazan comprobando Origin y Host, y el Content-Type evita
 * que un formulario simple (text/plain) llegue al escritor. Sin Origin (p. ej.
 * curl) también se rechaza: la pestaña siempre lo envía. */
import type { IncomingHttpHeaders } from 'node:http';

/* Front de Vite (5175), backend (8787) y preview (4173). Puertos explícitos: el
 * puerto 5174 es de opencode-propio y nunca figura aquí. */
export const PUERTOS_TABLERO: readonly number[] = [5175, 8787, 4173];

const HOSTS_LOCALES = '(localhost|127\\.0\\.0\\.1|\\[::1\\])';
const PUERTOS = PUERTOS_TABLERO.join('|');
const ORIGIN_LOCAL = new RegExp(`^http://${HOSTS_LOCALES}:(${PUERTOS})$`, 'u');
const HOST_LOCAL = new RegExp(`^${HOSTS_LOCALES}:(${PUERTOS})$`, 'u');

export type VeredictoPeticion = { ok: true } | { ok: false; status: 403 | 415; motivo: string };

const PERMITIDO: VeredictoPeticion = { ok: true };

function cabecera(valor: string | string[] | undefined): string | null {
  /* Una cabecera repetida (array) no es una petición del navegador: se rechaza. */
  return typeof valor === 'string' ? valor.toLowerCase() : null;
}

/* Verifica Origin, Host y Content-Type de una escritura. El orden fija el motivo
 * que se devuelve: primero quién llama (403), luego el formato (415). */
export function verificarPeticionEscritura(headers: IncomingHttpHeaders): VeredictoPeticion {
  const origin = cabecera(headers.origin);
  if (origin === null) return { ok: false, status: 403, motivo: 'Falta la cabecera Origin' };
  if (!ORIGIN_LOCAL.test(origin)) return { ok: false, status: 403, motivo: 'Origin no permitido' };

  const host = cabecera(headers.host);
  if (host === null || !HOST_LOCAL.test(host)) return { ok: false, status: 403, motivo: 'Host no permitido' };

  const tipo = typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
  /* Se ignoran parámetros (`; charset=utf-8`) y mayúsculas, como en el resto del tablero. */
  const base = tipo.split(';')[0].trim().toLowerCase();
  if (base !== 'application/json') return { ok: false, status: 415, motivo: 'Content-Type debe ser application/json' };

  return PERMITIDO;
}
