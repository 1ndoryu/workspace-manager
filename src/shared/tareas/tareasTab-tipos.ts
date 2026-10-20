/* Tipos y constantes de la tab kanban (partido de tareasTab.ts). [por que] Sin funciones: el
 * contrato se lee aqui y lo usan el modelo, la cache y el componente sin arrastrar logica. */
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

/* Las tres fechas del protocolo, en su orden. */
export const FECHAS_TAREA = ['creada', 'pospuesta', 'completada'] as const;

/* Una tarea raiz con sus hijas. [por que] El kanban pinta una tarjeta por raiz y sus subtareas
 * dentro: una subtarea no es una tarjeta suelta, no se arrastra por su cuenta y su sitio en el
 * archivo lo fija su padre. */
export interface ArbolTarea {
  raiz: TareaTab;
  hijas: TareaTab[];
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
