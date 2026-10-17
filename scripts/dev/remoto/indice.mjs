/* Entrada del modulo remoto: decidir si un id va a la VPS y despachar el subcomando. */

import { cargarConfig } from '../../remoto/rcargo.mjs';
import { entradaEfectiva, esEntradaRemota, leerRegistro } from '../doctor.mjs';

import { logsRemoto, statusRemoto, stopRemoto, upRemoto } from './ciclo.mjs';

export function entradaRemotaDe(id, args) {
  if (!id || id.startsWith('-')) return null;
  // --local fuerza el camino local aunque el registro declare host (decidido 2026-10-14: todo en la 89 por defecto).
  if (args.includes('--local')) return null;
  const iReg = args.indexOf('--registro');
  let registro;
  try {
    registro = leerRegistro(iReg >= 0 ? args[iReg + 1] : undefined);
  } catch {
    return null;
  }
  const entrada = registro.entradas.get(id);
  return esEntradaRemota(entrada) ? entrada : null;
}


export async function despachar(cmd, args, entrada) {
  const id = args[0];
  const comoJson = args.includes('--json');
  const sale = (r) => {
    if (comoJson) console.log(JSON.stringify({ id, ...r }));
    else console.log(r.resumen ?? `${r.estado.padEnd(11)} ${id}  ${r.motivo}`);
    return r.codigo;
  };
  let config;
  try {
    config = cargarConfig();
  } catch (e) {
    return sale({ codigo: 1, resumen: `${cmd} ${id}: taller.json no legible (${e.message})` });
  }
  if (cmd === 'up') return sale(await upRemoto(config, id, entrada, args));
  // Los otros tres trabajan sobre el bloque del modo efectivo de la ficha: en build hay menos
  // puertos, así que `status` no debe sondear el 5199 del vite que ya no existe.
  const ef = entradaEfectiva(entrada);
  if (cmd === 'status') return sale(await statusRemoto(config, id, ef));
  if (cmd === 'stop') return sale(await stopRemoto(config, id, ef, entrada));
  if (cmd === 'logs') {
    const iLin = args.indexOf('--lineas');
    const n = iLin >= 0 ? Number.parseInt(args[iLin + 1], 10) : 50;
    const lineas = Number.isInteger(n) ? Math.min(Math.max(n, 1), 200) : 50;
    const r = await logsRemoto(config, id, ef, lineas);
    console.log(r.salida);
    return r.codigo;
  }
  return 1;
}

