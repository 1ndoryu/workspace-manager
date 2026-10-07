/* Historial persistente por despliegue (07AA-4 F1).
 * [por que] Las muestras del frente viven en el localStorage del navegador y
 * solo existen mientras la tab está abierta: al recargar o cambiar de origen
 * los gráficos "empiezan de cero". Este módulo anota en un fichero acotado
 * las sumas por sitio de cada snapshot que el backend YA sirve (el hook vive
 * en la rama /api/vps/agente de rutasVps.ts): cero consultas extra al VPS y
 * cero fondo —solo perdura lo que hoy ya se pide. Best-effort total: un fallo
 * de disco jamás rompe la ruta (el historial es decorativo, el vivo manda). */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HIST_INTERVALO_MS,
  HIST_MAX_MUESTRAS,
  HIST_RETENCION_MS,
  claveSitio,
  esMuestra,
  normalizarTs,
  type MuestraHistorial,
} from '../../shared/historialVps.js';
import { NOMBRE_OK } from './puente.js';

export interface FilaHistorial {
  sitio: string | null;
  cpuPct: number;
  memMiB: number;
}

export interface OpcionesHistorial {
  ruta?: string;
  ahora?: () => number;
}

/* Misma raíz que agente.ts (leerTokenLocal): el backend puede arrancar en
 * otra carpeta y la ruta relativa fallaría en silencio. `data/*` está
 * gitignored: el historial es dato runtime, nunca se commitea. */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUTA_DEFECTO = join(RAIZ, 'data', 'vps-historial.json');

function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* Clave fail-closed: `infra` o `sitio:<nombre>` con el charset canónico de
 * sitios (NOMBRE_OK, dueño puente.ts). Lo demás se rechaza, nunca se crea. */
export function claveValida(clave: string): boolean {
  if (clave === 'infra') return true;
  if (!clave.startsWith('sitio:')) return false;
  return NOMBRE_OK.test(clave.slice('sitio:'.length));
}

export function crearHistorial(op: OpcionesHistorial = {}): {
  anotar: (filas: FilaHistorial[], tsSnapshot: unknown) => void;
  leer: (clave: string) => MuestraHistorial[];
} {
  const ruta = op.ruta ?? RUTA_DEFECTO;
  const ahora = op.ahora ?? Date.now;
  let cache: Record<string, MuestraHistorial[]> | null = null;

  function cargar(): Record<string, MuestraHistorial[]> {
    if (cache) return cache;
    const limpio: Record<string, MuestraHistorial[]> = {};
    try {
      const crudo: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
      if (crudo && typeof crudo === 'object' && !Array.isArray(crudo)) {
        for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
          if (!claveValida(k) || !Array.isArray(v)) continue;
          const ms = (v as unknown[]).filter(esMuestra);
          if (ms.length > 0) limpio[k] = ms.slice(-HIST_MAX_MUESTRAS);
        }
      }
    } catch {
      /* Sin fichero o corrupto: historia vacía (el próximo anotar lo repara). */
    }
    cache = limpio;
    return limpio;
  }

  function guardar(datos: Record<string, MuestraHistorial[]>): void {
    try {
      mkdirSync(dirname(ruta), { recursive: true });
      const tmp = `${ruta}.tmp`;
      writeFileSync(tmp, JSON.stringify(datos));
      renameSync(tmp, ruta);
    } catch {
      /* El historial nunca rompe el /agente. */
    }
  }

  /* Suma contenedores por clave y añade una muestra [t, cpu, mem]. Throttle
   * por última muestra persistida (a prueba de reinicios): mismo t o <30 s
   * se salta —el poll de 5 s del frente no engorda el fichero. */
  function anotar(filas: FilaHistorial[], tsSnapshot: unknown): void {
    try {
      const t = normalizarTs(tsSnapshot, ahora());
      const sumas = new Map<string, { cpu: number; mem: number }>();
      for (const f of filas) {
        if (typeof f.cpuPct !== 'number' || !Number.isFinite(f.cpuPct)) continue;
        if (typeof f.memMiB !== 'number' || !Number.isFinite(f.memMiB)) continue;
        const clave = claveSitio(f.sitio ?? null);
        const s = sumas.get(clave) ?? { cpu: 0, mem: 0 };
        s.cpu += f.cpuPct;
        s.mem += f.memMiB;
        sumas.set(clave, s);
      }
      if (sumas.size === 0) return;
      const datos = cargar();
      let cambio = false;
      for (const [clave, s] of sumas) {
        const serie = datos[clave] ?? [];
        const ultima = serie.length > 0 ? serie[serie.length - 1][0] : 0;
        if (t - ultima < HIST_INTERVALO_MS) continue;
        const podada = serie.filter((m) => t - m[0] <= HIST_RETENCION_MS);
        podada.push([t, redondear1(s.cpu), redondear1(s.mem)]);
        datos[clave] = podada.slice(-HIST_MAX_MUESTRAS);
        cambio = true;
      }
      if (cambio) guardar(datos);
    } catch {
      /* Best-effort: lo vivo ya se sirvió. */
    }
  }

  function leer(clave: string): MuestraHistorial[] {
    if (!claveValida(clave)) return [];
    return cargar()[clave] ?? [];
  }

  return { anotar, leer };
}

/* Singleton de producción (el null no aplica: siempre hay ruta por defecto). */
let prod: ReturnType<typeof crearHistorial> | null = null;

export function historialProd(): ReturnType<typeof crearHistorial> {
  if (!prod) prod = crearHistorial();
  return prod;
}
