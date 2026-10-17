/* Resolucion del ejecutable a lanzar: where, node propio y rutas directas. */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve } from 'node:path';

/* Resuelve el exe del launcher sin shell: `where` + comprobacion de nombre.
 * npm es .cmd (no ejecutable por CreateProcess): se baja a node +
 * npm-cli.js hermano; cargo/node son exes reales y se lanzan directos. */
export function resolverExe(exeNombre) {
  // [por que] `where npm` puede devolver primero un `npm` sin extension
  // (shim de Git/MSYS u otro en PATH) antes que `npm.cmd`: caso real
  // 2026-10-01 (`up PROYECTO TASKS` rehusado por resolver). Se recorre la
  // lista y se elige el primer candidato existente con el nombre esperado,
  // no a ciegas el primero.
  const esperado = { npm: 'npm.cmd', cargo: 'cargo.exe', node: 'node.exe' }[exeNombre.toLowerCase()];
  return new Promise((resolveP, rejectP) => {
    execFile('where.exe', [exeNombre], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) {
        rejectP(new Error(`exe '${exeNombre}' no resuelto por where`));
        return;
      }
      const candidatos = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const elegido = esperado
        ? candidatos.find((c) => c.split('\\').pop().toLowerCase() === esperado && existsSync(c))
        : candidatos.find((c) => existsSync(c));
      if (!elegido) {
        rejectP(new Error(`exe '${exeNombre}' sin candidato existente (${candidatos.slice(0, 3).join('; ') || 'vacio'})`));
        return;
      }
      const pedido = exeNombre.toLowerCase();
      if (pedido === 'npm') {
        const dir = elegido.slice(0, -'npm.cmd'.length);
        const cli = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (!existsSync(cli)) {
          rejectP(new Error('npm-cli.js no encontrado junto a npm.cmd'));
          return;
        }
        const nodo = String(execFileSyncNode()).trim();
        resolveP({ exe: nodo, prefijo: [cli] });
        return;
      }
      resolveP({ exe: elegido, prefijo: [] });
    });
  });
}


function execFileSyncNode() {
  // [por que] where es async; node para npm-cli se resuelve sync una vez.
  // Si where falla aqui, el error ya salio por el camino async de npm.
  const sal = execFileSync('where.exe', ['node'], { timeout: 10_000, windowsHide: true });
  const primero = String(sal).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
  if (!primero || !existsSync(primero)) throw new Error('node no resuelto por where');
  return primero;
}


/* Resuelve `npm run <script>` al js final lanzado con node, sin pasar por
 * npm/cmd. [por que] `windowsHide:true` oculta al hijo directo, pero npm
 * ejecuta el script via `cmd.exe /d /s /c`: el NIETO cmd hereda "sin
 * consola" (detached) y Windows le crea una ventana VISIBLE nueva; al
 * cerrarla muere la app (caso real 2026-10-05: vite 5175). Lanzar el js
 * final con node evita cmd y no abre nada. Fallback: null (=npm original). */
export function resolverDirecto(rutaAbs, argv) {
  if (argv.length < 3) return null;
  if (String(argv[0]).toLowerCase() !== 'npm') return null;
  const sub = String(argv[1]).toLowerCase();
  if (sub !== 'run' && sub !== 'run-script') return null;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(rutaAbs, 'package.json'), 'utf8'));
  } catch (e) {
    return null;
  }
  const linea = pkg?.scripts?.[argv[2]];
  if (typeof linea !== 'string' || !linea.trim()) return null;
  const toks = linea.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (!toks.length) return null;
  const sinComillas = (t) => String(t).replace(/^["']|["']$/g, '');
  const primero = sinComillas(toks[0]);
  const argsScript = toks.slice(1).map(sinComillas);
  const resto = argv.slice(3).filter((t) => t !== '--');
  let jsReal;
  if (/\.m?c?js$/.test(primero)) {
    jsReal = isAbsolute(primero) ? normalize(primero) : resolve(rutaAbs, primero);
    if (!existsSync(jsReal)) return null;
  } else {
    const partes = primero.split('/');
    const dirPkg = join(rutaAbs, 'node_modules', ...partes);
    const claveBin = partes[partes.length - 1];
    if (!existsSync(join(rutaAbs, 'node_modules', '.bin', claveBin)) &&
        !existsSync(join(rutaAbs, 'node_modules', '.bin', `${claveBin}.cmd`))) return null;
    let pkgBin;
    try {
      pkgBin = JSON.parse(readFileSync(join(dirPkg, 'package.json'), 'utf8'));
    } catch (e) {
      return null;
    }
    const campo = pkgBin?.bin;
    const rel = typeof campo === 'string' ? campo : campo?.[claveBin];
    if (typeof rel !== 'string') return null;
    jsReal = resolve(dirPkg, rel);
    if (!existsSync(jsReal)) return null;
  }
  return [process.execPath, jsReal, ...argsScript, ...resto];
}

