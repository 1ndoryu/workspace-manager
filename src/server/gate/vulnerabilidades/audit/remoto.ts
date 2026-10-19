/* Donde corre el audit de dependencias: en la VPS 89 si el proyecto es del taller,
 * en el portatil si no. [por que] Un fallo al preparar el arbol remoto queda en error
 * con su motivo y NO cae a local: auditar en el portatil un proyecto del taller es
 * carga pesada (AGENTS §1). Corte de vulnerabilidades.ts (17AA-2): lo local/taller y la
 * ejecucion del audit son dos cosas distintas y estaban en el mismo archivo. */
import { prepararArbolRemoto } from '../../auditoria-remota.js';
import type { GestorAudit } from '../../auditoria-remota.js';
import { modoAnalisis } from '../../herramientas/config.js';

/* Deja en la 89 el arbol que necesita este gestor. Devuelve null si se pudo, o el
 * motivo por el que no. [por que] El llamador lo convierte en 'error' con ese
 * motivo: no hay audit en local de respaldo (AGENTS §1). Devolver false en
 * silencio mostraria un fallo igual que un resultado. */
export async function prepararRemoto(rutaProyecto: string, gestor: GestorAudit): Promise<string | null> {
  try {
    await prepararArbolRemoto(rutaProyecto, gestor);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
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
