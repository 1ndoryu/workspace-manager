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
import { asegurarSesion } from '../../remoto/rcargo.mjs';
import { rutaAbsDe } from '../remoto/rutaLocal.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const API = URL_API;
export const CLAVES_COMANDOS = ['gate', 'test-archivo', 'typecheck', 'build'];
const USO = `uso:
  gate <id> --inicio     guarda la línea base de hallazgos antes de la tarea
  gate <id> --cierre [--tarea <ID>]   hallazgos nuevos frente a la base + autogate
                         (comandos.gate, en la 89; sin orden se omite con aviso;
                          --tarea pasa el ID al gate del proyecto: sin él, el autogate
                          no sabe qué tarea se cierra)
                         (+ --forzar: re-analiza aunque el árbol no haya cambiado)
                         (+ --local: emergencia, VPS caída; analiza aquí, sin caché, con aviso)
  comandos <id>          contrato de comandos del proyecto (registro.json)`;

/* Argumentos de `gate`: <id>, exactamente uno de --inicio / --cierre y, opcionales,
 * --forzar, --local y --tarea <ID>. */
export function parsearArgsGate(argv) {
  const [id, ...resto] = argv;
  if (!id || id.startsWith('--')) return { error: 'falta <id> del proyecto' };
  const conocidas = ['--inicio', '--cierre', '--forzar', '--local'];
  const extra = resto.filter((a, i) => !conocidas.includes(a) && a !== '--tarea' && resto[i - 1] !== '--tarea');
  if (extra.length) return { error: `opción no reconocida: ${extra[0]}` };
  const inicio = resto.includes('--inicio');
  const cierre = resto.includes('--cierre');
  if (inicio === cierre) return { error: 'elige exactamente uno: --inicio o --cierre' };
  const iTarea = resto.indexOf('--tarea');
  const tarea = iTarea >= 0 ? resto[iTarea + 1] : undefined;
  if (iTarea >= 0 && (!tarea || tarea.startsWith('--'))) return { error: '--tarea necesita un <ID>' };
  return {
    id,
    modo: inicio ? 'inicio' : 'cierre',
    forzar: resto.includes('--forzar'),
    local: resto.includes('--local'),
    tarea,
  };
}

/* Orden del autogate con la tarea de la sesión detrás. [por que 10AA-3] El contrato
 * de la ficha (`npm run gate:check`) no puede saber qué tarea se está cerrando, y sin
 * el id el gate del proyecto aborta o analiza contra una tarea que no existe: el
 * autogate no podía pasar nunca en RESTAURANTE ni en WANDORIUS. Con npm hace falta el
 * separador `--` para que el id llegue al script y no a npm. */
