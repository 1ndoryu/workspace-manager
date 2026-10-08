/* Hook de la tab tareas (07AA-5 F3, DnD + edicion 07AA-15, columnas fijas
 * 08AA-6 + alta por modal 08AA-7 + optimista/cache 08AA-8): estado + carga
 * + movimientos.
 * [por que] Extraido antes de nacer (leccion usePanelRepos): el componente
 * renderiza, el hook posee el reducer y los thunks. Un solo useReducer
 * (cero useState) para no rozar usestate-excesivo. Cola en serie con ref
 * (08AA-8: el modal cierra al instante y dos altas rapidas ya no caben en
 * un single-flight que descarta; la segunda espera su turno en vez de
 * perderse). La carga inicial pinta la foto local y revalida en fondo
 * (stale-while-revalidate: la fresca tardaba ~4s por 18 columnas en
 * serie); las columnas se piden en paralelo y cada `cargado` refresca la
 * foto.
 * [D2] El orden de las tareas se escribe en TASKS via bulk y se relee tras
 * cada movimiento (la recarga es la prueba de persistencia en la UI); las
 * COLUMNAS son fijas del proxy (08AA-6: el servidor sincroniza WM->TASKS,
 * ni anadir ni quitar a mano). */
import { useEffect, useReducer, useRef } from 'react';
import {
  clonarCacheTareas,
  construirMovimientos,
  generarIdTarea,
  parcheConColumna,
  restaurarCacheTareas,
  textoTarea,
  type CacheTareasTab,
  type ColumnaTab,
  type ParcheTareaTab,
  type TareaTab,
  type TareasEstado,
} from '../shared/tareasTab.js';
import { guardarJson, leerJson } from '../shared/storage.js';
import {
  actualizarTarea,
  columnasTareas,
  eliminarTarea,
  estadoTareas,
  proyectoTareas,
  reordenarTareas,
} from '../v2/tareas/apiTareas.js';

interface EstadoPanelTareas {
  columnas: ColumnaTab[];
  tareas: Record<number, TareaTab[]>;
  estado: TareasEstado | null;
  cargando: boolean;
  error: string | null;
  moviendo: string | null;
}

type AccionTareas =
  | { tipo: 'cargando' }
  | { tipo: 'cache'; foto: CacheTareasTab }
  | { tipo: 'cargado'; estado: TareasEstado; columnas: ColumnaTab[]; tareas: Record<number, TareaTab[]> }
  | { tipo: 'fallo'; error: string }
  | { tipo: 'moviendo'; clave: string }
  | { tipo: 'movido' }
  | { tipo: 'optimista'; columna: number; tarea: TareaTab }
  | { tipo: 'descartar'; columna: number; legacyId: number };

const ESTADO_INICIAL: EstadoPanelTareas = {
  columnas: [],
  tareas: {},
  estado: null,
  cargando: false,
  error: null,
  moviendo: null,
};

function reductor(prev: EstadoPanelTareas, a: AccionTareas): EstadoPanelTareas {
  switch (a.tipo) {
    case 'cargando':
      return { ...prev, cargando: true, error: null };
    case 'cache':
      /* La foto pinta al instante pero sigue cargando (el fondo revalida):
       * la tab ya renderiza filas porque estado/columnas/tareas existen. */
      return { ...prev, cargando: true, error: null, estado: a.foto.estado, columnas: a.foto.columnas, tareas: a.foto.tareas };
    case 'cargado':
      return { ...prev, cargando: false, error: null, estado: a.estado, columnas: a.columnas, tareas: a.tareas };
    case 'fallo':
      return { ...prev, cargando: false, moviendo: null, error: a.error };
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
  }
}

/* Foto local (08AA-8): clave unica, lectura validada, escritura best-effort
 * (el boundary storage.ts ya traga cuota/modo-privado en silencio). */
const CLAVE_CACHE_TAREAS = 'wm.tareas.cache.v1';

