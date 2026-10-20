/* Hook de la tab tareas (07AA-5 F3, DnD + edicion 07AA-15, columnas fijas
 * 08AA-6 + alta por modal 08AA-7 + optimista/cache 08AA-8): estado + carga
 * + movimientos.
 * [por que] Extraido antes de nacer (leccion usePanelRepos): el componente
 * renderiza, el hook posee los efectos, la cola y las llamadas. El reductor y
 * el estado viven en panelTareasEstado.ts (sin IO). La carga inicial pinta la
 * foto local y revalida en fondo (stale-while-revalidate: la fresca tardaba ~4s
 * por 18 columnas en serie); las columnas se piden en paralelo y cada `cargado`
 * refresca la foto.
 * [D2] El orden de las tareas se escribe en TASKS via bulk y se relee tras
 * cada movimiento (la recarga es la prueba de persistencia en la UI); las
 * COLUMNAS son fijas del proxy (08AA-6: el servidor sincroniza WM->TASKS,
 * ni anadir ni quitar a mano). */
import { useEffect, useReducer, useRef } from 'react';
import {
  arbolDeTareas,
  clonarCacheTareas,
  construirMovimientos,
  esSubtarea,
  generarIdTarea,
  parcheConColumna,
  restaurarCacheTareas,
  textoTarea,
  type CacheTareasTab,
  type ColumnaTab,
  type ParcheTareaTab,
  type TareaTab,
  type TareasEstado,
} from '../shared/tareas/tareasTab.js';
import { guardarJson, leerJson } from '../shared/vista/storage.js';
import {
  actualizarTarea,
  columnasTareas,
  eliminarTarea,
  estadoSincroniaTareas,
  estadoTareas,
  proyectoTareas,
  reordenarTareas,
} from '../v2/tareas/apiTareas.js';
import { ESTADO_INICIAL, avisoDeSincronia, reductor } from './tareas/panelTareasEstado.js';

/* Foto local (08AA-8): clave unica, lectura validada, escritura best-effort
 * (el boundary storage.ts ya traga cuota/modo-privado en silencio). */
const CLAVE_CACHE_TAREAS = 'wm.tareas.cache.v1';

/* Auto-recuperacion (19AA-15). [por que] El tunel del taller hacia TASKS se cae
 * solo y el servidor lo reabre por su cuenta (supervisor de tuneles): sin esto
 * la tab se quedaba en «no disponible» hasta que alguien pulsara reintentar a
 * mano, aunque el tunel ya estuviera de vuelta. La espera es mas larga que el
 * breaker del puente (30 s) para no gastar peticiones en balde. */
const REINTENTO_MS = 15_000;

/* Cada cuanto se pregunta por la ultima pasada de la sincronia (20AA-10 F6). No hace falta mas
 * fino: lo que se pinta es un estado, no el progreso; con trabajo aplazado las pasadas van cada
 * 1,5 s y en un sondeo ya se ve el final. */
