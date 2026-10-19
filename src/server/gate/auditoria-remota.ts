/* Audit de dependencias en la VPS 89, para los tres gestores (npm, pnpm, cargo).
 *
 * [por que] El reparto del area manda el analisis del taller a la 89: Sentinel y
 * VarSense ya corren alli, y el audit de dependencias es analisis igual que ellos.
 * Tenerlo en el portatil dejaba la mitad del panel de vulnerabilidades medido en
 * otra maquina que la otra mitad, y ademas auditaba el lockfile del portatil en vez
 * del que se va a construir en la 89. Sin taller —o si el envio falla— el audit cae
 * a local, que es como funcionaba antes: el manager funciona igual sin VPS.
 *
 * El caso de cargo nacio antes y por otro motivo: el portatil se quedo sin toolchain
 * de Rust el 2026-10-16 (AGENTS §1), asi que `cargo audit` y `cargo tree` ya no
 * podian correr aqui. La 89 si los tiene: cargo 1.99 y cargo-audit 0.22. npm y pnpm
 * viajan por coherencia, no por falta de herramienta.
 *
 * Transporte: un tar con SOLO lo que el gestor necesita para resolver su lockfile.
 * Cargo ademas necesita los `.rs` (rechaza un manifiesto cuyo target no existe,
 * «no targets specified in the manifest», aunque no compile nada) y los hermanos de
 * `path = "../X"` (PROYECTO TASKS -> ../glory-harness/core, que hereda `edition` del
 * workspace root). npm y pnpm solo necesitan los manifiestos y los lockfiles. Lo
 * pesado (node_modules, target, uploads, data) no viaja.
 *
 * Se reenvia solo si cambio algun manifiesto o lockfile (firma) o si cm-sweep ya
 * barrio /var/tmp (marca ausente).
 *
 * Sin `--offline` en cargo: la cache de registro de la 89 no cubre todos los targets
 * y `cargo tree --target all` fallaba pidiendo crates que no tenia. Con red, cargo
 * los descarga la primera vez y los cachea en ~/.cargo/registry.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { leerConfigArea } from '../configArea.js';
import { RAIZ_AREA } from '../../shared/rutas.js';
import { BIN_SSH, BIN_TAR } from '../../shared/binarios.js';
import { leerConfigRemota } from './herramientas/config.js';
import { comillas } from './herramientas/ssh.js';

/* Los tres gestores que el audit sabe leer (ver detectarLockfiles). */
export type GestorAudit = 'npm' | 'pnpm' | 'cargo';

/* Carpeta temporal en la máquina remota (Linux). Por entorno para no fijar la
 * de nuestro taller; el default es genérico y vale para cualquier /tmp de Linux. */
const REMOTO_BASE = process.env.WM_AUDIT_REMOTO?.trim() || '/tmp/wm-audit';
const TIMEOUT_MS = 120_000;
const SSH_OPTS = ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
/* Sin `-n`: ese flag deja la entrada estandar en /dev/null y el tar que viaja
 * por stdin nunca llegaria a la 89. */
const SSH_OPTS_TAR = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];

/* Salida cruda de un comando remoto. `codigo` es null si ssh no llego a correr
 * (o vencio el timeout); el llamante lo trata como fallo, no como exito. */
export interface SalidaRemota {
  stdout: string;
  codigo: number | null;
}

/* Carpetas que no viajan: no las necesita ningun gestor y son las que pesan
 * (uploads, data, target, node_modules). Son las de cualquier repo: el
 * equivalente a `node_modules` no depende de quien use el programa.
 * [por que] Una carpeta pesada de un area concreta no va aqui: la declara
 * `carpetasPesadas` en la config (ver pesadasDe). */
const PESADAS = new Set([
  'node_modules',
  'target',
  '.git',
  '.quality-tools',
  '.sentinel',
  'data',
  'uploads',
  'logs',
  '.runtime',
  'dist',
  '.quality-reports',
  '.venv',
  'backups',
  'clients',
]);

/* PESADAS mas las que declare la config del area. */
function pesadasDe(extra: readonly string[]): Set<string> {
  return extra.length ? new Set([...PESADAS, ...extra]) : PESADAS;
}

