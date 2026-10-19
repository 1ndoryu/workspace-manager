/* Dónde corre lo pesado (builds, tests, análisis). Regla de la usuaria: en la VPS 89
 * siempre; el portátil solo en emergencia explícita con `--local`. Sin VPS configurada
 * no hay ejecución silenciosa en el portátil: el comando falla con un mensaje claro. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { BIN_SSH } from './binarios.mjs';
import { rutaConfigPrivada } from './rutas.mjs';
import { shQuote } from '../remoto/rcargo.mjs';

export const FLAG_LOCAL = '--local';

/* Configuración del taller (privada). Null si no existe: clon sin VPS. */
export function cargarTaller(ruta = rutaConfigPrivada('taller.json')) {
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, 'utf8'));
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

/* Carpeta de la réplica en la 89 para `carpeta` (dentro de `raiz`), bajo `dirRemotoBase/<id>`.
 * [por que] Mutagen replica el proyecto entero; lo que cuelga fuera de `raiz` no existe en la 89. */
export function dirRemotoDe(config, id, raiz, carpeta) {
  const relativa = path.relative(raiz, carpeta);
  if (relativa.startsWith('..') || path.isAbsolute(relativa)) {
    throw new Error(`${carpeta} está fuera de ${raiz}: no se replica en la VPS 89`);
  }
  const partes = relativa ? relativa.split(path.sep).join('/') : '';
  return path.posix.join(config.dirRemotoBase, id, partes);
}

/* Línea de shell para la VPS: entra en `dir` y ejecuta `argv` bajo el candado de carga pesada.
 * [por que] `config.preludio` (opcional, en taller.json) prepara el PATH del equipo remoto
 * (p. ej. el gestor de node); `bash -lc` no siempre lo carga. */
export function comandoEnVps(config, dir, argv) {
  const interno = `${config.preludio ?? ''}cd ${shQuote(dir)} && ${argv.map(shQuote).join(' ')}`;
  return `${config.lockWrapper} bash -lc ${shQuote(interno)}`;
}

/* Ejecuta `argv` en la 89 y devuelve el resultado de ssh. `capturar` recoge stdout (análisis)
 * en vez de volcarlo al terminal. */
export function ejecutarEnVps(config, dir, argv, { capturar = false } = {}) {
  return spawnSync(BIN_SSH, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', config.host, comandoEnVps(config, dir, argv)], {
    encoding: 'utf8',
    stdio: capturar ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/* ssh devuelve 255 cuando no llega a la VPS; ese caso se nombra aparte del fallo del comando. */
export function mensajeSinVps(status, host) {
  return status === 255
    ? `no se pudo conectar a la VPS (${host}); reintenta o usa --local solo en emergencia`
    : null;
}
