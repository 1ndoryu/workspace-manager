/* Alta de un proyecto en el tablero (10AA-2 F10): ejecuta `dev.mjs alta <ruta> --json`
 * y devuelve los ítems. Pendientes = código 1, un resultado normal y no un fallo.
 * [por que] La lista la decide el CLI (scripts/dev/proyecto/alta.mjs), igual que las acciones
 * del mando: aquí solo se lanza sin shell y se valida la salida antes de mostrarla. */
import { execFile } from 'node:child_process';
import { DEV_MJS } from './acciones.js';

const TIMEOUT_ALTA_MS = 60_000;

export interface ItemAlta {
  nombre: string;
  ok: boolean;
  detalle: string;
  accion?: string;
}

export interface ResumenAlta {
  etiqueta: string;
  hechos: number;
  total: number;
  items: ItemAlta[];
}

export type ResultadoAlta = { ok: true; resumen: ResumenAlta } | { ok: false; error: string };

/* Valida la forma del JSON del CLI; null si la salida está vacía, rota o no encaja. */
export function interpretarAlta(salida: string): ResumenAlta | null {
  let valor: unknown;
  try {
    valor = JSON.parse(salida);
  } catch {
    return null;
  }
  if (!valor || typeof valor !== 'object') return null;
  const o = valor as Record<string, unknown>;
  if (typeof o.etiqueta !== 'string' || typeof o.hechos !== 'number' || typeof o.total !== 'number') return null;
  if (!Array.isArray(o.items)) return null;
  const items: ItemAlta[] = [];
  for (const crudo of o.items) {
    if (!crudo || typeof crudo !== 'object') return null;
    const it = crudo as Record<string, unknown>;
    if (typeof it.nombre !== 'string' || typeof it.ok !== 'boolean' || typeof it.detalle !== 'string') return null;
    items.push({
      nombre: it.nombre,
      ok: it.ok,
      detalle: it.detalle,
      ...(typeof it.accion === 'string' ? { accion: it.accion } : {}),
    });
  }
  return { etiqueta: o.etiqueta, hechos: o.hechos, total: o.total, items };
}

export function resumirAlta(ruta: string): Promise<ResultadoAlta> {
  return new Promise((res) => {
    execFile(
      process.execPath,
      [DEV_MJS, 'alta', ruta, '--json'],
      { timeout: TIMEOUT_ALTA_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const resumen = interpretarAlta(String(stdout ?? ''));
        if (resumen) {
          res({ ok: true, resumen });
          return;
        }
        const detalle = String(stderr ?? '').trim() || (err ? err.message : 'salida sin formato');
        res({ ok: false, error: detalle.slice(0, 1000) });
      },
    );
  });
}
