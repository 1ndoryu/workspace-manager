/* Sincronizacion de la base de datos al taller: dumps, conteos y desvio. */

import { shQuote } from '../../remoto/rcargo.mjs';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { raizTemporales } from '../../shared/rutas.mjs';

import { filtrarSqlParaPg16, leerUrlBdLocal } from './entorno.mjs';
import { marcaTiempo } from './estado.mjs';
import { escribirArchivoRemoto, sshRemoto } from './ssh.mjs';

function ejecutarLocal(binario, args, env, timeoutMs) {
  return new Promise((resolveP) => {
    execFile(binario, args, { env, timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolveP({ ok: !err, salida: String(stdout ?? ''), error: String(stderr || err?.message || '').trim().slice(0, 300) });
    });
  });
}


export function parsearConteos(texto) {
  const mapa = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    const i = linea.indexOf('=');
    if (i > 0) mapa.set(linea.slice(0, i).trim(), linea.slice(i + 1).trim());
  }
  return mapa;
}

// [por que] Un conteo ausente o no numérico nunca cuenta como coincidente: solo igualdad exacta de números.

export function diferenciasConteos(local, remoto, tablas) {
  const numero = (v) => v !== undefined && /^\d+$/.test(v);
  return tablas
    .filter((t) => !(numero(local.get(t)) && numero(remoto.get(t)) && local.get(t) === remoto.get(t)))
    .map((t) => `${t}: laptop=${local.get(t) ?? 'sin conteo'}, 89=${remoto.get(t) ?? 'sin conteo'}`);
}


/* [por que] La raiz sale de raizTemporales(): el literal 'C:/tmp' era relativo
 * al cwd en Linux, y ademas duplicaba la regla que ya vive en un solo sitio. */
const DIR_DUMPS_LOCALES = join(raizTemporales(), 'backups-bd');

const COPIAS_PREVIAS_BD = 3;

// [por que] La 89 es la base de trabajo: si alguien escribio alli (el panel, subir fotos), tiene mas filas que
// la laptop, y restaurar la de la laptop destruiria ese trabajo. Solo se rehusa esa direccion: si la 89 tiene
// menos, la laptop es la verdad y refrescar es justo lo que se pide. Se comprueba antes de volcar nada.

export async function desvioConLaptop(config, nombreBd, tablas, local, envLocal, pgDump) {
  if (!tablas.length) return { diffs: [] };
  const remoto = await sshRemoto(config, [
    'PATH=$HOME/.local/bin:/usr/bin:/bin',
    `existe=$(psql -X -At -d postgres -c ${shQuote(`select 1 from pg_database where datname='${nombreBd}'`)}) || { echo FALLO; exit 1; }`,
    `[ "$existe" = 1 ] || { echo SIN_BD; exit 0; }`,
    ...tablas.map((t) => `printf '%s=' ${shQuote(t)}; psql -X -At -d ${shQuote(nombreBd)} -c ${shQuote(`select count(*) from "${t}"`)} 2>/dev/null || echo no-existe`),
  ].join('; '), 120_000);
  // [por que] Sin dato fiable no se rehusa: la restauracion vuelve a verificar los conteos al final.
  if (!remoto.ok || remoto.salida.includes('FALLO') || remoto.salida.includes('SIN_BD')) return { diffs: [] };
  const cuentaRemota = parsearConteos(remoto.salida);
  const conexion = ['-h', local.host, '-p', String(local.puerto), '-U', local.usuario];
  const cuentaLocal = new Map();
  for (const t of tablas) {
    const c = await ejecutarLocal(join(dirname(pgDump), 'psql.exe'), [...conexion, '-X', '-At', '-d', local.nombre, '-c', `select count(*) from "${t}"`], envLocal, 60_000);
    cuentaLocal.set(t, c.ok ? c.salida.trim() : 'sin conteo');
  }
  return { diffs: desviosDeConteos(cuentaLocal, cuentaRemota, tablas) };
}

// [por que] Solo cuenta como desvio que la 89 tenga MAS filas: eso es trabajo hecho alli que la laptop no tiene.
// Que tenga menos es lo normal (la laptop gano filas) y refrescar es justo lo que se pide. Sin numero fiable, no hay desvio.

export function desviosDeConteos(local, remoto, tablas) {
  return tablas
    .filter((t) => /^\d+$/.test(remoto.get(t) ?? '') && /^\d+$/.test(local.get(t) ?? '') && Number(remoto.get(t)) > Number(local.get(t)))
    .map((t) => `${t}: 89=${remoto.get(t)} > laptop=${local.get(t)}`);
}

// Base de trabajo de la 89 = copia de la base de la laptop (decidido 2026-10-14: dos bases como máximo; la 89 es la de trabajo y la 66 no se toca desde aquí).
// [por que] Orden: dump local filtrado -> copia previa en la 89 (si la base existe, sin copia no se restaura) -> restauración en una transacción -> conteos iguales en ambos lados.
// La clave viaja en PGPASSWORD (entorno del proceso), nunca en argumentos ni en logs.

