/* Ejecución de las comprobaciones de salud (10AA-2 F8). `ejecutar` es pura; el caché
 * de 60 s y el single-flight viven aquí para que el tablero y la ruta no relancen la
 * lectura de disco y Git en cada petición.
 * [por que] `forzar` salta el caché pero no se une a un vuelo en curso: ya es fresco. */
import { dirConfigPrivada, RAIZ_AREA } from '../plataforma/rutas.js';
import { snapshotArea } from '../snapshot.js';
import { leerPlantilla } from '../guardian/configuracion/plantilla.js';
import { CLAVE_AREA, type Hallazgo, type Omitida, type ResultadoSalud } from '../../shared/salud/salud.js';
import { COMPROBACIONES_PROYECTO } from './comprobacionesProyecto.js';
import { COMPROBACIONES_AREA } from './comprobacionesArea.js';
import { leerPinArea, recogerArea, recogerProyectos } from './recoger.js';
import type { Comprobacion } from './tipos.js';
import { entornoReal } from './entorno.js';

/* Composición: el entorno real se resuelve una vez, aquí, y se pasa a quien lo necesita. */
const entorno = entornoReal();

export const TTL_SALUD_MS = 60_000;

export function ejecutar<D>(
  ambito: ResultadoSalud['ambito'],
  clave: string,
  comprobaciones: Comprobacion<D>[],
  datos: D,
  calculadoEn: string,
): ResultadoSalud {
  const hallazgos: Hallazgo[] = [];
  const ejecutadas: string[] = [];
  const omitidas: Omitida[] = [];
  for (const c of comprobaciones) {
    const motivo = c.omitirSi?.(datos) ?? null;
    if (motivo !== null) {
      omitidas.push({ id: c.id, motivo });
      continue;
    }
    ejecutadas.push(c.id);
    hallazgos.push(...c.evaluar(datos));
  }
  return { ambito, clave, hallazgos, ejecutadas, omitidas, calculadoEn };
}

const cache = new Map<string, { expira: number; valor: unknown }>();
const vuelos = new Map<string, Promise<unknown>>();

export function obtenerSalud<T>(clave: string, calcular: () => Promise<T>, forzar = false): Promise<T> {
  const vigente = cache.get(clave);
  if (!forzar && vigente && vigente.expira > Date.now()) return Promise.resolve(vigente.valor as T);
  const enCurso = vuelos.get(clave);
  if (enCurso) return enCurso as Promise<T>;
  const vuelo = calcular()
    .then((valor) => {
      cache.set(clave, { expira: Date.now() + TTL_SALUD_MS, valor });
      return valor;
    })
    .finally(() => vuelos.delete(clave));
  vuelos.set(clave, vuelo);
  return vuelo;
}

/* Solo para pruebas: deja el caché vacío entre casos. */
export function limpiarCacheSalud(): void {
  cache.clear();
  vuelos.clear();
}

/* Resultado por proyecto, con la misma lectura de snapshot que el resto del tablero. */
export function saludProyectos(forzar = false): Promise<Map<string, ResultadoSalud>> {
  return obtenerSalud(
    'proyectos',
    async () => {
      const ahora = Date.now();
      const { snapshot } = await snapshotArea(false);
      const datos = recogerProyectos(snapshot.proyectos, {
        ahora,
        pinArea: leerPinArea(entorno.raizRepo),
        plantilla: leerPlantilla(dirConfigPrivada()),
      });
      const calculadoEn = new Date(ahora).toISOString();
      return new Map(datos.map((d) => [d.clave, ejecutar('proyecto', d.clave, COMPROBACIONES_PROYECTO, d, calculadoEn)]));
    },
    forzar,
  );
}

export function saludArea(forzar = false): Promise<ResultadoSalud> {
  return obtenerSalud(
    'area',
    async () => {
      const ahora = Date.now();
      const { snapshot } = await snapshotArea(false);
      const datos = await recogerArea(snapshot.proyectos, RAIZ_AREA, leerPinArea(entorno.raizRepo), ahora, entorno);
      return ejecutar('area', CLAVE_AREA, COMPROBACIONES_AREA, datos, new Date(ahora).toISOString());
    },
    forzar,
  );
}
