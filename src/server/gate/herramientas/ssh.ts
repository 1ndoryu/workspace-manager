/* El transporte con la VPS del taller: citar para el shell remoto, lanzar `ssh` y
 * copiar entradas por tar. [por que] Nada de esto sabe qué herramienta se ejecuta ni por
 * qué: recibe un comando y lo lleva. Estaba dentro de remoto.ts, mezclado con la
 * construcción de los comandos y con la decisión de modo, que son otra cosa.
 *
 * [por que] Un solo constructor de procesos: había tres transportes con argumentos
 * duplicados y límites distintos, y `enviarArbol` se quedaba sin tope, así que un ssh
 * que no respondía colgaba la petición para siempre. Aquí todos comparten `argsSsh` y
 * todos vencen. */
import { spawn } from 'node:child_process';
import { BIN_SSH, BIN_TAR } from '../../plataforma/sistema/binarios.js';
import type { ConfigRemota } from './config.js';

/* [por que] Tope de salida: el reporte de un proyecto grande (993 archivos) supera el
 * maxBuffer por defecto de execFile (1 MiB). Se mide en caracteres, que es lo que ocupa
 * la cadena que acumulamos. */
const MAX_SALIDA = 64 * 1024 * 1024;
const TIMEOUT_COPIA_MS = 120_000;
/* Enviar el árbol de un proyecto grande (tar + ssh de un tirón) tarda más que copiar
 * entradas sueltas: 5 min deja margen sin volver a colgar la petición. */
const TIMEOUT_ENVIO_MS = 300_000;
const TIMEOUT_AUDIT_MS = 120_000;

/* Cita un valor para el shell remoto (POSIX): comillas simples, con ' escapada. */
export function comillas(valor: string): string {
  return `'${valor.replace(/'/g, `'\\''`)}'`;
}

export function mensaje(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  const texto = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr : typeof e.message === 'string' ? e.message : String(err);
  return texto.trim();
}

/* Argumentos comunes de ssh. `sinEntrada` pone `-n` (no leer stdin), que evita que un
 * comando remoto se quede esperando entrada; las tuberías de tar no lo llevan porque
 * el árbol viaja justo por ahí. */
function argsSsh(cfg: ConfigRemota, comando: string, sinEntrada: boolean): string[] {
  return [
    ...(sinEntrada ? ['-n'] : []),
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    cfg.host, comando,
  ];
}

/* Salida cruda de un comando remoto con su código de salida. `codigo` es null cuando ssh
 * no llegó a responder (spawn fallido, tope vencido o salida desbordada): el llamante
 * lo trata como fallo, nunca como éxito. */
export interface EjecucionSsh {
  stdout: string;
  stderr: string;
  codigo: number | null;
  /* Por qué no hay código de salida válido; null si el proceso terminó por su cuenta. */
  motivo: string | null;
}

/* Único lugar donde se lanza ssh para leer una respuesta. Acumula stdout con tope y
 * stderr aparte (cada consumidor decide qué es un fallo), y vence siempre. */
function correr(cfg: ConfigRemota, comando: string, timeoutMs: number): Promise<EjecucionSsh> {
  return new Promise((listo) => {
    let resuelto = false;
    let stdout = '';
    let stderr = '';
    let reloj: ReturnType<typeof setTimeout>;
    const acabar = (r: EjecucionSsh) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(reloj);
      listo(r);
    };
    const hijo = spawn(BIN_SSH, argsSsh(cfg, comando, true), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    reloj = setTimeout(() => {
      hijo.kill();
      acabar({ stdout, stderr, codigo: null, motivo: `ssh sin respuesta en ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    hijo.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      /* Se corta al desbordar en vez de seguir acumulando memoria sin freno. */
      if (stdout.length > MAX_SALIDA) {
        hijo.kill();
        acabar({ stdout: '', stderr, codigo: null, motivo: 'la salida remota supera los 64 MiB' });
      }
    });
    hijo.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    hijo.on('error', (e) => acabar({ stdout: '', stderr, codigo: null, motivo: `no se pudo ejecutar ssh: ${e.message}` }));
    hijo.on('close', (codigo) => acabar({ stdout, stderr, codigo, motivo: null }));
  });
}

export interface SalidaSsh {
  stdout: string;
  fallo: string | null;
}

/* Ejecuta un comando en la VPS. A diferencia de execFile, devuelve la salida también
 * si sale con código ≠ 0: sentinel y varsense salen así cuando hay hallazgos de
 * severidad error (el reporte válido va en stdout). */
export async function ssh(cfg: ConfigRemota, comando: string, timeout: number): Promise<SalidaSsh> {
  const r = await correr(cfg, comando, timeout);
  if (r.motivo) return { stdout: r.stdout, fallo: r.motivo };
  if (r.codigo === 0) return { stdout: r.stdout, fallo: null };
  const detalle = r.stderr.trim();
  return { stdout: r.stdout, fallo: detalle || `ssh salió con ${r.codigo ?? 'señal'}` };
}

/* Resuelve con null si el proceso salió bien, o con el motivo si falló. */
function esperarProceso(p: ReturnType<typeof spawn>, nombre: string): Promise<string | null> {
  return new Promise((resolve) => {
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve(`${nombre}: ${e.message}`));
    p.on('close', (code) => resolve(code === 0 ? null : `${nombre} salió con ${code ?? 'señal'}: ${err.trim()}`));
  });
}

