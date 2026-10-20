/* Subcomando del doctor `up <id>`: arranca los puertos libres de un proyecto y sus `requiere`.
 * Tiene E/S (spawn, probe, registro); indice.mjs lo reexporta y doctor.mjs lo expone. */

import { clasificarEntrada, detectarCompartidos } from './clasificar.mjs';
import { envPara } from './ficha/entorno.mjs';
import { FLAG_LOCAL } from '../../shared/vps.mjs';
import { contextoEntrada, esperarProbe, lanzar, oyenteDelProyecto, veredictoUpSinCobertura } from './lanzar.mjs';
import { accionParaPuerto, duenoDePuerto, esEntradaRemota } from './sistema/puertos.mjs';
import { leerRegistro } from './ficha/registro.mjs';
import { asegurarExe } from './sistema/rust.mjs';

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