/* Lo que cada gestor lee para resolver su lockfile. npm y pnpm solo necesitan los
 * manifiestos (el workspace se declara en el `package.json` de la raiz); cargo
 * necesita ademas los `.rs`, porque rechaza un manifiesto cuyo target no existe. */
export const ESENCIALES: Record<GestorAudit, (nombre: string) => boolean> = {
  cargo: (n) => n.endsWith('.rs') || n === 'Cargo.toml' || n === 'Cargo.lock',
  npm: (n) => n === 'package.json' || n === 'package-lock.json' || n === 'npm-shrinkwrap.json',
  pnpm: (n) => n === 'package.json' || n === 'pnpm-lock.yaml' || n === 'pnpm-workspace.yaml',
};

/* De lo que viaja, lo que cambia el RESULTADO del audit: solo esto entra en la
 * huella. Los `.rs` no, porque editarlos no cambia ni el grafo ni las
 * vulnerabilidades y si haria reenviar 3 MB en cada guardado. */
export const MANIFIESTOS: Record<GestorAudit, (nombre: string) => boolean> = {
  cargo: (n) => n === 'Cargo.toml' || n === 'Cargo.lock',
  npm: ESENCIALES.npm,
  pnpm: ESENCIALES.pnpm,
};

/* Raiz remota de un proyecto y gestor. [por que] Un proyecto puede tener lockfiles
 * de dos gestores (WANDORIUS: npm en frontend/, cargo en glory-rs/); con un arbol
 * por proyecto el segundo `rm -rf` borraria el del primero. */
export function raizRemota(nombre: string, gestor: GestorAudit): string {
  return `${REMOTO_BASE}/${nombre}/${gestor}`;
}

/* Recorre el subarbol y acumula los archivos que `es` acepte (rutas absolutas). */
function listar(dir: string, salida: string[], es: (nombre: string) => boolean, pesadas: ReadonlySet<string>): void {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; /* sin permiso o desaparecido: no es motivo para abortar el audit */
  }
  for (const e of entradas) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) {
      if (!pesadas.has(e.name)) listar(ruta, salida, es, pesadas);
    } else if (e.isFile() && es(e.name)) {
      salida.push(ruta);
    }
  }
}

