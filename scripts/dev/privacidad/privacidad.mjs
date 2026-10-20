/* Detector de datos personales (19AA-12). Busca en el contenido que se va a
 * commitear o que ya está en el historial: rutas de usuario, IPs, tokens y los
 * términos privados de cada área. [por que] El repo se publica: un dato personal
 * que se cuele en un commit ya no se puede retirar sin reescribir la historia, así
 * que el detector corre ANTES de comitear.
 * [por que] El correo no cuenta: es público (decisión de la usuaria, 2026-10-19).
 * Los términos privados (hosts, nombres de máquina) viven en
 * config/privacidad.local.json, fuera del repo; el detector no los lleva dentro.
 * Línea con `privacidad:ignorar` = excepción explícita y visible en el código. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARCA_IGNORAR = 'privacidad:ignorar';
// El detector no se audita a sí mismo: sus reglas y fixtures contienen los patrones.
const RUTAS_EXCLUIDAS = new Set(['scripts/dev/privacidad/privacidad.mjs', 'scripts/dev/privacidad/privacidad.test.mjs']);
// Los lockfiles tienen miles de versiones con forma de IP: no son hallazgos.
const SIN_IP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|Cargo\.lock|yarn\.lock)$/;
// Sin dato personal: bucle local (127/8, 0.0.0.0) y rangos de documentación (RFC 5737).
const IP_NO_PERSONAL = /^(127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;
// Nombres de usuario de ejemplo: un fixture con «usuario» no es una cuenta real.
const USUARIO_EJEMPLO = /^(usuario|user|usuarioejemplo|ejemplo|example|<[^>]+>)$/i;

/* Reglas genéricas: válidas para cualquier área de trabajo. */
export const REGLAS_GENERICAS = [
  { id: 'ruta-usuario-windows', re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>`]+/i, excluye: (m) => USUARIO_EJEMPLO.test(m.split(/[\\/]+/).pop()) },
  { id: 'ruta-home-linux', re: /\/home\/[a-z_][a-z0-9_-]*/, excluye: (m) => USUARIO_EJEMPLO.test(m.slice(6)) },
  { id: 'token', re: /gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // [por que] Solo un literal entre comillas es un secreto. Sin comillas, `token: process.env.X_TOKEN`
  // casaba como valor de 16+ caracteres: era una expresión de código, no un secreto.
  { id: 'secreto-asignado', re: /(token|secret|password|passwd|api[_-]?key)\s*[:=]\s*(["'])[^"'\s]{16,}\2/i },
];

/* Versión de una regla para términos privados (lista literal del área). */
export function reglaTermino(termino) {
  const escapado = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { id: 'termino-privado', re: new RegExp(`(^|[^A-Za-z0-9-])${escapado}(?![A-Za-z0-9-])`, 'i') };
}

/* Lee config/privacidad.local.json: { "terminos": [...] }. Sin el fichero no hay
 * términos privados: el detector sigue con las reglas genéricas (degradación, no fallo). */
export function reglasPrivadas(rutaConfig) {
  if (!existsSync(rutaConfig)) return [];
  const datos = JSON.parse(readFileSync(rutaConfig, 'utf8'));
  return (datos.terminos ?? []).filter((t) => typeof t === 'string' && t.length > 0).map(reglaTermino);
}

/* Oculta el valor encontrado: el informe nunca repite el dato personal. */
function ocultar(fragmento) {
  return fragmento.length <= 4 ? '****' : `${fragmento.slice(0, 2)}…[${fragmento.length} car.]`;
}

function ipsDeLinea(linea) {
  const hallazgos = [];
  for (const m of linea.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)) {
    const ip = m[0];
    const octetos = ip.split('.').map(Number);
    if (octetos.some((o) => o > 255) || IP_NO_PERSONAL.test(ip)) continue;
    hallazgos.push({ regla: 'ip', fragmento: ip });
  }
  return hallazgos;
}

/* Hallazgos de un texto. Devuelve { linea, regla, fragmento (oculto) }. */
export function hallazgosEnTexto(texto, { ruta = '', reglas = [] } = {}) {
  const todas = [...REGLAS_GENERICAS, ...reglas];
  const salida = [];
  const lineas = texto.split(/\r?\n/);
  lineas.forEach((linea, i) => {
    if (linea.includes(MARCA_IGNORAR)) return;
    for (const regla of todas) {
      const m = linea.match(regla.re);
      if (m && !regla.excluye?.(m[0])) salida.push({ ruta, linea: i + 1, regla: regla.id, fragmento: ocultar(m[0]) });
    }
    if (!SIN_IP.test(ruta)) {
      for (const h of ipsDeLinea(linea)) salida.push({ ruta, linea: i + 1, ...h, fragmento: ocultar(h.fragmento) });
    }
  });
  return salida;
}

/* Lista de ficheros ya en el índice (sin binarios ni configuración privada). */
function ficherosRastreados(raiz) {
  return execFileSync('git', ['-C', raiz, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
}

function ficherosStaged(raiz) {
  return execFileSync('git', ['-C', raiz, 'diff', '--cached', '--name-only', '-z', '--diff-filter=AM'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
}

function leerTexto(raiz, rel) {
  const texto = readFileSync(join(raiz, rel), 'utf8');
  return texto.includes('\u0000') ? null : texto; // binarios: fuera
}

/* Escanea lo que ya está en el árbol (rastreado) o lo que se va a comitear. */
export function escanear({ raiz, modo = 'staged', reglas = [] }) {
  const ficheros = modo === 'todo' ? ficherosRastreados(raiz) : ficherosStaged(raiz);
  const hallazgos = [];
  for (const rel of ficheros) {
    if (RUTAS_EXCLUIDAS.has(rel) || !existsSync(join(raiz, rel))) continue;
    const texto = leerTexto(raiz, rel);
    if (texto !== null) hallazgos.push(...hallazgosEnTexto(texto, { ruta: rel, reglas }));
  }
  return hallazgos;
}

/* true si `raiz` es un repo git (con árbol de trabajo o desnudo, como un mirror). */
export function esRepoGit(raiz) {
  try {
    execFileSync('git', ['-C', raiz, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* Historial: solo las líneas AÑADIDAS de cada commit. Un dato retirado después
 * sigue en el historial, por eso se mira todo el historial y no solo el árbol. */
export function escanearHistorial({ raiz, reglas = [] }) {
  const salida = execFileSync('git', ['-C', raiz, 'log', '--all', '-p', '-U0', '--no-color', '--format=@@COMMIT %h', '--', '.'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const hallazgos = [];
  let commit = '';
  let ruta = '';
  for (const linea of salida.split('\n')) {
    if (linea.startsWith('@@COMMIT ')) commit = linea.slice(9);
    else if (linea.startsWith('+++ b/')) ruta = linea.slice(6);
    else if (linea.startsWith('+') && !linea.startsWith('+++') && !RUTAS_EXCLUIDAS.has(ruta)) {
      for (const h of hallazgosEnTexto(linea.slice(1), { ruta, reglas })) {
        hallazgos.push({ ...h, linea: `commit ${commit}` });
      }
    }
  }
  return hallazgos;
}

function informar(hallazgos) {
  for (const h of hallazgos) console.log(`${h.ruta}:${h.linea} [${h.regla}] ${h.fragmento}`);
  console.log(hallazgos.length ? `${hallazgos.length} hallazgo(s) de datos personales` : 'sin datos personales');
}

const esEntrada = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (esEntrada) {
  // --raiz: repo a escanear (p. ej. un mirror clonado para el historial); por defecto, este repo.
  const iRaiz = process.argv.indexOf('--raiz');
  const raiz = iRaiz > -1 ? resolve(process.argv[iRaiz + 1]) : resolve(join(fileURLToPath(import.meta.url), '..', '..', '..', '..'));
  const modo = process.argv.includes('--todo') ? 'todo' : process.argv.includes('--historial') ? 'historial' : 'staged';
  // [por que] Sin repo git (réplica de Mutagen en la 89) el historial no existe: se dice en claro, sin volcar la pila de git.
  // rev-parse y no existsSync('.git'): un mirror desnudo no tiene carpeta .git y sí tiene historial.
  if (modo === 'historial' && !esRepoGit(raiz)) {
    console.error(`privacidad: ${raiz} no es un repo git; el historial se escanea con --raiz <clon o mirror>`);
    process.exit(2);
  }
  const reglas = reglasPrivadas(join(raiz, 'config', 'privacidad.local.json'));
  const hallazgos = modo === 'historial' ? escanearHistorial({ raiz, reglas }) : escanear({ raiz, modo, reglas });
  informar(hallazgos);
  process.exitCode = hallazgos.length ? 1 : 0;
}
