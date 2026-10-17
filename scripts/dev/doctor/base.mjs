/* Constantes y rutas del doctor: la base que comparten sus modulos. */

import { rutaConfigPrivada } from '../../shared/rutas.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* [por que] La carpeta de este modulo es scripts/dev/doctor; DIR_DEV es la de los
 * comandos (scripts/dev), que es lo que esperan sus consumidores. */
export const DIR_DEV = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RAIZ_REPO = resolve(DIR_DEV, '..', '..');

export const RUTA_REGISTRO = rutaConfigPrivada('registro.json');

export const TTL_MS = 60_000;
// [por que] 25 s: Get-CimInstance en frio tardo 7 s medidos; con 12 s el
// sensor fallaba por carga y no por defecto real.

export const TIMEOUT_SENSOR_MS = 25_000;

export const MAX_PIDS_CONSULTA = 20;

export const PUERTOS_PROTEGIDOS = new Set([8787, 5174, 5175]);

export const MOTIVOS_ENUM = new Set([
  'solo-docs',
  'gestion-externa',
  'pendiente-onboarding',
  'pausado-archivado',
  'puerto-dinamico',
  // [por que] 6 de 17 proyectos del area son herramientas o bibliotecas sin
  // servicio local (varsense, sentinel, inspector, gloryport, limpiador,
  // glory-agent): forzarlos a 'solo-docs' mentiria (tienen codigo y releases)
  // y 'otro{...}' pondria caducidad a un hecho permanente. 'sin-servicio'
  // dice exactamente eso: nada que arrancar, nada que probar, el mando no
  // aplica y no es deuda pendiente.
  'sin-servicio',
  // [por que] repos del area que la usuaria decidio no registrar (D5, 2026-10-10):
  // no tienen mando ni deuda, y declararlos evita que `doctor --all` y la salud
  // (F8) los marquen como huerfanos. Distinto de 'pendiente-onboarding': aqui no
  // hay onboarding previsto.
  'sin-mando-intencional',
]);

export const RE_OTRO = /^otro\{detalle="(.{1,80})",caducidad=(\d{4}-\d{2}-\d{2})\}$/;

/* F1: boton = argv ejecutable, no texto bonito. argv[0] en allowlist
 * (npm/cargo/node); `node <script>` solo scripts con nombre permitido bajo la
 * ruta de la entrada (anti-hijack: el nombre lo fija el registro, la
 * existencia la comprueba el doctor, el exe lo resuelve `where`). argv[i]
 * arranca puertos[i] (mapeo posicional, validado): el `up` sabe que lanzar
 * por puerto caido sin adivinar. */
export const EXES_PERMITIDOS = new Set(['npm', 'cargo', 'node']);

export const SCRIPTS_NODO_VALIDOS = new Set([
  'dev-web.mjs',
  'dev-web.ts',
  'dev-runner.ts',
  'dev.sh',
  'dev.ps1',
]);
