/* Clasificación de la vigilancia dev: sin-botón, deriva, sensor, puertos huérfanos y
 * artefactos entre proyectos. Pura: el informe del doctor llega ya leído. */
import type { Proyecto } from '../../types.js';
import type { HuerfanoDev, InformeDev } from '../../dev.js';
import type { Entrada, Problema } from './consola-tipos.js';

/* Nombre del proceso dueño de un listener, a partir del exe o, si no lo hay, de la
 * primera palabra de la linea de comandos. [por que] Un proceso elevado deja el exe
 * vacio (CIM no lo lee sin permisos) y el motivo salia como «pid 12528 (pid 12528)»:
 * el pid dos veces y ningun nombre, que es justo lo que hace falta para saber de quien
 * es el puerto. El cmd suele traerlo aunque el exe no. */
function nombreDeProceso(h: HuerfanoDev): string {
  const primera = (h.cmd ?? '').trim().match(/^"[^"]+"|\S+/)?.[0]?.replace(/^"|"$/g, '');
  const ruta = h.exe ?? primera;
  if (!ruta) return 'proceso desconocido';
  return ruta.split(/[\\/]/).pop() || ruta;
}

/* Vigilancia dev de un proyecto (F0b): sin-boton/deriva del informe del doctor
 * mas los huerfanos atribuidos a su clave. Cada estado es una entrada propia
 * en la categoria 'dev'; los huerfanos reviven la categoria 'huerfano' (estaba
 * en el union y el filtro pero problemasDe nunca la emitia). [por que] El
 * informe viaja en el store (useWorkspace.dev, servido por /api/dev/estado);
 * la consola lo deriva igual que sentinel/vulnerabilidades, sin tuberia
 * paralela. Los fallos del sensor y del fetch se pintan en la fila del propio
 * manager (fail-loud: si la vigilancia falla, se ve donde vive). */
export function problemasDevDe(
  p: Proyecto,
  dev: InformeDev | null,
  devError: string | null,
): Problema | null {
  const entradas: Entrada[] = [];
  /* [por que] `esMando` lo marca el servidor por ruta: este modulo es
   * compartido con el cliente y no puede mirar el sistema de archivos. */
  const esMando = p.esMando === true;
  if (devError && esMando) {
    entradas.push({ categoria: 'dev', motivo: `dev: vigilancia no disponible: ${devError}`, seriedad: 'error' });
  }
  const info = dev?.proyectos.find((d) => d.clave === p.clave);
  if (info?.estado === 'sin-boton') {
    entradas.push({ categoria: 'dev', motivo: `dev sin botón: ${info.motivo}`, seriedad: 'advertencia' });
  } else if (info?.estado === 'deriva') {
    entradas.push({ categoria: 'dev', motivo: `dev deriva: ${info.motivo}`, seriedad: 'error', devId: info.id });
  }
  /* [05AA-4] `parado` no entra: detenido normal, nada que ver en problemas.
   * `bajo-mando` tampoco (decisión de la usuaria, 2026-10-12: ocultarla):
   * sano y gestionado por el mando; sus botones siguen en el detalle del proyecto. */
  if (dev?.errorSensor && esMando) {
    entradas.push({ categoria: 'dev', motivo: `dev: sensor falló: ${dev.errorSensor}`, seriedad: 'error' });
  }
  for (const h of dev?.huerfanos ?? []) {
    if (h.clave !== p.clave) continue;
    const quien = nombreDeProceso(h);
    entradas.push({
      categoria: 'huerfano',
      motivo: `puerto ${h.puerto} ocupado por ${quien} (pid ${h.pid})${h.verificado ? '' : ' NO-VERIFICADO'}`,
      seriedad: 'advertencia',
    });
  }
  /* [20AA-7] Artefactos entre proyectos: esta entrada empotra el artefacto de
   * compilacion de otro y ha quedado por detras (hoy MN-Escritorio <-
   * MN-Inmobiliaria/frontend/dist dentro del .exe). Advertencia, no error: no
   * hay nada roto, hay un paso pendiente (recompilar o reinstalar). Se atribuye
   * al proyecto CONSUMIDOR, que es el que tiene algo que hacer. */
  for (const a of dev?.artefactos ?? []) {
    if (a.proyecto !== p.clave) continue;
    entradas.push({
      categoria: 'dev',
      motivo: `artefacto ${a.veredicto}: ${a.consumido} — ${a.detalle}`,
      seriedad: 'advertencia',
    });
  }
  if (entradas.length === 0) return null;
  return { p, entradas };
}

/* Huerfanos sin proyecto atribuible (clave null): grupo sintetico solo para
 * la consola. [por que] Fail-loud: un listener desconocido en el area debe
 * verse aunque ningun exe/cmd apunte a un proyecto; inventar un Proyecto real
 * mentiria, asi que este grupo NUNCA participa en seleccion ni menu (el hook
 * lo ignora por clave ''). */
export function problemaHuerfanosSinProyecto(dev: InformeDev | null): Problema | null {
  if (!dev) return null;
  const solos = dev.huerfanos.filter((h) => h.clave == null);
  if (solos.length === 0) return null;
  const entradas: Entrada[] = solos.map((h) => {
    const quien = nombreDeProceso(h);
    return {
      categoria: 'huerfano' as const,
      motivo: `puerto ${h.puerto} sin proyecto: ${quien} (pid ${h.pid})${h.verificado ? '' : ' NO-VERIFICADO'}`,
      seriedad: 'advertencia' as const,
    };
  });
  return {
    p: { id: '(puertos sin proyecto)', clave: '', ruta: '', esGit: false, tipo: 'carpeta' },
    entradas,
  };
}
