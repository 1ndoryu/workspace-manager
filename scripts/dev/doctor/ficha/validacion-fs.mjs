/* Validaciones de una entrada del registro que TOCAN disco (existsSync).
 * [por que] Cada bloque con E/S va entero aqui, sin partir su parte pura: el orden de
 * comprobaciones y sus mensajes deben quedar identicos al validador original. */

import { existsSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';

import { EXES_PERMITIDOS, SCRIPTS_NODO_VALIDOS } from '../base.mjs';
import { esEntradaRemota } from '../sistema/puertos/modo.mjs';

export function motivoRutaInexistente(e, rutaAbs) {
  return existsSync(rutaAbs) ? null : `registro: '${e.id}' ruta inexistente (${e.ruta})`;
}

// [por que 06AA-1] `reconstruir` = auto-reparacion declarada: si el exe del
// boton falta (p. ej. el sweep purgo el target por rama), `up` recompila
// solo con `cargo build --manifest-path` + CARGO_TARGET_DIR declarado, en
// vez de rehusar todo el mando. Manifest siempre bajo la ruta de la
// entrada (nunca fuera del area); targetDir absoluta (vive en C:\tmp por
// regla del area, nunca en el arbol). Sin `reconstruir`, el exe ausente
// sigue siendo aviso no-actuable (fail-closed por entrada).
// Devuelve el motivo del fallo; en exito deja `_manifestAbs` y `_targetDirAbs` en la entrada.
export function motivoReconstruir(e, rutaAbs) {
  if (!('reconstruir' in e)) return null;
  const r = e.reconstruir;
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return `registro: '${e.id}' reconstruir no es objeto`;
  const claveExtra = Object.keys(r).find((k) => !['manifest', 'targetDir'].includes(k));
  if (claveExtra !== undefined) return `registro: '${e.id}' reconstruir con clave desconocida '${claveExtra}'`;
  if (typeof r.manifest !== 'string' || r.manifest.length === 0) return `registro: '${e.id}' reconstruir sin manifest`;
  const manAbs = resolve(rutaAbs, r.manifest);
  if (manAbs !== rutaAbs && !manAbs.startsWith(rutaAbs + sep)) return `registro: '${e.id}' reconstruir manifest fuera de la ruta (${r.manifest})`;
  if (!existsSync(manAbs)) return `registro: '${e.id}' reconstruir manifest inexistente (${r.manifest})`;
  if (typeof r.targetDir !== 'string' || !isAbsolute(r.targetDir)) return `registro: '${e.id}' reconstruir targetDir debe ser absoluta`;
  e._manifestAbs = manAbs;
  e._targetDirAbs = normalize(r.targetDir);
  return null;
}

// [por que] El binario absoluto no necesita args (longitud 1 vale); el resto
// exige exe + args para que el `up` sepa que lanzar sin suposiciones.
// [por que 06AA-1] Exe con forma valida pero ausente + `reconstruir`
// declarado = aviso accionable (el motivo dice el remedio: `up`), no
// un "fuera de allowlist" que esconderia la causa real. Sin
// `reconstruir`, el ausente es aviso no-actuable igualmente (fail-closed
// por entrada, nunca bloqueo global).
// Recorre `boton` (argv por proyecto) y devuelve el primer motivo; deja `_exeAusente` si el exe falta.
export function motivoExes(e, rutaAbs) {
  for (const argv of e.boton) {
    const exe = argv[0].toLowerCase();
    // [por que] Binario absoluto precompilado (p. ej. pulse.exe): evita
    // `cargo run`, cuyo hijo hereda una consola visible permanente. Solo ruta
    // absoluta existente: el registro versionado ya es la lista de confianza,
    // igual que los scripts node de la allowlist.
    const esBinarioAbsoluto = /^[a-z]:[\\/]/i.test(argv[0]) && exe.endsWith('.exe') && existsSync(resolve(argv[0]));
    const esExeAbsoluto = /^[a-z]:[\\/]/i.test(argv[0]) && exe.endsWith('.exe');
    if (esExeAbsoluto && !existsSync(resolve(argv[0]))) {
      // [por que] En una ficha remota el `boton` es de este equipo y no se lanza: el exe vive en el host (`botonRemoto`). Su ausencia aquí no es deriva ni motivo de reconstruir en el portátil.
      if (esEntradaRemota(e)) continue;
      if (e._manifestAbs) {
        e._exeAusente = argv[0];
        return `registro: '${e.id}' exe ausente, reconstruible con up (${argv[0]})`;
      }
      return `registro: '${e.id}' exe inexistente (${argv[0]})`;
    }
    if (!EXES_PERMITIDOS.has(exe) && !(exe.endsWith('/node') || exe.endsWith('\\node')) && !esBinarioAbsoluto) return `registro: '${e.id}' exe fuera de allowlist (${argv[0]})`;
    if ((exe === 'node' || exe.endsWith('/node') || exe.endsWith('\\node')) && argv[1] !== '-e') {
      const nombre = argv[1].split('/').pop().split('\\').pop();
      /* Servidor compilado del propio manager: un solo proceso node (sin tsx/cli
       * hijo que pida consola). Ruta fijada exacta, no basename generico. */
      const esServidorCompilado = argv[1].replace(/\\/g, '/') === 'dist-server/server/index.js';
      if (!esServidorCompilado && !SCRIPTS_NODO_VALIDOS.has(nombre)) return `registro: '${e.id}' script node fuera de allowlist (${argv[1]})`;
      const rutaScript = resolve(rutaAbs, argv[1]);
      if (!existsSync(rutaScript)) return `registro: '${e.id}' script inexistente (${argv[1]})`;
    }
  }
  return null;
}
