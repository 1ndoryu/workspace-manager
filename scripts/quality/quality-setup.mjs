/* quality:setup — genera la evidencia release real de los analyzers.
 *
 * IMPLEMENTACIÓN ÚNICA del área (109A-9). Los `scripts/quality/quality-setup.mjs`
 * de cada consumidor son ROUTERS sin lógica que delegan aquí; no copies este
 * archivo a un proyecto: un fix tiene que aplicarse una vez, no nueve.
 * Ver `AGENTS.md` §6 y la skill `quality-gate-setup`.
 *
 * Para cada tool declarada en `quality-tools.json` verifica que el checkout de
 * `sourcePath` esté en el commit fijado y limpio, y después:
 *   - REUTILIZA la certificación de `(tool, commit, buildScript, testScript,
 *     plataforma, runtime)` si ya existe (ver `certificacion.mjs`) y el CLI
 *     provisionado está presente; o
 *   - compila (`buildScript`) y corre la suite (`testScript`) en ese checkout, y
 *     registra la certificación para el resto de consumidores del mismo commit.
 * En ambos casos escribe `.sentinel/release-evidence/<tool>.json`: la evidencia
 * es el registro LOCAL de un hecho global, y declara su `origen` para que un
 * ahorro nunca sea indistinguible de un gate que no corrió.
 *
 * Nunca fabrica evidencia: ante cualquier fallo no escribe el archivo y sale con
 * error claro (1 = fallo de build/suite/staging, 2 = error de configuración).
 *
 * Uso: node quality-setup.mjs [--refresh] [--no-cache] [--workspace <dir>]
 *   --refresh   ignora la caché y re-ejecuta compile+suite (actualiza la entrada)
 *   --no-cache  ni lee ni escribe la caché (comportamiento anterior a 109A-9)
 *   --workspace directorio del consumidor (por defecto el cwd)
 * Variables: GLORY_CERT_REFRESH=1, GLORY_CERT_DISABLE=1, GLORY_CERT_CACHE=<dir>
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describirClave,
  directorioCertificaciones,
  escribirCertificacion,
  leerCertificacion,
} from './certificacion.mjs';

const argv = process.argv.slice(2);

function valorDe(flag) {
  const indice = argv.indexOf(flag);
  return indice >= 0 && argv[indice + 1] ? argv[indice + 1] : null;
}

const workspace = path.resolve(valorDe('--workspace') ?? process.cwd());
const refrescar = argv.includes('--refresh') || process.env.GLORY_CERT_REFRESH === '1';
const cacheActiva = !argv.includes('--no-cache') && process.env.GLORY_CERT_DISABLE !== '1';

function run(cmd, args, cwd, label) {
  // En Windows `npm` es un shim (npm.cmd): spawnSync solo lo ejecuta con shell.
  const result = spawnSync([cmd, ...args].join(' '), { cwd, stdio: 'inherit', windowsHide: true, shell: true });
  if (result.error) {
    process.stderr.write(`[quality:setup] no se pudo ejecutar ${label}: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.status !== 0) {
    process.stderr.write(`[quality:setup] ${label} falló (exit ${result.status}); no se escribe evidencia\n`);
    process.exit(1);
  }
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

/* Ruta del CLI provisionado declarado por el manifiesto (misma resolución que
 * el lock-generator: `provisionPath` + `cli`). Null si no se declara. */
function rutaCli(proyecto, config) {
  if (typeof config.cli !== 'string' || !config.cli) return null;
  return path.join(path.resolve(proyecto, config.provisionPath ?? '.quality-tools'), config.cli);
}

/* Fallo explícito antes que un stack de ENOENT: el adapter se ejecuta desde cada
 * consumidor y una ruta equivocada debe decir qué falta y cómo arreglarlo. */
const rutaManifiesto = path.join(workspace, 'quality-tools.json');
if (!fs.existsSync(rutaManifiesto)) {
  process.stderr.write(`[quality:setup] falta ${rutaManifiesto}\n`);
  process.stderr.write('[quality:setup] ejecuta desde la raíz del consumidor o pasa --workspace <proyecto>\n');
  process.exit(2);
}
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8'));
} catch (error) {
  process.stderr.write(`[quality:setup] ${rutaManifiesto} no es JSON válido: ${error.message}\n`);
  process.exit(2);
}
const tools = manifest?.tools;
if (!tools || typeof tools !== 'object') {
  process.stderr.write('[quality:setup] quality-tools.json sin sección tools\n');
  process.exit(2);
}