export function ordenAutogate(comando, tarea) {
  if (!tarea) return comando;
  return /^npm(\.cmd)?\s+run\s/.test(comando) ? `${comando} -- ${tarea}` : `${comando} ${tarea}`;
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
export function decidirAutogate(entrada, emergencia, tarea) {
  if (entrada?.comandos === undefined) return { estado: 'omitido', motivo: 'sin contrato de comandos en registro.json' };
  const r = leerComandos(entrada.comandos);
  if (r.error) return { estado: 'error', motivo: r.error };
  if (!r.comandos.gate) return { estado: 'omitido', motivo: 'sin comandos.gate en registro.json' };
  if (emergencia) return { estado: 'omitido', motivo: 'emergencia --local: el autogate no corre en el portátil; pásalo en la 89' };
  return { estado: 'pendiente', orden: ordenAutogate(r.comandos.gate, tarea) };
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

/* [10AA-3] Submódulos de herramientas en la réplica de la 89.
 *
 * Mutagen NO sincroniza `.git` (está en `sync.ignorar`), así que el HEAD de cada submódulo se
 * queda en el commit del día en que se clonó y su `git status` da por modificado todo el árbol
 * que Mutagen acaba de copiar. El gate de la 89 verifica el checkout de la herramienta por git
 * (`rev-parse`, `status`, `git archive`), así que sin esto muere con «checkout modificado» antes
 * de analizar nada, y el fallo no tiene nada que ver con el código del proyecto.
 *
 * `reset --mixed` mueve HEAD y el índice SIN tocar el árbol de trabajo: lo que Mutagen copió se
 * queda como está y pasa a compararse contra el commit fijado. Best-effort: si el commit no está
 * en el remoto de la 89, se avisa y se sigue — el proyecto ya declara esa réplica con
 * `GLORY_TALLER=1` y relaja allí lo que solo el repo padre puede probar. */
export function ordenSubmodulosReplica(dirRemoto, manifiesto) {
  const tools = manifiesto?.tools ?? {};
  const seguros = Object.values(tools).filter(
    t => typeof t?.sourcePath === 'string' && /^[\w./-]+$/.test(t.sourcePath) && /^[0-9a-f]{40}$/.test(t?.commit ?? ''),
  );
  if (seguros.length === 0) return null;
  const pasos = seguros.map(t => {
    const dir = `${dirRemoto}/${t.sourcePath}`;
    const pin = t.commit;
    return [
      `if [ -d '${dir}/.git' ] && [ "$(git -C '${dir}' rev-parse HEAD 2>/dev/null)" != '${pin}' ]; then`,
      `  git -C '${dir}' fetch --quiet origin >/dev/null 2>&1;`,
      `  if git -C '${dir}' cat-file -e '${pin}^{commit}' 2>/dev/null; then`,
      `    git -C '${dir}' reset --mixed '${pin}' >/dev/null;`,
      `  else echo "[replica] ${t.sourcePath}: el pin ${pin} no está en el remoto de la 89; se deja como estaba" >&2; fi;`,
      'fi',
    ].join('\n');
  });
  return pasos.join('\n');
}

export function asegurarSubmodulosReplica(config, dirRemoto, carpeta) {
  const ruta = join(carpeta, 'quality-tools.json');
  if (!existsSync(ruta)) return null;
  let manifiesto;
  try {
    manifiesto = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
  const orden = ordenSubmodulosReplica(dirRemoto, manifiesto);
  if (!orden) return null;
  const r = ejecutarEnVps(config, dirRemoto, ['bash', '-c', orden], { capturar: true });
  // Best-effort declarado: no cambia el resultado del gate, solo evita que falle por metadata ajena.
  return r.status === 0 ? null : `no se pudieron alinear los submódulos de la réplica (exit ${r.status})`;
}

/* Corre el autogate en la VPS por la misma vía que los tests (cm-heavy, réplica en <dirRemotoBase>/<id>).
 * [por que] Un script propio no invoca npm por su cuenta: el wrapper de la VPS es el que pone el candado
 * de carga pesada y el PATH del taller (AGENTS §2). */
export function correrAutogate(id, entrada, emergencia, tarea) {
  if (!entrada) return { estado: 'error', motivo: `'${id}' no está en registro.json` };
  const d = decidirAutogate(entrada, emergencia, tarea);
  if (d.estado !== 'pendiente') return d;
  const config = cargarTaller();
  if (!config) return { estado: 'error', motivo: 'sin VPS configurada (config/taller.json)' };
  const carpeta = rutaAbsDe(entrada);
  const dirRemoto = dirRemotoDe(config, id, carpeta, carpeta);
  /* [10AA-3] El gate es la primera orden que corre tras editar, y la que sufre la sesión de Mutagen
   * desalineada: con patrones viejos, el árbol de la 89 recibe del portátil lo que la 89 acaba de
   * generar (herramientas provisionadas, `out`) y el gate muere por artefactos, no por el código.
   * Best-effort: si la sesión no se puede asegurar, se avisa y se sigue — el gate decide por sí mismo. */
  if (asegurarSesion({ config, proyecto: id, rutaLocal: carpeta, cwd: carpeta }) !== 0) {
    process.stderr.write(`[gate] ${id}: no se pudo asegurar la sesión de Mutagen; la réplica puede estar desalineada\n`);
  }
  const avisoReplica = asegurarSubmodulosReplica(config, dirRemoto, carpeta);
  if (avisoReplica) process.stderr.write(`[gate] ${id}: ${avisoReplica}\n`);
  const r = ejecutarEnVps(config, dirRemoto, ['sh', '-c', d.orden], { capturar: true });
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
    const auto = correrAutogate(p.id, leerEntrada(p.id), destino.emergencia, p.tarea);
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
