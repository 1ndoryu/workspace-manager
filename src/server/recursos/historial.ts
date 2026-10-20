/* Anillo persistente de recursos del tablero (20AA-17).
 * [por que] Las muestras vivían solo en el localStorage del navegador y solo
 * mientras el panel estaba a la vista: al cerrar la pestaña —o al reiniciar el
 * tablero— la gráfica empezaba de cero. El servidor, que sí está siempre en
 * marcha, anota su propia muestra cada minuto (muestreador.ts) y el panel la lee
 * y la mezcla con su cola viva. Best-effort total: un fallo de disco jamás rompe
 * la ruta (lo vivo manda). `data/*` está gitignored: esto es dato runtime. */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MAX_MUESTRAS_RECURSOS,
  RETENCION_RECURSOS_MS,
  esMuestraRecursos,
  esTabRecursos,
  normalizarMuestraRecursos,
  type MuestraRecursos,
  type TabRecursos,
} from '../../shared/recursosHistorial.js';
import { RAIZ_REPO } from '../plataforma/rutas.js';
import { escribirAtomico } from '../guardian/escritura.js';

/* El anillo solo cambia una vez por minuto, pero volcarlo entero cada vez sería
 * escribir cientos de KB por nada: se guarda como mucho cada 5 minutos (y en el
 * peor caso se pierden esos minutos, que la cola del navegador tapa). */
const GUARDADO_MS = 5 * 60 * 1000;

export interface OpcionesHistorialRecursos {
  ruta?: string;
  ahora?: () => number;
}

/* Ruta derivada de la raíz del repo (no del cwd): el backend puede arrancar en otra
 * carpeta y la ruta relativa fallaría en silencio. */
const RUTA_DEFECTO = join(RAIZ_REPO, 'data', 'recursos-historial.json');

export function crearHistorialRecursos(op: OpcionesHistorialRecursos = {}) {
  const ruta = op.ruta ?? RUTA_DEFECTO;
  const ahora = op.ahora ?? Date.now;
  let cache: Record<string, MuestraRecursos[]> | null = null;
  let ultimoGuardado = 0;

  function cargar(): Record<string, MuestraRecursos[]> {
    if (cache) return cache;
    const corte = ahora() - RETENCION_RECURSOS_MS;
    const limpio: Record<string, MuestraRecursos[]> = {};
    try {
      const crudo: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
      if (crudo && typeof crudo === 'object' && !Array.isArray(crudo)) {
        for (const [tab, serie] of Object.entries(crudo as Record<string, unknown>)) {
          if (!esTabRecursos(tab) || !Array.isArray(serie)) continue;
          const ms: MuestraRecursos[] = [];
          for (const v of serie) {
            const m = normalizarMuestraRecursos(v, corte);
            if (m) ms.push(m);
          }
          if (ms.length > 0) limpio[tab] = ms.slice(-MAX_MUESTRAS_RECURSOS);
        }
      }
    } catch {
      /* Sin fichero o corrupto: anillo vacío (el próximo anotar lo repara). */
    }
    cache = limpio;
    return limpio;
  }

  function guardar(): void {
    if (!cache) return;
    try {
      mkdirSync(dirname(ruta), { recursive: true });
      escribirAtomico(ruta, JSON.stringify(cache));
    } catch {
      /* El historial nunca rompe al llamante. */
    }
  }

  /* Añade una muestra al anillo de su tab. Se salta lo que no avance en el tiempo
   * (mismo t o hacia atrás): el muestreo de fondo y el navegador pueden coincidir. */
  function anotar(tab: TabRecursos, m: MuestraRecursos): void {
    if (!esTabRecursos(tab) || !esMuestraRecursos(m)) return;
    try {
      const datos = cargar();
      const serie = datos[tab] ?? [];
      const ultima = serie.length > 0 ? serie[serie.length - 1][0] : 0;
      if (m[0] <= ultima) return;
      const corte = m[0] - RETENCION_RECURSOS_MS;
      datos[tab] = [...serie.filter((x) => x[0] >= corte), m].slice(-MAX_MUESTRAS_RECURSOS);
      const t = ahora();
      if (t - ultimoGuardado >= GUARDADO_MS) {
        ultimoGuardado = t;
        guardar();
      }
    } catch {
      /* Best-effort: lo vivo ya se sirvió. */
    }
  }

  function leer(tab: TabRecursos): MuestraRecursos[] {
    if (!esTabRecursos(tab)) return [];
    return cargar()[tab] ?? [];
  }

  /* Volcado inmediato (pruebas y cierre ordenado): no espera al throttle. */
  function volcar(): void {
    ultimoGuardado = ahora();
    guardar();
  }

  return { anotar, leer, volcar };
}

/* Singleton de producción (siempre hay ruta por defecto). */
let prod: ReturnType<typeof crearHistorialRecursos> | null = null;

export function historialRecursosProd(): ReturnType<typeof crearHistorialRecursos> {
  if (!prod) prod = crearHistorialRecursos();
  return prod;
}

