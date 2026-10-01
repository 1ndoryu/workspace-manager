/* Acciones de vigilancia dev (F0b) + mando (F3).
 * [por que] Slice del store como vulnerabilidades: el server ejecuta el
 * doctor en su proceso (cache TTL 60s) y las acciones del CLI en un hijo
 * sin shell; aqui solo se cachea el informe y el ultimo resultado para
 * que la consola pinte sin-boton/deriva y ofrezca botones sin re-ejecutar
 * sensores. */
import axios from 'axios';
import type { StoreApi } from 'zustand';
import type { InformeDev } from '../../shared/dev.js';
import type { AccionesDev, AccionDevNombre, EstadoWorkspace } from './tipos.js';
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
    /* Ejecuta una accion del mando sobre una entrada del registro (F3):
     * up/stop por POST, status/logs/open por GET. Single-flight con
     * devOcupado (el server ya tarda: up hasta arranqueMs). El resultado
     * (codigo + salida del CLI) queda en devResultado para pintarlo; tras
     * up/stop se refresca la vigilancia (el estado del area cambio).
     * `open` ademas abre la primera URL en pestana nueva. Nunca rechaza. */
    accionDev: async (accion: AccionDevNombre, id: string) => {
      if (get().devOcupado) return;
      set({ devOcupado: true });
      try {
        const { data } =
          accion === 'up' || accion === 'stop'
            ? await axios.post<{ codigo: number; salida: string }>(`/api/dev/${accion}`, { id })
            : await axios.get<{ codigo: number; salida: string }>(`/api/dev/${accion}`, {
                params: accion === 'logs' ? { id, lineas: 50 } : { id },
              });
        const codigo = typeof data?.codigo === 'number' ? data.codigo : 1;
        const salida = typeof data?.salida === 'string' && data.salida ? data.salida : '(sin salida)';
        set({ devResultado: { accion, id, codigo, salida, en: new Date().toISOString() } });
        if (accion === 'open' && codigo === 0) {
          const primera = salida.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('http'));
          if (primera) window.open(primera, '_blank', 'noopener');
        }
        if (accion === 'up' || accion === 'stop') {
          await get().cargarDev();
        }
      } catch (err) {
        logger.warn(`accion dev ${accion} ${id} no disponible:`, err);
        set({
          devResultado: {
            accion,
            id,
            codigo: 1,
            salida: err instanceof Error ? err.message : `Error al pedir /api/dev/${accion}`,
            en: new Date().toISOString(),
          },
        });
      } finally {
        set({ devOcupado: false });
      }
    },
  };
}
