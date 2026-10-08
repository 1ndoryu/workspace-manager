/* Hook de la tab tareas (07AA-5 F3, DnD + edicion 07AA-15): estado +
 * carga + movimientos.
 * [por que] Extraido antes de nacer (leccion usePanelRepos): el componente
 * renderiza, el hook posee el reducer y los thunks. Un solo useReducer
 * (cero useState) para no rozar usestate-excesivo. Single-flight con ref:
 * nunca dos cargas ni dos escrituras concurrentes (el bulk es
 * transaccional y el doble clic duplicaria el POST).
 * [D2] El orden de las tareas se escribe en TASKS via bulk y se relee tras
 * cada movimiento (la recarga es la prueba de persistencia en la UI); el
 * orden de las COLUMNAS es presentacion WM (localStorage, sin server). */
import { useEffect, useReducer, useRef } from 'react';
import {
  construirMovimientos,
  guardarColumnasTareas,
  leerColumnasTareas,
  parcheConColumna,
  textoTarea,
  type ParcheTareaTab,
  type TareaTab,
  type TareasEstado,
} from '../shared/tareasTab.js';
import {
  actualizarTarea,
  eliminarTarea,
  estadoTareas,
  proyectoTareas,
  reordenarTareas,
} from '../v2/tareas/apiTareas.js';

interface EstadoPanelTareas {
  columnas: number[];
  tareas: Record<number, TareaTab[]>;
  estado: TareasEstado | null;
  cargando: boolean;
  error: string | null;
  moviendo: string | null;
}

type AccionTareas =
  | { tipo: 'cargando' }
  | { tipo: 'cargado'; estado: TareasEstado; tareas: Record<number, TareaTab[]> }
  | { tipo: 'fallo'; error: string }
  | { tipo: 'moviendo'; clave: string }
  | { tipo: 'movido' }
  | { tipo: 'columnas'; columnas: number[] };

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
      return { ...prev, cargando: false, error: null, estado: a.estado, tareas: a.tareas };
    case 'fallo':
      return { ...prev, cargando: false, moviendo: null, error: a.error };
    case 'moviendo':
      return { ...prev, moviendo: a.clave, error: null };
    case 'movido':
      return { ...prev, moviendo: null };
    case 'columnas':
      return { ...prev, columnas: a.columnas };
  }
}

export function usePanelTareas() {
  const [s, dispatch] = useReducer(reductor, ESTADO_INICIAL);
  const enVuelo = useRef(false);
  const columnasRef = useRef<number[]>([]);

  /* Cuerpo de carga sin single-flight (lo envuelve cargar; operar lo
   * llama directo porque ya posee el flag: si pasara por cargar, el
   * early-return por enVuelo saltaria la relectura post-escritura y la tab
   * quedaria con el orden anterior hasta F5 — bug 2026-10-07 cazado en
   * UI viva: el bulk persistia en TASKS pero la lista no se repintaba). */
  async function cargarInner(columnas: number[]): Promise<void> {
    dispatch({ tipo: 'cargando' });
    try {
      const estado = await estadoTareas();
      const tareas: Record<number, TareaTab[]> = {};
      if (estado.disponible) {
        for (const col of columnas) tareas[col] = await proyectoTareas(col);
      }
      dispatch({ tipo: 'cargado', estado, tareas });
    } catch (err) {
      dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function cargar(columnas: number[]): Promise<void> {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      await cargarInner(columnas);
    } finally {
      enVuelo.current = false;
    }
  }

  /* Columnas iniciales una vez (localStorage o defecto seed F1). */
  useEffect(() => {
    const iniciales = leerColumnasTareas();
    columnasRef.current = iniciales;
    dispatch({ tipo: 'columnas', columnas: iniciales });
    void cargar(iniciales);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fijarColumnas(columnas: number[]): void {
    columnasRef.current = columnas;
    guardarColumnasTareas(columnas);
    dispatch({ tipo: 'columnas', columnas });
    void cargar(columnas);
  }

  function recargar(): void {
    void cargar(columnasRef.current);
  }

  function agregarColumna(legacyId: number): void {
    if (columnasRef.current.includes(legacyId)) return;
    fijarColumnas([...columnasRef.current, legacyId]);
  }

  function quitarColumna(legacyId: number): void {
    fijarColumnas(columnasRef.current.filter((c) => c !== legacyId));
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
      await cargarInner(columnasRef.current);
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

  return { ...s, recargar, agregarColumna, quitarColumna, soltar, editar, eliminar, textoTarea };
}

export type PanelTareasApi = ReturnType<typeof usePanelTareas>;
