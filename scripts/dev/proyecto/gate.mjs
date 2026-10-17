/* Mando del gate y del contrato de comandos (10AA-2 F9.4 y F9.5).
 *   gate <id> --inicio   guarda la línea base de hallazgos antes de la tarea
 *   gate <id> --cierre   lista solo los hallazgos NUEVOS frente a esa base
 *   comandos <id>        imprime el contrato de comandos del proyecto
 * [por que] Sustituye los dos pasos manuales de AGENTS.md §6 (GET al empezar,
 * POST al cerrar y comparar a ojo) y evita releer package.json en cada tarea.
 * El análisis lo hace el backend (8787) y lo reutiliza si el árbol de trabajo no
 * cambió desde el último del gate (huella, 13AA-3); --forzar lo salta; el snapshot vive en data/gate-inicio/,
 * ignorado por Git (data/*). Los parsers y formateadores son puros y se exportan
 * para test; la red y el disco quedan en `gate` y `comandos`. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rutaConfigPrivada } from '../../shared/rutas.mjs';
import { cabeceraAutorizacion } from '../token.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const API = process.env.WM_API ?? 'http://127.0.0.1:8787';
export const CLAVES_COMANDOS = ['gate', 'test-archivo', 'typecheck', 'build'];
const USO = `uso:
  gate <id> --inicio     guarda la línea base de hallazgos antes de la tarea
  gate <id> --cierre     lista solo los hallazgos nuevos frente a la base
                         (+ --forzar: re-analiza aunque el árbol no haya cambiado)
  comandos <id>          contrato de comandos del proyecto (registro.json)`;

/* Argumentos de `gate`: <id>, exactamente uno de --inicio / --cierre y, opcional, --forzar. */
export function parsearArgsGate(argv) {
  const [id, ...resto] = argv;
  if (!id || id.startsWith('--')) return { error: 'falta <id> del proyecto' };
  const extra = resto.filter((a) => a !== '--inicio' && a !== '--cierre' && a !== '--forzar');
  if (extra.length) return { error: `opción no reconocida: ${extra[0]}` };
  const inicio = resto.includes('--inicio');
  const cierre = resto.includes('--cierre');
  if (inicio === cierre) return { error: 'elige exactamente uno: --inicio o --cierre' };
  return { id, modo: inicio ? 'inicio' : 'cierre', forzar: resto.includes('--forzar') };
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
  try {
    if (p.modo === 'inicio') {
      const a = await pedir('POST', '/api/gate/analizar', { clave: p.id, forzar: p.forzar, arbol: true });
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
    const r = await pedir('POST', '/api/gate/comparar', { clave: p.id, base: base.hallazgos, forzar: p.forzar });
    console.log(`gate ${p.id} --cierre: ${r.nuevos.length} nuevos, ${r.resueltos} resueltos (base ${base.hallazgos.length}, ahora ${r.total})`);
    for (const linea of formatearNuevos(r.nuevos)) console.log(linea);
    return r.nuevos.length > 0 ? 1 : 0;
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
  const registro = JSON.parse(readFileSync(rutaConfigPrivada('registro.json', raiz), 'utf8'));
  const entrada = registro.proyectos.find((x) => x.id === id);
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