/* Tubería `tar → ssh` con un solo tope para los dos extremos. La usan la copia de
 * entradas sueltas y el envío del árbol completo: es el mismo problema (empaquetar en
 * local y desempaquetar allá) con distinto comando. */
function porTuberia(
  cfg: ConfigRemota,
  argsTar: string[],
  comandoSsh: string,
  timeoutMs: number,
  lista?: string,
  binTar = BIN_TAR,
): Promise<void> {
  return new Promise((ok, mal) => {
    let resuelto = false;
    let vencido = false;
    const acabar = (fallo: string | null) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(reloj);
      if (fallo) mal(new Error(fallo));
      else ok();
    };
    const tar = spawn(binTar, argsTar, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const ssh = spawn(BIN_SSH, argsSsh(cfg, comandoSsh, false), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tar.stdout.pipe(ssh.stdin);
    /* Si ssh cae antes de tragarse el tar, el pipe revienta con EPIPE; sin este
     * manejador sería un error no capturado que tumbaría el manager. */
    ssh.stdin.on('error', () => {});
    tar.stdin.end(lista ?? '');
    const matar = () => { tar.kill(); ssh.kill(); };
    const reloj = setTimeout(() => { vencido = true; matar(); }, timeoutMs);
    tar.on('error', (e) => acabar(`no se pudo ejecutar tar: ${e.message}`));
    ssh.on('error', (e) => acabar(`no se pudo ejecutar ssh: ${e.message}`));
    /* [por que] En cuanto uno de los dos muere hay que parar el otro, o el fallo se
     * disfraza de espera: si ssh no llega (host que no resuelve, sin red), tar se queda
     * bloqueado escribiendo en una tubería que ya nadie lee; al revés, si tar falla, ssh
     * espera una entrada que no llega. El motivo que se informa es el de ssh cuando lo
     * hay: es el que dice qué pasó de verdad; el de tar, en ese caso, solo diría que lo
     * mataron. */
    const esperarTar = esperarProceso(tar, 'tar');
    const esperarSsh = esperarProceso(ssh, 'ssh');
    void esperarSsh.then(() => tar.kill());
    void esperarTar.then((fallo) => { if (fallo) ssh.kill(); });
    void Promise.all([esperarTar, esperarSsh]).then(([falloTar, falloSsh]) => {
      if (vencido) acabar(`la copia a la VPS no terminó en ${Math.round(timeoutMs / 1000)} s`);
      else acabar(falloSsh ?? falloTar);
    });
  });
}

/* Copia entradas (ficheros o directorios, relativas a `base`) al `destino` remoto,
 * que se crea si falta. [por que] tar por ssh y no `scp -r`: con este dist (180
 * archivos, 1,7 MB) scp se quedaba colgado hasta el timeout (probado 2026-10-15);
 * tar por ssh copia en ~8 s. */
export function copiarEntradas(base: string, cfg: ConfigRemota, destino: string, entradas: string[]): Promise<void> {
  const remoto = `mkdir -p ${comillas(destino)} && tar -C ${comillas(destino)} -xf -`;
  return porTuberia(cfg, ['-C', base, '-cf', '-', ...entradas], remoto, TIMEOUT_COPIA_MS);
}

export interface SalidaRemota {
  stdout: string;
  codigo: number | null;
}

/* Ejecuta un comando en la VPS y devuelve su stdout con el código de salida. No rechaza
 * por código ≠ 0: los audit salen 1 cuando HAY vulnerabilidades y `cargo tree` sale 101
 * cuando el crate no está en el grafo; los dos son respuestas válidas. Un fallo de ssh
 * devuelve código null y stdout vacío. */
export async function sshTexto(
  cfg: ConfigRemota,
  comando: string,
  timeout = TIMEOUT_AUDIT_MS,
): Promise<SalidaRemota> {
  const r = await correr(cfg, comando, timeout);
  return { stdout: r.stdout, codigo: r.codigo };
}

/* Envía un árbol a la VPS: `entradas` (relativas a `raiz`) se empaquetan con `tar` y se
 * desempaquetan en `destino` tras borrar lo anterior; la firma queda en `destino/.firma`.
 * [por que] `tar -T -` lee la lista por su entrada estándar: no hace falta temporal ni
 * depender de cómo expanda `--exclude` cada tar. Sin `-n`: el tar viaja por stdin de ssh,
 * y con `-n` no llegaría a la VPS. */
export function enviarArbol(
  cfg: ConfigRemota,
  tar: string,
  raiz: string,
  destino: string,
  entradas: string[],
  firma: string,
): Promise<void> {
  const orden =
    `rm -rf ${comillas(destino)} && mkdir -p ${comillas(destino)} && tar xzf - -C ${comillas(destino)} ` +
    `&& printf '%s' ${comillas(firma)} > ${comillas(`${destino}/.firma`)}`;
  return porTuberia(
    cfg,
    ['czf', '-', '-C', raiz, '-T', '-'],
    orden,
    TIMEOUT_ENVIO_MS,
    `${entradas.join('\n')}\n`,
    tar,
  );
}
