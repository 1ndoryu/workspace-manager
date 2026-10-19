/* Líneas de comandos y huellas del análisis remoto en la VPS. Funciones puras (salvo
 * leer ficheros para la huella): no lanzan nada. [por que] Separadas de remoto.ts para
 * que el orquestador (copiar, sincronizar, lanzar) quede dentro del límite de líneas y
 * para que cada construcción de comando se pruebe sin ssh. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { comillas } from '../ssh.js';

/* Nombre de variable POSIX. [por que] La clave se pega sin comillas en la línea de
 * comandos: una clave con `;` o espacios sería una orden extra en la VPS. */
const CLAVE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;

/* Asignaciones `CLAVE='valor'` del entorno remoto; el valor va entrecomillado. */
export function asignacionesEntorno(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => {
    if (!CLAVE_ENV.test(k)) throw new Error(`nombre de variable de entorno no válido: ${k}`);
    return `${k}=${comillas(v)}`;
  });
}

/* Línea de comandos del análisis remoto: entorno de los runtimes de la 89 + CLI. */
export function comandoAnalisis(a: {
  env: Record<string, string>;
  node: string;
  cli: string;
  verbo: 'analyze' | 'all';
  workspace: string;
}): string {
  return ['env', ...asignacionesEntorno(a.env), comillas(a.node), comillas(a.cli), a.verbo, '--workspace', comillas(a.workspace), '--format', 'json'].join(' ');
}

/* Línea del `doctor` remoto. Se diferencia del análisis en la forma del comando:
 * `doctor` no tiene `--format`, su JSON es siempre el mismo y sale por stdout. */
export function comandoDoctor(a: {
  env: Record<string, string>;
  node: string;
  cli: string;
  workspace: string;
}): string {
  return ['env', ...asignacionesEntorno(a.env), comillas(a.node), comillas(a.cli), 'doctor', '--json', '--workspace', comillas(a.workspace)].join(' ');
}

/* Decide si el runtime de la 89 está al día: misma huella de fuentes, CLI compilado y
 * dependencias instaladas. Responde `copiar` si hay que reenviar las fuentes; si no, `ok`.
 * [por que] Una sola ida y vuelta: con el runtime al día no se transfiere nada. */
export function comandoEstado(a: { base: string; marca: string; huella: string; cli: string }): string {
  const sinNodeModules = `[ ! -d ${comillas(`${a.base}/node_modules`)} ]`;
  const sinCli = `[ ! -f ${comillas(a.cli)} ]`;
  const sinMarca = `[ "$(cat ${comillas(a.marca)} 2>/dev/null)" != ${comillas(a.huella)} ]`;
  return `if ${sinMarca} || ${sinCli} || ${sinNodeModules}; then echo copiar; exit 0; fi; echo ok`;
}

/* Borra lo que se va a reenviar (fuentes y la salida anterior) sin tocar `node_modules`
 * ni las marcas. [por que] Un fichero borrado en el portátil debe desaparecer también
 * en la 89; si no, el compilador vería fuentes viejas. */
export function comandoLimpiar(base: string, rutas: string[]): string {
  return `rm -rf ${rutas.map((r) => comillas(`${base}/${r}`)).join(' ')}`;
}

/* Compila el runtime en la 89: `npm ci` solo si cambió el lock (o faltan los módulos),
 * luego `npm run compile` y, si todo sale bien, la marca de fuentes. [por que] La salida
 * de npm va a un registro en el propio runtime: en fallo se devuelven sus últimas líneas
 * por stderr, para que el motivo llegue al tablero y no un «salió con 4» mudo. El PATH
 * incluye la carpeta de node: el shell no interactivo puede traer otro node por defecto. */
