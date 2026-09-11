/* certificacion.mjs — caché de certificación de release del gate (109A-9).
 *
 * [por que] La certificación de release es un hecho GLOBAL de `(tool, commit,
 * buildScript, testScript, entorno)`: compilar y testear el mismo commit da el
 * mismo resultado en los 11 consumidores. Sentinel indexa la evidencia por
 * `(tool, commit)` (`releaseEvidence` en glory-sentinel/src/core/diagnose.ts),
 * pero cada consumidor guardaba su copia recalculándola: 248-407 s por proyecto
 * (~5 min) y 42-55 min por lote, casi todo el mismo compile+suite repetido.
 *
 * Este módulo separa el CÁLCULO (una vez por commit) del REGISTRO LOCAL (una
 * evidencia por consumidor). Reglas de diseño:
 *   - fail-closed: cualquier duda (falta, ilegible, corrupta, esquema distinto,
 *     campos que no coinciden, resultado no válido) es un MISS y el llamante
 *     ejecuta el camino completo. Nunca se fabrica evidencia.
 *   - la clave incluye buildScript/testScript/plataforma/runtime: un consumidor
 *     con otra suite o en otra máquina no puede recibir el hit de otro.
 *   - vive FUERA de todo repo (por defecto bajo el directorio de caché del
 *     usuario): el chequeo de staging limpio mira `git status` del checkout, y
 *     escribir dentro lo rompería. Nunca en una ruta temporal que se purgue, o
 *     el ahorro desaparecería justo cuando más se necesita.
 *   - escritura atómica (tmp + rename): dos setups en paralelo no dejan una
 *     entrada a medias.
 *
 * Límite conocido y aceptado: la certificación prueba el COMMIT, no el
 * contenido de los artefactos gitignored (`out/`, `dist/`). Ese límite es
 * preexistente; por eso un hit exige además que el CLI provisionado exista
 * (ver quality-setup.mjs). Ver skill `build-artefactos`.
 *
 * Uso: importar desde el adapter único. Tests: `npm run quality:cert:test`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ESQUEMA = 1;

/* Campos que forman la identidad de la certificación. Todos deben coincidir
 * para aceptar una entrada: la comparación campo a campo es la red de
 * seguridad frente a un nombre de fichero reutilizado o manipulado. */
const CAMPOS_CLAVE = ['tool', 'commit', 'buildScript', 'testScript', 'platform', 'nodeVersion'];

function texto(valor) {
  return valor === null || valor === undefined ? '' : String(valor);
}

/* Normaliza la clave a cadenas: `null`/`undefined` y ausentes son lo mismo
 * (un script no declarado), para que la clave sea estable entre manifiestos. */
export function normalizarClave(datos = {}) {
  const clave = {};
  for (const campo of CAMPOS_CLAVE) clave[campo] = texto(datos[campo]);
  return clave;
}

/* Huella del entorno y de los scripts. Entra en el NOMBRE del fichero (para que
 * dos certificaciones distintas del mismo commit no se pisen) y se revalida al
 * leer. */
export function huellaClave(datos = {}) {
  const clave = normalizarClave(datos);
  const material = [clave.buildScript, clave.testScript, clave.platform, clave.nodeVersion].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 8);
}

function segmento(valor) {
  return texto(valor).toLowerCase().replace(/[^a-z0-9._-]+/gu, '_');
}

export function nombreCertificacion(datos = {}) {
  const clave = normalizarClave(datos);
  return `${segmento(clave.tool)}-${segmento(clave.commit).slice(0, 12)}-${huellaClave(clave)}.json`;
}

/* Directorio de la caché. Override explícito (`GLORY_CERT_CACHE`) para pruebas
 * y para moverla de unidad; por defecto el hogar de caché del usuario, jamás
 * dentro de un repo ni en una ruta de purga automática. */
export function directorioCertificaciones(env = process.env) {
  const override = texto(env.GLORY_CERT_CACHE).trim();
  if (override) return path.resolve(override);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'GlorySentinel', 'certificaciones');
  const base = texto(env.XDG_CACHE_HOME).trim() || path.join(os.homedir(), '.cache');
  return path.join(base, 'glory-sentinel', 'certificaciones');
}

export function rutaCertificacion(datos = {}, { dir } = {}) {
  return path.join(dir ?? directorioCertificaciones(), nombreCertificacion(datos));
}

/* Lee una certificación. Devuelve `{ entrada, ruta, motivo }`: `entrada` no nulo
 * SOLO si la clave coincide por completo y el resultado es utilizable; si no,
 * el motivo explica por qué se descartó (para que el log no diga simplemente
 * "miss" cuando el problema es otro). */
export function leerCertificacion(datos = {}, { dir } = {}) {
  const clave = normalizarClave(datos);
  const ruta = rutaCertificacion(clave, { dir });
  let bruto;
  try {
    bruto = fs.readFileSync(ruta, 'utf8');
  } catch (error) {
    return { entrada: null, ruta, motivo: error?.code === 'ENOENT' ? 'ausente' : 'ilegible' };
  }
  let entrada;
  try {
    entrada = JSON.parse(bruto);
  } catch {
    return { entrada: null, ruta, motivo: 'corrupta' };
  }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { entrada: null, ruta, motivo: 'corrupta' };
  }
  if (entrada.schemaVersion !== ESQUEMA) return { entrada: null, ruta, motivo: 'esquema' };
  for (const campo of CAMPOS_CLAVE) {
    if (texto(entrada[campo]) !== clave[campo]) return { entrada: null, ruta, motivo: `campo ${campo}` };
  }
  if (entrada.compile !== 'passed') return { entrada: null, ruta, motivo: 'compile' };
  const suiteEsperada = clave.testScript ? 'passed' : 'not-configured';
  if (entrada.suite !== suiteEsperada) return { entrada: null, ruta, motivo: 'suite' };
  return { entrada, ruta, motivo: null };
}

/* Registra una certificación de forma atómica. `resultado` permite dejar
 * constancia de qué se ejecutó realmente (por defecto compile+suite en verde,
 * que es el único caso en el que el adapter llama a esta función). */
export function escribirCertificacion(datos = {}, resultado = {}, { dir } = {}) {
  const clave = normalizarClave(datos);
  const destino = rutaCertificacion(clave, { dir });
  const entrada = {
    schemaVersion: ESQUEMA,
    ...clave,
    compile: resultado.compile ?? 'passed',
    suite: resultado.suite ?? (clave.testScript ? 'passed' : 'not-configured'),
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporal = `${destino}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(temporal, `${JSON.stringify(entrada, null, 2)}\n`);
  fs.renameSync(temporal, destino);
  return { ruta: destino, entrada };
}

/* Clave completa lista para el log (commit corto, sin ruido). */
export function describirClave(datos = {}) {
  const clave = normalizarClave(datos);
  return `${clave.tool}@${clave.commit.slice(0, 12)}`;
}
