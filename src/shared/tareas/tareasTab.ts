/* Tipos del proxy /api/tareas/* + puras de la tab kanban (07AA-5 F3).
 * [por que] El front no toca TASKS: habla con el proxy del server F2, que
 * custodia la sesion D1. Formas aqui (no en el componente) para que el
 * contrato sea testeable sin React y la tab solo renderice. Columnas =
 * columnas fijas del proxy (08AA-6: una por repo WM no-ignorado, en orden de
 * snapshot; el servidor sincroniza WM->TASKS por `wmClave`); el orden de las
 * TAREAS vive en TASKS (D2). */
export interface TareaTab {
  legacyId: number;
  orden: number;
  proyectoId?: number;
  campos: Record<string, unknown>;
}

/* Item tal como lo sirve GET /api/tareas/proyecto (envoltorio F2 sobre
 * ItemVersionado del nucleo tasks-core: id + item + updatedAt). La tab
 * nunca ve esta forma: tareasDeRespuesta la normaliza a TareaTab. */
export interface TareaPuente {
  id: unknown;
  item: unknown;
  updatedAt?: unknown;
}

export interface TareasProyectoRespuesta {
  tareas: TareaTab[];
}

export interface TareasMovimientoTab {
  legacyId: number;
  orden: number;
  proyectoId?: number;
}

export interface TareasReordenarRespuesta {
  actualizadas: unknown;
}

/* GET /api/tareas/estado: el puente dice si puede operar y por que no. */
export interface TareasEstado {
  configurado: boolean;
  disponible: boolean;
  motivo: string | null;
}

export function esTareaTab(v: unknown): v is TareaTab {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    Number.isInteger(t.legacyId) &&
    Number.isInteger(t.orden) &&
    typeof t.campos === 'object' &&
    t.campos !== null
  );
}

/* Normaliza un item del puente a TareaTab (null si no es item valido).
 * [por que] El proxy sirve {id, item:{orden, proyectoId, texto, ...}} y la
 * tab trabaja con {legacyId, orden, proyectoId, campos}: sin esta
 * normalizacion el filtro de esTareaTab descarta el 100% (bug 2026-10-07:
 * las columnas salian siempre vacias aunque el proxy trajera tareas). */
export function tareaDePuente(v: unknown): TareaTab | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  if (!Number.isInteger(p.id)) return null;
  if (typeof p.item !== 'object' || p.item === null) return null;
  const item = p.item as Record<string, unknown>;
  if (!Number.isInteger(item.orden)) return null;
  const t: TareaTab = {
    legacyId: p.id as number,
    orden: item.orden as number,
    campos: item as Record<string, unknown>,
  };
  if (Number.isInteger(item.proyectoId)) t.proyectoId = item.proyectoId as number;
  return t;
}

/* Respuesta validada: normaliza cada item del puente y descarta lo que no
 * sea tarea (igual que historialSitioVps descarta lo que no sea tupla). */
export function tareasDeRespuesta(datos: unknown): TareaTab[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const lista = (datos as { tareas?: unknown }).tareas;
  if (!Array.isArray(lista)) return [];
  const normalizadas: TareaTab[] = [];
  for (const v of lista) {
    const t = tareaDePuente(v);
    if (t !== null) normalizadas.push(t);
  }
  return normalizadas;
}

/* Parche de edicion inline (07AA-15): espejo del body de PUT
 * /api/tareas/tarea/:id (el proxy revalida con validarParche; TASKS
 * revalida con UpsertTaskRequest). `texto` siempre va (F1 lo exige). */
export interface ParcheTareaTab {
  texto: string;
  completado?: boolean;
  prioridad?: string | null;
  urgencia?: string;
  proyectoId?: number | null;
  orden?: number;
}

/* El PUT F1 es upsert de reemplazo: sin proyectoId TASKS lo pone a null
 * y la tarjeta se vuelve huerfana invisible (bug 2026-10-07: completar
 * desde el menu "borraba" la tarjeta). El hook inyecta su columna con
 * esta pura para que el invariante quede cubierto por test. */
export function parcheConColumna(columna: number, parche: ParcheTareaTab): ParcheTareaTab {
  return {...parche, proyectoId: columna};
}

/* Vocabulario de niveles (07AA-15): espejo exacto de TASKS
 * frontend/src/app/utils/constantes.ts (OPCIONES_PRIORIDAD/URGENCIA) y
 * types/tarea.ts (NivelPrioridad/NivelUrgencia). El proxy solo acepta
 * estos ids (validarParche) y TASKS los valida en dataService.ts:351-355:
 * inventar uno nuevo daria 422 en el frente. */
export const PRIORIDADES_TAREA = ['muy_alta', 'alta', 'media', 'baja', 'muy_baja'] as const;
export const URGENCIAS_TAREA = ['bloqueante', 'urgente', 'normal', 'chill'] as const;

export const ETIQUETAS_PRIORIDAD: Record<string, string> = {
  muy_alta: 'Muy Alta',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  muy_baja: 'Muy Baja',
};

export const ETIQUETAS_URGENCIA: Record<string, string> = {
  bloqueante: 'Bloqueante',
  urgente: 'Urgente',
  normal: 'Normal',
  chill: 'Chill',
};

/* Lecturas honestas de los campos (campos es Record<string, unknown>):
 * lo ausente o roto cae al defecto, nunca rompe el render. */
export function completadoTarea(t: TareaTab): boolean {
  return t.campos.completado === true;
}

