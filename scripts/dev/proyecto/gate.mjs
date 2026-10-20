/* Mando del gate y del contrato de comandos (10AA-2 F9.4 y F9.5).
 *   gate <id> --inicio   guarda la línea base de hallazgos antes de la tarea
 *   gate <id> --cierre   lista solo los hallazgos NUEVOS frente a esa base
 *   comandos <id>        imprime el contrato de comandos del proyecto
 * [por que] Sustituye los dos pasos manuales de AGENTS.md §6 (GET al empezar,
 * POST al cerrar y comparar a ojo) y evita releer package.json en cada tarea.
 * El análisis lo hace el backend y lo reutiliza si el árbol de trabajo no
 * cambió desde el último del gate (huella, 13AA-3); --forzar lo salta; el snapshot vive en data/gate-inicio/,
 * ignorado por Git (data/*). Tras los hallazgos, `gate --cierre` corre también el autogate del
 * proyecto (`comandos.gate`) en la VPS. Los parsers y formateadores son puros y se exportan
 * para test; la red y el disco quedan en `gate`, `comandos` y `correrAutogate`. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rutaConfigPrivada } from '../../shared/rutas.mjs';
import { cabeceraAutorizacion } from '../token.mjs';
import { URL_API } from '../../shared/puertos.mjs';
import { cargarTaller, dirRemotoDe, ejecutarEnVps, emergenciaLocal, mensajeSinVps } from '../../shared/vps.mjs';
import { rutaAbsDe } from '../remoto/rutaLocal.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const API = URL_API;
export const CLAVES_COMANDOS = ['gate', 'test-archivo', 'typecheck', 'build'];
const USO = `uso:
  gate <id> --inicio     guarda la línea base de hallazgos antes de la tarea
  gate <id> --cierre     lista solo los hallazgos nuevos frente a la base y corre el autogate
                         (comandos.gate, en la 89; sin orden se omite con aviso)
                         (+ --forzar: re-analiza aunque el árbol no haya cambiado)
                         (+ --local: emergencia, VPS caída; analiza aquí, sin caché, con aviso)
  comandos <id>          contrato de comandos del proyecto (registro.json)`;

/* Argumentos de `gate`: <id>, exactamente uno de --inicio / --cierre y, opcionales, --forzar y --local. */
export function parsearArgsGate(argv) {
  const [id, ...resto] = argv;
  if (!id || id.startsWith('--')) return { error: 'falta <id> del proyecto' };
  const conocidas = ['--inicio', '--cierre', '--forzar', '--local'];
  const extra = resto.filter((a) => !conocidas.includes(a));
  if (extra.length) return { error: `opción no reconocida: ${extra[0]}` };
  const inicio = resto.includes('--inicio');
  const cierre = resto.includes('--cierre');
  if (inicio === cierre) return { error: 'elige exactamente uno: --inicio o --cierre' };
  return {
    id,
    modo: inicio ? 'inicio' : 'cierre',
    forzar: resto.includes('--forzar'),
    local: resto.includes('--local'),
  };
}

/* Ruta del snapshot de un proyecto. La clave es la carpeta del proyecto
 * (puede tener espacios: "PROYECTO TASKS"), así que no se normaliza. */
export function rutaSnapshot(clave, raiz = RAIZ) {
  return join(raiz, 'data', 'gate-inicio', `${clave}.json`);
}

/* Valida el bloque `comandos` de una entrada del registro. `null` en una clave
 * significa «no aplica» (p. ej. test-archivo sin filtro posible). */
export function leerComandos(bloque) {
  if (bloque === undefined) return { error: 'sin contrato de comandos en registro.json (campo comandos)' };
  if (typeof bloque !== 'object' || bloque === null || Array.isArray(bloque)) {
    return { error: 'comandos debe ser un objeto' };
  }
  for (const [clave, valor] of Object.entries(bloque)) {
    if (!CLAVES_COMANDOS.includes(clave)) return { error: `comandos: clave desconocida '${clave}'` };
    if (valor !== null && (typeof valor !== 'string' || valor.trim() === '')) {
      return { error: `comandos.${clave} debe ser un texto no vacío o null` };
    }
  }
  return { comandos: bloque };
}

