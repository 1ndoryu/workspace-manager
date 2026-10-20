/* Operaciones unitarias sobre una tarea (07AA-15): parche de edicion y mapa
 * de errores PUT/DELETE, sin sesion (puras: testeables sin red ni login).
 * [por que] Nacio al partir `puente-tareas.ts` (limite-lineas 300): lo puro
 * vive aqui; la sesion D1, el lock de re-login y la cuota siguen en el puente. */
import type {ErrorKanban} from './nucleo/tipos.js';

/* Parche de edición inline de la tab (07AA-15): subconjunto del
 * UpsertTaskRequest F1 (vocabulario espejo; TASKS revalida con 422).
 * `texto` es requerido por F1: el front lo manda siempre (lo conoce).
 * `proyectoId` viaja siempre (el PUT F1 es upsert de reemplazo: sin el,
 * TASKS lo pone a null y la tarjeta se vuelve huerfana invisible). */
export interface ParcheTarea {
  texto: string;
  completado?: boolean;
  prioridad?: string | null;
  urgencia?: string;
  proyectoId?: number | null;
  parentId?: number | null;
  orden?: number;
  /* Payload del item. [por que 20AA-10] En TASK no es opcional: un PUT sin `payload` lo
   * reemplaza por el objeto canonico vacio y se lleva por delante las claves guardadas
   * (`src/models/productivity.rs:83` y `repositories/productivity.rs:173`), asi que el espejo
   * del roadmap manda siempre el payload entero. */
  payload?: Record<string, unknown>;
  /* Control de concurrencia optimista: el `updatedAt` que se leyo. Si la app de TASK escribio
   * entretanto, TASK responde 409 y no se pisa nada. `null` = escritura incondicional. */
  expectedUpdatedAt?: string | null;
  /* Propiedades del roadmap que TASK no conoce (20AA-10 F4): etiquetas, dependencias y las tres
   * fechas. Viajan a raiz del parche y `completarParche` las mete en el `payload`, que es donde
   * las lee la otra direccion (`contenidoDeItem`). [por que aqui y no un `payload` del frente] El
   * PUT de TASK es de reemplazo: si el frente mandara el payload entero tendria que reproducir
   * `payloadGuardado` —y con el, el espejo del roadmap— fuera del servidor, que es donde se sabe
   * hacerlo sin perder nada. `null` o vacio = quitar la clave. */
  etiquetas?: string[] | null;
  dependeDe?: string[] | null;
  creada?: string | null;
  pospuesta?: string | null;
  completada?: string | null;
}

const PRIORIDADES_OK = ['muy_alta', 'alta', 'media', 'baja', 'muy_baja'];
const URGENCIAS_OK = ['bloqueante', 'urgente', 'normal', 'chill'];
/* Fecha en forma ISO corta: la misma que escribe y lee el roadmap (`RE_FECHA`). */
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TOPE_LISTA = 50;
const TOPE_ETIQUETA = 60;

export function validarParche(parche: unknown): {ok: true; valor: ParcheTarea} | {ok: false; errores: string[]} {
  const errores: string[] = [];
  if (typeof parche !== 'object' || parche === null) return {ok: false, errores: ['parche-vacio']};
  const p = parche as Record<string, unknown>;
  if (typeof p.texto !== 'string' || p.texto.trim() === '' || p.texto.length > 1000) {
    errores.push('texto-requerido-max-1000');
  }
  if (p.completado !== undefined && typeof p.completado !== 'boolean') errores.push('completado-bool');
  if (p.prioridad !== undefined && p.prioridad !== null && !PRIORIDADES_OK.includes(String(p.prioridad))) {
    errores.push('prioridad-invalida');
  }
  if (p.urgencia !== undefined && !URGENCIAS_OK.includes(String(p.urgencia))) errores.push('urgencia-invalida');
  for (const k of ['proyectoId', 'parentId', 'orden'] as const) {
    if (p[k] !== undefined && p[k] !== null && !Number.isInteger(p[k])) errores.push(`${k}-entero`);
  }
  if (p.payload !== undefined && (typeof p.payload !== 'object' || p.payload === null || Array.isArray(p.payload))) {
    errores.push('payload-objeto');
  }
  if (p.expectedUpdatedAt !== undefined && p.expectedUpdatedAt !== null && typeof p.expectedUpdatedAt !== 'string') {
    errores.push('expectedUpdatedAt-texto');
  }
  /* Propiedades del roadmap (20AA-10 F4): listas de textos cortos y fechas ISO cortas. Lo vacio y
   * lo nulo son «quitar», no un error: es como se borra la ultima etiqueta. */
  for (const k of ['etiquetas', 'dependeDe'] as const) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v) || v.length > TOPE_LISTA) {
      errores.push(`${k}-lista-max-${TOPE_LISTA}`);
      continue;
    }
    if (!v.every((x) => typeof x === 'string' && x.trim() !== '' && x.length <= TOPE_ETIQUETA)) {
      errores.push(`${k}-textos-max-${TOPE_ETIQUETA}`);
    }
  }
  for (const k of ['creada', 'pospuesta', 'completada'] as const) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !RE_FECHA.test(v)) errores.push(`${k}-fecha-aaaa-mm-dd`);
  }
  if (errores.length > 0) return {ok: false, errores};
  return {ok: true, valor: p as unknown as ParcheTarea};
}

