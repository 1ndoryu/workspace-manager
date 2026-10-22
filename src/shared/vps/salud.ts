/* Lectura única del estado de un servicio a partir de la cadena que manda el agente
 * (`running:healthy`, `degraded:unhealthy`, `exited`, `apagado`, `desconocido`...).
 * [por que] El criterio estaba repetido en el panel de VPS, el del taller y los hooks, y cada uno
 * lo escribía a su manera. Con la campana de avisos había tres sitios más a punto de divergir: un
 * aviso que dice «caído» mientras el panel dice «degraded» es peor que no avisar. Todo lo que
 * pregunte «¿esto está vivo?» pregunta aquí.
 * Sin estado y sin red: solo cadenas, así se prueba sin montar nada. */

/* Cuatro grados, y no más: es lo que distingue de verdad una fila del tablero. */
export type SaludServicio = 'vivo' | 'degradado' | 'caido' | 'desconocido';

/* Estado de un servicio del que no sabemos nada: ni contenedores ni fase. [por que aquí] Es una
 * palabra del vocabulario de la salud y se leía como caído; escrita a mano en el panel del taller,
 * un cambio de criterio aquí la dejaba mintiendo (20AA-30 N4-4). */
export const ESTADO_CAIDO = 'apagado';

/* `running` y `restarting` cuentan como vivos (un reinicio está corriendo, no muerto);
 * `degraded` está vivo con un chequeo de salud fallando; lo que no se puede leer es desconocido,
 * que nunca se anuncia como caída. */
export function saludDeEstado(estado: string | null | undefined): SaludServicio {
  const e = (estado ?? '').trim().toLowerCase();
  if (e === '' || e === 'desconocido' || e === 'sin-asignar' || e === 'sin-estado-real') return 'desconocido';
  if (e.startsWith('running') || e.startsWith('restarting')) return 'vivo';
  if (e.startsWith('degraded')) return 'degradado';
  if (e.startsWith(ESTADO_CAIDO) || e === 'detenido' || e.startsWith('exited') || e.startsWith('stopped')) return 'caido';
  /* Cualquier otro estado concreto (`created`, `paused`...) se lee como no vivo: la duda se
   * resuelve hacia fuera, no hacia dentro. */
  return 'caido';
}

/* ¿Está sirviendo? Un degradado sirve, así que cuenta como vivo para pintar y para el mapa del
 * taller. Es lo que usaba `useProduccionViva` con su regex. */
export function estaVivo(estado: string | null | undefined): boolean {
  const s = saludDeEstado(estado);
  return s === 'vivo' || s === 'degradado';
}

/* La salud de un despliegue a partir de la de sus contenedores: manda el peor. [por que] Un sitio
 * con la app viva y la base caída no sirve, aunque haya un `running` en la lista. Vacío =
 * desconocido: no haber visto nada no es estar caído. */
export function peorSalud(estados: (string | null | undefined)[]): SaludServicio {
  if (estados.length === 0) return 'desconocido';
  const salud = estados.map(saludDeEstado);
  if (salud.includes('caido')) return 'caido';
  if (salud.includes('degradado')) return 'degradado';
  if (salud.includes('vivo')) return 'vivo';
  return 'desconocido';
}
