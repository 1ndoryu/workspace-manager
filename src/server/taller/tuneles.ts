/* Supervisor de los túneles del portátil (19AA-15; protocolo de estado permanente, 2026-10-21).
 * [por que] El túnel SSH del portátil a la VPS 89 se muere solo (suspensión del portátil, cambio
 * de red) y nadie lo reabría: una app del portátil se quedaba en «no responde» hasta que alguien
 * tecleaba `Arranque up` a mano. Aquí se comprueba el puerto local de cada proyecto que la ficha
 * marca `permanente` y, si no escucha, se reabre por el mismo camino que `Arranque` (dev.mjs),
 * nunca por un ssh propio.
 * [por que] Se repara SOLO el tramo del portátil (`up --solo-tunel`): el proceso de la 89 ya lo
 * rearma su propio vigilante, y un `up` completo reconstruye el front (minutos) para algo que
 * cuesta segundos.
 * [por que] Solo se repara lo que la 89 tiene en marcha (su sesión tmux vive): un proyecto parado
 * a propósito no se resucita solo.
 * [por que] Con temporizador propio (`arrancarSupervisor`): antes dependía de que alguien mirase
 * el panel, y con el tablero cerrado el túnel se quedaba caído. */
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { sesionDev } from '../../shared/taller/sesiones.js';
import { esPermanente } from '../../../scripts/dev/doctor.mjs';
import { ejecutarAccionDev, type ResultadoAccionDev } from '../dev/acciones.js';
import { rutaConfigPrivada } from '../plataforma/rutas.js';

const RUTA_REGISTRO = rutaConfigPrivada('registro.json');
const TIMEOUT_SONDEO_MS = 1_500;
/* Reabrir un túnel son segundos; dos minutos dan margen a la red recién levantada. */
const ENFRIAMIENTO_MS = 2 * 60_000;

/* Cadencia del supervisor: un minuto, lo que tarda en notarse un corte de red sin girar en
 * caliente sobre un ssh que no levanta. */
export const INTERVALO_SUPERVISOR_MS = 60_000;

export interface EntradaTunel {
  id: string;
  /* Sesiones tmux que la 89 debe tener vivas para que el túnel tenga sentido. */
  sesiones: string[];
  /* Puertos locales que el portátil necesita: los del túnel del proyecto. */
  puertosLocales: number[];
}

/* Forma mínima de la ficha que el supervisor necesita. `permanente` y `supervisar` vienen las
 * dos porque el alias deprecado sigue valiendo hasta que todas las fichas migren: quien decide
 * es `esPermanente`, la misma función que el `up` remoto (una sola verdad). */
interface ProyectoRegistro {
  id?: unknown;
  host?: unknown;
  permanente?: unknown;
  supervisar?: unknown;
  tunelSsh?: unknown;
  modo?: unknown;
  puertos?: unknown;
  puertosRemotos?: unknown;
  puertosLocales?: unknown;
  tunelPortatil?: unknown;
  build?: { puertos?: unknown; puertosLocales?: unknown };
}

const numeros = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];

const pares = (v: unknown): [number, number][] =>
  Array.isArray(v)
    ? v.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))
    : [];

/* Reenvíos que el portátil debe tener abiertos para esta entrada. Gemelo exacto de
 * `paresTunelPortatil` (scripts/dev/doctor/sistema/puertos/modo.mjs), que es la fuente: el
 * supervisor no puede importar el `.mjs` (corre con el módulo cargado por el servidor, sin
 * allowJs), así que repite las tres reglas —modo efectivo, `tunelSsh` y `tunelPortatil`— y la
 * prueba las compara contra el original.
 * [por que] NO incluye `tunelesExtra`: esos reenvíos son de otro dueño (un gateway del propio
 * proyecto); abrirlos aquí haría que dos ssh se pisaran el mismo puerto local. */
