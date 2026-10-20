/* Acciones del tab sobre el roadmap (20AA-10 F3b): une lo que el puente acaba de escribir en TASK
 * con lo que le toca al archivo. Es la unica capa que conoce las dos partes.
 * [por que aqui y no en las rutas] Las rutas saben de HTTP y de validacion; emparejar la columna de
 * TASK con el proyecto del workspace, decidir que accion toca y armar el espejo del alta es
 * logica de la sincronizacion, y asi se puede probar sin levantar el servidor.
 * [por que el alta se repite] La tarea se crea primero en TASK (el ID de la tarjeta lo reparte el
 * front) y el ID del roadmap lo reparte el archivo: hasta que no se escribe la linea no se sabe
 * cual es, asi que el espejo se graba en un segundo PUT. Si ese PUT falla, la tarea se queda viva
 * sin espejo y la pasada de F2 la veria como una linea sin tarea: por eso el aviso viaja.
 * [por que hay avisos que no lo son] «sin cambios», «ya esta» y «mismo orden» significan que el
 * archivo ya decia lo que la accion pedia. Se callan para no llenar la tab de ruido; el resto
 * —falta el archivo, falta la seccion, no esta la tarea— si sube a la respuesta. */
import { type PropiedadesTarea } from '../../scanner/roadmap/roadmap.js';
import { contenidoDe, contenidoDeItem, huellaDeTarea, idRoadmapDeItem, payloadPropio, textoDeTitulo, URGENCIA_POR_DEFECTO } from './contenido-tarea.js';
import { completarParche } from './parche-completo.js';
import { leerDelDisco, type LecturaRoadmap } from './escribir-roadmaps.js';
import {
  borrarDelRoadmap,
  cerrarEnRoadmap,
  crearEnRoadmap,
  editarEnRoadmap,
  reabrirEnRoadmap,
  reordenarRoadmap,
  SECCION_NUEVAS,
  type AccionTab,
  type DepsAccionRoadmap,
  type ProyectoRoadmap,
  type ResultadoAccion,
} from './accion-roadmap.js';
import type { EspejoRoadmap } from '../espejo-roadmap.js';
import type { ItemVersionado, ReordenarMovimiento } from '../nucleo/tipos.js';
import type { PuenteTareas } from '../puente-tareas.js';
import type { ProyectoWm } from '../sincronizacion/sincronizar-tareas.js';
import type { ParcheTarea } from '../tarea-unitaria.js';

export interface DepsAccionesTab {
  /* Proyectos del workspace con su carpeta (los mismos que usa el sync). */
  proyectos: () => ProyectoWm[] | Promise<ProyectoWm[]>;
  puente: PuenteTareas;
  raizRepo?: string;
  leerRoadmap?: (ruta: string) => LecturaRoadmap | null;
  ahora?: () => number;
}

/* Lo que la tab necesita saber de la accion sobre el archivo. */
export interface ResultadoTab {
  accion: AccionTab;
  proyecto: string;
  id: string | null;
  linea: number | null;
  escribio: boolean;
  /* Solo lo que la usuaria tiene que ver: un problema, no un no-op. */
  aviso: string | null;
}

export interface EscrituraTab {
  roadmap: ResultadoTab | null;
  /* Alta: el parche entero con el que repetir el PUT para grabar el espejo. */
  repetir: ParcheTarea | null;
}

const VACIO: EscrituraTab = { roadmap: null, repetir: null };

/* Avisos de «no habia nada que hacer»: no se le cuentan a nadie. */
const BENIGNOS = new Set(['sin-cambios', 'ya-esta-en-el-roadmap', 'orden-sin-cambios']);

function aviso(r: ResultadoAccion): string | null {
  return r.aviso !== null && BENIGNOS.has(r.aviso) ? null : r.aviso;
}

function resumen(r: ResultadoAccion): ResultadoTab {
  return { accion: r.accion, proyecto: r.proyecto, id: r.id, linea: r.linea, escribio: r.escribio, aviso: aviso(r) };
}

function leer(deps: DepsAccionesTab, ruta: string): LecturaRoadmap | null {
  return (deps.leerRoadmap ?? leerDelDisco)(ruta);
}

/* Lo que se pudo romper al reflejar una escritura que en TASK ya ocurrio. [por que no se lanza] La
 * tarjeta ya esta escrita: un 500 haria creer que no se guardo nada, y el archivo quedaria
 * desincronizado sin que nadie lo sepa. */
