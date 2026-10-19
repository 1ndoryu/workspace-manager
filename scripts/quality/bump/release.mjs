/* Que release se propaga y con que comandos se rehace la evidencia en cada
 * consumidor. */
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ_AREA } from '../../shared/rutas.mjs';
import { BIN_GIT } from '../../shared/binarios.mjs';
import { AQUI } from './ajustes.mjs';
import { comando, ejecutar, leerJson } from './utilidades.mjs';

export function objetivoDelRelease(tool, { commit, version, source }) {
  const fuente = path.resolve(source ?? path.join(RAIZ_AREA, '.quality-tools', tool));
  if (!fs.existsSync(fuente)) {
    throw new Error(`no existe el checkout de referencia ${fuente}; pasa --source o provisiona el área`);
  }
  const head = ejecutar(comando(BIN_GIT, ['rev-parse', 'HEAD']), fuente);
  const headReal = head.status === 0 ? head.salida.trim() : null;
  const pkg = leerJson(path.join(fuente, 'package.json'));
  const commitFinal = commit ?? headReal;
  const versionFinal = version ?? pkg?.version ?? null;
  if (!commitFinal) throw new Error(`no se pudo determinar el commit de ${tool}; pasa --commit`);
  if (headReal && commitFinal !== headReal) {
    throw new Error(
      `el checkout de referencia está en ${headReal.slice(0, 12)} pero el destino es ${commitFinal.slice(0, 12)}; ` +
        'mueve el checkout o pasa --source (un pin que el checkout no tiene dejaría la evidencia sin poder generarse)',
    );
  }
  return { fuente, commit: commitFinal, version: versionFinal, head: headReal };
}

export function pasosDe(consumidor, config, configSentinel) {
  const propios = archivo => path.join(consumidor.dir, 'scripts', 'quality', archivo);
  const lock = fs.existsSync(propios('lock-generator.mjs')) ? propios('lock-generator.mjs') : path.join(AQUI, 'lock-generator.mjs');
  const setupPropio = [propios('quality-setup.mjs'), propios('setup.mjs')].find(archivo => fs.existsSync(archivo));
  const setup = setupPropio ?? path.join(AQUI, 'quality-setup.mjs');
  const pkg = leerJson(path.join(consumidor.dir, 'package.json'));
  /* `doctor` es { argv, enProyecto }: argv se ejecuta en local o en la 89; `enProyecto` dice si el
   * comando vive en la réplica del consumidor (sí en el script npm) o en un checkout fuera de ella. */
  let doctor;
  if (pkg?.scripts?.['quality:doctor']) {
    doctor = { argv: ['npm', 'run', 'quality:doctor', '--silent'], enProyecto: true };
  } else {
    /* [219A-2] El doctor siempre es `sentinel doctor`, aunque se este
     * propagando otra tool: el CLI de varsense no tiene subcomando doctor
     * y el fallback imprimia "Uso:" (fallo falso en GLORYINSPECTOR/PORT). */
    const cfgDoctor = configSentinel ?? config;
    const provision = path.resolve(consumidor.dir, cfgDoctor?.provisionPath ?? '.quality-tools');
    const cli = typeof cfgDoctor?.cli === 'string' && cfgDoctor.cli ? path.join(provision, cfgDoctor.cli) : null;
    doctor = cli && fs.existsSync(cli) ? { argv: [process.execPath, cli, 'doctor', '--json'], enProyecto: false } : null;
  }
  return {
    lock: comando(process.execPath, [lock, '--write']),
    setup: comando(process.execPath, [setup]),
    doctor,
  };
}
