/* Base de las acciones del tab sobre el roadmap (20AA-10 F3b): tipos, apertura del archivo y escritura
 * con copia verificada, historial y situado. La usan accion-roadmap (tareas) y accion-subtareas (F4).
 * [por que aparte] accion-roadmap pasaba de las 300 lineas del gate; esta parte no depende de ninguna
 * accion concreta y puede vivir sola. */
import { join } from 'node:path';
import { RAIZ_REPO } from '../../plataforma/rutas.js';
import { analizarRoadmap, type AnalisisRoadmap } from '../../scanner/roadmap/roadmap.js';
import { apuntarHistorial, copiaPrevia, escribirAtomico, hashTexto } from './escritura-roadmap.js';
import { type CambioArchivo } from './plan-archivo.js';
import { leerDelDisco, partir, type LecturaRoadmap } from './escribir-roadmaps.js';

export type AccionTab = 'crear' | 'editar' | 'cerrar' | 'reabrir' | 'borrar' | 'reordenar' | 'crear-sub' | 'editar-sub' | 'borrar-sub';

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

export interface Contexto {
  raizRepo: string;
  ahora: Date;
  archivo: string;
  lectura: LecturaRoadmap;
  lineas: string[];
  eol: string;
}

export type Abierto = { ok: true; ctx: Contexto } | { ok: false; resultado: ResultadoAccion };

export function sinEfecto(accion: AccionTab, p: ProyectoRoadmap, aviso: string, id: string | null = null): ResultadoAccion {
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

export function abrir(deps: DepsAccionRoadmap, p: ProyectoRoadmap, accion: AccionTab): Abierto {
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
 * linea en la que quedo la tarea, y solo el analisis del texto que se acaba de escribir lo sabe.
 * [por que `situar`] Una subtarea no tiene ID con el que buscarse en el analisis: quien la escribe
 * sabe donde la dejo y lo dice aqui. */
export function escribir(
  ctx: Contexto,
  p: ProyectoRoadmap,
  accion: AccionTab,
  nuevas: string[],
  cambios: CambioArchivo[],
  id: string | null,
  situar?: (a: AnalisisRoadmap) => number | null,
): ResultadoAccion {
  const texto = nuevas.join(ctx.eol);
  const { ruta } = copiaPrevia(ctx.raizRepo, p.clave, ctx.archivo, ctx.lectura.texto, ctx.ahora);
  escribirAtomico(ctx.archivo, texto, hashTexto(ctx.lectura.texto));
  const analisis = analizarRoadmap(texto);
  const linea =
    id === null ? null : (situar?.(analisis) ?? analisis.tareas.find((t) => t.id === id)?.linea ?? null);
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