function fallo(accion: AccionTab, proyecto: ProyectoRoadmap | null, id: string | null, e: unknown): ResultadoTab {
  return {
    accion,
    proyecto: proyecto?.nombre ?? '',
    id,
    linea: null,
    escribio: false,
    aviso: `roadmap-no-escrito: ${e instanceof Error ? e.message : 'desconocido'}`,
  };
}

/* Columna de TASK -> proyecto del workspace. [por que por `wmClave`] Es la misma llave con la que
 * el sync (08AA-6) empareja columna y repo: una columna que no nace de un repo del area no tiene
 * roadmap que tocar. */
export async function proyectoDeColumna(deps: DepsAccionesTab, columna: number): Promise<ProyectoRoadmap | null> {
  const enTask = await deps.puente.proyectos();
  const c = enTask.find((x) => x.legacyId === columna);
  const clave = c?.wmClave ?? null;
  if (clave === null || clave === '') return null;
  const proyectos = await deps.proyectos();
  return proyectos.find((p) => p.clave === clave) ?? null;
}

/* Las dependencias del tab son las del driver mas dos (`proyectos` y `puente`): se pasan tal cual,
 * que el driver solo mira las suyas. */
function depsRoadmap(deps: DepsAccionesTab): DepsAccionRoadmap {
  return deps;
}

/* Lo que TASK dice de la tarea, en propiedades del roadmap. [por que la urgencia normal no se
 * escribe] Es el valor por defecto de TASK: una tarea que nadie toco no dice «normal», no dice
 * nada, y escribirselo llenaria de ruido todas las lineas nuevas. */
function propiedadesDeItem(item: Record<string, unknown>): PropiedadesTarea {
  const p: PropiedadesTarea = {};
  if (typeof item.prioridad === 'string' && item.prioridad !== '') p.prioridad = item.prioridad;
  if (typeof item.urgencia === 'string' && item.urgencia !== '' && item.urgencia !== URGENCIA_POR_DEFECTO) {
    p.urgencia = item.urgencia;
  }
  return p;
}

/* El espejo de una tarea que acaba de nacer en el archivo. [por que se relee el archivo] La huella
 * tiene que ser la de la linea tal como quedo escrita, no la que creiamos escribir: si el texto
 * llevaba punto o el titulo se recorto, la huella de la tarea y la de TASK tienen que coincidir o
 * la pasada siguiente la reescribiria otra vez. */
function espejoDeAlta(deps: DepsAccionesTab, p: ProyectoRoadmap, id: string): EspejoRoadmap | null {
  const lectura = leer(deps, p.ruta);
  if (lectura === null) return null;
  const t = lectura.tareas.find((x) => x.id === id);
  if (t === undefined) return null;
  return {
    id,
    proyecto: p.clave,
    archivo: 'roadmap.md',
    seccion: SECCION_NUEVAS,
    huella: huellaDeTarea(t),
    escritoEn: new Date((deps.ahora ?? Date.now)()).toISOString(),
    mtimeArchivo: lectura.mtimeMs === null ? null : new Date(lectura.mtimeMs).toISOString(),
    espejo: contenidoDe(t.propiedades, textoDeTitulo(t.titulo)),
  };
}

/* Despues de un PUT en TASK: alta, cierre, reapertura o edicion. El parche dice que se toco; el
 * item, que quedo guardado. [por que `completado` manda] El front solo lo manda cuando la usuaria
 * marco o desmarco la casilla, asi que su presencia es la intencion; su valor, cual de las dos. */
