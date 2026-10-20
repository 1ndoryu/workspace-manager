/* El transporte con la 89: citar para el shell remoto, lanzar `ssh` y copiar entradas
 * por tar. [por que] Nada de esto sabe qué herramienta se ejecuta ni por qué: recibe un
 * comando y lo lleva. Estaba dentro de remoto.ts, mezclado con la construcción de los
 * comandos y con la decisión de modo, que son otra cosa. */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { BIN_SSH, BIN_TAR } from '../../plataforma/binarios.js';
import type { ConfigRemota } from './config.js';

const execFileAsync = promisify(execFile);

/* [por que] Tope de salida: el reporte de un proyecto grande (proyecto-ejemplo, 993
 * archivos) supera el maxBuffer por defecto de execFile (1 MiB). */
export const MAX_SALIDA = 64 * 1024 * 1024;
const TIMEOUT_COPIA_MS = 120_000;

/* Cita un valor para el shell remoto (POSIX): comillas simples, con ' escapada. */
export function comillas(valor: string): string {
  return `'${valor.replace(/'/g, `'\\''`)}'`;
}

export function mensaje(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  const texto = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr : typeof e.message === 'string' ? e.message : String(err);
  return texto.trim();
}

export interface SalidaSsh {
  stdout: string;
  fallo: string | null;
}

/* Ejecuta un comando en la 89. A diferencia de execFile, devuelve la salida también
 * si sale con código ≠ 0: sentinel y varsense salen así cuando hay hallazgos de
 * severidad error (el reporte válido va en stdout). -n: no lee stdin. */
export async function ssh(cfg: ConfigRemota, comando: string, timeout: number): Promise<SalidaSsh> {
  try {
    const { stdout } = await execFileAsync(
      BIN_SSH,
      ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.host, comando],
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: MAX_SALIDA },
    );
    return { stdout, fallo: null };
  } catch (err) {
    const e = err as { stdout?: string };
    return { stdout: e.stdout ?? '', fallo: mensaje(err) };
  }
}

/* Resuelve con null si el proceso salió bien, o con el motivo si falló. */
function esperarProceso(p: ChildProcess, nombre: string): Promise<string | null> {
  return new Promise((resolve) => {
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve(`${nombre}: ${e.message}`));
    p.on('close', (code) => resolve(code === 0 ? null : `${nombre} salió con ${code ?? 'señal'}: ${err.trim()}`));
  });
}

/* Copia entradas (ficheros o directorios, relativas a `base`) al `destino` remoto,
 * que se crea si falta. [por que] tar por ssh y no `scp -r`: con este dist (180
 * archivos, 1,7 MB) scp se quedaba colgado hasta el timeout (probado 2026-10-15);
 * tar por ssh copia en ~8 s. */
export async function copiarEntradas(base: string, cfg: ConfigRemota, destino: string, entradas: string[]): Promise<void> {
  const remoto = `mkdir -p ${comillas(destino)} && tar -C ${comillas(destino)} -xf -`;
  const tar = spawn(BIN_TAR, ['-C', base, '-cf', '-', ...entradas], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const ssh = spawn(BIN_SSH, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.host, remoto], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  tar.stdout.pipe(ssh.stdin);
  ssh.stdin.on('error', () => {}); // si ssh cae antes, su código de salida ya lo informa
  const reloj = setTimeout(() => { tar.kill(); ssh.kill(); }, TIMEOUT_COPIA_MS);
  try {
    /* [por que] En cuanto uno de los dos muere hay que parar el otro, o el fallo se
     * disfraza de espera: si ssh no llega (host que no resuelve, sin red), tar se queda
     * bloqueado escribiendo en una tubería que ya nadie lee y no sale hasta el vigilante
     * de 120 s — medido: un host inexistente tardaba 123 s en dar el motivo. Al revés,
     * si tar falla, ssh espera una entrada que no llega. El motivo que se informa es el
     * de ssh cuando lo hay: es el que dice qué pasó de verdad; el de tar, en ese caso,
     * solo diría que lo mataron. */
    const esperarTar = esperarProceso(tar, 'tar');
    const esperarSsh = esperarProceso(ssh, 'ssh');
    void esperarSsh.then(() => tar.kill());
    void esperarTar.then((fallo) => { if (fallo) ssh.kill(); });
    const [falloTar, falloSsh] = await Promise.all([esperarTar, esperarSsh]);
    const motivo = falloSsh ?? falloTar;
    if (motivo) throw new Error(motivo);
  } finally {
    clearTimeout(reloj);
  }
}

/* Salida cruda de un comando remoto. `codigo` es null si ssh no llegó a correr (o venció
 * el timeout); el llamante lo trata como fallo, no como éxito. */
export interface SalidaRemota {
  stdout: string;
  codigo: number | null;
}

const TIMEOUT_AUDIT_MS = 120_000;

/* Ejecuta un comando en la 89 y devuelve su stdout con el código de salida. No rechaza
 * por código ≠ 0: los audit salen 1 cuando HAY vulnerabilidades y `cargo tree` sale 101
 * cuando el crate no está en el grafo; los dos son respuestas válidas. Un fallo de ssh
 * devuelve código null y stdout vacío. `-n`: no lee stdin, que aquí no lleva nada. */
export function sshTexto(cfg: ConfigRemota, comando: string, timeout = TIMEOUT_AUDIT_MS): Promise<SalidaRemota> {
  return new Promise((listo) => {
    const hijo = spawn(BIN_SSH, ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.host, comando], { windowsHide: true });
    let out = '';
    const to = setTimeout(() => {
      hijo.kill();
      listo({ stdout: out, codigo: null });
    }, timeout);
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

/* Envía un árbol a la 89: `entradas` (relativas a `raiz`) se empaquetan con `tar` y se
 * desempaquetan en `destino` tras borrar lo anterior; la firma queda en `destino/.firma`.
 * [por que] `tar -T -` lee la lista por su entrada estándar: no hace falta temporal ni
 * depender de cómo expanda `--exclude` cada tar. Sin `-n`: el tar viaja por stdin de ssh,
 * y con `-n` no llegaría a la 89. */
export function enviarArbol(
  cfg: ConfigRemota,
  tar: string,
  raiz: string,
  destino: string,
  entradas: string[],
  firma: string,
): Promise<void> {
  return new Promise((ok, mal) => {
    const lista = `${entradas.join('\n')}\n`;
    const orden =
      `rm -rf ${comillas(destino)} && mkdir -p ${comillas(destino)} && tar xzf - -C ${comillas(destino)} ` +
      `&& printf '%s' ${comillas(firma)} > ${comillas(`${destino}/.firma`)}`;
    const empaquetar = spawn(tar, ['czf', '-', '-C', raiz, '-T', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const ssh = spawn(BIN_SSH, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.host, orden], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    /* Si ssh muere antes de tragarse el tar, el pipe revienta con EPIPE; sin este
     * manejador sería un error no capturado que tumbaría el manager. */
    ssh.stdin.on('error', () => {});
    empaquetar.stdout.pipe(ssh.stdin);
    empaquetar.stdin.end(lista);
    empaquetar.on('error', (e) => mal(new Error(`no se pudo ejecutar tar: ${e.message}`)));
    ssh.on('error', (e) => mal(new Error(`no se pudo ejecutar ssh: ${e.message}`)));
    ssh.on('close', (c) => (c === 0 ? ok() : mal(new Error(`el envio del arbol a la 89 fallo (ssh ${c})`))));
  });
}