export function prioridadTarea(t: TareaTab): string | null {
  const v = t.campos.prioridad;
  return typeof v === 'string' && (PRIORIDADES_TAREA as readonly string[]).includes(v) ? v : null;
}

export function urgenciaTarea(t: TareaTab): string {
  const v = t.campos.urgencia;
  return typeof v === 'string' && (URGENCIAS_TAREA as readonly string[]).includes(v) ? v : 'normal';
}
export function textoTarea(t: TareaTab): string {
  for (const k of ['texto', 'titulo', 'nombre', 'name']) {
    const v = t.campos[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return `#${t.legacyId}`;
}

/* Orden nuevo de una columna como movimientos bulk (orden = posicion). */
export function construirMovimientos(
  ordenados: { legacyId: number }[],
  proyectoId: number,
): TareasMovimientoTab[] {
  return ordenados.map((t, i) => ({ legacyId: t.legacyId, orden: i, proyectoId }));
}

/* Columna fija tal como la sirve GET /api/tareas/proyectos (08AA-6 sync):
 * `clave` = repo WM (estable), `nombre` = lo que se pinta, `legacyId` =
 * proyecto TASKS donde viven/crear las tareas. Sin `legacyId` entero no hay
 * columna donde operar: se descarta (el servidor nunca la emite). */
export interface ColumnaTab {
  clave: string;
  nombre: string;
  legacyId: number;
}

export function esColumnaTab(v: unknown): v is ColumnaTab {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.clave === 'string' &&
    c.clave !== '' &&
    typeof c.nombre === 'string' &&
    c.nombre !== '' &&
    Number.isInteger(c.legacyId) &&
    (c.legacyId as number) > 0
  );
}

export function columnasDeRespuesta(datos: unknown): ColumnaTab[] {
  if (typeof datos !== 'object' || datos === null) return [];
  const lista = (datos as { proyectos?: unknown }).proyectos;
  if (!Array.isArray(lista)) return [];
  const columnas: ColumnaTab[] = [];
  const vistas = new Set<string>();
  for (const v of lista) {
    if (!esColumnaTab(v) || vistas.has(v.clave)) continue;
    vistas.add(v.clave);
    columnas.push({ clave: v.clave, nombre: v.nombre, legacyId: v.legacyId });
  }
  return columnas;
}

/* Id legacy nuevo espejo de TASKS `generarIdTarea` (`Date.now()*1000 +
 * resto`): el PUT del proxy es upsert y asi el alta inline no colisiona con
 * los ids que crea el front TASKS. Contador de modulo (como TASKS). */
let restoIdTarea = 0;

export function generarIdTarea(ahora: number = Date.now()): number {
  restoIdTarea = (restoIdTarea + 1) % 1000;
  return Math.floor(ahora) * 1000 + restoIdTarea;
}

/* Foto local del kanban (08AA-8: stale-while-revalidate).
 * [por que] La carga fresca tarda ~4s (18 columnas en serie contra TASKS);
 * el hook pinta esta foto al montar y revalida en fondo. Solo datos JSON:
 * clonar filtra con los mismos guardianes que la red (esColumnaTab /
 * esTareaTab) y restaurar devuelve null ante cualquier forma ajena en vez
 * de pintar basura. Las claves de `tareas` se validan enteras (en JSON
 * viajan como texto). */
export interface CacheTareasTab {
  guardadoEn: number;
  estado: TareasEstado;
  columnas: ColumnaTab[];
  tareas: Record<number, TareaTab[]>;
}

export function clonarCacheTareas(
  estado: TareasEstado,
  columnas: ColumnaTab[],
  tareas: Record<number, TareaTab[]>,
): CacheTareasTab {
  const copia: Record<number, TareaTab[]> = {};
  for (const [k, lista] of Object.entries(tareas)) {
    if (!Array.isArray(lista)) continue;
    copia[Number(k)] = lista.filter(esTareaTab);
  }
  return {
    guardadoEn: Date.now(),
    estado: {
      configurado: estado.configurado === true,
      disponible: estado.disponible === true,
      motivo: typeof estado.motivo === 'string' ? estado.motivo : null,
    },
    columnas: columnas.filter(esColumnaTab).map((c) => ({ clave: c.clave, nombre: c.nombre, legacyId: c.legacyId })),
    tareas: copia,
  };
}

export function restaurarCacheTareas(v: unknown): CacheTareasTab | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!Number.isInteger(c.guardadoEn)) return null;
  if (typeof c.estado !== 'object' || c.estado === null) return null;
  const e = c.estado as Record<string, unknown>;
  if (typeof e.configurado !== 'boolean' || typeof e.disponible !== 'boolean') return null;
  if (!Array.isArray(c.columnas) || !c.columnas.every(esColumnaTab)) return null;
  if (typeof c.tareas !== 'object' || c.tareas === null || Array.isArray(c.tareas)) return null;
  const tareas: Record<number, TareaTab[]> = {};
  for (const [k, lista] of Object.entries(c.tareas as Record<string, unknown>)) {
    if (!Number.isInteger(Number(k)) || !Array.isArray(lista)) return null;
    tareas[Number(k)] = lista.filter(esTareaTab);
  }
  return {
    guardadoEn: c.guardadoEn as number,
    estado: {
      configurado: e.configurado as boolean,
      disponible: e.disponible as boolean,
      motivo: typeof e.motivo === 'string' ? (e.motivo as string) : null,
    },
    columnas: (c.columnas as ColumnaTab[]).map((col) => ({ clave: col.clave, nombre: col.nombre, legacyId: col.legacyId })),
    tareas,
  };
}
