/* Subcomandos del doctor: `up` y el arranque en cadena de un proyecto y sus deps. */

import { avisoTaller } from '../taller/taller-aviso.mjs';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { RAIZ_REPO, TTL_MS } from './base.mjs';
import { clasificar, clasificarEntrada, codigoSalida, detectarCompartidos, escuchaRobusta, tabla } from './clasificar.mjs';
import { envPara } from './ficha/entorno.mjs';
import { esEntradaRemota } from './sistema/puertos.mjs';
import { FLAG_LOCAL } from '../../shared/vps.mjs';
import { contextoEntrada, esperarProbe, lanzar, leerSnapshotServidor, oyenteDelProyecto, veredictoUpSinCobertura } from './lanzar.mjs';
import { detectarDerivaEnv, duenoDePuerto } from './sistema/puertos.mjs';
import { leerRegistro } from './ficha/registro.mjs';
import { asegurarExe, detectarRust } from './sistema/rust.mjs';
import { detectarArtefactos } from './sistema/artefactos.mjs';
import { validarMotivo } from './ficha/validacion.mjs';

/* F1 `up <id>`: ya-arriba (verifica, no reinicia) | arranca puertos libres
 * (spawn + probe hasta arranqueMs) | rehusa (ocupado/duplicado/sin-probe/
 * no-verificable/sin entrada: nunca mata, nunca inventa). Exit 0 solo con
 * probe verde; 1 en cualquier otro caso, siempre con motivo.
 * Tras el verde propio, asegura `requiere` (dependencias de arranque):
 * todo verde = 0; dependencia caida/rehusada = 2 (degradado, visible). */
export async function up(argv) {
  const args = argv ?? [];
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('uso: dev up <id> [--sin-bd] [--bd] [--snapshot-file <ruta>] [--registro <ruta>] [--json]');
    return 1;
  }
  const comoJson = args.includes('--json');
  const r = await arrancarUno(id, args, new Set());
  if (comoJson) console.log(JSON.stringify({ id, codigo: r.codigo, resumen: r.resumen }));
  else console.log(r.resumen);
  return r.codigo;
}


/* Entradas del registro activo (mismo --registro que contextoEntrada). Fail-open:
 * sin registro legible el nombre del dueño queda sin resolver, no rompe `up`. */
function registroDeArgs(args) {
  try {
    const i = args.indexOf('--registro');
    return [...leerRegistro(i >= 0 ? args[i + 1] : undefined).entradas.values()];
  } catch {
    return [];
  }
}


