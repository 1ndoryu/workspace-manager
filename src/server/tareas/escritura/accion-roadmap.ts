/* Acciones del tab sobre el roadmap de un proyecto (20AA-10 F3b): crear, editar, cerrar, reabrir,
 * borrar y reordenar. Cada una deja copia verificada del archivo, escritura atomica y linea de
 * historial; lo que no se puede hacer vuelve como `aviso`, nunca en silencio.
 * [por que la accion manda y no el reloj] La pasada por lotes (F3a) decide quien cambio por ultima
 * vez comparando el mtime del archivo con el `updated_at` de la tarea; aqui no: la usuaria acaba de
 * pulsar en el tab y su accion es la ultima palabra. Por eso no se mira el reloj, y por eso mismo
 * lo unico que puede impedir la escritura es que el archivo no este o que falte la seccion.
 * [por que solo se toca `roadmap.md`] Es el archivo del protocolo; los completados se anotan en
 * `Agente/completados/` (D8) y nada mas se escribe dentro de un proyecto ajeno.
 * [por que el historial va aparte] `data/historial-roadmap/<proyecto>.ndjson` es del manager, no
 * del proyecto: un roadmap lleva nombres de trabajo privados y no se versiona. */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { RAIZ_REPO } from '../../plataforma/rutas.js';
import { analizarRoadmap, type PropiedadesTarea } from '../../scanner/roadmap/roadmap.js';
import { apuntarHistorial, copiaPrevia, escribirAtomico, hashTexto } from './escritura-roadmap.js';
import { aplicarPlan, diferencias, type CambioArchivo, type TareaAescribir } from './plan-archivo.js';
import { contenidoDe, textoDeTitulo, type EspejoContenido } from './contenido-tarea.js';
import { entradaCompletado, indiceCompletado, insertarTarea, quitarTarea, reordenarTareas, siguienteId } from './accion-archivo.js';
import { leerDelDisco, partir, type LecturaRoadmap } from './escribir-roadmaps.js';

/* Seccion donde aterriza una tarea creada o reabierta desde el tab: es la zona de tareas del
 * protocolo y la misma que declara el espejo de F2. */
export const SECCION_NUEVAS = 'Pendientes';

export type AccionTab = 'crear' | 'editar' | 'cerrar' | 'reabrir' | 'borrar' | 'reordenar';

/* Proyecto del workspace tal como lo necesitan las acciones: su clave de tablero y su carpeta. */
export interface ProyectoRoadmap {
  clave: string;
  nombre: string;
  ruta: string;
}

export interface ResultadoAccion {
  accion: AccionTab;
  clave: string;
  proyecto: string;
  id: string | null;
  /* Linea donde quedo la tarea (1-based), o null si la accion se la llevo o no la movio. */
  linea: number | null;
  escribio: boolean;
  copia: string | null;
  cambios: CambioArchivo[];
  /* Por que no se hizo (o que quedo a medias): lo pinta la tab. */
  aviso: string | null;
}

export interface DepsAccionRoadmap {
  raizRepo?: string;
  leerRoadmap?: (ruta: string) => LecturaRoadmap | null;
  ahora?: () => number;
}

interface Contexto {
  raizRepo: string;
  ahora: Date;
  archivo: string;
  lectura: LecturaRoadmap;
  lineas: string[];
  eol: string;
}

type Abierto = { ok: true; ctx: Contexto } | { ok: false; resultado: ResultadoAccion };

function sinEfecto(accion: AccionTab, p: ProyectoRoadmap, aviso: string, id: string | null = null): ResultadoAccion {
  return {
    accion,
    clave: p.clave,
    proyecto: p.nombre,
    id,
    linea: null,
    escribio: false,
    copia: null,
    cambios: [],
    aviso,
  };
}

function abrir(deps: DepsAccionRoadmap, p: ProyectoRoadmap, accion: AccionTab): Abierto {
  const leer = deps.leerRoadmap ?? leerDelDisco;
  const lectura = leer(p.ruta);
  if (lectura === null) return { ok: false, resultado: sinEfecto(accion, p, 'sin-roadmap: el proyecto no tiene roadmap.md') };
  const { lineas, eol } = partir(lectura.texto);
  return {
    ok: true,
    ctx: {
      raizRepo: deps.raizRepo ?? RAIZ_REPO,
      ahora: new Date((deps.ahora ?? Date.now)()),
      archivo: join(p.ruta, 'roadmap.md'),
      lectura,
      lineas,
      eol,
    },
  };
}

