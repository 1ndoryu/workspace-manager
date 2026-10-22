/* Mando dev (F0: `doctor`; F1: +`up`; F2: +`status/logs/open/stop`).
 * [por que] La superficie del mando crece por fases del plan; el dispatcher
 * existe desde F0 para fijar los argv sin arrancar nada. Lo no autorizado
 * responde con su fase, nunca con verde ambiguo. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as doctor, up } from './doctor.mjs';
import { logs, open, status, stop } from './acciones.mjs';
import { problemas } from './taller/consola.mjs';
import { comandos, gate } from './proyecto/gate.mjs';
import { cierre } from './proyecto/cierre.mjs';
import { alta } from './proyecto/alta/alta.mjs';
import { artefactos } from './proyecto/artefactos.mjs';
import { app } from './proyecto/app-escritorio.mjs';
import { despachar as remoto, despacharPermanente, entradaRemotaDe } from './remoto.mjs';

const AYUDA = `uso: dev <comando>
  doctor --all [--json] [--snapshot-file <ruta>] [--assert]   clasifica (F0)
  up <id> [--sin-bd] [--bd] [--dev|--build] [--permanente|--no-permanente] [--solo-tunel] [--snapshot-file <ruta>] [--registro <ruta>] [--json]   arranca/verifica (F1)
      --sin-bd: no toca la base de la 89 (para reiniciar codigo sin perder lo escrito alli)
      --bd:     refresca la base de la 89 desde la laptop aunque ya este arriba (pisa lo de la 89)
      --dev:    esta sesion en modo dev (vite con HMR), aunque la ficha diga build
      --build:  esta sesion en modo build (front a dist/ servido por el backend), aunque diga dev
      --permanente/--no-permanente: graba la bandera en la ficha antes de arrancar (protocolo de
                estado permanente: proceso en la 89, tunel del portatil y produccion; ver
                Agente/documentacion/arquitectura/protocolo-estado-permanente-2026-10-21.md)
      --solo-tunel: reabre SOLO el tunel del portatil de lo ya declarado (segundos, no minutos):
                no toca la 89, ni la base, ni el front. Lo usa el supervisor del tablero
  permanente <id> --permanente|--no-permanente [--registro <ruta>] [--json]  graba la bandera sin arrancar nada (protocolo de estado permanente)
  status [id] [--snapshot-file <ruta>] [--registro <ruta>] [--json]  estado (F2)
  logs <id> [--lineas N] [--registro <ruta>]                  cola del log (F2)
  open <id> [--registro <ruta>]                               imprime URLs (F2)
  stop <id> [--snapshot-file <ruta>] [--registro <ruta>] [--json]    detiene (F2)
  problemas [--forzar] [--categoria <cat>] [--proyecto <clave>] [--json]  consola agregada (07AA-1)
  gate <id> --inicio|--cierre                                 hallazgos nuevos de la tarea (F9)
  comandos <id> [--json]                                      contrato de comandos (F9)
  cierre <id> [--tarea <ID>]                                  puerta de cierre, solo lectura (F9)
  alta <id|carpeta> [--aplicar] [--json]                  lista de alta; en seco salvo --aplicar (F10)
  artefactos [--json]                                         que un proyecto consume de otro (20AA-7)
  app <id>                                                    compila el front y el .exe de una app de escritorio en la 89`;

export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const [cmd, ...resto] = args;
  // [por que] Solo estos cuatro tienen camino remoto; el resto de comandos sigue local. Entrada sin `host` = camino local intacto.
  // [por que] `permanente` se despacha ANTES de mirar el host: escribir la bandera no arranca,
  // detiene ni reabre nada, y vale igual para un proyecto del portatil.
  if (cmd === 'permanente') return despacharPermanente(resto);
  if (['up', 'status', 'logs', 'stop'].includes(cmd)) {
    const entrada = entradaRemotaDe(resto[0], resto);
    if (entrada) return remoto(cmd, resto, entrada);
  }
  if (cmd === 'doctor') return doctor(resto);
  if (cmd === 'up') return up(resto);
  if (cmd === 'status') return status(resto);
  if (cmd === 'logs') return logs(resto);
  if (cmd === 'open') return open(resto);
  if (cmd === 'stop') return stop(resto);
  if (cmd === 'problemas') return problemas(resto);
  if (cmd === 'gate') return gate(resto);
  if (cmd === 'comandos') return comandos(resto);
  if (cmd === 'cierre') return cierre(resto);
  if (cmd === 'alta') return alta(resto);
  if (cmd === 'artefactos') return artefactos(resto);
  if (cmd === 'app') return app(resto);
  console.log(AYUDA);
  return cmd ? 1 : 0;
}

/* [por que] Se compara con la ruta real de este archivo, no con un sufijo
 * literal: asi el guard sobrevive a mover el modulo de carpeta. */
const esCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esCli) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`dev: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
