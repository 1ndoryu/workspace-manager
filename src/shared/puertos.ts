/* Puertos de ESTE repo. Definición única: el resto del código importa de aquí.
 * [por qué] Estaban escritos a mano en catorce sitios y por eso se
 * desincronizaban entre sí: el guardián protegía 5175/8787/4173 y el doctor
 * 8787/5174/5175, sin que ninguno fuera el dueño del dato. Un puerto es del
 * producto, no de nuestra área, así que vive en el código con estos valores por
 * defecto; el prefijo `WS_` (el mismo de `WS_AREA_ROOT`/`WS_CONFIG_ROOT`) los
 * mueve sin tocar nada.
 *
 * Gemelo de `scripts/shared/puertos.mjs` (los `.mjs` sueltos no pueden importar
 * TypeScript; es la misma duplicación documentada que en `rutas`).
 *
 * Solo servidor: lee `process.env`, que en el navegador no existe. Ningún
 * componente del front debe importarlo. */
function puerto(valor: string | undefined, defecto: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : defecto;
}

/** API HTTP del tablero (el backend). */
export const PUERTO_API = puerto(process.env.WS_PORT, 8787);

/** Front del tablero: el build estático o el servidor de Vite. */
export const PUERTO_WEB = puerto(process.env.WS_WEB_PORT, 5175);

/** Vista previa del front compilado (`vite preview`). */
export const PUERTO_PREVIEW = puerto(process.env.WS_PREVIEW_PORT, 4173);

/* Puerto de opencode-propio. Es AJENO a este repo —otra app que la usuaria
 * tiene abierta en la misma máquina— pero el tablero tiene que conocerlo para no
 * matarlo nunca (AGENTS §6). */
export const PUERTO_OPENCODE = puerto(process.env.WS_OPENCODE_PORT, 5174);

/** Puertos que el tablero reconoce como suyos (guardián: Origin y Host). */
export const PUERTOS_TABLERO: readonly number[] = [PUERTO_WEB, PUERTO_API, PUERTO_PREVIEW];

/** Puertos que no se matan nunca: los del tablero más el de opencode-propio. */
export const PUERTOS_PROTEGIDOS: readonly number[] = [PUERTO_OPENCODE, PUERTO_WEB, PUERTO_API];
