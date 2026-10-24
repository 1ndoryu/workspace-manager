/* Lectura de la ficha de una entrada remota: puertos, healths y estado real en la VPS. */

import { rutasRemotas, shQuote } from '../../remoto/rcargo.mjs';
import { localesDeModo, paresTunelPortatil, puertosRemotosDe } from '../doctor.mjs';

import { borrarRegistro, comandoSesiones, sesionTmux } from './comandos.mjs';
import { entornoRemoto } from './entorno.mjs';
import { leerEstado } from './estado.mjs';
import { esperarSonda, esperarSondaRemota, pidDeEscucha, variablesDistintas } from './red/sondas.mjs';
import { sshRemoto } from './red/ssh.mjs';
import { puertosLocalesDe, tunelesNuestrosEnPuertos, tunelVivo, usaTunel } from './red/tunel.mjs';

// Túneles ssh del portátil que la entrada declara en `tunelPortatil`/`tunelesExtra` y siguen vivos.
// Sin `tunelSsh` el `up` no los abre, así que sirven para saber si el acceso local existe, no para gestionarlos.
async function tunelesPortatilVivos(config, entrada) {
  const pares = paresTunelPortatil(entrada);
  if (!pares.length) return [];
  return tunelesNuestrosEnPuertos(config, pares.map(([l]) => l), pares.map(([, r]) => r));
}

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


// [por que] El registro de supervision se borra antes de matar la sesion: si la sesion muriera
// primero, el vigilante la recrearia al minuto siguiente y el `stop` no pararia nada. Va por
// puerto (no por proyecto) porque `up` para subconjuntos: matar de mas dejaria sin registro a
// sesiones que siguen vivas.
export function pararSesionesPuertos(config, id, puertos) {
  const comando = puertos
    .map((p) => {
      const s = shQuote(sesionTmux(id, p));
      return `${borrarRegistro(id, p)}; tmux send-keys -t ${s} C-c 2>/dev/null; sleep 2; tmux kill-session -t ${s} 2>/dev/null; true`;
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
  // [por que] Sin `tunelSsh` el `up` no abre el túnel del portátil, pero uno de `tunelPortatil` puede
  // seguir vivo (p. ej. abierto con `--solo-tunel`): `status` lo cuenta en vez de decir «sin tunel» (20AA-12).
  const pidPortatil = tunel ? null : (await tunelesPortatilVivos(config, entrada))[0] ?? null;
  const remotos = puertosRemotosDe(entrada);
  // [por que] Sin puertos no hay sesiones ni sondas: `[].every` daba «bajo-mando» aunque la réplica
  // no existiera, y `up` se saltaba el sync (varsense quedó sin ~/taller/varsense). Aquí «arriba» =
  // la réplica está en la 89.
  if (!remotos.length) {
    const dir = rutasRemotas(config, id, 'main').dirRemoto;
    const replica = await sshRemoto(config, `test -d ${shQuote(dir)} && echo si || echo no`);
    if (!replica.ok) return { estado: 'deriva', pidTunel, motivo: `sin ssh a ${config.host} (${replica.error})` };
    const hay = replica.salida.trim() === 'si';
    return { estado: hay ? 'bajo-mando' : 'parado', pidTunel, motivo: `${config.host}: sin puertos, réplica ${hay ? 'presente' : 'ausente'}` };
  }
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
  const conexion = tunel ? `tunel ${pidTunel ? `pid ${pidTunel}` : 'caido'}` : pidPortatil ? `tunel portatil pid ${pidPortatil}` : 'sin tunel';
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
