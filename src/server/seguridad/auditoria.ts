/* Registro de auditoría de la API (F9.1): quién llamó, a qué ruta y con qué resultado.
 * [por que] Un proceso que lanza otros (dev up, doctor, escaneos) debe dejar rastro sin
 * registrar cabeceras, cuerpos ni el token. Una línea JSON por petición; al pasar de
 * TAMANO_MAX se rota a un único `.1` para que el disco no crezca sin límite. */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

export const TAMANO_MAX_AUDITORIA = 5 * 1024 * 1024;

export interface EntradaAuditoria {
  metodo: string | undefined;
  ruta: string;
  estado: number;
  origin: string | null;
}

export function rutaAuditoriaPorDefecto(raizWm: string): string {
  return path.join(raizWm, 'logs', 'auditoria-manager.jsonl');
}

export function registrarAuditoria(archivo: string, entrada: EntradaAuditoria, ahora: Date = new Date()): void {
  const linea = JSON.stringify({ t: ahora.toISOString(), ...entrada }) + '\n';
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    const tamano = statSync(archivo, { throwIfNoEntry: false })?.size ?? 0;
    if (tamano > TAMANO_MAX_AUDITORIA) {
      renameSync(archivo, `${archivo}.1`);
    }
    appendFileSync(archivo, linea, 'utf8');
  } catch {
    /* La auditoría nunca tumba la petición: si el disco falla, se pierde la línea. */
  }
}