const SONDEO_SINCRONIA_MS = 10_000;

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

  /* Mientras el puente no este disponible, se reintenta solo (19AA-15). Se para
   * en cuanto vuelve: el estado sigue pintado durante el reintento, asi que no
   * hay parpadeo (el reductor de 'cargando' no borra `estado`). */
  const noDisponible = s.estado !== null && !s.estado.disponible;
  useEffect(() => {
    if (!noDisponible) return undefined;
    const id = setInterval(() => void cargar(), REINTENTO_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noDisponible]);

  /* Sondeo de la sincronia de fondo (20AA-10 F6). Va en su propio efecto, sin depender de la
   * carga: la sincronia corre por detras del escaneo y de los gestos, y su estado puede cambiar
   * sin que la tab haya recargado nada. Un fallo del sondeo no se pinta: la tab ya tiene su
   * `error` para lo que le impide funcionar, y quedarse sin la noticia de la sincronia no es eso. */
  useEffect(() => {
    let vivo = true;
    const mirar = async (): Promise<void> => {
      try {
        const e = await estadoSincroniaTareas();
        if (vivo) dispatch({ tipo: 'sincronia', aviso: e.activa ? avisoDeSincronia(e) : null });
      } catch {
        /* Sin noticia: se queda el ultimo aviso, que es lo que se sabia. */
      }
    };
    void mirar();
    const id = setInterval(() => void mirar(), SONDEO_SINCRONIA_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  /* Escritura en serie: marca la tarjeta en vuelo, ejecuta, relee todo (la
   * relectura confirma que TASKS persistio) y libera. Al fallar, corre
   * `alFallar` (08AA-8: el alta optimista descarta su tarjeta fantasma) y
   * el banner pinta el motivo. */
  async function operar(clave: string, fn: () => Promise<string | null>, alFallar?: () => void): Promise<void> {
    dispatch({ tipo: 'moviendo', clave });
    await encolar(async () => {
      try {
        const aviso = await fn();
        dispatch({ tipo: 'movido' });
        dispatch({ tipo: 'aviso', aviso });
        await cargarInner();
      } catch (err) {
        alFallar?.();
        dispatch({ tipo: 'fallo', error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  /* Suelta de DnD (07AA-15): mueve legacyId de `origen` a `destino` delante
   * de `antesDe` (null = al final). Origen = destino es reorden interno;
   * el bulk cubre ambas columnas y es transaccional en el servidor.
   * [por que solo raices] Lo que se arrastra y lo que el archivo ordena son las tareas raiz: una
   * subtarea no tiene linea propia que mover (vive dentro del bloque de su padre) y colarla en el
   * lote le daria un `orden` que no le toca. */
  async function soltar(
    origen: number,
    destino: number,
    legacyId: number,
    antesDe: number | null,
  ): Promise<void> {
    if (antesDe === legacyId) return;
    const raices = (columna: number): TareaTab[] => (s.tareas[columna] ?? []).filter((t) => !esSubtarea(t));
    const movil = raices(origen).find((t) => t.legacyId === legacyId);
    if (!movil) return;
    const restoOrigen = raices(origen).filter((t) => t.legacyId !== legacyId);
    const baseDestino = origen === destino ? restoOrigen : raices(destino);
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
    await operar(`${destino}:${legacyId}`, () => reordenarTareas(movimientos).then((r) => r.aviso));
  }

  /* Edicion inline del menu (07AA-15): el texto viaja siempre (F1 exige
   * `texto`) y la columna tambien como proyectoId: el PUT F1 es upsert de
   * reemplazo y sin proyectoId TASKS lo pone a null (huerfana invisible —
   * bug 2026-10-07: completar desde el menu "borraba" la tarjeta). */
  async function editar(columna: number, legacyId: number, parche: ParcheTareaTab): Promise<void> {
    await operar(`${columna}:${legacyId}`, () =>
      actualizarTarea(legacyId, parcheConColumna(columna, parche)).then((r) => r.aviso),
    );
  }

  /* Borrado del menu (07AA-15): DELETE idempotente + relectura. La columna viaja al proxy porque
   * el roadmap se toca por tarea y linea (20AA-10 F3b). */
  async function eliminar(columna: number, legacyId: number): Promise<void> {
    await operar(`${columna}:${legacyId}`, () => eliminarTarea(columna, legacyId));
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
    /* El orden es el de las raices: las subtareas viven dentro de su padre y no ocupan posicion
     * en la lista (20AA-10 F4). */
    const orden = arbolDeTareas(s.tareas[columna.legacyId] ?? []).length;
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
    await operar(`${columna.legacyId}:nueva`, () => actualizarTarea(id, parche).then((r) => r.aviso), () =>
      dispatch({ tipo: 'descartar', columna: columna.legacyId, legacyId: id }),
    );
  }

  /* Alta de una subtarea bajo una tarjeta (20AA-10 F4): mismo PUT-upsert que el alta, con
   * `parentId` y su orden entre las hermanas. [por que optimista igual] La relectura de la columna
   * la reemplaza con la misma id, asi que la subtarea no parpadea; si el PUT falla, se descarta. */
  async function crearSubtarea(columna: ColumnaTab, padre: TareaTab, texto: string): Promise<void> {
    const limpio = texto.trim();
    if (limpio === '') return;
    const id = generarIdTarea();
    const orden = (s.tareas[columna.legacyId] ?? []).filter((t) => t.campos.parentId === padre.legacyId).length;
    const parche: ParcheTareaTab = {
      texto: limpio,
      proyectoId: columna.legacyId,
      parentId: padre.legacyId,
      orden,
    };
    const fantasma: TareaTab = {
      legacyId: id,
      orden,
      proyectoId: columna.legacyId,
      campos: { ...parche, completado: false },
    };
    dispatch({ tipo: 'optimista', columna: columna.legacyId, tarea: fantasma });
    await operar(`${columna.legacyId}:subtarea`, () => actualizarTarea(id, parche).then((r) => r.aviso), () =>
      dispatch({ tipo: 'descartar', columna: columna.legacyId, legacyId: id }),
    );
  }

  return { ...s, recargar, crear, crearSubtarea, soltar, editar, eliminar, textoTarea };
}

export type PanelTareasApi = ReturnType<typeof usePanelTareas>;