/* Líneas de salida para los hallazgos nuevos, con archivo:línea. */
export function formatearNuevos(nuevos) {
  return nuevos.map((h) => `  ${h.archivo}:${h.linea ?? '?'}  ${h.ruleId}  ${h.mensaje}`);
}

/* Entrada del proyecto en registro.json, o undefined si no existe. */
export function leerEntrada(id, raiz = RAIZ) {
  const registro = JSON.parse(readFileSync(rutaConfigPrivada('registro.json', raiz), 'utf8'));
  return registro.proyectos.find((x) => x.id === id);
}

/* Decide si el autogate (`comandos.gate`) corre. Sin contrato o sin orden se omite con aviso:
 * no bloquea a los proyectos que no tienen autogate. En emergencia (`--local`) no corre en el
 * portátil, porque los tests van a la 89 (AGENTS §1). */
export function decidirAutogate(entrada, emergencia) {
  if (entrada?.comandos === undefined) return { estado: 'omitido', motivo: 'sin contrato de comandos en registro.json' };
  const r = leerComandos(entrada.comandos);
  if (r.error) return { estado: 'error', motivo: r.error };
  if (!r.comandos.gate) return { estado: 'omitido', motivo: 'sin comandos.gate en registro.json' };
  if (emergencia) return { estado: 'omitido', motivo: 'emergencia --local: el autogate no corre en el portátil; pásalo en la 89' };
  return { estado: 'pendiente', orden: r.comandos.gate };
}

/* Últimas líneas de la salida: un fallo se lee desde el final. */
export function colaSalida(texto, lineas = 40) {
  return texto.trimEnd().split('\n').slice(-lineas);
}

/* Líneas de salida del autogate. Un fallo o un error no se calla: el mando devuelve 1. */
export function lineasAutogate(id, a) {
  if (a.estado === 'ok') return [`gate ${id} --cierre: autogate OK en la 89 (${a.orden})`];
  if (a.estado === 'omitido') return [`gate ${id} --cierre: autogate omitido: ${a.motivo}`];
  if (a.estado === 'fallo') return [`gate ${id} --cierre: autogate FALLÓ en la 89 (rc ${a.rc}, ${a.orden}). Últimas líneas:`, ...colaSalida(a.salida)];
  return [`gate ${id} --cierre: autogate no ejecutado: ${a.motivo}`];
}

/* Corre el autogate en la VPS por la misma vía que los tests (cm-heavy, réplica en <dirRemotoBase>/<id>).
 * [por que] Un script propio no invoca npm por su cuenta: el wrapper de la VPS es el que pone el candado
 * de carga pesada y el PATH del taller (AGENTS §2). */
export function correrAutogate(id, entrada, emergencia) {
  if (!entrada) return { estado: 'error', motivo: `'${id}' no está en registro.json` };
  const d = decidirAutogate(entrada, emergencia);
  if (d.estado !== 'pendiente') return d;
  const config = cargarTaller();
  if (!config) return { estado: 'error', motivo: 'sin VPS configurada (config/taller.json)' };
  const carpeta = rutaAbsDe(entrada);
  const r = ejecutarEnVps(config, dirRemotoDe(config, id, carpeta, carpeta), ['sh', '-c', d.orden], { capturar: true });
  const aviso = mensajeSinVps(r.status, config.host);
  if (aviso) return { estado: 'error', motivo: aviso };
  return { estado: r.status === 0 ? 'ok' : 'fallo', rc: r.status, orden: d.orden, salida: r.stdout ?? '' };
}

