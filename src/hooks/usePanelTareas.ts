/* Hook de la tab tareas (07AA-5 F3): estado + carga + movimientos.
 * [por que] Extraido antes de nacer (leccion usePanelRepos): el componente
 * renderiza, el hook posee el reducer y los thunks. Un solo useReducer
 * (cero useState) para no rozar usestate-excesivo. Single-flight con ref:
 * nunca dos cargas ni dos reordenes concurrentes (el bulk es
 * transaccional y el doble clic duplicaria el POST).
 * [D2] El orden de las tareas se escribe en TASKS via bulk y se relee tras
 * cada movimiento (la recarga es la prueba de persistencia en la UI); el
 * orden de las COLUMNAS es presentacion WM (localStorage, sin server). */
import { useEffect, useReducer, useRef } from 'react';
import {
  construirMovimientos,
  guardarColumnasTareas,
  leerColumnasTareas,
  textoTarea,
  type TareaTab,
  type TareasEstado,
} from '../shared/tareasTab.js';
import { estadoTareas, proyectoTareas, reordenarTareas } from '../v2/tareas/apiTareas.js';

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

function movida<T>(lista: T[], de: number, a: number): T[] {
  const copia = [...lista];
  const [x] = copia.splice(de, 1);
  copia.splice(a, 0, x);
  return copia;
}

export function usePanelTareas() {
  const [s, dispatch] = useReducer(reductor, ESTADO_INICIAL);
  const enVuelo = useRef(false);
  const columnasRef = useRef<number[]>([]);

  async function cargar(columnas: number[]): Promise<void> {
    if (enVuelo.current) return;
    enVuelo.current = true;
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

  function moverColumna(legacyId: number, dir: -1 | 1): void {
    const i = columnasRef.current.indexOf(legacyId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= columnasRef.current.length) return;
    fijarColumnas(movida(columnasRef.current, i, j));
  }

  /* Reordena dentro de una columna y relee (la relectura confirma que TASKS
   * persistio el orden: sobrevive a recargas). */
  async function reordenar(columna: number, de: number, a: number): Promise<void> {
    const lista = s.tareas[columna] ?? [];
    if (enVuelo.current || de === a || !lista[de] || !lista[a]) return;
    enVuelo.current = true;
    dispatch({ tipo: 'moviendo', clave: `${columna}:${lista[de].legacyId}` });
    try {
      await reordenarTareas(construirMovimientos(movida(lista, de, a), columna));
      dispatch({ tipo: 'movido' });
      await cargar(columnasRef.current);
    } catch (err) {
      dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
    } finally {
      enVuelo.current = false;
    }
  }

  /* Mueve a la columna vecina (un solo bulk con ambas columnas: el servidor
   * lo aplica transaccional) y relee ambas. */
  async function migrar(columna: number, legacyId: number, dir: -1 | 1): Promise<void> {
    const cols = columnasRef.current;
    const j = cols.indexOf(columna) + dir;
    if (enVuelo.current || j < 0 || j >= cols.length) return;
    const destino = cols[j];
    const origen = (s.tareas[columna] ?? []).filter((t) => t.legacyId !== legacyId);
    const movil = (s.tareas[columna] ?? []).find((t) => t.legacyId === legacyId);
    if (!movil) return;
    const destLista = [...(s.tareas[destino] ?? []), movil];
    enVuelo.current = true;
    dispatch({ tipo: 'moviendo', clave: `${columna}:${legacyId}` });
    try {
      await reordenarTareas([
        ...construirMovimientos(origen, columna),
        ...construirMovimientos(destLista, destino),
      ]);
      dispatch({ tipo: 'movido' });
      await cargar(columnasRef.current);
    } catch (err) {
      dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
    } finally {
      enVuelo.current = false;
    }
  }

  return { ...s, recargar, agregarColumna, quitarColumna, moverColumna, reordenar, migrar, textoTarea };
}

export type PanelTareasApi = ReturnType<typeof usePanelTareas>;