/* Proyecto TASKS tal como lo sirve GET /api/dashboard (data.proyectos):
 * `object_with_id` fija `id` = legacy_id numerico (models/dashboard.rs) y
 * `project_object` aporta `nombre`/`estado`/`orden` (proyeccion.rs:209). El
 * `payload` del proyecto se mezcla a raiz, asi que `payload.wmClave` (llave
 * del sync 08AA-6: clave WM que origino el proyecto) llega como `wmClave`
 * a raiz. Sin `wmClave` el proyecto no es de ningun repo WM (p. ej. demos)
 * y no genera columna, pero queda intacto. */
export interface ProyectoPuente {
  legacyId: number;
  nombre: string;
  estado: string | null;
  orden: number | null;
  wmClave: string | null;
}

function enteroPositivo(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : null;
}

function textoNoVacio(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/* Normaliza data.proyectos del agregado a ProyectoPuente (descarta lo que no
 * sea proyecto: sin id entero positivo no hay columna posible). `nombre`
 * admite `nombre`/`name`; sin nombre queda '' y nunca empareja (no se
 * inventa etiqueta). `wmClave` admite raiz o `payload.wmClave` (el agregado
 * ya lo mezcla a raiz; se aceptan ambas formas por robustez). */
export function proyectosDeAgregado(datos: unknown): ProyectoPuente[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const data = (datos as {data?: unknown}).data;
  if (typeof data !== 'object' || data === null) return [];
  const lista = (data as {proyectos?: unknown}).proyectos;
  if (!Array.isArray(lista)) return [];
  const normalizados: ProyectoPuente[] = [];
  for (const v of lista) {
    if (typeof v !== 'object' || v === null) continue;
    const p = v as Record<string, unknown>;
    const id = enteroPositivo(p.id) ?? enteroPositivo(p.legacy_id) ?? enteroPositivo(p.legacyId);
    if (id === null) continue;
    const nombre = textoNoVacio(p.nombre) ?? textoNoVacio(p.name) ?? '';
    const estado = textoNoVacio(p.estado);
    const orden = Number.isInteger(p.orden) ? (p.orden as number) : null;
    const anidado =
      typeof p.payload === 'object' && p.payload !== null ? (p.payload as Record<string, unknown>).wmClave : null;
    normalizados.push({legacyId: id, nombre, estado, orden, wmClave: textoNoVacio(p.wmClave) ?? textoNoVacio(anidado)});
  }
  return normalizados;
}

/* Mapa de errores PUT/DELETE sobre /api/tasks/:legacy_id: el mismo
 * vocabulario ErrorKanban para que las rutas respondan igual que el resto. */
export function mapearErrorTarea(estado: number, cuerpo: unknown, reintentar?: number): ErrorKanban {
  const mensaje =
    typeof cuerpo === 'object' && cuerpo !== null && typeof (cuerpo as {message?: unknown}).message === 'string'
      ? (cuerpo as {message: string}).message
      : 'Error de TASKS';
  if (estado === 401) return {codigo: 'no-autenticado', mensaje, estadoHttp: estado};
  if (estado === 404) return {codigo: 'no-encontrado', mensaje, estadoHttp: estado};
  if (estado === 422) return {codigo: 'validacion', mensaje, estadoHttp: estado};
  if (estado === 429) {
    return {codigo: 'cuota', mensaje, estadoHttp: estado, reintentarEnMs: reintentar};
  }
  return {codigo: 'servidor', mensaje, estadoHttp: estado};
}
