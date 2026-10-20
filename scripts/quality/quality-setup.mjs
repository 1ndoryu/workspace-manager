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
 * Uso: node quality-setup.mjs [--refresh] [--no-cache] [--workspace <dir>] [--local]
 *   --refresh   ignora la caché y re-ejecuta compile+suite (actualiza la entrada)
 *   --no-cache  ni lee ni escribe la caché (comportamiento anterior a 109A-9)
 *   --workspace directorio del consumidor (por defecto el cwd)
 *   --local     emergencia: compile+suite en este equipo si la VPS no está disponible.
 *               Por defecto compile+suite corren en la VPS configurada (réplica del consumidor).
 * Variables: GLORY_CERT_REFRESH=1, GLORY_CERT_DISABLE=1, GLORY_CERT_CACHE=<dir>
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIN_GIT, BIN_NPM } from '../shared/binarios.mjs';
import {
  cargarTaller,
  decidirDonde,
  dirRemotoDeHerramienta,
  ejecutarEnVps,
  mensajeSinVps,
} from '../shared/vps.mjs';
import {
  describirClave,
  directorioCertificaciones,
  escribirCertificacion,
  leerCertificacion,
} from './certificacion.mjs';
import { git, refrescarRefs, run, versionDelCli } from './quality-setup-ejecucion.mjs';
import { rutaCli } from './quality-setup-rutas.mjs';

const argv = process.argv.slice(2);

function valorDe(flag) {
  const indice = argv.indexOf(flag);
  return indice >= 0 && argv[indice + 1] ? argv[indice + 1] : null;
}

const workspace = path.resolve(valorDe('--workspace') ?? process.cwd());
const refrescar = argv.includes('--refresh') || process.env.GLORY_CERT_REFRESH === '1';
const cacheActiva = !argv.includes('--no-cache') && process.env.GLORY_CERT_DISABLE !== '1';

/* Compile y suite van a la VPS configurada (carga pesada). Este equipo solo con `--local`, en emergencia.
 * Sin VPS configurada, el setup falla aquí con mensaje claro, antes de tocar ningún checkout. */
const taller = cargarTaller();
let destino;
try {
  destino = decidirDonde(argv, taller, hostname());
} catch (error) {
  process.stderr.write(`[quality:setup] ${error.message}\n`);
  process.exit(2);
}
if (destino.aviso) process.stderr.write(`[quality:setup] ${destino.aviso}\n`);
// [por que] `ejecutor` dice DÓNDE se compiló: en la VPS (también si este equipo ES la VPS) o en local por emergencia.
// [por que] Nombre genérico: el taller puede ser cualquier VPS; el nombre concreto va en config/taller.json.
const ejecutor = destino.donde === 'local' ? 'local' : 'taller';

/* Carpeta en la 89 donde compilar `source`: SIEMPRE un checkout por commit fuera de la réplica.
 * [10AA-3] Antes, un checkout interno (`tools/sentinel` dentro del consumidor) se compilaba en la
 * carpeta del propio consumidor de la réplica, porque Mutagen ya la trae. Pero la trae copiando el
 * árbol de TRABAJO del portátil, y con `core.autocrlf=true` ese árbol tiene CRLF: la propia suite
 * del tool compara `rules.md` con el registro y fallaba en la 89 por eso, no por el código. El
 * árbol del commit (`git archive`) es LF, idéntico para checkouts internos y compartidos, y no
 * depende de que Mutagen haya terminado de sincronizar. */
function dirRemotoDeFuente(name, config) {
  return dirRemotoDeHerramienta(taller, name, config.commit);
}

/* [por que] Mutagen no replica `.quality-tools/<tool>` (está fuera del consumidor), así que la 89 no lo tiene.
 * Se envía el árbol EXACTO del commit fijado (`git archive HEAD`, el que hashea el lock) y se instalan
 * sus dependencias una vez; `.listo` marca una carpeta completa, así una ejecución fallida se rehace.
 * [por que] `core.autocrlf=false`: con autocrlf (portátil Windows) `git archive` escribe CRLF y los
 * textos comparados (p. ej. rules.md) fallan en la 89; el blob del commit es LF. */
