/* Audit de dependencias en la VPS 89, para los tres gestores (npm, pnpm, cargo).
 *
 * [por que] El reparto del area manda el analisis del taller a la 89: Sentinel y
 * VarSense ya corren alli, y el audit de dependencias es analisis igual que ellos.
 * Tenerlo en el portatil dejaba la mitad del panel de vulnerabilidades medido en
 * otra maquina que la otra mitad, y ademas auditaba el lockfile del portatil en vez
 * del que se va a construir en la 89. Un proyecto del taller no cae a local: sin taller
 * configurado o si el envio falla, queda en error con su motivo (AGENTS §1). Un proyecto
 * sin marca de taller se audita en local, con o sin VPS.
 *
 * El caso de cargo nacio antes y por otro motivo: el portatil se quedo sin toolchain
 * de Rust el 2026-10-16 (AGENTS §1), asi que `cargo audit` y `cargo tree` ya no
 * podian correr aqui. La 89 si los tiene: cargo 1.99 y cargo-audit 0.22. npm y pnpm
 * viajan por coherencia, no por falta de herramienta.
 *
 * Transporte: un tar con SOLO lo que el gestor necesita para resolver su lockfile.
 * Cargo ademas necesita los `.rs` (rechaza un manifiesto cuyo target no existe,
 * «no targets specified in the manifest», aunque no compile nada) y los hermanos de
 * `path = "../X"` (proyecto-ejemplo -> ../proyecto-ejemplo/core, que hereda `edition` del
 * workspace root). npm y pnpm solo necesitan los manifiestos y los lockfiles. Lo
 * pesado (node_modules, target, uploads, data) no viaja. El ssh y el envio viven en
 * `herramientas/ssh.ts`; el binario de tar, en `herramientas/tar.ts`.
 *
 * Se reenvia solo si cambio algun manifiesto o lockfile (firma) o si cm-sweep ya
 * barrio /var/tmp (marca ausente).
 *
 * Sin `--offline` en cargo: la cache de registro de la 89 no cubre todos los targets
 * y `cargo tree --target all` fallaba pidiendo crates que no tenia. Con red, cargo
 * los descarga la primera vez y los cachea en ~/.cargo/registry.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { leerConfigArea } from '../configArea.js';
import { RAIZ_AREA } from '../plataforma/rutas.js';
import { type ConfigRemota, leerConfigRemota } from './herramientas/config.js';
import { comillas, enviarArbol, type SalidaRemota, sshTexto } from './herramientas/ssh.js';
import { tarReal } from './herramientas/tar.js';

/* Los tres gestores que el audit sabe leer (ver detectarLockfiles). */
export type GestorAudit = 'npm' | 'pnpm' | 'cargo';

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
 * de dos gestores (proyecto-ejemplo: npm en frontend/, cargo en glory-rs/); con un arbol
 * por proyecto el segundo `rm -rf` borraria el del primero. La carpeta temporal
 * llega en la config (`tmpAudit`), no se lee aquí. */
export function raizRemota(cfg: Pick<ConfigRemota, 'tmpAudit'>, nombre: string, gestor: GestorAudit): string {
  return `${cfg.tmpAudit}/${nombre}/${gestor}`;
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
  const cfg = leerConfigRemota();
  const destino = raizRemota(cfg, nombre, gestor);
  const visto = await sshTexto(cfg, `cat ${comillas(`${destino}/.firma`)} 2>/dev/null`);
  if (visto.codigo === 0 && visto.stdout.trim() === firma) return;
  await enviarArbol(cfg, tarReal(), raiz, destino, archivos.map((a) => relativa(raiz, a)), firma);
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
  const partes = [raizRemota(cfg, nombre, gestor), nombre, ...(base ? base.split(sep) : [])];
  /* [por que] corepack pregunta en consola antes de descargar pnpm; sin consola esa
   * pregunta colgaria el audit.
   * [por que comillas DOBLES] `pathRemoto` devuelve `$HOME/.cargo/bin` para cargo, y
   * `comillas` (simples) lo dejaria literal, sin expandir: cargo quedaria fuera del
   * PATH y el audit de Cargo.lock saldria «no disponible». Los dos valores son
   * seguros entre dobles: `$HOME` es la unica expansion, y `nodeRemoto` ya paso por
   * `RUTA_ABSOLUTA_SEGURA` (solo `[A-Za-z0-9._/-]`), asi que no puede traer `$` ni
   * comillas. */
  const env = `export PATH="${pathRemoto(gestor, cfg.nodeRemoto)}:$PATH" && export COREPACK_ENABLE_DOWNLOAD_PROMPT=0`;
  return sshTexto(cfg, `cd ${comillas(partes.join('/'))} && ${env} && ${comando}`);
}
