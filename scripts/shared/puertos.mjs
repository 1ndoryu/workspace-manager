/* Puertos de ESTE repo. Definición única para los scripts.
 * [por qué] Gemelo de `src/shared/puertos.ts`: node ejecuta los `.mjs` sueltos y
 * no puede importar TypeScript, así que la derivación se repite. Es el único
 * sitio donde se permite (igual que en `rutas.mjs`); el resto de scripts importa
 * de aquí. */
function puerto(valor, defecto) {
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
export const PUERTOS_TABLERO = [PUERTO_WEB, PUERTO_API, PUERTO_PREVIEW];

/** Puertos que no se matan nunca: los del tablero más el de opencode-propio. */
export const PUERTOS_PROTEGIDOS = [PUERTO_OPENCODE, PUERTO_WEB, PUERTO_API];

/** URL base de la API del tablero. `WM_API` la mueve (p. ej. a un túnel).
 * [por qué] Cinco scripts repetían `http://127.0.0.1:8787` a mano. */
export const URL_API = (process.env.WM_API || `http://127.0.0.1:${PUERTO_API}`).replace(/\/+$/u, '');
