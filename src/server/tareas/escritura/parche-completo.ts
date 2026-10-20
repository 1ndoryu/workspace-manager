/* Parche de edicion completado antes de un PUT a TASK (20AA-10).
 * [por que] El PUT de TASK es un upsert de **reemplazo** y sus campos no enviados caen a su valor
 * por defecto: `payload` vacio, `proyectoId` null, `parentId` null, `orden` 0, `completado` false,
 * `urgencia` «normal» (PROYECTO TASKS src/models/productivity.rs:68-88 y
 * repositories/productivity.rs:163-194). Una edicion parcial desde el tab —que manda solo el texto,
 * la columna y lo que se toco— borraria el espejo del roadmap (`payload.roadmap`), devolveria la
 * tarjeta a la primera posicion y la sacaria de su columna: la sincronizacion con el archivo moriria
 * **en silencio**, que es justo lo que este encargo no puede permitirse. Medido en vivo el
 * 2026-10-20: un PUT de `{texto, prioridad}` sobre `19AA-1` de glory-pulse le quito el espejo y la
 * saco de su columna. */
import {CLAVES_RESERVADAS} from './contenido-tarea.js';
import type {ParcheTarea} from '../tarea-unitaria.js';

/* Claves que TASK sirve a raiz del item pero que **no** son payload suyo: si viajaran dentro del
 * `payload` del PUT se guardarian como basura propia. `updatedAt` lo escriben algunos clientes
 * (la app de escritorio) dentro del payload; se copia tal cual estaba, sin inventarlo. */
const CLAVES_DE_FILA = ['updatedAt'];

/* Payload guardado de una tarea: todo lo que TASK devuelve menos las claves que fija el mismo y la
 * fecha de fila. Es lo que hay que devolverle para no borrarle nada. */
export function payloadGuardado(item: Record<string, unknown>): Record<string, unknown> {
  const propio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if ((CLAVES_RESERVADAS as readonly string[]).includes(k)) continue;
    if (CLAVES_DE_FILA.includes(k)) continue;
    propio[k] = v;
  }
  return propio;
}

/* Lo que el parche dice, o lo que ya estaba guardado. [por que `undefined` y no falsy] El parche
 * usa `undefined` para «no lo toco»; `null` y `false` son valores dichos (limpiar la prioridad,
 * desmarcar) y tienen que viajar. */
function o<T>(dicho: T | undefined, guardado: T): T {
  return dicho === undefined ? guardado : dicho;
}

function entero(v: unknown): number {
  return Number.isInteger(v) ? (v as number) : 0;
}

function booleano(v: unknown): boolean {
  return v === true;
}

function textoDe(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/* El parche, completado con lo que TASK ya tenia guardado. */
export function completarParche(item: Record<string, unknown>, parche: ParcheTarea): ParcheTarea {
  const guardado: ParcheTarea = {
    texto: typeof item.texto === 'string' ? item.texto : '',
    completado: booleano(item.completado),
    prioridad: textoDe(item.prioridad),
    urgencia: textoDe(item.urgencia) ?? 'normal',
    proyectoId: typeof item.proyectoId === 'number' ? item.proyectoId : null,
    parentId: typeof item.parentId === 'number' ? item.parentId : null,
    orden: entero(item.orden),
    payload: payloadGuardado(item),
  };
  return {
    texto: parche.texto,
    completado: o(parche.completado, guardado.completado),
    prioridad: o(parche.prioridad, guardado.prioridad),
    urgencia: o(parche.urgencia, guardado.urgencia),
    proyectoId: o(parche.proyectoId, guardado.proyectoId),
    parentId: o(parche.parentId, guardado.parentId),
    orden: o(parche.orden, guardado.orden),
    payload: o(parche.payload, guardado.payload),
    ...(parche.expectedUpdatedAt === undefined ? {} : {expectedUpdatedAt: parche.expectedUpdatedAt}),
  };
}
