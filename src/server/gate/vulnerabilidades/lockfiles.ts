/* Localizacion de los lockfiles de un proyecto y huella de su contenido.
 * [por que] Bloque con identidad propia dentro del detector: donde estan los
 * lockfiles, con que gestor se auditan y que los invalida. Vivir aqui deja el
 * detector por debajo del limite de lineas y permite probar la deteccion sin
 * arrancar ningun audit. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Proyecto } from '../../../shared/types.js';
import type { GestorAudit } from '../auditoria-remota.js';
import { fechaLocal } from './audit/parseo.js';
import { NOMBRE_QUALITY_TOOLS } from '../../plataforma/rutas.js';

/* Carpetas donde puede vivir un lockfile: la raiz y las de primer nivel que no
 * sean vendored ni generadas (esas no son deps del proyecto: tools/,
 * .quality-tools/, .sentinel/, node_modules/, target/, dist/, build/, vendor/).
 * [por que] Antes era una lista fija con los nombres de las carpetas de nuestros
 * proyectos (`frontend`, `gui`, `frontend-v2`, `glory-rs`): en cualquier otro
 * proyecto el audit se dejaba lockfiles sin mirar, y con un nombre distinto el
 * resultado cambiaba sin avisar. Se leen las carpetas reales, sin bajar mas de
 * un nivel. */
const NO_VENDORED = new Set([
  'node_modules', 'tools', NOMBRE_QUALITY_TOOLS, '.sentinel', 'target', 'dist', 'build', 'vendor', '.git',
]);

export function carpetasDePrimerNivel(rutaProyecto: string): string[] {
  try {
    return readdirSync(rutaProyecto, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !NO_VENDORED.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export interface LockDetectado {
  /* Ruta relativa al proyecto para mostrar, p. ej. `frontend/package-lock.json`. */
  lockfile: string;
  ruta: string;
  /* Subcarpeta donde se ejecuta el audit ('' para la raiz). */
  base: string;
  gestor: GestorAudit;
}

/* Localiza TODOS los lockfile del proyecto. Por carpeta: un lockfile JS (pnpm
 * gana a npm si ambos existen) y su Cargo.lock, si lo hay. `existe` se inyecta
 * para poder probarlo sin disco. */
export function detectarLockfiles(
  rutaProyecto: string,
  existe: (ruta: string) => boolean = existsSync,
  subcarpetas: (ruta: string) => string[] = carpetasDePrimerNivel,
): LockDetectado[] {
  const hallados: LockDetectado[] = [];
  for (const base of ['', ...subcarpetas(rutaProyecto)]) {
    const hay = (file: string) => existe(join(rutaProyecto, base, file));
    const elegidos: { file: string; gestor: LockDetectado['gestor'] }[] = [];
    if (hay('pnpm-lock.yaml')) elegidos.push({ file: 'pnpm-lock.yaml', gestor: 'pnpm' });
    else if (hay('package-lock.json')) elegidos.push({ file: 'package-lock.json', gestor: 'npm' });
    if (hay('Cargo.lock')) elegidos.push({ file: 'Cargo.lock', gestor: 'cargo' });
    for (const e of elegidos) {
      hallados.push({
        lockfile: base ? `${base}/${e.file}` : e.file,
        ruta: join(rutaProyecto, base, e.file),
        base,
        gestor: e.gestor,
      });
    }
  }
  return hallados;
}

/* Hash del contenido del lockfile: si cambia (misma base que Dependabot) se
 * re-audita. [por que] La cache por cambio REAL del lockfile evita volver a
 * correr audit cada vez que se pide sin que nada haya cambiado. */
export function hashLockfile(ruta: string): string {
  try {
    return createHash('sha1').update(readFileSync(ruta)).digest('hex').slice(0, 12);
  } catch {
    return 'leer-error';
  }
}

/* Clave de frescura del proyecto: cambia si cambia cualquiera de sus lockfile,
 * el audit.toml de un crate o el dia. [por que] El HEAD no entra: audit depende
 * de los lockfile. El dia si: una excepcion vence por fecha, sin tocar archivos. */
export function frescoDe(p: Proyecto, locks: LockDetectado[]): string {
  const lockfiles = locks.map((l) => `${l.lockfile}@${hashLockfile(l.ruta)}`).join('|');
  const tomls = locks
    .filter((l) => l.gestor === 'cargo')
    .map((l) => hashLockfile(join(p.ruta, l.base, '.cargo', 'audit.toml')));
  return `${p.clave}|${fechaLocal(new Date())}|${lockfiles}|${tomls.join('|')}`;
}