async function arrancarUno(id, args, visitados) {
  if (visitados.has(id)) return { codigo: 1, resumen: `up ${id}: ciclo en requiere (omitido)` };
  visitados.add(id);
  const ctx = await contextoEntrada(id, args, { autoBackend: true });
  if (!ctx.ok) {
    return { codigo: 1, resumen: `up ${id}: ${ctx.resumen}` };
  }
  const { entrada, proyecto, rutaAbs, porPuerto, procs } = ctx;
  // [por que] Una entrada con `host` vive en otra máquina (la VPS): este equipo no la arranca
  // salvo la emergencia `--local`, que queda explícita en el comando.
  if (esEntradaRemota(entrada) && !args.includes(FLAG_LOCAL)) {
    return { codigo: 1, resumen: `up ${id}: entrada remota (host ${entrada.host}): no se arranca en este equipo; usa el flujo remoto o --local solo en emergencia` };
  }
  if (ctx.sinCobertura) {
    return veredictoUpSinCobertura(id, await clasificarEntrada(proyecto, entrada, porPuerto, procs), ctx.sinCobertura);
  }
  // [por que 06AA-1] Via de reanimacion: exe ausente + `reconstruir`
  // declarado recompila antes de clasificar. Otra marca = rehusado con el
  // motivo del aviso (la entrada no se toca).
  if (entrada._avisoRegistro) {
    if (!entrada._exeAusente) {
      return { codigo: 1, resumen: `up ${id}: rehusado (${entrada._avisoRegistro}): el mando no toca entradas marcadas` };
    }
    const fallo = await asegurarExe(id, entrada, rutaAbs, { local: args.includes(FLAG_LOCAL) });
    if (fallo) return { codigo: 1, resumen: fallo };
  }
  const r = await clasificarEntrada(proyecto, entrada, porPuerto, procs);
  // [por que] Preflight de auxiliares: el mando no los lanza, pero si su puerto
  // lo tiene otro, el backend del proyecto no arrancara ahi. Se avisa antes de
  // lanzar lo propio; no bloquea (el auxiliar es externo al mando).
  const avisosAux = [];
  for (const a of entrada.auxiliares ?? []) {
    const ocupantes = (porPuerto.get(a.puerto) ?? []).map((o) => o.pid);
    if (!ocupantes.length) continue;
    const dueno = duenoDePuerto(a.puerto, ocupantes, procs, registroDeArgs(args));
    if (dueno?.id === id) continue;
    avisosAux.push(`auxiliar ${a.puerto} (${a.motivo}) ocupado por ${dueno?.id ?? `proceso ajeno pid ${ocupantes.join(',')}`}: ${id} no arrancara ahi; revisa PORT en su .env`);
  }
  const avisoSufijo = avisosAux.map((a) => `; aviso: ${a}`).join('');
  if (r.estado === 'bajo-mando') {
    return await conDependencias(id, entrada, args, visitados, 0, `up ${id}: ya-arriba (${r.motivo})${avisoSufijo}`);
  }
  const caidos = r.detalle.filter((d) => d.situacion === 'libre');
  const bloqueos = r.detalle.filter((d) => d.situacion !== 'libre' && d.situacion !== 'arriba');
  if (bloqueos.length > 0) {
    const b = bloqueos[0];
    // [por que] Si el puerto lo reclaman dos entradas, el rehusado lo dice:
    // el choque es del registro, no del pid que escucha.
    const entradasReg = registroDeArgs(args);
    const reclamados = (detectarCompartidos({ entradas: new Map(entradasReg.map((e) => [e.id, e])) }).find((c) => c.puerto === b.puerto)?.ids ?? []).filter((x) => x !== id);
    const dueno = duenoDePuerto(b.puerto, b.pids, procs, entradasReg);
    return {
      codigo: 1,
      resumen: `up ${id}: rehusado (puerto ${b.puerto}: ${b.situacion}${b.pids.length ? ` pids ${b.pids.join(',')}` : ''}): ${accionParaPuerto(id, b.puerto, b.pids, dueno, reclamados)}`,
    };
  }
  if (caidos.length === 0) {
    return { codigo: 1, resumen: `up ${id}: deriva sin puerto libre (${r.motivo}): nada arrancable` };
  }
  const timeoutMs = entrada.timeoutMs ?? 2000;
  const limiteMs = entrada.arranqueMs ?? 60_000;
  const healths = entrada.healths?.length ? entrada.healths : entrada.puertos.map((puerto) => ({ puerto }));
  const lanzados = [];
  for (const c of caidos) {
    const i = entrada.puertos.indexOf(c.puerto);
    const argvLanzador = entrada.boton[i];
    let lan;
    try {
      lan = await lanzar(entrada, rutaAbs, argvLanzador, envPara(entrada));
    } catch (e) {
      return { codigo: 1, resumen: `up ${id}: spawn fallo (puerto ${c.puerto}: ${e.message})` };
    }
    lanzados.push({ puerto: c.puerto, pid: lan.pid, rutaLog: lan.rutaLog });
  }
  for (const l of lanzados) {
    const h = healths.find((x) => x.puerto === l.puerto) ?? { puerto: l.puerto };
    const ok = await esperarProbe(l.puerto, h.ruta, h.esperaJson, timeoutMs, limiteMs, entrada.dominio);
    if (!ok) {
      return {
        codigo: 1,
        resumen: `up ${id}: arrancado pid ${l.pid} pero sin probe en ${limiteMs}ms (puerto ${l.puerto}, log ${l.rutaLog}): NO verde`,
      };
    }
    if (!(await oyenteDelProyecto(entrada, rutaAbs, l.puerto))) {
      return {
        codigo: 1,
        resumen: `up ${id}: probe responde en ${l.puerto} pero el oyente no es del proyecto (pid ${l.pid}, log ${l.rutaLog}): NO verde`,
      };
    }
  }
  return await conDependencias(
    id,
    entrada,
    args,
    visitados,
    0,
    `up ${id}: arrancado (${lanzados.map((l) => `${l.puerto} pid ${l.pid}`).join(', ')}) + probe verde${avisoSufijo}`,
  );
}


/* Asegura `requiere` tras el verde propio. Si el propio fallo (codigo!=0)
 * no se persiguen dependencias: el motivo principal manda y no se enmascara. */
