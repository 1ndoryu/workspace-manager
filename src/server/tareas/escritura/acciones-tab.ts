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
import { contenidoDeItem, espejoDeItem, idRoadmapDeItem, payloadPropio } from './contenido-tarea.js';
import { completarParche } from './parche-completo.js';
import {
  borrarDelRoadmap,
  borrarSubtarea,
  cerrarEnRoadmap,
  crearEnRoadmap,
  crearSubtarea,
  editarEnRoadmap,
  editarSubtarea,
  huecoDeEtiqueta,
  reabrirEnRoadmap,
  reordenarRoadmap,
  type ProyectoRoadmap,
  type RefSubtarea,
} from './accion-roadmap.js';
import { leerDelDisco } from './escribir-roadmaps.js';
import { espejoDeAlta, espejoDeSubtarea } from './acciones-tab/espejos.js';
import type { ItemVersionado, ReordenarMovimiento } from '../nucleo/tipos.js';
import type { ParcheTarea } from '../tarea-unitaria.js';
import {
  depsRoadmap,
  fallo,
  propiedadesDeItem,
  refDeSubtarea,
  repetirSubtarea,
  resumen,
  VACIO,
  type DepsAccionesTab,
  type EscrituraTab,
  type ResultadoTab,
} from './acciones-tab/mapeo.js';

export type { DepsAccionesTab, EscrituraTab, ResultadoTab } from './acciones-tab/mapeo.js';

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

/* --- Subtareas (F4) -------------------------------------------------------------------------
 * Una subtarea de TASK es una linea sangrada bajo el bloque de su padre. [por que hay que buscar al
 * padre] El ID del roadmap lo lleva el padre: la subtarea trae el suyo en `parentId`, y sin el padre
 * no se sabe en que linea del archivo vive. Si el padre no viene del roadmap, la subtarea tampoco
 * tiene casa en el archivo. */

/* Por que no se puede convertir una raiz: su borrado se lleva el bloque entero, y con subtareas propias
 * en el archivo las perderia sin aviso. Devuelve el motivo, o null si la raiz se puede convertir. */
function motivoNoConvertir(deps: DepsAccionesTab, p: ProyectoRoadmap, idRaiz: string): string | null {
  const lectura = (deps.leerRoadmap ?? leerDelDisco)(p.ruta);
  if (lectura === null) return 'sin-roadmap';
  const t = lectura.tareas.find((x) => x.id === idRaiz);
  if (t === undefined) return 'no-esta-en-el-roadmap';
  return t.subtareas.length > 0 ? 'tiene-subtareas' : null;
}

