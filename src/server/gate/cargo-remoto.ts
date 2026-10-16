/* Audit de dependencias de cargo en la VPS 89 (16AA-11).
 *
 * [por que] El portátil se quedó sin toolchain de Rust el 2026-10-16 (AGENTS §1),
 * así que `cargo audit` y `cargo tree` —los dos comandos que necesita el audit
 * de `Cargo.lock`— ya no pueden correr aquí. La 89 sí los tiene: cargo 1.99 y
 * cargo-audit 0.22 (`cargo install cargo-audit --locked`, bajo cm-heavy).
 *
 * Transporte: un tar con SOLO lo que cargo necesita para resolver el grafo
 * (`*.rs`, `Cargo.toml`, `Cargo.lock`). Los `.rs` viajan porque cargo rechaza un
 * manifiesto cuyo target no existe («no targets specified in the manifest»),
 * aunque no llegue a compilar nada. Se extrae con la misma disposición relativa
 * que en el portátil, para que resuelvan los `path` entre proyectos
 * (PROYECTO TASKS -> ../glory-harness/core, que además hereda `edition` del
 * workspace root de glory-harness). Lo pesado (node_modules, target, uploads,
 * data) no viaja: son ~3 MB comprimidos.
 *
 * Se reenvía solo si cambió algún `Cargo.toml`/`Cargo.lock` (firma) o si
 * cm-sweep ya barrió /var/tmp (marca ausente).
 *
 * Sin `--offline`: la caché de registro de la 89 no cubre todos los targets y
 * `cargo tree --target all` fallaba pidiendo crates que no tenía. Con red, cargo
 * los descarga la primera vez y los cachea en ~/.cargo/registry.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { comillas, leerConfigRemota } from './remoto.js';

const REMOTO_BASE = '/var/tmp/wm-audit';
const TIMEOUT_MS = 120_000;
const SSH_OPTS = ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
/* Sin `-n`: ese flag deja la entrada estándar en /dev/null y el tar que viaja
 * por stdin nunca llegaría a la 89. */
const SSH_OPTS_TAR = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];

/* Salida cruda de un comando remoto. `codigo` es null si ssh no llegó a correr
 * (o venció el timeout); el llamante lo trata como fallo, no como éxito. */
export interface SalidaCargo {
  stdout: string;
  codigo: number | null;
}

/* Carpetas que no viajan: no las necesita cargo y son las que pesan
 * (WANDORIUS/uploads 245 MB, glory-harness/data 633 MB). */
const PESADAS = new Set([
  'node_modules',
  'target',
  '.git',
  '.quality-tools',
  '.sentinel',
  '.freebuff',
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

/* Raíz remota del proyecto, una por proyecto: el árbol de uno no borra el de
 * otro. Dentro queda el proyecto en <raíz>/<nombre> y, a su lado, los hermanos
 * de `path = "../X"`, que es lo que hace resolver las rutas relativas. */
function raizRemota(nombre: string): string {
  return `${REMOTO_BASE}/${nombre}`;
}

/* Lo que cargo lee para resolver el grafo. */
function esDelGrafo(nombre: string): boolean {
  return nombre.endsWith('.rs') || nombre === 'Cargo.toml' || nombre === 'Cargo.lock';
}

/* Recorre el subárbol y acumula los archivos del grafo (rutas absolutas). */
function listar(dir: string, salida: string[]): void {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; /* sin permiso o desaparecido: no es motivo para abortar el audit */
  }
  for (const e of entradas) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) {
      if (!PESADAS.has(e.name)) listar(ruta, salida);
    } else if (e.isFile() && esDelGrafo(e.name)) {
      salida.push(ruta);
    }
  }
}

/* Huella del árbol enviado: solo manifiestos y lockfiles, que son lo que cambia
 * el resultado del audit. Los `.rs` no entran: editarlos no cambia ni las
 * vulnerabilidades ni el grafo, y sí haría reenviar 3 MB en cada guardado. */
function huella(archivos: string[], raiz: string): string {
  const h = createHash('sha1');
  for (const a of archivos) {
    if (!a.endsWith('Cargo.toml') && !a.endsWith('Cargo.lock')) continue;
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
 * recorren también los hermanos añadidos, porque un crate de allí puede
 * depender de otro que quede fuera. */
function hermanosDe(raiz: string, proyecto: string): string[] {
  const fuera = new Set<string>();
  const pendientes = [join(raiz, proyecto)];
  while (pendientes.length) {
    const dir = pendientes.pop() as string;
    const archivos: string[] = [];
    listar(dir, archivos);
    for (const m of archivos.filter((a) => a.endsWith('Cargo.toml'))) {
      for (const rel of depsQueSalen(m)) {
        const comp = relative(raiz, resolve(dirname(m), rel)).split(sep)[0];
        if (comp && comp !== '..' && !fuera.has(comp) && !PESADAS.has(comp)) {
          fuera.add(comp);
          pendientes.push(join(raiz, comp));
        }
      }
    }
  }
  return [...fuera];
}

/* `tar` del PATH puede ser el de Windows (bsdtar) según cómo arranque el padre;
 * el de Git es el que se ha probado. Se resuelve por ruta, no por orden. */
function tarReal(): string {
  const candidatos = ['C:\\Program Files\\Git\\usr\\bin\\tar.exe', 'C:\\Program Files\\Git\\bin\\tar.exe'];
  for (const c of candidatos) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* siguiente candidato */
    }
  }
  return 'tar';
}

