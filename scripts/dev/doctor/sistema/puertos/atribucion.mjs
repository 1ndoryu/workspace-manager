/* Atribución de procesos y puertos a su proyecto: dueño de un listener (ruta, marcador o
 * auxiliar), dueño de un puerto ocupado, acción sugerida y listeners ignorados por sistema.
 * Puro: sin IO. Reexportado desde ../puertos.mjs. */

import { isAbsolute, normalize, resolve } from 'node:path';
import { RAIZ_REPO } from '../../base.mjs';
import { normalizarRuta } from '../procesos.mjs';

export function marcadorPuerto(entrada, puerto) {
  const m = entrada.expectedCmdline;
  if (!Array.isArray(m)) return m;
  const i = entrada.puertos.indexOf(puerto);
  return i >= 0 ? m[i] : m[0];
}

/* ¿El proceso pertenece al proyecto? Exe bajo la ruta del proyecto O
 * cmdline que contiene expectedCmdline (deteccion; el match EXACTO con
 * normalizacion UTC es pre-kill, F1). */
export function esDelProyecto(proc, rutaProyecto, expectedCmdline) {
  if (!proc) return false;
  const base = normalizarRuta(rutaProyecto);
  if (proc.exe && normalizarRuta(proc.exe).startsWith(base + '\\')) return true;
  // [por que] Antes solo se miraba el exe: un node lanzado desde la carpeta del
  // proyecto (ruta en cmd, exe fuera) salia ajeno (PROYECTO TASKS 4191 = falso
  // positivo). enRuta exige frontera: "area\glory" no casa con "area\glory-pulse".
  if (proc.cmd && enRuta(normalizarRuta(proc.cmd), base)) return true;
  if (proc.cmd && expectedCmdline && proc.cmd.includes(expectedCmdline)) return true;
  return false;
}


/* `base` (ya normalizada) aparece en `texto` (normalizado) seguida de fin,
 * separador, espacio o comilla: frontera de ruta, no prefijo de texto. */
export function enRuta(texto, base) {
  if (!base) return false;
  let i = texto.indexOf(base);
  while (i >= 0) {
    const siguiente = texto.charAt(i + base.length);
    if (siguiente === '' || siguiente === '\\' || siguiente === ' ' || siguiente === '"') return true;
    i = texto.indexOf(base, i + 1);
  }
  return false;
}


/* ¿El proceso es el exe instalado de un artefacto consumido (consumeArtefacto.instalado)?
 * [por que] La app instalada (proyecto-escritorio) corre fuera de la carpeta del proyecto que la
 * compila, así que el atribuidor por ruta no la reclamaba y salía como hueco «(sin proyecto)».
 * Coincidencia exacta del fichero y no de la carpeta: una carpeta entera sería una exención
 * demasiado amplia y ocultaría procesos ajenos. */
export function esAppInstalada(proc, entradas) {
  if (!proc?.exe) return false;
  const exe = normalizarRuta(proc.exe);
  for (const e of entradas) {
    const instalado = e?.consumeArtefacto?.instalado;
    if (typeof instalado === 'string' && instalado !== '' && exe === normalizarRuta(instalado)) return true;
  }
  return false;
}


/* Dueño de un listener huerfano en `puerto`: el proyecto del pool que lo
 * reclama (ruta o marcador del puerto, igual que esDelProyecto), con la ruta
 * mas larga si hay varios. null = sin dueño conocido (grupo propio).
 * [por que] Solo por ruta, un proceso lanzado fuera de la carpeta (glory-backend
 * de PROYECTO TASKS en 4190) salia sin dueño: el marcador de su puerto lo reclama. */
export function atribuirHuerfano(proc, pool, puerto) {
  let clave = null;
  let mejor = -1;
  for (const p of pool) {
    const marcador = p.entrada ? marcadorPuerto(p.entrada, puerto) : undefined;
    const base = normalizarRuta(p.ruta).length;
    if (esDelProyecto(proc, p.ruta, marcador) && base > mejor) {
      mejor = base;
      clave = p.clave;
    }
  }
  return clave;
}