/* Lo que hay que hacer con la subtarea que se acaba de guardar en TASK. */
async function trasGuardarSubtarea(deps: DepsAccionesTab, columna: number, item: ItemVersionado): Promise<EscrituraTab> {
  const parentId = typeof item.item.parentId === 'number' ? item.item.parentId : null;
  if (parentId === null) return VACIO;
  let p: ProyectoRoadmap | null = null;
  try {
    p = await proyectoDeColumna(deps, columna);
    if (p === null) return VACIO;
    const enTask = await deps.puente.listar(columna);
    const idPadre = idRoadmapDeItem(enTask.find((x) => x.id === parentId)?.item ?? {});
    /* El padre no viene del roadmap (una tarjeta de TASK con subtareas propias): no hay linea. */
    if (idPadre === null) return VACIO;
    const d = depsRoadmap(deps);
    const texto = typeof item.item.texto === 'string' ? item.item.texto : '';
    const conEspejo = espejoDeItem(item.item)?.sub === true;
    /* [por que] Una raiz arrastrada bajo otra llega con su espejo de tarea, no de subtarea: si se
     * escribiera como alta, el archivo tendria la tarea dos veces (la raiz y la subtarea). */
    const raiz = conEspejo ? null : idRoadmapDeItem(item.item);
    const motivo = raiz === null ? null : motivoNoConvertir(deps, p, raiz);
    if (motivo !== null) {
      return { roadmap: { accion: 'editar-sub', proyecto: p.nombre, id: raiz, linea: null, escribio: false, aviso: `no-convierte: ${motivo}` }, repetir: null };
    }

    const r = conEspejo
      ? editarSubtarea(d, p, idPadre, refDeSubtarea(item.item), {
          texto,
          propiedades: propiedadesDeItem(item.item),
          /* Marcar una subtarea no la saca del roadmap: escribe su casilla. Su padre sigue abierto,
           * y el archivo tiene que poder decir que pasos de esa tarea ya estan hechos. */
          completada: item.item.completado === true,
        })
      : texto.trim() === ''
        ? null
        : crearSubtarea(d, p, idPadre, { texto, propiedades: propiedadesDeItem(item.item), completada: item.item.completado === true });
    if (r === null) return VACIO;
    if (!r.escribio) return { roadmap: resumen(r), repetir: null };
    /* La subtarea ya esta bajo su padre: ahora se quita la linea de la raiz. Va despues para que un
     * fallo al crear la subtarea no deje la tarea sin ninguna linea. */
    if (raiz !== null) {
      const q = borrarDelRoadmap(d, p, raiz);
      if (!q.escribio) return { roadmap: resumen(q), repetir: null };
    }
    const espejo = espejoDeSubtarea(deps, p, idPadre, huecoDeEtiqueta(r.id ?? ''));
    return { roadmap: resumen(r), repetir: espejo === null ? null : repetirSubtarea(item, espejo) };
  } catch (e) {
    return { roadmap: fallo('editar-sub', p, null, e), repetir: null };
  }
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
  /* Las subtareas van dentro de su padre en el roadmap: otra linea, otro camino. */
  if (item.item.parentId !== null && item.item.parentId !== undefined) {
    return trasGuardarSubtarea(deps, columna, item);
  }
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
      /* [por que el texto del espejo y no el que se tecleo] La linea del roadmap se escribe
       * `**Titulo.**` —el punto es de la linea— y el espejo se relee del archivo. Si TASK guardara
       * el texto sin el punto, la tarea y su propio espejo dirian cosas distintas y la pasada
       * siguiente reescribiria la linea (y apuntaria un cambio de texto) sin que nadie tocara nada:
       * medido en F4, una entrada falsa por tarea creada. El texto de TASK es el del archivo. */
      return { roadmap: resumen(r), repetir: completarParche(item.item, { texto: espejo.espejo.texto, payload: { ...payloadPropio(item.item), roadmap: espejo } }) };
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
 * tiene que venir en la peticion.
 * [por que dos formas] Una subtarea y su padre no se borran igual: de la subtarea se va su linea
 * sangrada, y del padre el bloque entero. Y el espejo de una subtarea lleva el ID del padre, asi
 * que confundirlos se llevaria por delante la tarea de la que forma parte. */
export type BorradoPendiente =
  | { tipo: 'tarea'; proyecto: ProyectoRoadmap; id: string }
  | { tipo: 'subtarea'; proyecto: ProyectoRoadmap; idPadre: string; ref: RefSubtarea };

export async function prepararBorrado(
  deps: DepsAccionesTab,
  columna: number,
  legacyId: number,
): Promise<BorradoPendiente | null> {
  const p = await proyectoDeColumna(deps, columna);
  if (p === null) return null;
  const enTask = await deps.puente.listar(columna);
  const item = enTask.find((x) => x.id === legacyId)?.item;
  if (item === undefined) return null;
  const parentId = typeof item.parentId === 'number' ? item.parentId : null;
  if (parentId !== null) {
    const idPadre = idRoadmapDeItem(enTask.find((x) => x.id === parentId)?.item ?? {});
    /* Subtarea de una tarjeta que no viene del roadmap: no hay linea que borrar. */
    return idPadre === null ? null : { tipo: 'subtarea', proyecto: p, idPadre, ref: refDeSubtarea(item) };
  }
  const id = idRoadmapDeItem(item);
  /* Tarea de TASK que no viene del roadmap: no hay linea que borrar. */
  return id === null ? null : { tipo: 'tarea', proyecto: p, id };
}

/* Borrado, paso 2: quitar la linea. [por que no lanza] El borrado en TASK ya ocurrio; que el
 * archivo falle se cuenta como aviso, no se convierte en un 500 que haga creer que no se borro. */
export function confirmarBorrado(deps: DepsAccionesTab, pendiente: BorradoPendiente): ResultadoTab {
  const d = depsRoadmap(deps);
  try {
    return resumen(
      pendiente.tipo === 'tarea'
        ? borrarDelRoadmap(d, pendiente.proyecto, pendiente.id)
        : borrarSubtarea(d, pendiente.proyecto, pendiente.idPadre, pendiente.ref),
    );
  } catch (e) {
    return {
      accion: pendiente.tipo === 'tarea' ? 'borrar' : 'borrar-sub',
      proyecto: pendiente.proyecto.nombre,
      id: pendiente.tipo === 'tarea' ? pendiente.id : pendiente.idPadre,
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
      /* Las subtareas no entran (F4): su espejo lleva el ID de su padre, no uno propio, asi que
       * meterlas aqui repetiria IDs y el archivo copiaria el mismo bloque en dos huecos. El sitio
       * de una subtarea lo fija su padre. */
      const idDe = new Map(
        enTask.filter((x) => espejoDeItem(x.item)?.sub !== true).map((x) => [x.id, idRoadmapDeItem(x.item)]),
      );
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