/* Copia, escribe y anota. [por que se reanaliza el texto nuevo] Para el historial hace falta la
 * linea en la que quedo la tarea, y solo el analisis del texto que se acaba de escribir lo sabe. */
function escribir(
  ctx: Contexto,
  p: ProyectoRoadmap,
  accion: AccionTab,
  nuevas: string[],
  cambios: CambioArchivo[],
  id: string | null,
): ResultadoAccion {
  const texto = nuevas.join(ctx.eol);
  const { ruta } = copiaPrevia(ctx.raizRepo, p.clave, ctx.archivo, ctx.lectura.texto, ctx.ahora);
  escribirAtomico(ctx.archivo, texto, hashTexto(ctx.lectura.texto));
  const linea = id === null ? null : (analizarRoadmap(texto).tareas.find((t) => t.id === id)?.linea ?? null);
  if (cambios.length > 0) {
    const at = ctx.ahora.toISOString();
    apuntarHistorial(
      ctx.raizRepo,
      p.clave,
      cambios.map((c) => ({
        at,
        tarea: c.id,
        origen: 'task' as const,
        campo: c.campo,
        antes: c.antes,
        despues: c.despues,
        sitio: linea === null ? null : `roadmap.md:${linea}`,
        autor: 'puente' as const,
      })),
    );
  }
  return { accion, clave: p.clave, proyecto: p.nombre, id, linea, escribio: true, copia: ruta, cambios, aviso: null };
}

/* Al cerrar, la tarea sale del roadmap y queda en el registro de completados del proyecto (D8).
 * [por que no es fatal] El roadmap ya esta escrito; que el registro falle se cuenta, no se esconde. */