export function reenviosPortatil(p: ProyectoRegistro): [number, number][] {
  const enBuild = p.modo === 'build' || (p.modo === undefined && p.build !== undefined);
  const remotos = enBuild ? numeros(p.build?.puertos) : numeros(p.puertosRemotos ?? p.puertos);
  const locales = enBuild ? numeros(p.build?.puertosLocales) : numeros(p.puertosLocales);
  const delProyecto: [number, number][] =
    p.tunelSsh === false ? [] : remotos.map((r, i) => [locales[i] ?? r, r] as [number, number]);
  const vistos = new Set<string>();
  return [...delProyecto, ...pares(p.tunelPortatil)].filter(([l, r]) => {
    const clave = `${l}:${r}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/* Proyectos del registro que el portátil debe alcanzar: con host (`permanente` es el protocolo
 * de lo remoto; en un proyecto del portátil no hay tramo que rearmar) y con algún reenvío
 * declarado. Pura: el registro llega por parámetro. */
export function tunelesDelRegistro(crudo: unknown): EntradaTunel[] {
  const proyectos = (crudo as { proyectos?: ProyectoRegistro[] } | null)?.proyectos ?? [];
  const salida: EntradaTunel[] = [];
  for (const p of proyectos) {
    const id = typeof p.id === 'string' ? p.id : '';
    if (id === '' || typeof p.host !== 'string' || p.host === '') continue;
    if (!esPermanente(p as { permanente?: boolean; supervisar?: boolean })) continue;
    const reenvios = reenviosPortatil(p);
    if (reenvios.length === 0) continue;
    const enBuild = p.modo === 'build' || (p.modo === undefined && p.build !== undefined);
    const remotos = enBuild ? numeros(p.build?.puertos) : numeros(p.puertosRemotos ?? p.puertos);
    salida.push({
      id,
      sesiones: remotos.map((puerto) => sesionDev(id, puerto)),
      puertosLocales: reenvios.map(([local]) => local),
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
/* Último rearme con éxito, para que el panel pueda decir «rearmado a las HH:MM». */
const ultimoRearme = new Map<string, string>();

export function rearmesRecientes(): Record<string, string> {
  return Object.fromEntries(ultimoRearme);
}

/* [por que] Un supervisor que falla en silencio deja la app caída y sin pista. El fallo va a
 * stderr del servidor, que es donde queda un rastro que sobrevive a la pestaña cerrada. */
function avisarFallo(id: string, motivo: string): void {
  process.stderr.write(`[tuneles] no se pudo reabrir el tunel de "${id}": ${motivo}\n`);
}

/* Revisa los túneles y repara los que hagan falta. Devuelve los ids reparados en
 * esta pasada; la reparación sigue en segundo plano (abrir un ssh tarda segundos
 * y quien llama puede ser una ruta HTTP).
 * [por que] Basta con que UN puerto local del proyecto no escuche para reparar: el túnel es un
 * solo ssh y sus reenvíos caen juntos, así que sondear el primero y rendirse dejaría sin ver un
 * 33110 muerto con el 3110 vivo. */
export async function revisarTuneles(
  tmuxVivos: readonly string[],
  deps: DepsTuneles = {},
): Promise<string[]> {
  const entradas = deps.entradas ?? entradasConTunel();
  const probar = deps.probar ?? puertoEscucha;
  const reparar = deps.reparar ?? ((id: string) => ejecutarAccionDev('up', id, { soloTunel: true }));
  const ahora = deps.ahora ?? Date.now;
  const reparados: string[] = [];
  for (const e of entradas) {
    if (!e.sesiones.some((s) => tmuxVivos.includes(s))) continue;
    const vivos = await Promise.all(e.puertosLocales.map((p) => probar(p)));
    if (vivos.every(Boolean)) continue;
    if (enVuelo.has(e.id)) continue;
    const ultimo = ultimoIntento.get(e.id);
    if (ultimo !== undefined && ahora() - ultimo < ENFRIAMIENTO_MS) continue;
    ultimoIntento.set(e.id, ahora());
    reparados.push(e.id);
    const vuelo = reparar(e.id)
      .then((r) => {
        if (r.codigo !== 0) avisarFallo(e.id, `el up salio con codigo ${r.codigo}: ${r.salida.trim().slice(-400)}`);
        else ultimoRearme.set(e.id, new Date(ahora()).toISOString());
      })
      .catch((err: unknown) => avisarFallo(e.id, err instanceof Error ? err.message : String(err)))
      .finally(() => {
        enVuelo.delete(e.id);
      });
    enVuelo.set(e.id, vuelo);
  }
  return reparados;
}

/* Supervisor en segundo plano: una pasada por minuto sobre las sesiones que la 89 tiene vivas.
 * [por que aquí y no dentro de crearServidor] Las pruebas montan el servidor con crearServidor:
 * un temporizador ahí dentro lanzaría `up` reales sobre el taller. */
export function arrancarSupervisor(opciones: {
  tmuxVivos: () => Promise<readonly string[]>;
  intervaloMs?: number;
}): () => void {
  const intervalo = opciones.intervaloMs ?? INTERVALO_SUPERVISOR_MS;
  const pasada = (): void => {
    void opciones
      .tmuxVivos()
      .then((vivos) => revisarTuneles(vivos))
      .catch(() => undefined);
  };
  /* Primera pasada al arrancar: el servidor puede llevar horas apagado y la red haberse cortado
   * durante ese rato. Luego, cada minuto. */
  pasada();
  const t = setInterval(pasada, intervalo);
  t.unref();
  return () => clearInterval(t);
}
