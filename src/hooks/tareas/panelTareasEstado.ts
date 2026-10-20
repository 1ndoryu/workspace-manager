/* Estado y reductor de la tab tareas (20AA-10 F5/F6 y 19AA-15), sin efectos ni IO.
 * [por que] Separado de usePanelTareas.ts: el reductor es la parte pura (mismo estado y acciones
 * => mismo resultado) y el hook solo pone los efectos, la cola y las llamadas a la API. Asi se
 * puede probar sin React ni red y el hook queda bajo el limite de tamaño del gate. */
import {
  type CacheTareasTab,
  type ColumnaTab,
  type TareaTab,
  type TareasEstado,
} from '../../shared/tareas/tareasTab.js';
import type { EstadoSincroniaTab } from '../../v2/tareas/apiTareas.js';

export interface EstadoPanelTareas {
  columnas: ColumnaTab[];
  tareas: Record<number, TareaTab[]>;
  estado: TareasEstado | null;
  cargando: boolean;
  error: string | null;
  /* Lo que salio a medias: la tarjeta se guardo en TASK y el roadmap del proyecto no (20AA-10
   * F3b). No es un fallo del tab —por eso no comparte canal con `error`— pero tampoco puede
   * desaparecer: es el unico sitio donde se ve que el archivo quedo desincronizado. */
  aviso: string | null;
  moviendo: string | null;
  /* Abrir una tarea desde la consola (20AA-10 F5). Son dos campos y no uno porque entre la
   * peticion y el destaque hace falta la columna cargada: la peticion llega del store con lo unico
   * que la consola conoce —el `clave` del repo y el ID del roadmap— y solo se puede resolver
   * contra listas que ya esten ahi. Consumirla antes de resolverla la perderia. */
  peticionDestacada: { clave: string; roadmapId: string } | null;
  /* La tarjeta ya resuelta (columna de TASK + id legacy) o null si la peticion no encontro
   * tarjeta. */
  destacada: { columna: number; legacyId: number } | null;
  /* La peticion no encontro tarjeta: el roadmap y TASK no coinciden (tarea creada a mano en el
   * archivo y aun no espejada, o TASK caido). Se dice, no se abre una tab muda. */
  avisoDestacada: string | null;
  /* Lo que le paso a la ultima pasada de la sincronia de fondo (20AA-10 F6). Campo propio y no
   * `aviso` porque son cosas distintas y de duraciones distintas: `aviso` es de un gesto (y lo
   * limpia el siguiente), esto es del estado del area y sigue ahi hasta que se arregle. */
  avisoSincronia: string | null;
}

export type AccionTareas =
  | { tipo: 'cargando' }
  | { tipo: 'cache'; foto: CacheTareasTab }
  | { tipo: 'cargado'; estado: TareasEstado; columnas: ColumnaTab[]; tareas: Record<number, TareaTab[]> }
  | { tipo: 'fallo'; error: string }
  | { tipo: 'aviso'; aviso: string | null }
  | { tipo: 'moviendo'; clave: string }
  | { tipo: 'movido' }
  | { tipo: 'optimista'; columna: number; tarea: TareaTab }
  | { tipo: 'descartar'; columna: number; legacyId: number }
  | { tipo: 'peticionDestacada'; peticion: { clave: string; roadmapId: string } | null }
  | { tipo: 'destacada'; destino: { columna: number; legacyId: number } | null; roadmapId: string }
  | { tipo: 'sincronia'; aviso: string | null };

export const ESTADO_INICIAL: EstadoPanelTareas = {
  columnas: [],
  tareas: {},
  estado: null,
  cargando: false,
  error: null,
  aviso: null,
  moviendo: null,
  peticionDestacada: null,
  destacada: null,
  avisoDestacada: null,
  avisoSincronia: null,
};

export function reductor(prev: EstadoPanelTareas, a: AccionTareas): EstadoPanelTareas {
  switch (a.tipo) {
    case 'cargando':
      return { ...prev, cargando: true, error: null };
    case 'sincronia':
      return { ...prev, avisoSincronia: a.aviso };
    case 'cache':
      /* La foto pinta al instante pero sigue cargando (el fondo revalida):
       * la tab ya renderiza filas porque estado/columnas/tareas existen. */
      return { ...prev, cargando: true, error: null, estado: a.foto.estado, columnas: a.foto.columnas, tareas: a.foto.tareas };
    case 'cargado':
      return { ...prev, cargando: false, error: null, estado: a.estado, columnas: a.columnas, tareas: a.tareas };
    case 'fallo':
      return { ...prev, cargando: false, moviendo: null, error: a.error, aviso: null };
    case 'aviso':
      return { ...prev, aviso: a.aviso };
    case 'moviendo':
      return { ...prev, moviendo: a.clave, error: null };
    case 'movido':
      return { ...prev, moviendo: null };
    case 'optimista':
      return { ...prev, tareas: { ...prev.tareas, [a.columna]: [...(prev.tareas[a.columna] ?? []), a.tarea] } };
    case 'descartar':
      return {
        ...prev,
        tareas: { ...prev.tareas, [a.columna]: (prev.tareas[a.columna] ?? []).filter((t) => t.legacyId !== a.legacyId) },
      };
    case 'peticionDestacada':
      return { ...prev, peticionDestacada: a.peticion };
    case 'destacada':
      /* [por que se limpia la peticion aqui] Ya esta resuelta (con tarjeta o sin ella): dejarla
       * puesta volveria a resolverla en cada recarga y el destaque no se podria soltar. */
      return {
        ...prev,
        peticionDestacada: null,
        destacada: a.destino,
        avisoDestacada:
          a.destino === null
            ? `no hay tarjeta de ${a.roadmapId} en el tab (el roadmap y TASK no coinciden todavía)`
            : null,
      };
  }
}

/* Que decir de la ultima pasada, o null si no hay nada que decir. [por que no basta con el log]
 * La sincronia corre sola por detras: si TASK rechaza tareas o el roadmap queda a medias, la tab
 * seguiria pintando una lista incompleta como si fuera la buena. */
export function avisoDeSincronia(e: EstadoSincroniaTab): string | null {
  if (e.ultimoError !== null) return `sincronía: la última pasada falló (${e.ultimoError})`;
  const partes: string[] = [];
  if (e.errores.length > 0) {
    const motivos = [...new Set(e.errores.map((x) => x.motivo))].join(', ');
    partes.push(`${e.errores.length} tarea(s) sin escribir en TASK (${motivos})`);
  }
  if (e.aplazadas > 0) partes.push(`${e.aplazadas} por escribir, siguen en la pasada siguiente`);
  return partes.length === 0 ? null : `sincronía: ${partes.join(' · ')}`;
}