function anotarCompletado(p: ProyectoRoadmap, id: string, texto: string, ahora: Date): string | null {
  const dia = ahora.toISOString().slice(0, 10);
  const carpeta = join(p.ruta, 'Agente', 'completados');
  const archivo = join(carpeta, `tareas-${dia}.md`);
  try {
    mkdirSync(carpeta, { recursive: true });
    const nuevo = statSync(archivo, { throwIfNoEntry: false }) === undefined;
    appendFileSync(archivo, `${nuevo ? `# Tareas completadas — ${dia}\n\n` : ''}${entradaCompletado(id, texto, ahora)}\n`, 'utf8');
    return null;
  } catch (e) {
    return `completados-no-escrito: ${e instanceof Error ? e.message : 'desconocido'}`;
  }
}

/* Busca la entrada de esa tarea en el registro de completados. Se mira de la fecha mas nueva a la
 * mas vieja porque una tarea cerrada ayer y reabierta hoy esta en el archivo de ayer. */
function buscarCompletado(p: ProyectoRoadmap, id: string): { archivo: string; linea: number; antes: string } | null {
  const carpeta = join(p.ruta, 'Agente', 'completados');
  let nombres: string[];
  try {
    nombres = readdirSync(carpeta);
  } catch {
    return null;
  }
  for (const nombre of nombres.filter((n) => /^tareas-\d{4}-\d{2}-\d{2}\.md$/u.test(n)).sort().reverse()) {
    const archivo = join(carpeta, nombre);
    const lineas = readFileSync(archivo, 'utf8').split('\n');
    const i = indiceCompletado(lineas, id);
    if (i !== null) return { archivo, linea: i + 1, antes: lineas[i] ?? '' };
  }
  return null;
}

/* Reabrir tiene que quitar la entrada del registro de completados (D8). [por que] Si se queda, el
 * registro afirma cerrada una tarea que el roadmap acaba de dar por pendiente: dos fuentes, dos
 * versiones. El rastro de la reapertura lo deja el historial, que es donde toca. */
function quitarCompletado(raizRepo: string, p: ProyectoRoadmap, id: string, ahora: Date): string | null {
  const hallada = buscarCompletado(p, id);
  if (hallada === null) return null;
  const nombre = basename(hallada.archivo);
  try {
    const lineas = readFileSync(hallada.archivo, 'utf8').split('\n');
    lineas.splice(hallada.linea - 1, 1);
    writeFileSync(hallada.archivo, lineas.join('\n'), 'utf8');
    apuntarHistorial(raizRepo, p.clave, [
      {
        at: ahora.toISOString(),
        tarea: id,
        origen: 'puente',
        campo: 'reabrir',
        antes: hallada.antes,
        despues: null,
        sitio: `Agente/completados/${nombre}:${hallada.linea}`,
        autor: 'puente' as const,
      },
    ]);
    return null;
  } catch (e) {
    return `completados-no-escrito: ${e instanceof Error ? e.message : 'desconocido'}`;
  }
}

/* Lo que se lleva por delante quitar una tarea: sus subtareas salen del archivo con ella y quedan
 * anotadas una a una, para que el historial diga que habia. */
function cambiosDeSubtareas(t: { subtareas: { titulo: string }[] }, id: string, campo: string): CambioArchivo[] {
  return t.subtareas.map((s) => ({ id, campo, antes: s.titulo, despues: null }));
}

/* Alta desde el tab. Devuelve el ID del roadmap que hay que grabar en el espejo de la tarea: el
 * puente es quien lo reparte (la tab no conoce los IDs del archivo). */
export function crearEnRoadmap(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  nueva: { texto: string; propiedades: PropiedadesTarea },
): ResultadoAccion {
  const a = abrir(deps, p, 'crear');
  if (!a.ok) return a.resultado;
  const { ctx } = a;
  const id = siguienteId(ctx.lectura.tareas.map((t) => t.id), ctx.ahora);
  const puesto = insertarTarea(ctx.lineas, { id, texto: nueva.texto, propiedades: nueva.propiedades, seccion: SECCION_NUEVAS });
  if (puesto === null) {
    return sinEfecto('crear', p, `sin-seccion-${SECCION_NUEVAS}: el roadmap no tiene esa seccion`, id);
  }
  return escribir(ctx, p, 'crear', puesto.lineas, [{ id, campo: 'crear', antes: null, despues: nueva.texto }], id);
}

/* Edicion desde el tab: se reescribe la linea del titulo y la de propiedades, y nada mas. El
 * cuerpo que hubiera debajo (subtareas y prosa) se queda donde estaba. */
export function editarEnRoadmap(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  id: string,
  objetivo: EspejoContenido,
): ResultadoAccion {
  const a = abrir(deps, p, 'editar');
  if (!a.ok) return a.resultado;
  const { ctx } = a;
  const t = ctx.lectura.tareas.find((x) => x.id === id);
  if (t === undefined) return sinEfecto('editar', p, 'no-esta-en-el-roadmap', id);
  const cambios = diferencias(contenidoDe(t.propiedades, textoDeTitulo(t.titulo)), objetivo, id);
  /* Sin diferencias no se toca el archivo: reescribirlo igual daria un mtime nuevo y la pasada
   * siguiente lo leeria como un cambio del archivo. */
  if (cambios.length === 0) return sinEfecto('editar', p, 'sin-cambios', id);
  const tarea: TareaAescribir = { t, objetivo, cambios };
  return escribir(ctx, p, 'editar', aplicarPlan(ctx.lineas, [tarea]), cambios, id);
}

export function borrarDelRoadmap(deps: DepsAccionRoadmap, p: ProyectoRoadmap, id: string): ResultadoAccion {
  const a = abrir(deps, p, 'borrar');
  if (!a.ok) return a.resultado;
  const { ctx } = a;
  const t = ctx.lectura.tareas.find((x) => x.id === id);
  if (t === undefined) return sinEfecto('borrar', p, 'no-esta-en-el-roadmap', id);
  const cambios: CambioArchivo[] = [
    { id, campo: 'borrar', antes: textoDeTitulo(t.titulo), despues: null },
    ...cambiosDeSubtareas(t, id, 'subtarea-borrada'),
  ];
  return escribir(ctx, p, 'borrar', quitarTarea(ctx.lineas, t), cambios, id);
}

/* Cerrar: la tarea sale del roadmap y entra en el registro de completados. */
export function cerrarEnRoadmap(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  id: string,
  texto: string,
): ResultadoAccion {
  const a = abrir(deps, p, 'cerrar');
  if (!a.ok) return a.resultado;
  const { ctx } = a;
  const t = ctx.lectura.tareas.find((x) => x.id === id);
  if (t === undefined) return sinEfecto('cerrar', p, 'no-esta-en-el-roadmap', id);
  const cambios: CambioArchivo[] = [
    { id, campo: 'cerrar', antes: textoDeTitulo(t.titulo), despues: null },
    ...cambiosDeSubtareas(t, id, 'subtarea-cerrada'),
  ];
  const res = escribir(ctx, p, 'cerrar', quitarTarea(ctx.lineas, t), cambios, id);
  return { ...res, aviso: anotarCompletado(p, id, texto, ctx.ahora) };
}

/* Reabrir: una tarea que se destilda en el tab vuelve al roadmap con su mismo ID. [por que] Sin
 * esto quedaria viva en TASK y ausente del archivo: invisible para el roadmap y para el espejo. */
export function reabrirEnRoadmap(
  deps: DepsAccionRoadmap,
  p: ProyectoRoadmap,
  id: string,
  texto: string,
  propiedades: PropiedadesTarea,
): ResultadoAccion {
  const a = abrir(deps, p, 'reabrir');
  if (!a.ok) return a.resultado;
  const { ctx } = a;
  if (ctx.lectura.tareas.some((t) => t.id === id)) {
    /* Ya esta pendiente en el roadmap: no hay linea que escribir. Pero si el registro de
     * completados todavia la da por cerrada, esa entrada sobra y se quita: el roadmap ya dijo que
     * esta pendiente y el registro no puede decir lo contrario. */
    const base = sinEfecto('reabrir', p, 'ya-esta-en-el-roadmap', id);
    const aviso = quitarCompletado(ctx.raizRepo, p, id, ctx.ahora);
    return aviso === null ? base : { ...base, aviso };
  }
  const puesto = insertarTarea(ctx.lineas, { id, texto, propiedades, seccion: SECCION_NUEVAS });
  if (puesto === null) {
    return sinEfecto('reabrir', p, `sin-seccion-${SECCION_NUEVAS}: el roadmap no tiene esa seccion`, id);
  }
  const res = escribir(ctx, p, 'reabrir', puesto.lineas, [{ id, campo: 'reabrir', antes: null, despues: texto }], id);
  if (!res.escribio) return res;
  /* El registro de completados se limpia despues, y solo si el roadmap quedo escrito: al reves, un
   * fallo de escritura dejaria la tarea cerrada y sin su entrada. */
  const aviso = quitarCompletado(ctx.raizRepo, p, id, ctx.ahora);
  return aviso === null ? res : { ...res, aviso };
}

/* Reordenar: los IDs en el orden que manda el tab. Solo se mueven los bloques mencionados, dentro
 * de su seccion, y la prosa de la seccion se queda donde estaba. */
export function reordenarRoadmap(deps: DepsAccionRoadmap, p: ProyectoRoadmap, ids: string[]): ResultadoAccion {
  const a = abrir(deps, p, 'reordenar');
  if (!a.ok) return a.resultado;
  const { ctx } = a;
  const nuevas = reordenarTareas(ctx.lineas, ctx.lectura.tareas, ids);
  const texto = nuevas.join(ctx.eol);
  if (texto === ctx.lectura.texto) return sinEfecto('reordenar', p, 'orden-sin-cambios');
  const antes = new Map(ctx.lectura.tareas.map((t, i) => [t.id, i + 1]));
  const despues = new Map(analizarRoadmap(texto).tareas.map((t, i) => [t.id, i + 1]));
  const cambios: CambioArchivo[] = ids
    .filter((id) => antes.has(id))
    .map((id) => ({ id, campo: 'orden', antes: String(antes.get(id)), despues: String(despues.get(id) ?? '') }));
  return escribir(ctx, p, 'reordenar', nuevas, cambios, null);
}
