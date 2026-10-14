/* Cabecera de autorización para llamar a la API del manager (F9.1). Lee el mismo token
 * que el servidor (src/server/seguridad/token.ts) y NO lo crea: si falta, el manager
 * no se ha arrancado nunca y el error lo dice. [por que] Sin esto, los scripts de
 * Arranque, doctor y gate reciben 401 y el arranque los da por caídos. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function leerToken(env = process.env) {
  const porVariable = env.WM_TOKEN?.trim();
  if (porVariable) return porVariable;
  const ruta = env.WM_TOKEN_FILE || path.join(homedir(), '.workspace-manager', 'token');
  if (!existsSync(ruta)) {
    throw new Error(`token del manager no encontrado en ${ruta}: arranca el manager una vez para crearlo`);
  }
  return readFileSync(ruta, 'utf8').trim();
}

export function cabeceraAutorizacion(env = process.env) {
  return { Authorization: `Bearer ${leerToken(env)}` };
}