/* Llamada al backend. Lanza con un mensaje accionable si no responde. */
export async function pedir(metodo, ruta, cuerpo) {
  // [por que] Fuera del try: un token ausente debe salir tal cual, no como "backend sin respuesta".
  const cabeceras = cabeceraAutorizacion();
  let res;
  try {
    // [por que 14AA-5] connection: close: sin keep-alive no queda socket abierto al salir por
    // process.exit (dev.mjs); con dos sockets así Node en Windows aborta con exit 127.
    res = await fetch(`${API}${ruta}`, {
      method: metodo,
      headers: { ...cabeceras, 'content-type': 'application/json', connection: 'close' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(200_000),
    });
  } catch (e) {
    throw new Error(`backend ${API} sin respuesta (${e?.message ?? e}). Arranca con: Arranque up "<id del manager>"`);
  }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalle = datos.detalle ? `: ${datos.detalle}` : '';
    throw new Error(`${datos.error ?? `HTTP ${res.status}`}${detalle}`);
  }
  return datos;
}

export async function gate(argv) {
  const p = parsearArgsGate(argv);
  if (p.error) {
    console.error(`gate: ${p.error}\n${USO}`);
    return 1;
  }
  let destino;
  try {
    destino = emergenciaLocal(argv);
  } catch (e) {
    console.error(`gate ${p.id}: ${e?.message ?? e}`);
    return 1;
  }
  if (destino.aviso) console.error(destino.aviso);
  try {
    if (p.modo === 'inicio') {
      const a = await pedir('POST', '/api/gate/analizar', { clave: p.id, forzar: p.forzar, arbol: true, local: destino.emergencia });
      if (a.estado === 'error') throw new Error(`el análisis falló: ${a.error ?? 'sin detalle'}`);
      const ruta = rutaSnapshot(p.id);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(ruta, `${JSON.stringify({ clave: p.id, creadoEn: new Date().toISOString(), hallazgos: a.hallazgos }, null, 2)}\n`);
      console.log(`gate ${p.id} --inicio: ${a.hallazgos.length} hallazgos de base en data/gate-inicio/${p.id}.json`);
      return 0;
    }
    const ruta = rutaSnapshot(p.id);
    if (!existsSync(ruta)) {
      console.error(`gate ${p.id} --cierre: sin línea base. Ejecuta antes: Arranque gate "${p.id}" --inicio`);
      return 1;
    }
    const base = JSON.parse(readFileSync(ruta, 'utf8'));
    const r = await pedir('POST', '/api/gate/comparar', { clave: p.id, base: base.hallazgos, forzar: p.forzar, local: destino.emergencia });
    console.log(`gate ${p.id} --cierre: ${r.nuevos.length} nuevos, ${r.resueltos} resueltos (base ${base.hallazgos.length}, ahora ${r.total})`);
    for (const linea of formatearNuevos(r.nuevos)) console.log(linea);
    // Sentinel y autogate son puertas independientes: se corren las dos y el cierre falla si una falla.
    const auto = correrAutogate(p.id, leerEntrada(p.id), destino.emergencia);
    for (const linea of lineasAutogate(p.id, auto)) (auto.estado === 'fallo' || auto.estado === 'error' ? console.error : console.log)(linea);
    return r.nuevos.length > 0 || auto.estado === 'fallo' || auto.estado === 'error' ? 1 : 0;
  } catch (e) {
    console.error(`gate ${p.id}: ${e?.message ?? e}`);
    return 1;
  }
}

export async function comandos(argv, raiz = RAIZ) {
  const [id, ...resto] = argv;
  if (!id || id.startsWith('--')) {
    console.error(`comandos: falta <id> del proyecto\n${USO}`);
    return 1;
  }
  const entrada = leerEntrada(id, raiz);
  if (!entrada) {
    console.error(`comandos: '${id}' no está en registro.json`);
    return 1;
  }
  const r = leerComandos(entrada.comandos);
  if (r.error) {
    console.error(`comandos ${id}: ${r.error}`);
    return 1;
  }
  if (resto.includes('--json')) {
    console.log(JSON.stringify({ id, ruta: entrada.ruta, comandos: r.comandos }, null, 2));
    return 0;
  }
  console.log(`comandos ${id} (cwd: ${entrada.ruta})`);
  for (const clave of CLAVES_COMANDOS) {
    console.log(`  ${clave.padEnd(13)} ${r.comandos[clave] ?? '-'}`);
  }
  return 0;
}
