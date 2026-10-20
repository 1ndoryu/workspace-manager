/* Sesión admin del puente TASKS: cookies `session_id` y `csrf_token` y el login que las obtiene.
 * [por que] Solo el login toca red, y recibe el transporte por parámetro: el resto es puro. */
import type {ConfigPuente} from '../entorno/config-puente.js';
import type {ErrorKanban} from '../nucleo/tipos.js';
import type {FetchPuente, RespuestaPuente} from '../transporte/transporte-tipos.js';

export const RUTA_LOGIN = '/api/auth/login';
export const COOKIE_SESION = 'session_id';
export const COOKIE_CSRF = 'csrf_token';
const VALOR_COOKIE_OK = /^[A-Za-z0-9._-]{1,256}$/;

export interface Sesion {
  sessionId: string;
  csrf: string;
}

/* Valor de una cookie por nombre. [por que] Solo se acepta un valor con forma de token:
 * una cabecera set-cookie malformada no puede colarse en la del siguiente pedido. */
export function extraerCookie(cookies: string[], nombre: string): string | null {
  for (const c of cookies) {
    const par = (c.split(';', 1)[0] ?? '').trim();
    const eq = par.indexOf('=');
    if (eq > 0 && par.slice(0, eq).trim() === nombre) {
      const valor = par.slice(eq + 1).trim();
      if (VALOR_COOKIE_OK.test(valor)) return valor;
    }
  }
  return null;
}

export function cabeceraCookies(sesion: Sesion): string {
  return `${COOKIE_SESION}=${sesion.sessionId}; ${COOKIE_CSRF}=${sesion.csrf}`;
}

/* Login admin. Un fallo abre el breaker (`abrir`) y lanza el error de Kanban que lo describe.
 * [por que] Sin las dos cookies no hay sesión válida: es un contrato roto de TASKS, no un 401. */
export async function loginTasks(
  transporte: FetchPuente,
  cfg: Pick<ConfigPuente, 'base' | 'email' | 'password'>,
  abrir: (motivo: string) => void,
): Promise<Sesion> {
  let respuesta: RespuestaPuente;
  try {
    respuesta = await transporte(`${cfg.base}${RUTA_LOGIN}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: cfg.email, password: cfg.password}),
    });
  } catch {
    abrir('red-tasks: TASKS no responde al login');
    throw {codigo: 'red', mensaje: 'TASKS no responde'} satisfies ErrorKanban;
  }
  if (!respuesta.ok) {
    abrir(respuesta.estado === 401 ? 'credenciales-rechazadas por TASKS' : `login-tasks-${respuesta.estado}`);
    throw {codigo: 'no-autenticado', mensaje: 'Login TASKS rechazado', estadoHttp: respuesta.estado} satisfies ErrorKanban;
  }
  const sessionId = extraerCookie(respuesta.cookies, COOKIE_SESION);
  const csrf = extraerCookie(respuesta.cookies, COOKIE_CSRF);
  if (sessionId === null || csrf === null) {
    abrir('login-tasks-sin-cookies (contrato roto)');
    throw {codigo: 'servidor', mensaje: 'Login TASKS sin cookies de sesión'} satisfies ErrorKanban;
  }
  return {sessionId, csrf};
}