/* Huella del arbol enviado: solo manifiestos y lockfiles. */
function huella(archivos: string[], raiz: string, esManifiesto: (nombre: string) => boolean): string {
  const h = createHash('sha1');
  for (const a of archivos) {
    if (!esManifiesto(basename(a))) continue;
    let mtime = 0;
    try {
      mtime = statSync(a).mtimeMs;
    } catch {
      /* se queda en 0: la huella cambia igual si el archivo reaparece */
    }
    h.update(`${relativa(raiz, a)}:${mtime}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

/* Ruta relativa con barras normales: el tar de la 89 es POSIX. */
function relativa(raiz: string, ruta: string): string {
  return relative(raiz, ruta).split(sep).join('/');
}

/* Rutas de los `path = "..."` de un manifiesto que empiezan por `../`. */
function depsQueSalen(manifiesto: string): string[] {
  let texto: string;
  try {
    texto = readFileSync(manifiesto, 'utf8');
  } catch {
    return [];
  }
  const salen: string[] = [];
  for (const m of texto.matchAll(/path\s*=\s*"([^"]+)"/g)) {
    if (m[1].startsWith('../')) salen.push(m[1]);
  }
  return salen;
}

/* Directorios hermanos que el proyecto necesita por un `path = "../X"`. Se
 * recorren tambien los hermanos añadidos, porque un crate de alli puede
 * depender de otro que quede fuera. Solo aplica a cargo: npm y pnpm resuelven
 * sus dependencias de workspace desde el lockfile. */
function hermanosDe(raiz: string, proyecto: string, pesadas: ReadonlySet<string>): string[] {
  const fuera = new Set<string>();
  const pendientes = [join(raiz, proyecto)];
  while (pendientes.length) {
    const dir = pendientes.pop() as string;
    const archivos: string[] = [];
    listar(dir, archivos, ESENCIALES.cargo, pesadas);
    for (const m of archivos.filter((a) => a.endsWith('Cargo.toml'))) {
      for (const rel of depsQueSalen(m)) {
        const comp = relative(raiz, resolve(dirname(m), rel)).split(sep)[0];
        if (comp && comp !== '..' && !fuera.has(comp) && !pesadas.has(comp)) {
          fuera.add(comp);
          pendientes.push(join(raiz, comp));
        }
      }
    }
  }
  return [...fuera];
}

/* `tar` del PATH puede ser el de Windows (bsdtar) segun como arranque el padre;
 * el de Git es el que se ha probado. Se resuelve por ruta, no por orden.
 * [por que] Antes eran dos rutas fijas de `C:\Program Files\Git`: la instalacion
 * por defecto de esta maquina, no una verdad del proyecto. Git en
 * `%LOCALAPPDATA%\Programs\Git`, en otro idioma de sistema o en Linux no casaba
 * ninguno y se caia a `tar` (bsdtar), que es justo lo que se queria evitar. La
 * raiz se deriva ahora del `git` que haya en el PATH; `WS_TAR` la fija a mano. */
export function tarReal(): string {
  const declarado = process.env.WS_TAR?.trim();
  if (declarado) return declarado;
  for (const c of candidatosTar()) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return BIN_TAR;
}

/* Candidatos a `tar` de Git, derivados de donde este `git` en el PATH.
 * [por que] No hay una sola forma: segun la instalacion, el ejecutable aparece
 * en `<raiz>\cmd`, `<raiz>\bin` o `<raiz>\mingw64\bin` (medido aqui: Git Bash
 * pone `mingw64\bin`), y el `tar` de Git vive en `<raiz>\usr\bin`. En vez de
 * fijar una, se suben hasta tres niveles desde el directorio de `git` probando
 * las ubicaciones en cada uno. En Linux no casa ninguna y se cae a `tar`, que
 * alli ya es GNU tar. */
function candidatosTar(): string[] {
  let dir = raizDeGit();
  if (dir === null) return [];
  const rutas: string[] = [];
  for (let nivel = 0; nivel < 3; nivel++) {
    rutas.push(join(dir, 'usr', 'bin', 'tar.exe'), join(dir, 'bin', 'tar.exe'), join(dir, 'tar.exe'));
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return rutas;
}

/* Directorio del `git` que resuelve el PATH. Null si no hay ninguno. */
function raizDeGit(): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const exe = join(dir, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      if (statSync(exe).isFile()) return dir;
    } catch {
      /* siguiente directorio del PATH */
    }
  }
  return null;
}

/* Ejecuta un comando en la 89 y devuelve su stdout con el codigo de salida. No
 * rechaza por codigo ≠ 0: los audit salen 1 cuando HAY vulnerabilidades y
 * `cargo tree` sale 101 cuando el crate no esta en el grafo, y los dos casos son
 * respuestas validas. Un fallo de ssh devuelve codigo null y stdout vacio. */
function sshTexto(host: string, comando: string): Promise<SalidaRemota> {
  return new Promise((listo) => {
    const hijo = spawn(BIN_SSH, [...SSH_OPTS, host, comando], { windowsHide: true });
    let out = '';
    const to = setTimeout(() => {
      hijo.kill();
      listo({ stdout: out, codigo: null });
    }, TIMEOUT_MS);
    hijo.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    hijo.on('error', () => {
      clearTimeout(to);
      listo({ stdout: '', codigo: null });
    });
    hijo.on('close', (codigo) => {
      clearTimeout(to);
      listo({ stdout: out, codigo });
    });
  });
}

/* Envia el arbol por stdin de ssh: `tar -T -` lee la lista de archivos de su
 * entrada estandar y escribe el archivo en la salida, asi que no hace falta
 * ningun temporal ni depender de como expanda `--exclude` cada tar. */
function enviar(host: string, raiz: string, destino: string, archivos: string[], firma: string): Promise<void> {
  return new Promise((ok, mal) => {
    const lista = `${archivos.map((a) => relativa(raiz, a)).join('\n')}\n`;
    const orden =
      `rm -rf ${comillas(destino)} && mkdir -p ${comillas(destino)} && tar xzf - -C ${comillas(destino)} ` +
      `&& printf '%s' ${comillas(firma)} > ${comillas(`${destino}/.firma`)}`;
    const tar = spawn(tarReal(), ['czf', '-', '-C', raiz, '-T', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const ssh = spawn(BIN_SSH, [...SSH_OPTS_TAR, host, orden], { stdio: ['pipe', 'inherit', 'inherit'] });
    /* Si ssh muere antes de tragarse el tar, el pipe revienta con EPIPE; sin este
     * manejador seria un error no capturado que tumbaria el manager. */
    ssh.stdin.on('error', () => {});
    tar.stdout.pipe(ssh.stdin);
    tar.stdin.end(lista);
    tar.on('error', (e) => mal(new Error(`no se pudo ejecutar tar: ${e.message}`)));
    ssh.on('error', (e) => mal(new Error(`no se pudo ejecutar ssh: ${e.message}`)));
    ssh.on('close', (c) => (c === 0 ? ok() : mal(new Error(`el envio del arbol a la 89 fallo (ssh ${c})`))));
  });
}

/* Deja en la 89 el arbol que necesita este gestor para auditar el proyecto. Si ya
 * esta y no ha cambiado nada, no hace nada. */
export async function prepararArbolRemoto(rutaProyecto: string, gestor: GestorAudit): Promise<void> {
  const raiz = dirname(rutaProyecto);
  const nombre = basename(rutaProyecto);
  const es = ESENCIALES[gestor];
  const archivos: string[] = [];
  /* La config del area se lee de su raiz, no de `raiz` (que para un proyecto
   * anidado seria su carpeta madre y no tendria el fichero). */
  const pesadas = pesadasDe(leerConfigArea(RAIZ_AREA).carpetasPesadas ?? []);
  const dirs = gestor === 'cargo' ? [nombre, ...hermanosDe(raiz, nombre, pesadas)] : [nombre];
  for (const d of dirs) listar(join(raiz, d), archivos, es, pesadas);
  const firma = huella(archivos, raiz, MANIFIESTOS[gestor]);
  const destino = raizRemota(nombre, gestor);
  const cfg = leerConfigRemota();
  const visto = await sshTexto(cfg.host, `cat ${comillas(`${destino}/.firma`)} 2>/dev/null`);
  if (visto.codigo === 0 && visto.stdout.trim() === firma) return;
  await enviar(cfg.host, raiz, destino, archivos, firma);
}

/* PATH que necesita cada gestor en la 89. cargo vive en ~/.cargo/bin; npm y pnpm
 * en el mismo directorio que el node que declara taller.json (`nodeRemoto`), que
 * no esta en el PATH de un ssh no interactivo. */
export function pathRemoto(gestor: GestorAudit, nodeRemoto: string): string {
  return gestor === 'cargo' ? '$HOME/.cargo/bin' : posix.dirname(nodeRemoto);
}

/* Corre un comando del audit del proyecto en la 89, en la carpeta equivalente a
 * `rutaProyecto/base` del portatil. `comando` lo arma vulnerabilidades.ts con
 * texto estatico y nombres de paquete validados; nunca lleva entrada externa. */
export async function ejecutarAuditRemoto(
  comando: string,
  rutaProyecto: string,
  base: string,
  gestor: GestorAudit,
): Promise<SalidaRemota> {
  let cfg;
  try {
    cfg = leerConfigRemota();
  } catch {
    return { stdout: '', codigo: null }; /* taller.json ilegible: se trata como fallo */
  }
  const nombre = basename(rutaProyecto);
  const partes = [raizRemota(nombre, gestor), nombre, ...(base ? base.split(sep) : [])];
  /* [por que] corepack pregunta en consola antes de descargar pnpm; sin consola esa
   * pregunta colgaria el audit.
   * [por que comillas DOBLES] `pathRemoto` devuelve `$HOME/.cargo/bin` para cargo, y
   * `comillas` (simples) lo dejaria literal, sin expandir: cargo quedaria fuera del
   * PATH y el audit de Cargo.lock saldria «no disponible». Los dos valores son
   * seguros entre dobles: `$HOME` es la unica expansion, y `nodeRemoto` ya paso por
   * `RUTA_ABSOLUTA_SEGURA` (solo `[A-Za-z0-9._/-]`), asi que no puede traer `$` ni
   * comillas. */
  const env = `export PATH="${pathRemoto(gestor, cfg.nodeRemoto)}:$PATH" && export COREPACK_ENABLE_DOWNLOAD_PROMPT=0`;
  return sshTexto(cfg.host, `cd ${comillas(partes.join('/'))} && ${env} && ${comando}`);
}
