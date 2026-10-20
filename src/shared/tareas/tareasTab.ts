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

/* GET /api/tareas/estado: el puente dice si puede operar y por que no.
 * [por que] `base` es la URL donde responde TASKS (TASKS_BASE_URL, en el
 * portatil el puerto del tunel a la 89): es el unico enlace bueno que tenemos
 * para "abrir en TASKS", asi que viaja hasta la tab en vez de fijarlo a mano. */
export interface TareasEstado {
  configurado: boolean;
  disponible: boolean;
  motivo: string | null;
  base: string | null;
}

/* Normaliza la base que manda el puente ('' = sin-base, no vale como enlace). */
export function baseDeEstado(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
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
  /* Una subtarea de TASK es una linea sangrada bajo su padre en el roadmap (20AA-10 F4): sin
   * `parentId` el PUT no la cuelga de nadie y el archivo no sabe donde ponerla. */
  parentId?: number | null;
  /* Propiedades del roadmap que TASK no conoce (F4). Viajan a raiz del parche y el proxy las
   * guarda en el payload: aqui no se manda `payload` nunca (el PUT de TASK es de reemplazo y
   * llevaria por delante el espejo del roadmap, que el frente no tiene por que reproducir). */
  etiquetas?: string[] | null;
  dependeDe?: string[] | null;
  creada?: string | null;
  pospuesta?: string | null;
  completada?: string | null;
}

/* El PUT F1 es upsert de reemplazo: sin proyectoId TASKS lo pone a null
 * y la tarjeta se vuelve huerfana invisible (bug 2026-10-07: completar
 * desde el menu "borraba" la tarjeta). El hook inyecta su columna con
 * esta pura para que el invariante quede cubierto por test. */
export function parcheConColumna(columna: number, parche: ParcheTareaTab): ParcheTareaTab {
  return {...parche, proyectoId: columna};
}

/* Lo que la respuesta dice de la escritura en el roadmap (20AA-10 F3b). El PUT/DELETE/reorden
 * tocan dos sitios —TASK y el `roadmap.md` del proyecto— y el segundo puede fallar despues de que
 * el primero haya funcionado: la tarjeta esta guardada y el archivo no. Eso no puede quedarse en
 * el cuerpo de la respuesta sin que nadie lo lea, asi que se convierte en una linea de aviso.
 * [por que se acepta objeto o lista] El reorden puede tocar dos columnas (arrastre entre
 * proyectos) y devuelve una por cada una. */
export function avisoDeRespuesta(datos: unknown): string | null {
  const roadmap = (datos as {roadmap?: unknown} | null)?.roadmap;
  const items = Array.isArray(roadmap) ? roadmap : roadmap === null || roadmap === undefined ? [] : [roadmap];
  const partes: string[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const {aviso, proyecto} = item as {aviso?: unknown; proyecto?: unknown};
    if (typeof aviso !== 'string' || aviso === '') continue;
    partes.push(typeof proyecto === 'string' && proyecto !== '' ? `${proyecto}: ${aviso}` : aviso);
  }
  return partes.length === 0 ? null : partes.join(' · ');
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

/* --- Subtareas y propiedades del roadmap (20AA-10 F4) ---------------------------------------
 * Lo que el tab necesita saber de una tarea para pintarla anidada y para editar lo que el roadmap
 * guarda en su linea «·». Todo son lecturas honestas de `campos` (lo ausente o roto no rompe el
 * render) y una escritura: la lista de etiquetas tecleada por la usuaria. */

/* Las tres fechas del protocolo, en su orden. */
export const FECHAS_TAREA = ['creada', 'pospuesta', 'completada'] as const;

/* El padre de una tarea, o null si es raiz. */
export function padreDeTarea(t: TareaTab): number | null {
  const v = t.campos.parentId;
  return Number.isInteger(v) ? (v as number) : null;
}

/* Es una subtarea de TASK (hija de otra tarjeta de la misma columna). */
export function esSubtarea(t: TareaTab): boolean {
  return padreDeTarea(t) !== null;
}

/* Una tarea raiz con sus hijas. [por que] El kanban pinta una tarjeta por raiz y sus subtareas
 * dentro: una subtarea no es una tarjeta suelta, no se arrastra por su cuenta y su sitio en el
 * archivo lo fija su padre. */
export interface ArbolTarea {
  raiz: TareaTab;
  hijas: TareaTab[];
}

export function arbolDeTareas(lista: TareaTab[]): ArbolTarea[] {
  const ids = new Set(lista.map((t) => t.legacyId));
  /* [por que] Una subtarea cuyo padre no esta en la lista se pinta como raiz: huerfana visible
   * antes que desaparecida (el padre puede no haber llegado en la foto local). */
  const raices = lista.filter((t) => {
    const p = padreDeTarea(t);
    return p === null || !ids.has(p);
  });
  return raices.map((raiz) => ({ raiz, hijas: lista.filter((t) => padreDeTarea(t) === raiz.legacyId) }));
}

function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

export function etiquetasTarea(t: TareaTab): string[] {
  return textos(t.campos.etiquetas);
}

/* El ID del roadmap que la tarjeta declara, o null si no nacio del archivo (20AA-10 F5). Es con lo
 * que la consola empareja una tarea al abrirla: la consola conoce el ID del archivo, no el de TASK. */
export function idRoadmapDeTarea(t: TareaTab): string | null {
  const e = t.campos.roadmap;
  if (typeof e !== 'object' || e === null) return null;
  const id = (e as Record<string, unknown>).id;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function dependeDeTarea(t: TareaTab): string[] {
  return textos(t.campos.dependeDe);
}

/* Solo las fechas que la tarea dice, por su nombre del roadmap. */
export function fechasTarea(t: TareaTab): Record<string, string> {
  const f: Record<string, string> = {};
  for (const k of FECHAS_TAREA) {
    const v = t.campos[k];
    if (typeof v === 'string' && v.trim() !== '') f[k] = v.trim();
  }
  return f;
}

/* Una fecha en la forma que el roadmap lee (`RE_FECHA`), o null si no lo es: el campo de fecha
 * vacio llega como '' y no puede viajar como si fuera una fecha. */
export function fechaValida(v: string): string | null {
  const limpio = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(limpio) ? limpio : null;
}

/* Lo que la usuaria tecleo en un campo de lista, en lista. [por que se corta por coma y no por
 * espacio] Una etiqueta puede llevar espacios («vps 89») y el campo es una sola linea: la coma es
 * el unico separador que no aparece dentro de un nombre. */
export function listaTecleada(texto: string): string[] {
  return texto
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/* Una lista tecleada como campo de texto: lo que se pinta en el formulario. */
export function listaATexto(lista: string[]): string {
  return lista.join(', ');
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
      base: baseDeEstado(estado.base),
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
      // [por que] Las caches guardadas antes de existir `base` se restauran sin
      // enlace, no se descartan: la tab cae al valor por defecto.
      base: baseDeEstado(e.base),
    },
    columnas: (c.columnas as ColumnaTab[]).map((col) => ({ clave: col.clave, nombre: col.nombre, legacyId: col.legacyId })),
    tareas,
  };
}