const evidenceDir = path.join(workspace, '.sentinel', 'release-evidence');

process.stdout.write(`[quality:setup] adapter compartido: ${fileURLToPath(import.meta.url)}\n`);
process.stdout.write(
  `[quality:setup] workspace ${workspace} · caché ${cacheActiva ? (refrescar ? 'ignorada (--refresh)' : directorioCertificaciones()) : 'desactivada'}\n`,
);

let reutilizadas = 0;
let ejecutadas = 0;

for (const [name, config] of Object.entries(tools)) {
  const source = path.resolve(workspace, config.sourcePath);
  const commit = config.commit;
  const buildScript = config.buildScript;
  const testScript = config.testScript;
  const clave = {
    tool: name,
    commit,
    buildScript: buildScript ?? null,
    testScript: testScript ?? null,
    platform: process.platform,
    nodeVersion: process.version,
  };
  process.stdout.write(`[quality:setup] ${name}: staging ${source} (${commit})\n`);

  const head = git(source, 'rev-parse', 'HEAD');
  if (head !== commit) {
    process.stderr.write(`[quality:setup] ${name}: checkout en ${head ?? '??'} != commit fijado ${commit}; sin evidencia\n`);
    process.exit(1);
  }
  const porcelain = git(source, 'status', '--porcelain') ?? '';
  const unexpected = porcelain
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.slice(3))
    .filter(change => change !== '.quality-install.json');
  if (unexpected.length > 0) {
    process.stderr.write(`[quality:setup] ${name}: staging sucio (${unexpected.join(', ')}); sin evidencia\n`);
    process.exit(1);
  }

  /* El CLI provisionado es la única prueba de que el checkout está realmente
   * construido. `out/` está gitignored, así que el staging limpio no lo cubre:
   * si falta el CLI, la certificación no puede reutilizarse y hay que compilar. */
  const cli = rutaCli(workspace, config);
  const cliPresente = cli === null ? null : fs.existsSync(cli);

  let origen = 'ejecutada';
  if (cacheActiva && !refrescar && cliPresente !== false) {
    const { entrada, ruta, motivo } = leerCertificacion(clave);
    if (entrada) {
      origen = 'reutilizada';
      reutilizadas += 1;
      process.stdout.write(
        `[quality:setup] ${name}: certificación reutilizada ${describirClave(clave)} (compile+suite omitidos) · ${ruta}\n`,
      );
    } else {
      process.stdout.write(`[quality:setup] ${name}: sin certificación válida ${describirClave(clave)} (${motivo}); se ejecuta compile+suite\n`);
    }
  } else if (cliPresente === false) {
    process.stdout.write(`[quality:setup] ${name}: CLI provisionado ausente (${cli}); se ejecuta compile+suite\n`);
  }

  if (origen === 'ejecutada') {
    if (buildScript) {
      process.stdout.write(`[quality:setup] ${name}: compilando (npm run ${buildScript})\n`);
      run('npm', ['run', buildScript], source, `${name} compile`);
    }
    if (testScript) {
      process.stdout.write(`[quality:setup] ${name}: suite (npm run ${testScript})\n`);
      run('npm', ['run', testScript], source, `${name} suite`);
    }
    ejecutadas += 1;
    if (cacheActiva) {
      const { ruta } = escribirCertificacion(clave, {}, {});
      process.stdout.write(`[quality:setup] ${name}: certificación registrada ${describirClave(clave)} · ${ruta}\n`);
    }
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    schemaVersion: 1,
    tool: name,
    commit,
    compile: 'passed',
    suite: testScript ? 'passed' : 'not-configured',
    cleanStaging: true,
    origen,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(evidenceDir, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`[quality:setup] ${name}: evidencia escrita (origen=${origen})\n`);
}

process.stdout.write(
  `[quality:setup] evidencia release generada para todos los analyzers (${reutilizadas} reutilizada(s), ${ejecutadas} ejecutada(s))\n`,
);