function leerFoto(): CacheTareasTab | null {
  return restaurarCacheTareas(leerJson<unknown>(CLAVE_CACHE_TAREAS));
}

function guardarFoto(estado: TareasEstado, columnas: ColumnaTab[], tareas: Record<number, TareaTab[]>): void {
  guardarJson(CLAVE_CACHE_TAREAS, clonarCacheTareas(estado, columnas, tareas));
}

export function usePanelTareas() {
  const [s, dispatch] = useReducer(reductor, ESTADO_INICIAL);
  /* Cola en serie (08AA-8): cada turno espera al anterior; si uno falla, el
   * siguiente corre igual (el fallo ya quedo en `fallo` con su banner). */
  const cadena = useRef<Promise<void>>(Promise.resolve());
  const cargaEnVuelo = useRef<Promise<void> | null>(null);
  const columnasRef = useRef<ColumnaTab[]>([]);

  function encolar(trabajo: () => Promise<void>): Promise<void> {
    const turno = cadena.current.then(trabajo, trabajo);
    cadena.current = turno.catch(() => undefined);
    return turno;
  }

  /* Carga completa: estado + columnas fijas del proxy + tareas por columna
   * EN PARALELO (08AA-8: en serie tardaba ~3.1s para 18 columnas). Las
   * columnas llegan del servidor (08AA-6: ya sincronizadas WM->TASKS), asi
   * que cada recarga refleja ignorados y repos nuevos sin estado local. La
   * fresca refresca la foto local para el proximo montaje. */
  async function cargarInner(): Promise<void> {
    dispatch({ tipo: 'cargando' });
    try {
      const estado = await estadoTareas();
      const columnas = estado.disponible ? await columnasTareas() : [];
      const listas = await Promise.all(columnas.map((col) => proyectoTareas(col.legacyId)));
      const tareas: Record<number, TareaTab[]> = {};
      columnas.forEach((col, i) => {
        tareas[col.legacyId] = listas[i];
      });
      columnasRef.current = columnas;
      guardarFoto(estado, columnas, tareas);
      dispatch({ tipo: 'cargado', estado, columnas, tareas });
    } catch (err) {
      dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function cargar(): Promise<void> {
    /* Reintentar durante una carga en vuelo se adjunta a ella (no encola
     * una duplicada). */
    if (cargaEnVuelo.current) {
      await cargaEnVuelo.current.catch(() => undefined);
      return;
    }
    const turno = encolar(cargarInner);
    cargaEnVuelo.current = turno;
    try {
      await turno;
    } finally {
      if (cargaEnVuelo.current === turno) cargaEnVuelo.current = null;
    }
  }

  /* Montaje (08AA-8): la foto pinta al instante si existe; la fresca
   * revalida en fondo y la reemplaza al llegar. */
  useEffect(() => {
    const foto = leerFoto();
    if (foto) dispatch({ tipo: 'cache', foto });
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recargar(): void {
    void cargar();
  }

  /* Escritura en serie: marca la tarjeta en vuelo, ejecuta, relee todo (la
   * relectura confirma que TASKS persistio) y libera. Al fallar, corre
   * `alFallar` (08AA-8: el alta optimista descarta su tarjeta fantasma) y
   * el banner pinta el motivo. */
  async function operar(clave: string, fn: () => Promise<void>, alFallar?: () => void): Promise<void> {
    dispatch({ tipo: 'moviendo', clave });
    await encolar(async () => {
      try {
        await fn();
        dispatch({ tipo: 'movido' });
        await cargarInner();
      } catch (err) {
        alFallar?.();
        dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  /* Suelta de DnD (07AA-15): mueve legacyId de `origen` a `destino` delante
   * de `antesDe` (null = al final). Origen = destino es reorden interno;
   * el bulk cubre ambas columnas y es transaccional en el servidor. */
  async function soltar(
    origen: number,
    destino: number,
    legacyId: number,
    antesDe: number | null,
  ): Promise<void> {
    if (antesDe === legacyId) return;
    const movil = (s.tareas[origen] ?? []).find((t) => t.legacyId === legacyId);
    if (!movil) return;
    const restoOrigen = (s.tareas[origen] ?? []).filter((t) => t.legacyId !== legacyId);
    const baseDestino = origen === destino ? restoOrigen : [...(s.tareas[destino] ?? [])];
    const pos = antesDe === null ? baseDestino.length : baseDestino.findIndex((t) => t.legacyId === antesDe);
    const destinoNuevo = [...baseDestino];
    destinoNuevo.splice(pos < 0 ? baseDestino.length : pos, 0, movil);
    const movimientos =
      origen === destino
        ? construirMovimientos(destinoNuevo, origen)
        : [
            ...construirMovimientos(restoOrigen, origen),
            ...construirMovimientos(destinoNuevo, destino),
          ];
    await operar(`${destino}:${legacyId}`, () => reordenarTareas(movimientos).then(() => undefined));
  }

  /* Edicion inline del menu (07AA-15): el texto viaja siempre (F1 exige
   * `texto`) y la columna tambien como proyectoId: el PUT F1 es upsert de
   * reemplazo y sin proyectoId TASKS lo pone a null (huerfana invisible —
   * bug 2026-10-07: completar desde el menu "borraba" la tarjeta). */
  async function editar(columna: number, legacyId: number, parche: ParcheTareaTab): Promise<void> {
    await operar(`${columna}:${legacyId}`, () =>
      actualizarTarea(legacyId, parcheConColumna(columna, parche)).then(() => undefined),
    );
  }

  /* Borrado del menu (07AA-15): DELETE idempotente + relectura. */
  async function eliminar(columna: number, legacyId: number): Promise<void> {
    await operar(`${columna}:${legacyId}`, () => eliminarTarea(legacyId));
  }

  /* Alta por modal (08AA-6 PUT-upsert con id espejo-TASKS al final de la
   * columna, orden = longitud actual; 08AA-7 con prioridad/urgencia del
   * modal estilo TASKS; 08AA-8 optimista: la tarjeta se pinta al instante
   * con el mismo id que viaja en el PUT, asi la relectura la reemplaza sin
   * parpadeo; si el PUT falla, se descarta y el banner canta el motivo).
   * El texto viaja siempre (F1 lo exige) con su proyectoId (anti-huerfanas
   * 07AA-15). */
  async function crear(
    columna: ColumnaTab,
    datos: { texto: string; prioridad: string | null; urgencia: string },
  ): Promise<void> {
    const limpio = datos.texto.trim();
    if (limpio === '') return;
    const id = generarIdTarea();
    const orden = (s.tareas[columna.legacyId] ?? []).length;
    const parche = {
      texto: limpio,
      proyectoId: columna.legacyId,
      orden,
      ...(datos.prioridad === null ? {} : { prioridad: datos.prioridad }),
      ...(datos.urgencia === 'normal' ? {} : { urgencia: datos.urgencia }),
    };
    /* Fantasma con los mismos campos que el PUT (textoTarea y los chips
     * leen de `campos`, igual que la tarjeta servida). */
    const fantasma: TareaTab = {
      legacyId: id,
      orden,
      proyectoId: columna.legacyId,
      campos: { ...parche, completado: false },
    };
    dispatch({ tipo: 'optimista', columna: columna.legacyId, tarea: fantasma });
    await operar(`${columna.legacyId}:nueva`, () => actualizarTarea(id, parche).then(() => undefined), () =>
      dispatch({ tipo: 'descartar', columna: columna.legacyId, legacyId: id }),
    );
  }

  return { ...s, recargar, crear, soltar, editar, eliminar, textoTarea };
}

export type PanelTareasApi = ReturnType<typeof usePanelTareas>;