async function conDependencias(id, entrada, args, visitados, codigoPropio, resumenPropio) {
  if (codigoPropio !== 0) return { codigo: codigoPropio, resumen: resumenPropio };
  // [por que 06AA-1] La marcada nunca llega aqui (arrancarUno rehusa antes),
  // pero un `requiere` con forma rota no debe iterar caracteres: array o nada.
  const deps = Array.isArray(entrada.requiere) ? entrada.requiere : [];
  if (deps.length === 0) return { codigo: 0, resumen: resumenPropio };
  const partes = [resumenPropio];
  let codigo = 0;
  for (const d of deps) {
    const rd = await arrancarUno(d, args, visitados);
    partes.push(`[dep] ${rd.resumen}`);
    if (rd.codigo !== 0) codigo = 2;
  }
  return { codigo, resumen: partes.join(' | ') };
}


/* CLI: doctor --all [--json] [--snapshot-file <ruta>] [--assert].
 * `up` vive en dev.mjs (mismo modulo, funcion exportada `up`). */
export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  if (args[0] !== '--all') {
    console.log('uso: doctor --all [--json] [--snapshot-file <ruta>] [--assert]');
    return 0;
  }
  const comoJson = args.includes('--json');
  const conAssert = args.includes('--assert');
  const iSnap = args.indexOf('--snapshot-file');
  const rutaSnap = iSnap >= 0 ? args[iSnap + 1] : null;

  let registro;
  try {
    registro = leerRegistro();
  } catch (e) {
    console.error(`registro: ${e.message}`);
    return 1;
  }
  let snapshot = null;
  let errorSensor = null;
  if (rutaSnap) {
    try {
      snapshot = JSON.parse(readFileSync(rutaSnap, 'utf8'));
    } catch (e) {
      console.error(`snapshot: no se pudo leer (${e.message})`);
      return 1;
    }
  } else {
    // [por que] Sin --snapshot-file la lista de proyectos sale del backend, igual
    // que status/up (contextoEntrada). Antes quedaba vacia: todo listener salia
    // como huerfano "(sin proyecto)", incluidos 8787/5175 de workspace-manager.
    // Sin snapshot no se clasifica a ciegas: falla con el motivo.
    let r = await leerSnapshotServidor();
    // [por que] La cache del backend puede superar el TTL (60 s): --assert la
    // rechazaria sin que el area haya cambiado. Se fuerza un escaneo solo entonces.
    if (!r.error && r.snapshot && Date.now() - new Date(r.snapshot.escaneadoEn).getTime() > TTL_MS) {
      r = await leerSnapshotServidor(true);
    }
    if (r.error || !r.snapshot) errorSensor = `snapshot: servidor 8787 sin datos (${r.error ?? 'vacio'}); arranca el backend o pasa --snapshot-file`;
    else snapshot = r.snapshot;
  }
  const proyectos = (snapshot?.proyectos ?? []).map((p) => ({ clave: p.clave, ruta: p.ruta }));
  // [por que] El tablero ignora entradas con repo (RESTAURANTE) y no llegan en el
  // snapshot: sin evaluarlas sus puertos salian huerfanos. Se evaluan con su ruta.
  const enSnapshot = new Set(proyectos.map((p) => p.clave));
  for (const e of registro.entradas.values()) {
    if (enSnapshot.has(e.id) || typeof e.ruta !== 'string') continue;
    proyectos.push({ clave: e.id, ruta: isAbsolute(e.ruta) ? e.ruta : resolve(RAIZ_REPO, e.ruta) });
  }
  // [por que] noAplica entra en el pool: opencode-propio-dev (gestion-externa) no
  // esta en ignorados, asi que sus listeners salian huerfanos sin dueño.
  const ignoradosArea = [...(snapshot?.config?.ignorados ?? []), ...Object.keys(registro.noAplica)].map((n) => ({
    clave: n,
    ruta: resolve(RAIZ_REPO, '..', n),
  }));
  const snapshotEn = snapshot?.escaneadoEn ?? null;

  let escucha = [];
  let establecidas = [];
  // [por que] Con sistema en el snapshot (lo escribe el servidor) no hace falta netstat propio.
  const sistema = snapshot?.sistema ?? null;
  if (sistema) ({ escucha, establecidas } = sistema);
  else if (!errorSensor) ({ escucha, establecidas, errorSensor } = await escuchaRobusta());
  const tomadoEn = new Date().toISOString();
  /* [por que 2026-10-20] Los artefactos (SSH a la 89, ~3 s medidos) solo dependen del
   * registro: se lanzan antes de clasificar y se esperan al armar el informe, en vez de
   * sumar su tiempo al de clasificar. */
  const artefactos = detectarArtefactos(registro);
  let clasif = { proyectos: [], huerfanos: [] };
  if (!errorSensor) {
    try {
      clasif = await clasificar(proyectos, registro, escucha, ignoradosArea, establecidas, sistema);
    } catch (e) {
      errorSensor = `clasificar: ${e.message}`;
    }
  }
  // [por que] derivaEnv es aviso: no entra en codigoSalida (el registro manda
  // sobre el .env, y un .env desfasado no debe tumbar el chequeo del tablero).
  // [por que 20AA-7] artefactos es aviso como derivaEnv: que el .exe de
  // MN-Escritorio no embeba el front nuevo no puede tumbar el chequeo del
  // tablero. Es lo unico del informe que sale a la 89 (~2,7 s medidos), sobre un
  // doctor que ya tarda ~23 s y que el servidor cachea 60 s.
  const informe = { version: 1, tomadoEn, snapshotEn, ttlMs: TTL_MS, errorSensor, compartidos: detectarCompartidos(registro), rust: detectarRust(registro), artefactos: await artefactos, derivaEnv: detectarDerivaEnv(registro), ...clasif };

  if (conAssert) {
    const fallos = [];
    if (informe.errorSensor) fallos.push(informe.errorSensor);
    if (informe.proyectos.length !== proyectos.length) {
      fallos.push(`cobertura: clasificados ${informe.proyectos.length} != snapshot ${proyectos.length}`);
    }
    // [por que] Anti-trampa: el enum de motivos rige la INTENCION humana
    // (sin-boton/no-aplica: por que nadie lo gestiona); deriva/bajo-mando/
    // parado llevan EVIDENCIA del sensor (texto libre: que se vio), no intencion.
    // Mezclarlos permitiria esconder proyectos tras 'otro' inventados o
    // motivos vacios. `otro` >20% = el registro dejo de describir el area.
    let otros = 0;
    let clasificados = 0;
    for (const p of informe.proyectos) {
      if (p.estado === 'sin-boton' || p.estado === 'no-aplica') {
        clasificados++;
        try {
          validarMotivo(p.motivo, p.clave);
        } catch (e) {
          fallos.push(e.message);
        }
        if (typeof p.motivo === 'string' && p.motivo.startsWith('otro{')) otros++;
      } else if (p.estado === 'deriva' || p.estado === 'bajo-mando' || p.estado === 'parado') {
        if (typeof p.motivo !== 'string' || p.motivo.length === 0 || p.motivo.length > 200) {
          fallos.push(`${p.clave}: evidencia vacia o excesiva (${p.estado})`);
        }
      } else {
        fallos.push(`${p.clave}: estado desconocido '${p.estado}'`);
      }
    }
    if (clasificados > 0 && otros / clasificados > 0.2) {
      fallos.push(`otro supera 20% (${otros}/${clasificados}): el registro no describe el area`);
    }
    for (const c of informe.compartidos ?? []) {
      fallos.push(`puerto ${c.puerto} compartido: ${c.ids.join(', ')}`);
    }
    if (snapshotEn) {
      const edad = Date.now() - new Date(snapshotEn).getTime();
      if (!(edad >= 0 && edad <= TTL_MS)) fallos.push(`snapshot stale (edad ${Math.round(edad / 1000)}s > TTL)`);
    } else if (proyectos.length > 0) {
      fallos.push('snapshot sin escaneadoEn');
    }
    if (fallos.length > 0) {
      console.error(`ASSERT FAIL:\n- ${fallos.join('\n- ')}`);
      const listaOtro = informe.proyectos.filter((p) => typeof p.motivo === 'string' && p.motivo.startsWith('otro{'));
      if (listaOtro.length > 0) {
        console.error(`OTROS:\n- ${listaOtro.map((p) => `${p.clave}: ${p.motivo}`).join('\n- ')}`);
      }
      return 1;
    }
  }

  if (comoJson) console.log(JSON.stringify(informe));
  else {
    console.log(tabla(informe));
    // [por que 14AA-5] Aviso bajo la tabla; no entra en codigoSalida.
    await avisoTaller();
  }
  return codigoSalida(informe);
}

