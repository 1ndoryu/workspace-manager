/* Mando dev (F0: `doctor`; F1: +`up`; status/logs/open/stop = F2).
 * [por que] La superficie del mando crece por fases del plan; el dispatcher
 * existe desde F0 para fijar los argv sin arrancar nada. Lo no autorizado
 * responde con su fase, nunca con verde ambiguo. */
import { main as doctor, up } from './doctor.mjs';

const AYUDA = `uso: dev <comando>
  doctor --all [--json] [--snapshot-file <ruta>] [--assert]   clasifica (F0)
  up <id> [--snapshot-file <ruta>] [--json]                   arranca/verifica (F1)
  status|logs|open|stop   pendientes de F2 (no implementados)`;

export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const [cmd, ...resto] = args;
  if (cmd === 'doctor') return doctor(resto);
  if (cmd === 'up') return up(resto);
  if (['status', 'logs', 'open', 'stop'].includes(cmd)) {
    console.error(`'${cmd}' pendiente de F2 (plan mando-dev): no implementado`);
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