/* Listener auxiliar declarado en registro.auxiliares: puerto y marcador en la
 * linea de comando. Devuelve la clave del proyecto dueno o null. Entradas con
 * aviso de registro no cuentan: su configuracion no esta validada. */
export function auxiliarDe(puerto, cmd, entradas) {
  if (!cmd) return null;
  for (const e of entradas) {
    if (e._avisoRegistro) continue;
    for (const a of e.auxiliares ?? []) {
      if (a.puerto === puerto && cmd.includes(a.marcador)) return e.id;
    }
  }
  return null;
}


/* Dueño de un puerto ocupado: primero por proceso (la ruta del proyecto que
 * declara ese puerto), luego por auxiliar declarado. null = proceso ajeno.
 * [por que] El rehusado debe nombrar a quien tiene el puerto: sin nombre el
 * operador no sabe si es un tercero o un proyecto del propio registro. */
export function duenoDePuerto(puerto, pids, procs, entradas, raiz = RAIZ_REPO) {
  for (const pid of pids) {
    const proc = procs.get(pid);
    if (!proc) continue;
    for (const e of entradas) {
      if (typeof e.ruta !== 'string' || !(e.puertos ?? []).includes(puerto)) continue;
      const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(raiz, e.ruta);
      if (esDelProyecto(proc, rutaAbs, marcadorPuerto(e, puerto))) return { id: e.id, pid, via: 'proceso' };
    }
    const aux = auxiliarDe(puerto, proc.cmd, entradas);
    if (aux) return { id: aux, pid, via: 'auxiliar' };
  }
  return null;
}


/* Siguiente acción para un puerto que no se puede dar a `id`. Nunca mata: si
 * el dueño es otro proyecto, la salida es mover un puerto (registro + .env)
 * o parar ese proyecto a propósito, no un kill del mando. */
export function accionParaPuerto(id, puerto, pids, dueno, reclamados = []) {
  if (reclamados.length) {
    return `el registro declara el puerto ${puerto} para ${[id, ...reclamados].join(' y ')}: deja un solo dueño en config/registro.json`;
  }
  if (dueno && dueno.id !== id) {
    return `lo ocupa ${dueno.id} (pid ${dueno.pid}, ${dueno.via}); no se mata. Siguiente: mueve el puerto de ${id} en config/registro.json y su PORT en .env, o para ${dueno.id} si no lo necesitas ahora`;
  }
  return `lo ocupa un proceso ajeno (pid ${pids.join(',')}); no se mata. Siguiente: cierra ese proceso o mueve el puerto de ${id} en config/registro.json`;
}

/* Listener de tercero/sistema declarado en registro.ignoradosSistema. Por exe
 * (ruta exacta), por imagen (nombre .exe, para exe ocultos sin elevar), por
 * servicio de Windows (nombre, para exe protegidos) o por pid solo cuando no
 * hay exe (System = PID 4 en Windows). */
export function esSistemaIgnorado(pid, proc, lista = [], servicio = null, puerto = null) {
  return lista.some((s) => {
    if (s.servicio) return servicio?.nombre === s.servicio;
    if (s.imagen) return typeof proc?.imagen === 'string' && proc.imagen.toLowerCase() === s.imagen.toLowerCase();
    // [por que 16AA-20] Identidad por puerto solo para un proceso ilegible: si
    // tuviera exe, el ignorado no casa y el hueco sigue siendo visible.
    if (s.puerto) return s.puerto === puerto && !proc?.exe;
    if (!s.exe) return s.pid === pid && !proc?.exe;
    if (!proc?.exe || normalizarRuta(proc.exe) !== normalizarRuta(s.exe)) return false;
    return !s.cmdContiene || (proc.cmd ?? '').includes(s.cmdContiene);
  });
}
