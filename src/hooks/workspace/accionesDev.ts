/* Acciones de vigilancia dev (F0b): informe del doctor servido por el server.
 * [por que] Slice del store como vulnerabilidades: el server ejecuta el
 * doctor en su proceso (cache TTL 60s) y aqui solo se cachea el informe para
 * que la consola pinte sin-boton/deriva sin re-ejecutar sensores. */
import axios from 'axios';
import type { StoreApi } from 'zustand';
import type { InformeDev } from '../../shared/dev.js';
import type { AccionesDev, EstadoWorkspace } from './tipos.js';
import { logger } from '../../shared/logger.js';

type Set = StoreApi<EstadoWorkspace>['setState'];
type Get = StoreApi<EstadoWorkspace>['getState'];

/* Informe vivo: el InformeDev del doctor mas la frescura del cache server. */
export interface InformeDevVivo extends InformeDev {
  escaneadoHaceMs: number;
}

export function crearAccionesDev(set: Set, get: Get): AccionesDev {
  return {
    /* Pide el informe al server (single-flight con devCargando). Best-effort
     * como cargarAnalisis: si falla queda devError y la consola lo pinta en
     * la fila del propio manager en vez de callar. Nunca rechaza. */
    cargarDev: async () => {
      if (get().devCargando) return;
      set({ devCargando: true, devError: null });
      try {
        const { data } = await axios.get<InformeDevVivo>('/api/dev/estado');
        if (data && Array.isArray(data.proyectos)) {
          set({ dev: data });
        } else {
          set({ devError: 'respuesta sin forma de InformeDev' });
        }
      } catch (err) {
        logger.warn('vigilancia dev no disponible:', err);
        set({ devError: err instanceof Error ? err.message : 'Error al pedir /api/dev/estado' });
      } finally {
        set({ devCargando: false });
      }
    },
  };
}
