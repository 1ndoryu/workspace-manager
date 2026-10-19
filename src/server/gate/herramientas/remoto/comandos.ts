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

/* Comprueba que el CLI está en su sitio, en una sola ida y vuelta. [por que] La
 * versión no se lee de la 89: el runtime lo acaba de copiar el portátil, así que
 * la sabe de origen y ahorra una lectura remota. */
export function comandoSonda(cli: string): string {
  return `test -f ${comillas(cli)} && echo ok`;
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

/* Huella del runtime que se copia: su `out/` y sus dos ficheros de dependencias.
 * [por que] Por contenido y no por mtime: un checkout sin cambios no debe reenviar
 * 4,5 MB, y un cambio real siempre cambia el hash. */
export function huellaRuntime(base: string): string {
  const archivos: string[] = [];
  listarBajo(base, 'out', archivos);
  const h = createHash('sha256');
  for (const f of [...archivos.sort(), 'package.json', 'package-lock.json']) {
    h.update(`${f}\0`);
    try {
      h.update(readFileSync(join(base, f)));
    } catch {
      h.update('?'); /* falta: la huella cambia igual que si cambiara el contenido */
    }
  }
  return h.digest('hex').slice(0, 16);
}

/* Relativas (con `/`) de los ficheros bajo `rel`, recursivo. */
function listarBajo(base: string, rel: string, salida: string[]): void {
  let entradas;
  try {
    entradas = readdirSync(join(base, rel), { withFileTypes: true });
  } catch {
    return; /* no existe: el runtime no tiene `out/` y la huella sale de los otros ficheros */
  }
  for (const e of entradas) {
    const ruta = `${rel}/${e.name}`;
    if (e.isDirectory()) listarBajo(base, ruta, salida);
    else if (e.isFile()) salida.push(ruta);
  }
}

/* Instala las dependencias del runtime en la 89, solo cuando el lock cambió. [por que]
 * `out/` se copia en cada análisis (4,5 MB) pero `node_modules` son 61 MB: copiarlo
 * cada vez no tiene sentido. El runtime usa 3 dependencias de producción, así que
 * `npm ci --omit=dev` en la 89 es barato y deja el árbol reproducible. Si `npm ci`
 * falla sale con 3: la sonda lo ve como fallo y el análisis remoto queda en 'error'
 * con motivo, en vez de reventar más tarde con un «Cannot find module». */
export function comandoDeps(npm: string, base: string, huella: string): string {
  const marca = `${base}/.lock-sha`;
  return (
    `if [ "$(cat ${comillas(marca)} 2>/dev/null)" != ${comillas(huella)} ]; then ` +
    `${comillas(npm)} ci --omit=dev --silent --prefix ${comillas(base)} >/dev/null 2>&1 && ` +
    `printf '%s' ${comillas(huella)} > ${comillas(marca)} || exit 3; fi; echo ok`
  );
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
