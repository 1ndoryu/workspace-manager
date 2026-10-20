/* Supervisor de los túneles del taller (19AA-15).
 * [por que] El túnel SSH del portátil a la VPS 89 se muere solo (suspensión del
 * portátil, cambio de red) y nadie lo reabría: la tab tareas se quedaba en
 * «TASKS no responde» hasta que alguien tecleaba `Arranque up` a mano, y
 * `Arranque status` solo lo reportaba como `deriva`. Aquí se comprueba el puerto
 * local de cada proyecto bajo mando y, si no escucha, se reabre por el mismo
 * camino que `Arranque` (dev.mjs), nunca por un ssh propio.
 * [por que] Solo se repara lo que la 89 tiene en marcha (su sesión tmux vive): un
 * proyecto parado a propósito no se resucita solo.
 * [por que] Sin temporizador propio: se llama al leer el estado del taller (el
 * panel lo pide cada 60 s) y al fallar una llamada de la tab. Si nadie mira, no
 * hay trabajo que hacer. */
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { sesionDev } from '../../shared/taller/sesiones.js';
import { ejecutarAccionDev, type ResultadoAccionDev } from '../dev/acciones.js';
import { rutaConfigPrivada } from '../plataforma/rutas.js';

const RUTA_REGISTRO = rutaConfigPrivada('registro.json');
const TIMEOUT_SONDEO_MS = 1_500;
/* Un `up` puede tardar minutos (arranqueMs de la ficha), así que el enfriamiento
 * es más largo que el vuelo: si el arranque falla, no se encadena otro intento. */
const ENFRIAMIENTO_MS = 5 * 60_000;

export interface EntradaTunel {
  id: string;
  /* Sesiones tmux que la 89 debe tener vivas para que el túnel tenga sentido. */
  sesiones: string[];
  puertoLocal: number;
}

interface ProyectoRegistro {
  id?: unknown;
  host?: unknown;
  tunelSsh?: unknown;
  puertos?: unknown;
  puertosRemotos?: unknown;
  puertosLocales?: unknown;
}

const numeros = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];

/* Proyectos del registro que abren túnel: con host y sin `tunelSsh: false` (los
 * que exponen sus puertos solos, como MN por Cloudflare, no lo abren). El puerto
 * local es la misma regla que `puertosLocalesDe` en scripts/dev/remoto/tunel.mjs:
 * `puertosLocales` o, si falta, el remoto. Pura: el registro llega por parámetro. */
export function tunelesDelRegistro(crudo: unknown): EntradaTunel[] {
  const proyectos = (crudo as { proyectos?: ProyectoRegistro[] } | null)?.proyectos ?? [];
  const salida: EntradaTunel[] = [];
  for (const p of proyectos) {
    const id = typeof p.id === 'string' ? p.id : '';
    if (id === '' || typeof p.host !== 'string' || p.host === '') continue;
    if (p.tunelSsh === false) continue;
    const remotos = numeros(p.puertosRemotos ?? p.puertos);
    if (remotos.length === 0) continue;
    const locales = numeros(p.puertosLocales);
    salida.push({
      id,
      sesiones: remotos.map((puerto) => sesionDev(id, puerto)),
      puertoLocal: locales[0] ?? remotos[0],
    });
  }
  return salida;
}

export function entradasConTunel(): EntradaTunel[] {
  return tunelesDelRegistro(JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')));
}

/* ¿Escucha algo en ese puerto local? Basta un TCP: si el ssh vive, el reenvío
 * está atado; si murió, el puerto queda libre y la conexión se rechaza al
 * instante. El timeout cubre el caso de un puerto en negro (sin RST). */
export function puertoEscucha(puerto: number, timeoutMs = TIMEOUT_SONDEO_MS): Promise<boolean> {
  return new Promise((resolver) => {
    const s = connect({ host: '127.0.0.1', port: puerto });
    const cerrar = (vivo: boolean): void => {
      s.destroy();
      resolver(vivo);
    };
    s.setTimeout(timeoutMs, () => cerrar(false));
    s.once('connect', () => cerrar(true));
    s.once('error', () => cerrar(false));
  });
}

export interface DepsTuneles {
  entradas?: EntradaTunel[];
  probar?: (puerto: number) => Promise<boolean>;
  reparar?: (id: string) => Promise<ResultadoAccionDev>;
  ahora?: () => number;
}

/* Un vuelo por proyecto: dos revisiones simultáneas no abren dos `up` del mismo
 * id (el CLI revalidaría PID, pero es trabajo y ruido de más). */
const enVuelo = new Map<string, Promise<unknown>>();
const ultimoIntento = new Map<string, number>();

/* [por que] Quien llama a `revisarTuneles` es una ruta HTTP y no puede esperar
 * minutos: el fallo de la reparación se quedaría sin testigo. Un supervisor que
 * falla en silencio deja la tab caída y sin pista (pasó: `ID_OK` rechazaba
 * «PROYECTO TASKS» y nadie se enteró). */
function avisarFallo(id: string, motivo: string): void {
  process.stderr.write(`[tuneles] no se pudo reabrir el tunel de "${id}": ${motivo}\n`);
}

/* Revisa los túneles y repara los que hagan falta. Devuelve los ids reparados en
 * esta pasada; la reparación sigue en segundo plano (un `up` puede tardar
 * minutos y quien llama es una ruta HTTP). */
export async function revisarTuneles(
  tmuxVivos: readonly string[],
  deps: DepsTuneles = {},
): Promise<string[]> {
  const entradas = deps.entradas ?? entradasConTunel();
  const probar = deps.probar ?? puertoEscucha;
  const reparar = deps.reparar ?? ((id: string) => ejecutarAccionDev('up', id, { sinBd: true }));
  const ahora = deps.ahora ?? Date.now;
  const reparados: string[] = [];
  for (const e of entradas) {
    if (!e.sesiones.some((s) => tmuxVivos.includes(s))) continue;
    if (await probar(e.puertoLocal)) continue;
    if (enVuelo.has(e.id)) continue;
    const ultimo = ultimoIntento.get(e.id);
    if (ultimo !== undefined && ahora() - ultimo < ENFRIAMIENTO_MS) continue;
    ultimoIntento.set(e.id, ahora());
    reparados.push(e.id);
    const vuelo = reparar(e.id)
      .then((r) => {
        if (r.codigo !== 0) avisarFallo(e.id, `el up salio con codigo ${r.codigo}: ${r.salida.trim().slice(-400)}`);
      })
      .catch((err: unknown) => avisarFallo(e.id, err instanceof Error ? err.message : String(err)))
      .finally(() => {
        enVuelo.delete(e.id);
      });
    enVuelo.set(e.id, vuelo);
  }
  return reparados;
}
