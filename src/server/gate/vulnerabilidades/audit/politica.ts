/* Diferencias de cada gestor de audit que el orquestador necesita conocer. Una tabla
 * por gestor: añadir uno es una entrada, no otra rama `if (gestor === ...)`.
 * [por que] Antes `vulnerabilidades.ts` comparaba con 'cargo' en dos sitios; el
 * parseo sigue por gestor en `parseo.ts`, que es donde vive cada formato. */
import type { Gestor } from './parseo.js';

export interface PoliticaGestor {
  /* Cargo: un crate de Cargo.lock que no alcanza el build (cargo tree -i) no cuenta. */
  filtraAlcance: boolean;
  /* Sin CLI (stdout vacío o no JSON) el gestor no es auditable: sale como noAuditable,
   * no como error. */
  ausenciaEsNoAuditable: boolean;
}

export const POLITICA_GESTOR: Record<Gestor, PoliticaGestor> = {
  npm: { filtraAlcance: false, ausenciaEsNoAuditable: false },
  pnpm: { filtraAlcance: false, ausenciaEsNoAuditable: false },
  cargo: { filtraAlcance: true, ausenciaEsNoAuditable: true },
};
