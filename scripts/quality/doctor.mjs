/* Doctor de Sentinel con el mismo CLI que ejecuta el gate del proyecto (12AA-6).
 * [por que] `sentinel` del PATH puede ser otra versión: el doctor tiene que medir el artefacto
 * que fija `quality-tools.json` (sourcePath + cli), no el que encuentre el shell. Sin ese CLI
 * falla con el motivo, en vez de caer al PATH en silencio. */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/* import.meta.dirname no existe en Node 18 (el SSH no interactivo de la 89 lo usa): se deriva de la URL. */
const raiz = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const config = JSON.parse(readFileSync(join(raiz, 'quality-tools.json'), 'utf8'));
const sentinel = config.tools?.sentinel;
if (!sentinel) {
  console.error('quality-tools.json no declara la herramienta sentinel');
  process.exit(1);
}

/* Dos disposiciones: el checkout compartido del área (sourcePath) y el del taller, que aprovisiona
 * cada proyecto en `_quality-tools/<proyecto>/` junto a su réplica (config.ts, dirRemotoBase). */
const relCli = sentinel.cli ?? 'out/cli/index.js';
const candidatos = [
  join(resolve(raiz, sentinel.sourcePath), relCli),
  join(resolve(raiz, '..', '_quality-tools', basename(raiz), 'sentinel'), relCli),
];
const cli = candidatos.find((c) => existsSync(c));
if (cli === undefined) {
  console.error(`falta el CLI de sentinel (buscado en: ${candidatos.join(' | ')}): ejecuta quality:setup`);
  process.exit(1);
}

/* Los argumentos del script pasan tal cual (p. ej. --json); el CLI decide su salida. */
const resultado = spawnSync(process.execPath, [cli, 'doctor', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(resultado.status ?? 1);
