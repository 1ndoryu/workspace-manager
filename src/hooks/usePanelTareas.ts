/* Hook de la tab tareas (07AA-5 F3, DnD + edicion 07AA-15, columnas fijas +
 * alta inline 08AA-6): estado + carga + movimientos.
 * [por que] Extraido antes de nacer (leccion usePanelRepos): el componente
 * renderiza, el hook posee el reducer y los thunks. Un solo useReducer
 * (cero useState) para no rozar usestate-excesivo. Single-flight con ref:
 * nunca dos cargas ni dos escrituras concurrentes (el bulk es
 * transaccional y el doble clic duplicaria el POST).
 * [D2] El orden de las tareas se escribe en TASKS via bulk y se relee tras
 * cada movimiento (la recarga es la prueba de persistencia en la UI); las
 * COLUMNAS son fijas del proxy (08AA-6: el servidor sincroniza WM->TASKS,
 * ni anadir ni quitar a mano). */
import { useEffect, useReducer, useRef } from 'react';
import {
  construirMovimientos,
  generarIdTarea,
  parcheConColumna,
  textoTarea,
  type ColumnaTab,
  type ParcheTareaTab,
  type TareaTab,
  type TareasEstado,
} from '../shared/tareasTab.js';
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
  | { tipo: 'cargado'; estado: TareasEstado; columnas: ColumnaTab[]; tareas: Record<number, TareaTab[]> }
  | { tipo: 'fallo'; error: string }
  | { tipo: 'moviendo'; clave: string }
  | { tipo: 'movido' };

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
    case 'cargado':
      return { ...prev, cargando: false, error: null, estado: a.estado, columnas: a.columnas, tareas: a.tareas };
    case 'fallo':
      return { ...prev, cargando: false, moviendo: null, error: a.error };
    case 'moviendo':
      return { ...prev, moviendo: a.clave, error: null };
    case 'movido':
      return { ...prev, moviendo: null };
  }
}

export function usePanelTareas() {
  const [s, dispatch] = useReducer(reductor, ESTADO_INICIAL);
  const enVuelo = useRef(false);
  const columnasRef = useRef<ColumnaTab[]>([]);

  /* Carga completa: estado + columnas fijas del proxy + tareas por columna.
   * Las columnas llegan del servidor (08AA-6: ya sincronizadas WM->TASKS),
   * asi que cada recarga refleja ignorados y repos nuevos sin estado local. */
  async function cargarInner(): Promise<void> {
    dispatch({ tipo: 'cargando' });
    try {
      const estado = await estadoTareas();
      const columnas = estado.disponible ? await columnasTareas() : [];
      const tareas: Record<number, TareaTab[]> = {};
      for (const col of columnas) tareas[col.legacyId] = await proyectoTareas(col.legacyId);
      columnasRef.current = columnas;
      dispatch({ tipo: 'cargado', estado, columnas, tareas });
    } catch (err) {
      dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function cargar(): Promise<void> {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      await cargarInner();
    } finally {
      enVuelo.current = false;
    }
  }

  /* Columnas fijas: una sola carga al montar (sin localStorage 08AA-6). */
  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recargar(): void {
    void cargar();
  }

  /* Escritura con single-flight: marca la tarjeta en vuelo, ejecuta,
   * relee todo (la relectura confirma que TASKS persistio) y libera. La
   * relectura usa cargarInner: con el flag en la mano, cargar rehusaria. */
  async function operar(clave: string, fn: () => Promise<void>): Promise<void> {
    if (enVuelo.current) return;
    enVuelo.current = true;
    dispatch({ tipo: 'moviendo', clave });
    try {
      await fn();
      dispatch({ tipo: 'movido' });
      await cargarInner();
    } catch (err) {
      dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
    } finally {
      enVuelo.current = false;
    }
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

  /* Alta rapida inline (08AA-6): PUT-upsert con id espejo-TASKS al final
   * de la columna (orden = longitud actual). El texto viaja siempre (F1 lo
   * exige) con su proyectoId (anti-huerfanas 07AA-15); la relectura de
   * operar confirma que TASKS persistio. */
  async function crear(columna: ColumnaTab, texto: string): Promise<void> {
    const limpio = texto.trim();
    if (limpio === '') return;
    const orden = (s.tareas[columna.legacyId] ?? []).length;
    await operar(`${columna.legacyId}:nueva`, () =>
      actualizarTarea(generarIdTarea(), { texto: limpio, proyectoId: columna.legacyId, orden }).then(
        () => undefined,
      ),
    );
  }

  return { ...s, recargar, crear, soltar, editar, eliminar, textoTarea };
}

export type PanelTareasApi = ReturnType<typeof usePanelTareas>;
