/* Mando dev (F0: `doctor`; F1: +`up`; F2: +`status/logs/open/stop`).
 * [por que] La superficie del mando crece por fases del plan; el dispatcher
 * existe desde F0 para fijar los argv sin arrancar nada. Lo no autorizado
 * responde con su fase, nunca con verde ambiguo. */
import { main as doctor, up } from './doctor.mjs';
import { logs, open, status, stop } from './acciones.mjs';

const AYUDA = `uso: dev <comando>
  doctor --all [--json] [--snapshot-file <ruta>] [--assert]   clasifica (F0)
  up <id> [--snapshot-file <ruta>] [--registro <ruta>] [--json]   arranca/verifica (F1)
  status [id] [--snapshot-file <ruta>] [--registro <ruta>] [--json]  estado (F2)
  logs <id> [--lineas N] [--registro <ruta>]                  cola del log (F2)
  open <id> [--registro <ruta>]                               imprime URLs (F2)
  stop <id> [--snapshot-file <ruta>] [--registro <ruta>] [--json]    detiene (F2)`;

export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const [cmd, ...resto] = args;
  if (cmd === 'doctor') return doctor(resto);
  if (cmd === 'up') return up(resto);
  if (cmd === 'status') return status(resto);
  if (cmd === 'logs') return logs(resto);
  if (cmd === 'open') return open(resto);
  if (cmd === 'stop') return stop(resto);
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