/* Ejecuta un comando en la 89 y devuelve su stdout con el código de salida. No
 * rechaza por código ≠ 0: `cargo audit` sale 1 cuando HAY vulnerabilidades y
 * `cargo tree` sale 101 cuando el crate no está en el grafo, y los dos casos son
 * respuestas válidas. Un fallo de ssh devuelve código null y stdout vacío. */
function sshTexto(host: string, comando: string): Promise<SalidaCargo> {
  return new Promise((listo) => {
    const hijo = spawn('ssh', [...SSH_OPTS, host, comando], { windowsHide: true });
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

/* Envía el árbol por stdin de ssh: `tar -T -` lee la lista de archivos de su
 * entrada estándar y escribe el archivo en la salida, así que no hace falta
 * ningún temporal ni depender de cómo expanda `--exclude` cada tar. */
function enviar(host: string, raiz: string, destino: string, archivos: string[], firma: string): Promise<void> {
  return new Promise((ok, mal) => {
    const lista = `${archivos.map((a) => relativa(raiz, a)).join('\n')}\n`;
    const orden =
      `rm -rf ${comillas(destino)} && mkdir -p ${comillas(destino)} && tar xzf - -C ${comillas(destino)} ` +
      `&& printf '%s' ${comillas(firma)} > ${comillas(`${destino}/.firma`)}`;
    const tar = spawn(tarReal(), ['czf', '-', '-C', raiz, '-T', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const ssh = spawn('ssh', [...SSH_OPTS_TAR, host, orden], { stdio: ['pipe', 'inherit', 'inherit'] });
    /* Si ssh muere antes de tragarse el tar, el pipe revienta con EPIPE; sin este
     * manejador sería un error no capturado que tumbaría el manager. */
    ssh.stdin.on('error', () => {});
    tar.stdout.pipe(ssh.stdin);
    tar.stdin.end(lista);
    tar.on('error', (e) => mal(new Error(`no se pudo ejecutar tar: ${e.message}`)));
    ssh.on('error', (e) => mal(new Error(`no se pudo ejecutar ssh: ${e.message}`)));
    ssh.on('close', (c) => (c === 0 ? ok() : mal(new Error(`el envío del árbol a la 89 falló (ssh ${c})`))));
  });
}

/* Deja en la 89 el árbol que necesitan los comandos de cargo del proyecto. Si ya
 * está y no ha cambiado nada, no hace nada. */
export async function prepararArbolRemoto(rutaProyecto: string): Promise<void> {
  const raiz = dirname(rutaProyecto);
  const nombre = basename(rutaProyecto);
  const archivos: string[] = [];
  for (const d of [nombre, ...hermanosDe(raiz, nombre)]) listar(join(raiz, d), archivos);
  const firma = huella(archivos, raiz);
  const destino = raizRemota(nombre);
  const cfg = leerConfigRemota();
  const visto = await sshTexto(cfg.host, `cat ${comillas(`${destino}/.firma`)} 2>/dev/null`);
  if (visto.codigo === 0 && visto.stdout.trim() === firma) return;
  await enviar(cfg.host, raiz, destino, archivos, firma);
}

/* Corre un comando de cargo del proyecto en la 89, en la carpeta equivalente a
 * `rutaProyecto/base` del portátil. `comando` lo arma vulnerabilidades.ts con
 * texto estático y nombres de crate validados; nunca lleva entrada externa. */
export async function ejecutarCargoRemoto(
  comando: string,
  rutaProyecto: string,
  base: string,
): Promise<SalidaCargo> {
  let host: string;
  try {
    host = leerConfigRemota().host;
  } catch {
    return { stdout: '', codigo: null }; /* taller.json ilegible: se trata como fallo */
  }
  const nombre = basename(rutaProyecto);
  const partes = [raizRemota(nombre), nombre, ...(base ? base.split(sep) : [])];
  return sshTexto(host, `cd ${comillas(partes.join('/'))} && export PATH=$HOME/.cargo/bin:$PATH && ${comando}`);
}
