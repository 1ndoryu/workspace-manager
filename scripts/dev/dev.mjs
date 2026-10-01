/* Mando dev (F0: solo `doctor`; up/status/logs/open/stop = F1, no existen).
 * [por que] La superficie del mando crece por fases del plan; el dispatcher
 * existe desde F0 para fijar los argv (`dev doctor --all ...`) sin arrancar
 * nada. Lo no autorizado responde con su fase, nunca con verde ambiguo. */
import { main as doctor } from './doctor.mjs';

const AYUDA = `uso: dev <comando>
  doctor --all [--json] [--snapshot-file <ruta>] [--assert]   clasifica (F0)
  up|status|logs|open|stop   pendientes de F1 (no implementados)`;

export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const [cmd, ...resto] = args;
  if (cmd === 'doctor') return doctor(resto);
  if (['up', 'status', 'logs', 'open', 'stop'].includes(cmd)) {
    console.error(`'${cmd}' pendiente de F1 (plan mando-dev): no implementado`);
    return 1;
  }
  console.log(AYUDA);
  return cmd ? 1 : 0;
}

const esCli = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('/scripts/dev/dev.mjs');
if (esCli) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`dev: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