function prepararFuenteRemota(source, dir, name, commit) {
  const archivo = spawnSync(BIN_GIT, ['-C', source, '-c', 'core.autocrlf=false', 'archive', '--format=tar', commit], { maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (archivo.error || archivo.status !== 0) {
    process.stderr.write(`[quality:setup] ${name}: no se pudo generar el árbol de ${commit} para la VPS; sin evidencia\n`);
    process.exit(1);
  }
  const script = [
    'set -e',
    `D="${dir}"`,
    'if [ -f "$D/.listo" ]; then exit 0; fi',
    'rm -rf "$D"; mkdir -p "$D"; tar -x -C "$D"',
    'cd "$D"; npm ci --no-audit --no-fund',
    'touch .listo',
  ].join('; ');
  const resultado = ejecutarEnVps(taller, '/var/tmp', ['bash', '-c', script], { entrada: archivo.stdout });
  const aviso = mensajeSinVps(resultado.status, taller.host);
  if (aviso || resultado.status !== 0) {
    process.stderr.write(`[quality:setup] ${name}: preparar ${commit} en la VPS falló${aviso ? `: ${aviso}` : ` (exit ${resultado.status})`}; sin evidencia\n`);
    process.exit(aviso ? 2 : 1);
  }
}

/* Paso de build o suite. Remoto: `npm run <script>` dentro de `dirRemoto` en la 89.
 * Los checkouts git (staging, evidencia) siguen siendo locales: la evidencia vive en el portátil. */
function paso(source, script, label, dirRemoto) {
  if (destino.donde !== 'remoto') return run(BIN_NPM, ['run', script], source, label);
  const resultado = ejecutarEnVps(taller, dirRemoto, ['npm', 'run', script]);
  const aviso = mensajeSinVps(resultado.status, taller.host);
  if (aviso) {
    process.stderr.write(`[quality:setup] ${label}: ${aviso}\n`);
    process.exit(2);
  }
  if (resultado.status !== 0) {
    process.stderr.write(`[quality:setup] ${label} falló en la VPS (exit ${resultado.status}); no se escribe evidencia\n`);
    process.exit(1);
  }
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
    ejecutor,
  };
  process.stdout.write(`[quality:setup] ${name}: staging ${source} (${commit})\n`);
  refrescarRefs(source, name);

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

  /* Existir no es ser el CLI del pin: un `.quality-tools/<tool>/` viejo (o un
   * `install-state.json` que declara otra versión) pasaría como bueno. Se
   * compara `--version` con lo que fija el manifiesto —misma fuente que el lock—
   * y si no cuadra se trata la provisión como ausente y se recompila. */
  const versionEsperada = typeof config.version === 'string' && config.version ? config.version : null;
  const versionCli = cliPresente === true ? versionDelCli(cli, workspace) : null;
  const cliAlDia = cliPresente !== true || versionEsperada === null || versionCli === versionEsperada;
  if (cliPresente === true && !cliAlDia) {
    process.stdout.write(
      `[quality:setup] ${name}: el CLI provisionado se declara ${versionCli ?? 'ilegible'} y el manifiesto fija ${versionEsperada}; se ejecuta compile+suite\n`,
    );
  }

  let origen = 'ejecutada';
  if (cacheActiva && !refrescar && cliPresente !== false && cliAlDia) {
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
    const dirRemoto = destino.donde === 'remoto' && (buildScript || testScript) ? dirRemotoDeFuente(name, config) : null;
    if (dirRemoto) prepararFuenteRemota(source, dirRemoto, name, commit);
    if (buildScript) {
      process.stdout.write(`[quality:setup] ${name}: compilando (npm run ${buildScript}, ${ejecutor})\n`);
      paso(source, buildScript, `${name} compile`, dirRemoto);
    }
    if (testScript) {
      process.stdout.write(`[quality:setup] ${name}: suite (npm run ${testScript}, ${ejecutor})\n`);
      paso(source, testScript, `${name} suite`, dirRemoto);
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
    ejecutor,
    origen,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(evidenceDir, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`[quality:setup] ${name}: evidencia escrita (origen=${origen})\n`);
}

process.stdout.write(
  `[quality:setup] evidencia release generada para todos los analyzers (${reutilizadas} reutilizada(s), ${ejecutadas} ejecutada(s))\n`,
);
