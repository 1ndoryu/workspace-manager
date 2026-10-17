/* Donde corre el audit de dependencias: en la VPS 89 si el proyecto se analiza
 * alli, en el portatil si no. [por que] El manager funciona sin VPS, asi que un
 * fallo al preparar el arbol remoto NO es un fallo del analisis: se cae a local
 * y se dice. Corte de vulnerabilidades.ts (17AA-2): lo local/taller y la
 * ejecucion del audit son dos cosas distintas y estaban en el mismo archivo. */
import { prepararArbolRemoto } from '../auditoria-remota.js';
import type { GestorAudit } from '../auditoria-remota.js';
import { modoAnalisis } from '../remoto.js';

/* Deja en la 89 el arbol que necesita este gestor. Devuelve null si se pudo, o el
 * motivo por el que no: el audit cae a local en vez de fallar, que es lo que hace
 * el manager sin VPS. [por que] Antes devolvia false en silencio, y un audit que
 * corrio en el portatil se mostraba igual que uno de la 89: la degradacion tiene
 * que decirse, no callarse. */
export async function prepararRemoto(rutaProyecto: string, gestor: GestorAudit): Promise<string | null> {
  try {
    await prepararArbolRemoto(rutaProyecto, gestor);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/* Aviso de degradacion, para que el panel distinga un audit de la 89 de uno que
 * se quedo en local. Misma forma que el de `analizador.ts` para Sentinel y
 * VarSense: `aviso`, no `error`, porque hay resultado. */
export function avisoLocal(fallo: string): string {
  return `hecho en local, el taller no respondió (${fallo.slice(0, 120)})`;
}

/* Si el proyecto se analiza en la 89. `modoAnalisis` lee registro.json, que es
 * configuracion privada: sin el (o ilegible) se audita en local, nunca se falla. */
export function enTaller(clave: string): boolean {
  try {
    return modoAnalisis(clave) === 'taller';
  } catch {
    return false;
  }
}
