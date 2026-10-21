/* Entrada del modulo remoto: decidir si un id va a la VPS y despachar el subcomando. */

import { cargarConfig } from '../../remoto/rcargo.mjs';
import { RUTA_REGISTRO } from '../doctor/base.mjs';
import { entradaEfectiva, esEntradaRemota, leerRegistro } from '../doctor.mjs';

import { logsRemoto, statusRemoto, stopRemoto, upRemoto, upRemotoTunel } from './ciclo.mjs';
import { persistirPermanente, valorPermanente } from './permanente.mjs';

/* El subcomando NO es `up`: encender o apagar la bandera de un proyecto que ya esta arriba no
 * debe arrancar, detener ni reabrir nada (era la unica forma de hacerlo antes, y un `up` completo
 * reconstruye el front: minutos para escribir un booleano). Sirve para cualquier entrada del
 * registro, con host o sin el: en un proyecto del portatil la bandera se acepta y no promete mas
 * que el tramo que tenga. */
export function despacharPermanente(args) {
  const id = args[0];
  const comoJson = args.includes('--json');
  const sale = (r) => {
    if (comoJson) console.log(JSON.stringify({ id, ...r }));
    else console.log(r.resumen);
    return r.codigo;
  };
  if (!id || id.startsWith('-')) return sale({ codigo: 1, resumen: 'permanente: falta el id' });
  const valor = valorPermanente(args);
  if (valor === undefined) return sale({ codigo: 1, resumen: `permanente ${id}: falta --permanente o --no-permanente` });
  const iReg = args.indexOf('--registro');
  const r = persistirPermanente(iReg >= 0 ? args[iReg + 1] : RUTA_REGISTRO, id, valor);
  if (!r.ok) return sale({ codigo: 1, resumen: `permanente ${id}: no se pudo guardar: ${r.resumen}` });
  const que = valor ? 'permanente' : 'no permanente';
  return sale({ codigo: 0, resumen: `permanente ${id}: ${que}${r.sinCambio ? ' (ya lo estaba)' : ''}` });
}

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
  // La entrada se devuelve tal cual sale del registro (sin `entradaEfectiva`): es la que necesita
  // `up` para cambiar de modo, y la que ve el doctor al atribuir el tunel.
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
  if (cmd === 'up') {
    // [por que] `--permanente` se graba ANTES del arranque: si se grabara después, un `up` que
    // falla a medias dejaria la bandera en el aire sin el tramo que promete. `--solo-tunel` no la
    // toca: repara el tramo del portátil de lo que ya estaba declarado.
    const valor = valorPermanente(args);
    if (valor !== undefined) {
      // Mismo `--registro` que `entradaRemotaDe`: grabar en el real cuando se pidio otro seria mentir.
      const iReg = args.indexOf('--registro');
      const rutaReg = iReg >= 0 ? args[iReg + 1] : RUTA_REGISTRO;
      const r = persistirPermanente(rutaReg, id, valor);
      if (!r.ok) return sale({ codigo: 1, resumen: `up ${id}: no se pudo guardar permanente=${valor}: ${r.resumen}` });
      /* [por que] `entrada` se leyo ANTES de grabar: sin releerla, un `up --permanente` sobre un
       * proyecto ya arriba no ve la bandera y no rearma la sesion con bucle (prometeria un rearme
       * que nadie ejecuta). Una sola verdad: la de la ficha en disco. */
      try {
        entrada = leerRegistro(rutaReg).entradas.get(id) ?? entrada;
      } catch {
        /* Si el registro no se puede releer, se sigue con la entrada previa: `up` fallara cerrado. */
      }
    }
    if (args.includes('--solo-tunel')) return sale(await upRemotoTunel(config, id, entrada));
    return sale(await upRemoto(config, id, entrada, args));
  }
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

