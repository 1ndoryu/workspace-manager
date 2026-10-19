/* Lectura de la ficha de una entrada remota: puertos, healths y estado real en la VPS. */

import { shQuote } from '../../remoto/rcargo.mjs';
import { localesDeModo, puertosRemotosDe } from '../doctor.mjs';

import { comandoSesiones, sesionTmux } from './comandos.mjs';
import { entornoRemoto } from './entorno.mjs';
import { leerEstado } from './estado.mjs';
import { esperarSonda, esperarSondaRemota, pidDeEscucha, variablesDistintas } from './sondas.mjs';
import { sshRemoto } from './ssh.mjs';
import { puertosLocalesDe, tunelVivo, usaTunel } from './tunel.mjs';

export function puertosTodos(ficha) {
  const dev = ficha.puertosRemotos ?? ficha.puertos ?? [];
  return [...new Set([...dev, ...(ficha.build?.puertos ?? [])])];
}

// Puertos locales de los dos modos, con la misma regla que `puertosLocalesDe` (sin `puertosLocales`,
// el local es el remoto). Sirve para encontrar el tunel huerfano del modo que se deja.

export function localesTodos(ficha) {
  const b = ficha.build;
  return [...new Set([...localesDeModo(ficha), ...(b ? localesDeModo({ puertos: b.puertos, puertosLocales: b.puertosLocales }) : [])])];
}

// Pide Ctrl-C y luego mata la sesion. Si ssh falla, lo devuelve: el tunel se cierra igual.
// Recibe la ficha (no la entrada efectiva) porque para parar valen las sesiones de los dos modos.

export function pararSesiones(config, id, ficha) {
  return pararSesionesPuertos(config, id, puertosTodos(ficha));
}


export function pararSesionesPuertos(config, id, puertos) {
  const comando = puertos
    .map((p) => {
      const s = shQuote(sesionTmux(id, p));
      return `tmux send-keys -t ${s} C-c 2>/dev/null; sleep 2; tmux kill-session -t ${s} 2>/dev/null; true`;
    })
    .join('; ');
  return sshRemoto(config, comando);
}


// El health del puerto: de ahí salen la ruta y el marcador. En build el `/` lo sirve el backend, así
// que un 200 puede ser la API y no la SPA; el marcador (p. ej. `<div id="root">`) es lo que las
// distingue. Sin marcador, el criterio sigue siendo el de siempre: solo el 200.

function saludDe(entrada, puerto) {
  return entrada.healths?.find((h) => h.puerto === puerto) ?? {};
}

export const rutaSonda = (entrada, puerto) => saludDe(entrada, puerto).ruta ?? '/';

export const marcadorSonda = (entrada, puerto) => saludDe(entrada, puerto).marcador ?? null;


export async function estadoRemoto(config, id, entrada) {
  const tunel = usaTunel(entrada);
  const pidTunel = tunel ? await tunelVivo(config, entrada, leerEstado(id)) : null;
  const remotos = puertosRemotosDe(entrada);
  const r = await sshRemoto(config, comandoSesiones(remotos.map((p) => sesionTmux(id, p))));
  if (!r.ok) {
    return { estado: 'deriva', pidTunel, motivo: `sin ssh a ${config.host} (${r.error})` };
  }
  const vivas = r.salida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sesionesVivas = remotos.filter((p) => vivas.includes(sesionTmux(id, p)));
  // [por que] Un solo intento de 2 s daba «deriva» falso tras un arranque en frío del túnel; se reintenta hasta 3 s.
  // Sin túnel, el probe solo corre si hay sesiones: sin ellas no hay nada que sondear.
  let sondasOk = remotos.map(() => false);
  if (tunel && pidTunel) {
    sondasOk = await Promise.all(remotos.map((p, i) => esperarSonda(puertosLocalesDe(entrada)[i], rutaSonda(entrada, p), 3000, marcadorSonda(entrada, p))));
  } else if (!tunel && sesionesVivas.length) {
    sondasOk = await Promise.all(remotos.map((p) => esperarSondaRemota(config, p, rutaSonda(entrada, p), 3000, marcadorSonda(entrada, p))));
  }
  const conexion = tunel ? `tunel ${pidTunel ? `pid ${pidTunel}` : 'caido'}` : 'sin tunel';
  const detalle = `tmux ${sesionesVivas.length}/${remotos.length}, ${conexion}, probe ${sondasOk.filter(Boolean).length}/${remotos.length}`;
  if (sesionesVivas.length === remotos.length && (pidTunel || !tunel) && sondasOk.every(Boolean)) {
    return { estado: 'bajo-mando', pidTunel, motivo: `${config.host}: ${detalle}` };
  }
  if (sesionesVivas.length === 0 && !pidTunel) {
    return { estado: 'parado', pidTunel, motivo: `${config.host}: ${detalle}` };
  }
  return { estado: 'deriva', pidTunel, motivo: `${config.host}: ${detalle}` };
}


export async function puertosConEntornoDistinto(config, id, entrada, rama) {
  let esperado;
  try {
    esperado = entornoRemoto(config, id, entrada, rama).env;
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
  const ss = await sshRemoto(config, 'ss -ltnpH');
  if (!ss.ok) return { ok: false, motivo: `ss remoto fallo: ${ss.error}` };
  const puertos = [];
  const detalle = [];
  for (const p of puertosRemotosDe(entrada)) {
    const pid = pidDeEscucha(ss.salida, p);
    let texto = '';
    if (pid) {
      const r = await sshRemoto(config, `tr '\\0' '\\n' < /proc/${pid}/environ`);
      texto = r.ok ? r.salida : '';
    }
    const claves = variablesDistintas(texto, esperado);
    if (!pid || claves.length) {
      puertos.push(p);
      detalle.push(pid ? `puerto ${p}: ${claves.join(', ')}` : `puerto ${p}: sin pid`);
    }
  }
  return { ok: true, puertos, detalle };
}

// Espera a que los puertos queden libres tras parar sus sesiones; si no, el arranque nuevo chocaría con el viejo.