export async function trasGuardar(
  deps: DepsAccionesTab,
  columna: number,
  item: ItemVersionado,
  parche: ParcheTarea,
): Promise<EscrituraTab> {
  /* Las subtareas van dentro de su padre en el roadmap (F4): mientras no se escriban, una
   * subtarea de TASK no tiene linea propia que tocar. */
  if (item.item.parentId !== null && item.item.parentId !== undefined) return VACIO;
  const id = idRoadmapDeItem(item.item);
  let p: ProyectoRoadmap | null = null;
  try {
    p = await proyectoDeColumna(deps, columna);
    if (p === null) return VACIO;
    const d = depsRoadmap(deps);
    const texto = typeof item.item.texto === 'string' ? item.item.texto : id ?? '';

    if (id === null) {
      if (texto.trim() === '') return VACIO;
      const r = crearEnRoadmap(d, p, { texto, propiedades: propiedadesDeItem(item.item) });
      if (!r.escribio || r.id === null) return { roadmap: resumen(r), repetir: null };
      const espejo = espejoDeAlta(deps, p, r.id);
      if (espejo === null) {
        /* La linea se escribio y no se encuentra: el espejo no se puede inventar. */
        return { roadmap: { ...resumen(r), aviso: 'espejo-no-armado: la tarea nueva no aparece al releer el roadmap' }, repetir: null };
      }
      return { roadmap: resumen(r), repetir: completarParche(item.item, { texto, payload: { ...payloadPropio(item.item), roadmap: espejo } }) };
    }

    if (parche.completado === true) return { roadmap: resumen(cerrarEnRoadmap(d, p, id, texto)), repetir: null };
    if (parche.completado === false) return { roadmap: resumen(reabrirEnRoadmap(d, p, id, texto, propiedadesDeItem(item.item))), repetir: null };
    return { roadmap: resumen(editarEnRoadmap(d, p, id, contenidoDeItem(item.item))), repetir: null };
  } catch (e) {
    return { roadmap: fallo(parche.completado === true ? 'cerrar' : parche.completado === false ? 'reabrir' : id === null ? 'crear' : 'editar', p, id, e), repetir: null };
  }
}

/* Borrado, paso 1: averiguar que linea del roadmap hay que quitar. Va antes del DELETE porque
 * despues la tarea ya no esta y no hay nada que leer; TASK no tiene GET por id, asi que la columna
 * tiene que venir en la peticion. */
export interface BorradoPendiente {
  proyecto: ProyectoRoadmap;
  id: string;
}

export async function prepararBorrado(
  deps: DepsAccionesTab,
  columna: number,
  legacyId: number,
): Promise<BorradoPendiente | null> {
  const p = await proyectoDeColumna(deps, columna);
  if (p === null) return null;
  const item = (await deps.puente.listar(columna)).find((x) => x.id === legacyId)?.item;
  if (item === undefined) return null;
  const id = idRoadmapDeItem(item);
  /* Tarea de TASK que no viene del roadmap: no hay linea que borrar. */
  return id === null ? null : { proyecto: p, id };
}

/* Borrado, paso 2: quitar la linea. [por que no lanza] El borrado en TASK ya ocurrio; que el
 * archivo falle se cuenta como aviso, no se convierte en un 500 que haga creer que no se borro. */
export function confirmarBorrado(deps: DepsAccionesTab, pendiente: BorradoPendiente): ResultadoTab {
  try {
    return resumen(borrarDelRoadmap(depsRoadmap(deps), pendiente.proyecto, pendiente.id));
  } catch (e) {
    return {
      accion: 'borrar',
      proyecto: pendiente.proyecto.nombre,
      id: pendiente.id,
      linea: null,
      escribio: false,
      aviso: `roadmap-no-escrito: ${e instanceof Error ? e.message : 'desconocido'}`,
    };
  }
}

/* Despues de un reorden en TASK: el mismo orden en el archivo. [por que por columna] El lote puede
 * traer dos (un arrastre entre columnas) y cada una tiene su roadmap; el orden de los ids es el que
 * manda el tab, y las tareas que no vienen del roadmap se quedan donde estaban. */
export async function trasReordenar(deps: DepsAccionesTab, movimientos: ReordenarMovimiento[]): Promise<ResultadoTab[]> {
  const porColumna = new Map<number, ReordenarMovimiento[]>();
  for (const m of movimientos) {
    if (typeof m.proyectoId !== 'number') continue;
    const lista = porColumna.get(m.proyectoId);
    if (lista === undefined) porColumna.set(m.proyectoId, [m]);
    else lista.push(m);
  }
  const hechas: ResultadoTab[] = [];
  for (const [columna, movs] of porColumna) {
    let p: ProyectoRoadmap | null = null;
    try {
      p = await proyectoDeColumna(deps, columna);
      if (p === null) continue;
      const enTask = await deps.puente.listar(columna);
      const idDe = new Map(enTask.map((x) => [x.id, idRoadmapDeItem(x.item)]));
      const ids = [...movs]
        .sort((a, b) => a.orden - b.orden)
        .map((m) => idDe.get(m.legacyId) ?? null)
        .filter((x): x is string => x !== null);
      /* Con una sola linea no hay orden que cambiar: el archivo se quedaria igual. */
      if (ids.length < 2) continue;
      hechas.push(resumen(reordenarRoadmap(depsRoadmap(deps), p, ids)));
    } catch (e) {
      hechas.push(fallo('reordenar', p, null, e));
    }
  }
  return hechas;
}
