/* Versión del manager y su changelog (2026-10-22). [por que] La usuaria no tenía forma de saber
 * si la app instalada correspondía al código de `main`: el exe se compila aparte y no llevaba
 * marca. Aquí se lee la versión de `package.json` (una sola fuente) y se explica de dónde sale;
 * el front la pinta en el nav y ofrece el changelog. */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_REPO } from '../plataforma/rutas.js';

/* Commit del código en disco. [por que con timeout y sin fallar] `git` puede tardar en un repo
 * grande y, sin él, la versión sigue siendo útil: se devuelve null y el front no compara. */
function commitLocal(): Promise<{ commit: string | null; rama: string | null; fecha: string | null }> {
  return new Promise((resolver) => {
    execFile(
      'git',
      ['log', '-1', '--format=%H%n%cI%n%D'],
      { cwd: RAIZ_REPO, timeout: 3_000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolver({ commit: null, rama: null, fecha: null });
        const [commit = '', fecha = '', refs = ''] = String(stdout).trim().split('\n');
        /* `%D` trae «HEAD -> main, origin/main»: se prefiere la rama local y se descarta `HEAD`. */
        const rama =
          refs
            .split(',')
            .map((r) => r.trim().replace(/^HEAD -> /, ''))
            .find((r) => r !== '' && !r.startsWith('origin/') && r !== 'HEAD') ?? null;
        resolver({ commit: commit.slice(0, 8) || null, rama, fecha: fecha || null });
      },
    );
  });
}

export interface InfoVersion {
  version: string;
  /* Commit del código en disco; null si no se pudo leer git. */
  commit: string | null;
  rama: string | null;
  /* Fecha del commit en disco. */
  fecha: string | null;
  /* Momento en que el backend arrancó: si es anterior al commit, el proceso en marcha va por
   * detrás del código y hay que reiniciarlo. */
  arrancadoEn: string;
}

let cache: InfoVersion | null = null;

export async function infoVersion(): Promise<InfoVersion> {
  if (cache) return cache;
  const pkg = JSON.parse(readFileSync(join(RAIZ_REPO, 'package.json'), 'utf8')) as { version?: string };
  const git = await commitLocal();
  cache = {
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    ...git,
    arrancadoEn: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  };
  return cache;
}

/* Changelog en crudo. [por que sin parser] El front lo pinta con markdown muy simple (secciones y
 * listas); inventar un AST aquí no aporta y desincroniza dos lecturas del mismo fichero. */
export function leerChangelog(): string {
  try {
    return readFileSync(join(RAIZ_REPO, 'CHANGELOG.md'), 'utf8');
  } catch {
    /* Sin fichero la ruta responde 200 con vacío: el panel lo dice, no simula contenido. */
    return '';
  }
}