export async function sincronizarBd(config, id, entrada, ruta, nombreBd, forzar = false) {
  if (!nombreBd) return { ok: false, resumen: 'BD: el proyecto no tiene base remota (sin Cargo.toml o envRemoto)' };
  const pgDump = config.bd?.pgDumpLocal;
  if (!pgDump) return { ok: false, resumen: 'BD: taller.json bd.pgDumpLocal no declarado' };
  const tablas = config.proyectos?.[id]?.bdDesdeLocal?.verificar ?? [];
  let local;
  try {
    local = leerUrlBdLocal(readFileSync(join(ruta, '.env'), 'utf8'));
  } catch (e) {
    return { ok: false, resumen: `BD: ${e.message}` };
  }
  const envLocal = { ...process.env, PGPASSWORD: local.clave };
  const conexion = ['-h', local.host, '-p', String(local.puerto), '-U', local.usuario];

  const desvio = await desvioConLaptop(config, nombreBd, tablas, local, envLocal, pgDump);
  if (desvio.diffs.length && !forzar) {
    return {
      ok: false,
      resumen: `BD: la base de ${config.host} tiene datos que la laptop no tiene (${desvio.diffs.join('; ')}); no se restaura para no perderlos. Sigue con --sin-bd (conserva la de la 89) o fuerza con --bd (vuelve a la de la laptop)`,
    };
  }

  mkdirSync(DIR_DUMPS_LOCALES, { recursive: true });
  const rutaDump = `${DIR_DUMPS_LOCALES}/${local.nombre}-sync.sql`;
  const dump = await ejecutarLocal(pgDump, [...conexion, '-Fp', '--no-owner', '--no-acl', '--clean', '--if-exists', '-f', rutaDump, local.nombre], envLocal, 600_000);
  if (!dump.ok) return { ok: false, resumen: `BD: pg_dump de la laptop fallo: ${dump.error}` };
  const sql = filtrarSqlParaPg16(readFileSync(rutaDump, 'utf8'));
  writeFileSync(rutaDump, sql);

  // [por que] escribirArchivoRemoto hace mkdir -p del directorio y deja el fichero en 0600.
  const dirDatos = `${config.dirRemotoBase}/_datos`;
  const rutaRemotaSql = `${dirDatos}/${nombreBd}-sync.sql`;
  const subida = await escribirArchivoRemoto(config, rutaRemotaSql, sql, 300_000);
  if (!subida.ok) return { ok: false, resumen: `BD: subida del dump a ${config.host} fallo: ${subida.error}` };

  const dirCopias = `${dirDatos}/copias`;
  const copiaPrevia = `${dirCopias}/${nombreBd}-previo-${marcaTiempo()}.dump`;
  const previa = await sshRemoto(config, [
    'PATH=$HOME/.local/bin:/usr/bin:/bin',
    `mkdir -p ${shQuote(dirCopias)}`,
    `existe=$(psql -X -At -d postgres -c ${shQuote(`select 1 from pg_database where datname='${nombreBd}'`)}) || { echo FALLO_COMPROBAR; exit 1; }`,
    `if [ "$existe" = 1 ]; then pg_dump -Fc -d ${shQuote(nombreBd)} -f ${shQuote(copiaPrevia)} || { rm -f ${shQuote(copiaPrevia)}; echo FALLO_PREVIA; exit 1; }; echo PREVIA_OK; else echo SIN_PREVIA; fi`,
    `ls -1t ${shQuote(dirCopias)}/${nombreBd}-previo-*.dump 2>/dev/null | tail -n +${COPIAS_PREVIAS_BD + 1} | xargs -r rm -f`,
  ].join('; '), 300_000);
  if (!previa.ok) return { ok: false, resumen: `BD: copia previa en ${config.host} fallo: ${previa.error || previa.salida.trim()}` };

  const restauracion = await sshRemoto(config, `PATH=$HOME/.local/bin:/usr/bin:/bin; psql -X -q -v ON_ERROR_STOP=1 -1 -d ${shQuote(nombreBd)} -f ${shQuote(rutaRemotaSql)}`, 600_000);
  if (!restauracion.ok) return { ok: false, resumen: `BD: restauracion en ${config.host} fallo (transaccion revertida): ${restauracion.error}` };

  const cuentaRemota = await sshRemoto(config, [
    'PATH=$HOME/.local/bin:/usr/bin:/bin',
    ...tablas.map((t) => `printf '%s=' ${shQuote(t)}; psql -X -At -d ${shQuote(nombreBd)} -c ${shQuote(`select count(*) from "${t}"`)} 2>/dev/null || echo no-existe`),
  ].join('; '), 120_000);
  if (!cuentaRemota.ok) return { ok: false, resumen: `BD: conteo en ${config.host} fallo: ${cuentaRemota.error}` };
  const cuentaLocal = new Map();
  for (const t of tablas) {
    const c = await ejecutarLocal(join(dirname(pgDump), 'psql.exe'), [...conexion, '-X', '-At', '-d', local.nombre, '-c', `select count(*) from "${t}"`], envLocal, 60_000);
    cuentaLocal.set(t, c.ok ? c.salida.trim() : 'sin conteo');
  }
  const diffs = diferenciasConteos(cuentaLocal, parsearConteos(cuentaRemota.salida), tablas);
  if (diffs.length) return { ok: false, resumen: `BD: conteos distintos tras restaurar (${diffs.join('; ')})` };
  const remota = parsearConteos(cuentaRemota.salida);
  const cuenta = tablas.map((t) => `${t}=${remota.get(t)}`).join(', ');
  return { ok: true, resumen: `BD sincronizada desde laptop${cuenta ? ` (${cuenta})` : ''}` };
}

