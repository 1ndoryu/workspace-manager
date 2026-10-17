/* Ajustes y opciones del propagador (`quality:bump`): rutas base, routers que se
 * propagan y los flags de argv. No importa otros modulos del paquete, asi que
 * cualquiera puede usarlo sin crear ciclos. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* [por que] Este modulo vive en scripts/quality/bump, pero lo que los
 * consumidores esperan de AQUI es la carpeta de los comandos (scripts/quality):
 * ahi viven el adapter canonico y sus routers. */
export const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANAGER = path.resolve(AQUI, '..', '..');

/* Routers: archivos que en cada consumidor son solo un puente al adapter único
 * del área. `ADAPTER` es el nombre del archivo canónico al que delegan. */
export const ROUTERS = [
  { archivo: 'quality-setup.mjs', prefijo: 'quality:setup' },
  { archivo: 'lock-generator.mjs', prefijo: 'quality:lock' },
];

export const EXCLUIDOS_POR_ALCANCE = ['glory-harness'];

const argv = process.argv.slice(2);

export function valorDe(flag) {
  const indice = argv.indexOf(flag);
  return indice >= 0 && argv[indice + 1] ? argv[indice + 1] : null;
}

export const soloShims = argv.includes('--shims');
export const escribir = argv.includes('--write');
/* Los routers solo se ESCRIBEN en modo --shims. [por que] Antes los tocaba
 * también `--tool <t> --write`, y como el destino del host coincide con el
 * adapter canónico, un bump de pin borraba el adapter y dejaba routers que
 * delegaban en sí mismos (recursión + AssignProcessToJobObject, 2026-09-10). */
export const escribirRouters = soloShims && escribir;
export const salidaJson = argv.includes('--json');
export const conPasos = !argv.includes('--no-steps');
export const herramienta = valorDe('--tool');
export const solo = (valorDe('--only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
export const salta = (valorDe('--skip') ?? '').split(',').map(s => s.trim()).filter(Boolean);