export function comandoCompilar(a: {
  base: string;
  npm: string;
  nodeDir: string;
  huella: string;
  huellaLock: string;
  marca: string;
  cli: string;
}): string {
  const log = comillas(`${a.base}/.build.log`);
  const lockMarca = comillas(`${a.base}/.lock-sha`);
  /* [por que] La marca dice «instalado con devDependencies para este lock». Un `npm ci
   * --omit=dev` previo (sin tsc) dejaba la marca del lock puesta y la compilación fallaba
   * con «tsc: not found»: el prefijo `completo-` obliga a reinstalar esas instalaciones. */
  const marcaLock = `completo-${a.huellaLock}`;
  const sinModulos = `[ ! -d ${comillas(`${a.base}/node_modules`)} ]`;
  const lockCambio = `[ "$(cat ${lockMarca} 2>/dev/null)" != ${comillas(marcaLock)} ]`;
  const instalar =
    `if ${sinModulos} || ${lockCambio}; then ` +
    `${comillas(a.npm)} ci --silent --prefix ${comillas(a.base)} >${log} 2>&1 || { tail -n 20 ${log} >&2; exit 3; }; ` +
    `printf '%s' ${comillas(marcaLock)} > ${lockMarca}; fi`;
  const compilar =
    `PATH=${comillas(`${a.nodeDir}:`)}"$PATH" ${comillas(a.npm)} --prefix ${comillas(a.base)} run -s compile >>${log} 2>&1 ` +
    `|| { tail -n 20 ${log} >&2; exit 4; }`;
  const salida = `test -f ${comillas(a.cli)} || { echo 'compilación sin salida' >&2; exit 5; }`;
  const marca = `printf '%s' ${comillas(a.huella)} > ${comillas(a.marca)}`;
  return [`: > ${log}`, instalar, compilar, salida, marca, 'echo ok'].join('; ');
}

/* Huella del package-lock: identifica el juego de dependencias. [por que] La versión
 * no sirve de marca: el lock puede cambiar sin subir versión. mtime sí cambiaría en un
 * `git checkout` sin cambios de contenido y reinstalaría de balde. */
export function huellaLock(ruta: string): string {
  try {
    return createHash('sha256').update(readFileSync(ruta)).digest('hex').slice(0, 16);
  } catch {
    return '?';
  }
}

/* Huella de las fuentes que se reenvían: contenido de cada entrada (fichero o árbol). Si
 * una entrada no existe, cuenta como `?` y la huella cambia igual que con un cambio real.
 * [por que] Por contenido y no por mtime: un checkout sin cambios no debe recompilar
 * en la 89 ni reenviar fuentes de balde. */
export function huellaFuentes(base: string, entradas: string[]): string {
  const archivos: string[] = [];
  for (const e of entradas) listarEntrada(base, e, archivos);
  const h = createHash('sha256');
  for (const f of archivos.sort()) {
    h.update(`${f}\0`);
    try {
      h.update(readFileSync(join(base, f)));
    } catch {
      h.update('?');
    }
  }
  return h.digest('hex').slice(0, 16);
}

/* Relativas (con `/`) de los ficheros bajo `rel`, recursivo. Si `rel` no es carpeta
 * (fichero o ausente), es una hoja: se devuelve tal cual. */
function listarEntrada(base: string, rel: string, salida: string[]): void {
  let entradas;
  try {
    entradas = readdirSync(join(base, rel), { withFileTypes: true });
  } catch {
    salida.push(rel);
    return;
  }
  for (const e of entradas) listarEntrada(base, `${rel}/${e.name}`, salida);
}

/* Recrea las marcas de repos anidados en la réplica. [por que] Viven bajo una ruta que
 * Mutagen ignora, así que la sincronización no las borra y quedan estables entre flushes. */
export function comandoMarcasRepos(ws: string, repos: { ruta: string; marca: string | null }[]): string {
  const partes = repos.map((r) => {
    const dir = `${ws}/${r.ruta}`;
    const marca = `${dir}/.git`;
    return r.marca === null
      ? `mkdir -p ${comillas(marca)}`
      : `mkdir -p ${comillas(dir)} && printf '%s' ${comillas(r.marca)} > ${comillas(marca)}`;
  });
  return [...partes, 'echo ok'].join(' && ');
}
