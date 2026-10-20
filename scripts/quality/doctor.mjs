/* Doctor de Sentinel con el mismo CLI que ejecuta el gate del proyecto (12AA-6).
 * [por que] `sentinel` del PATH puede ser otra versión: el doctor tiene que medir el artefacto
 * que fija `quality-tools.json` (sourcePath + cli), no el que encuentre el shell. Sin ese CLI
 * falla con el motivo, en vez de caer al PATH en silencio.
 * [por que] Es análisis: corre en la VPS 89 como el resto (AGENTS §1). En el portátil solo
 * con `--local`, en emergencia, y el aviso lo dice. */
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FLAG_LOCAL, cargarTaller, decidirDonde, dirRemotoDe, ejecutarEnVps, mensajeSinVps } from '../shared/vps.mjs';

/* import.meta.dirname no existe en Node 18 (el SSH no interactivo de la 89 lo usa): se deriva de la URL. */
const raiz = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/* Dos disposiciones: el checkout compartido del área (sourcePath) y el del taller, que aprovisiona
 * cada proyecto en `_quality-tools/<proyecto>/` junto a su réplica (config.ts, dirRemotoBase). */
function cliDeSentinel() {
  const config = JSON.parse(readFileSync(join(raiz, 'quality-tools.json'), 'utf8'));
  const sentinel = config.tools?.sentinel;
  if (!sentinel) throw new Error('quality-tools.json no declara la herramienta sentinel');
  const relCli = sentinel.cli ?? 'out/cli/index.js';
  const candidatos = [
    join(resolve(raiz, sentinel.sourcePath), relCli),
    join(resolve(raiz, '..', '_quality-tools', basename(raiz), 'sentinel'), relCli),
  ];
  const cli = candidatos.find((c) => existsSync(c));
  if (cli === undefined) {
    throw new Error(`falta el CLI de sentinel (buscado en: ${candidatos.join(' | ')}): ejecuta quality:setup`);
  }
  return cli;
}

/* Los argumentos pasan tal cual al CLI (p. ej. --json), sin el flag de decisión de equipo. */
function main(argv) {
  const args = argv.filter((a) => a !== FLAG_LOCAL);
  const config = cargarTaller();
  let destino;
  try {
    destino = decidirDonde(argv, config, hostname());
  } catch (error) {
    console.error(`quality-doctor: ${error.message}`);
    return 2;
  }
  if (destino.aviso) console.error(`quality-doctor: ${destino.aviso}`);

  if (destino.donde === 'remoto') {
    /* [por que] Se reenvía este mismo script a la 89: allí `decidirDonde` da 'aqui' y mide el
     * CLI del taller sin volver a saltar. */
    const dir = dirRemotoDe(config, basename(raiz), raiz, raiz);
    const r = ejecutarEnVps(config, dir, ['node', 'scripts/quality/doctor.mjs', ...args]);
    const aviso = mensajeSinVps(r.status, config.host);
    if (aviso) console.error(`quality-doctor: ${aviso}`);
    return r.status ?? 1;
  }

  let cli;
  try {
    cli = cliDeSentinel();
  } catch (error) {
    console.error(`quality-doctor: ${error.message}`);
    return 1;
  }
  return spawnSync(process.execPath, [cli, 'doctor', ...args], { stdio: 'inherit' }).status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
