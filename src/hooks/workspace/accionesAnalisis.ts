/* Acciones de analisis sentinel del store: rehidratar, uno y barrido.
 * [por que] Slice del store global: recibe set/get de zustand y devuelve su
 * grupo de acciones para que useWorkspace.ts lo componga sin logica duplicada. */
import axios from 'axios';
import type { StoreApi } from 'zustand';
import type { AnalisisSentinel, SnapshotWorkspace } from '../../shared/types.js';
import type { AccionesAnalisis, EstadoWorkspace } from './tipos.js';
import { logger } from '../../shared/logger.js';

type Set = StoreApi<EstadoWorkspace>['setState'];
type Get = StoreApi<EstadoWorkspace>['getState'];

export function crearAccionesAnalisis(set: Set, get: Get): AccionesAnalisis {
  return {
    /* Rehidrata el estado de analisis desde la cache del server (get de toda la
     * cache persistida). [por que] El analisis solo se guarda en el store durante
     * la sesion; sin esto, al recargar la pagina se perdia toda la info aunque el
     * server siguiera cacheandola en disco. Best-effort: si falla, no rompe el
     * arranque. */
    cargarAnalisis: async () => {
      try {
        const { data } = await axios.get<{ total: number; analisis: Record<string, AnalisisSentinel> }>(
          '/api/gate/analisis',
        );
        if (data && typeof data.analisis === 'object') {
          set((s) => ({ analisis: { ...s.analisis, ...data.analisis } }));
        }
      } catch (err) {
        logger.warn('no se pudo rehidratar el analisis guardado:', err);
      }
    },

    /* Analiza UN proyecto (boton 'Escanea ahora' del detalle/config) y cachea el
     * resultado en el store para que la consola lo agrupe sin volver al server. */
    escanearUno: async (clave, forzar = false) => {
      const { data } = await axios.post<AnalisisSentinel>('/api/gate/analizar', { clave, forzar });
      set((s) => ({ analisis: { ...s.analisis, [clave]: data } }));
      return data;
    },

    /* Barrido serial del workspace (auto-timer y boton 'Escanea todo').
     * [por que] El boton manual manda forzar=true para que sea GENUINO: el
     * server re-escanea git (nuevos commits/HEAD) y re-ejecuta sentinel aunque
     * la frescura no haya cambiado; el auto-timer manda forzar=false y reusa la
     * cache por frescura (branch+HEAD+version) sin spawns innecesarios. */
    escanearTodo: async (forzar = false) => {
      /* [por que] el flag analizando evita barridos encolados (single-flight);
       * el server igual no hace spawn si nada cambio (cache por HEAD/version). */
      if (get().analizando) return;
      set({ analizando: true });
      try {
        const { data } = await axios.post<{
          escaneadoEn: string;
          snapshot?: SnapshotWorkspace;
          proyectos: AnalisisSentinel[];
        }>('/api/gate/analizar-todo', { forzar });
        const analisis: Record<string, AnalisisSentinel> = {};
        for (const a of data.proyectos) analisis[a.clave] = a;
        /* [por que] El server re-escanea git real (snapshotArea(true)) y lo
         * devuelve en `snapshot`: hay que aplicarlo, si no la consola sigue
         * mostrando los contadores de git (sin push/sin commit) del snapshot
         * del arranque aunque el usuario ya haya commiteado/pusheado. */
        set((s) => ({
          snapshot: data.snapshot ?? s.snapshot,
          desdeCache: false,
          analisis: { ...s.analisis, ...analisis },
        }));
      } finally {
        set({ analizando: false });
      }
    },
  };
}
