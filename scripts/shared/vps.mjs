/* Dónde corre lo pesado (builds, tests, análisis). Regla de la usuaria: en la VPS 89
 * siempre; el portátil solo en emergencia explícita con `--local`. Sin VPS configurada
 * no hay ejecución silenciosa en el portátil: el comando falla con un mensaje claro. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

import { BIN_SSH } from './binarios.mjs';
import { rutaConfigPrivada } from './rutas.mjs';
import { shQuote } from '../remoto/rcargo.mjs';

export const FLAG_LOCAL = '--local';

/* Configuración del taller (privada). Null si no existe: clon sin VPS.
 * [por que] Un JSON corrupto no es «sin VPS»: se nombra el fichero y el remedio en vez de
 * soltar un SyntaxError sin contexto. */
export function cargarTaller(ruta = rutaConfigPrivada('taller.json')) {
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (err) {
    throw new Error(`taller.json no es JSON válido (${ruta}): ${err.message}. Corrígelo o bórralo para trabajar sin VPS`);
  }
}

/* Decide el destino. Función pura: `equipo` es el hostname de este equipo.
 * Devuelve { donde: 'aqui' | 'remoto' | 'local', aviso? }. */
export function decidirDonde(argv, config, equipo) {
  if (config?.hostnameTaller && equipo === config.hostnameTaller) return { donde: 'aqui' };
  if (argv.includes(FLAG_LOCAL)) {
    return {
      donde: 'local',
      aviso: 'EMERGENCIA --local: se ejecuta en este equipo porque la VPS no está disponible; anótalo en Agente/completados/',
    };
  }
  if (!config) {
    throw new Error('sin VPS configurada (config/taller.json): no se ejecuta en este equipo. Usa --local solo en emergencia');
  }
  return { donde: 'remoto' };
}

/* Para mandos que solo piden un análisis al backend: `emergencia` es true con `--local`.
 * [por que] El backend corre en este equipo, así que la decisión se toma aquí, antes de
 * pedir nada: sin VPS y sin `--local` el mando falla con su motivo y no llega a analizar. */
export function emergenciaLocal(argv, config = cargarTaller(), equipo = hostname()) {
  const { donde, aviso } = decidirDonde(argv, config, equipo);
  return { emergencia: donde === 'local', aviso };
}

/* ¿`carpeta` está dentro de `raiz` (o es la raíz)? */
export function dentroDe(raiz, carpeta) {
  const relativa = path.relative(raiz, carpeta);
  return !relativa.startsWith('..') && !path.isAbsolute(relativa);
}

/* Carpeta de la réplica en la 89 para `carpeta` (dentro de `raiz`), bajo `dirRemotoBase/<id>`.
 * [por que] Mutagen replica el proyecto entero; lo que cuelga fuera de `raiz` no existe en la 89
 * (para eso está `dirRemotoDeHerramienta`). */
export function dirRemotoDe(config, id, raiz, carpeta) {
  if (!dentroDe(raiz, carpeta)) {
    throw new Error(`${carpeta} está fuera de ${raiz}: no se replica en la VPS 89`);
  }
  const relativa = path.relative(raiz, carpeta);
  const partes = relativa ? relativa.split(path.sep).join('/') : '';
  return path.posix.join(config.dirRemotoBase, id, partes);
}

/* Carpeta en la 89 de un checkout compartido que no cuelga del proyecto (p. ej. `.quality-tools/<tool>`
 * fuera del consumidor). Una carpeta por commit: el árbol se envía con `git archive` (el mismo que
 * hashea el lock) y `npm ci` corre una vez por commit. Fuera de `dirRemotoBase`: Mutagen no la toca.
 * [por que] /var/tmp, como el resto de temporales de la 89 (AGENTS §1). */
export function dirRemotoDeHerramienta(config, nombre, commit) {
  return path.posix.join(config.dirRemotoHerramientas ?? '/var/tmp/glory-quality', nombre, commit);
}

/* Línea de shell para la VPS: entra en `dir` y ejecuta `argv` bajo el candado de carga pesada.
 * [por que] `config.preludio` (opcional, en taller.json) prepara el PATH del equipo remoto
 * (p. ej. el gestor de node); `bash -lc` no siempre lo carga.
 * [por que 10AA-3] GLORY_TALLER=1 declara que la orden corre en el taller: la carpeta de la
 * 89 es un espejo de Mutagen que NO sincroniza `.git` (está en `sync.ignorar`), así que allí
 * el historial del workspace no es la fuente de verdad y las herramientas que lo consultan
 * (adaptador de calidad de los proyectos) tienen que saberlo. En el portátil no se pone. */
export function comandoEnVps(config, dir, argv) {
  const interno = `${config.preludio ?? ''}export GLORY_TALLER=1; cd ${shQuote(dir)} && ${argv.map(shQuote).join(' ')}`;
  return `${config.lockWrapper} bash -lc ${shQuote(interno)}`;
}

/* Ejecuta `argv` en la 89 y devuelve el resultado de ssh. `capturar` recoge stdout (análisis)
 * en vez de volcarlo al terminal. `entrada` (Buffer) se envía por stdin (p. ej. un tar). */
export function ejecutarEnVps(config, dir, argv, { capturar = false, entrada } = {}) {
  const opciones = {
    encoding: 'utf8',
    stdio: entrada ? ['pipe', 'inherit', 'inherit'] : capturar ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  };
  if (entrada) opciones.input = entrada;
  return spawnSync(BIN_SSH, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', config.host, comandoEnVps(config, dir, argv)], opciones);
}

/* ssh devuelve 255 cuando no llega a la VPS; ese caso se nombra aparte del fallo del comando. */
export function mensajeSinVps(status, host) {
  return status === 255
    ? `no se pudo conectar a la VPS (${host}); reintenta o usa --local solo en emergencia`
    : null;
}
