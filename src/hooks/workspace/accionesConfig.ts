/* Acciones de config persistente del store: ignorar, eximir, scan y sync.
 * [por que] Slice del store global: recibe set/get de zustand y devuelve su
 * grupo de acciones para que useWorkspace.ts lo componga sin logica duplicada. */
import axios from 'axios';
import type { StoreApi } from 'zustand';
import type {
  ConfigScan,
  ConfigWorkspace,
  SnapshotWorkspace,
} from '../../shared/types.js';
import type { ReporteSincronizacion } from '../../server/gate/sincronizacion.js';
import type { AccionesConfig, EstadoWorkspace } from './tipos.js';
import { logger } from '../../shared/logger.js';

type Set = StoreApi<EstadoWorkspace>['setState'];

export function crearAccionesConfig(set: Set): AccionesConfig {
  return {
    cambiarIgnorado: async (clave, ignorar) => {
      try {
        const { data } = await axios.post<{ ok: boolean; snapshot?: SnapshotWorkspace }>('/api/config', {
          op: ignorar ? 'ignorar' : 'quitar',
          clave,
        });
        /* [por que] El server devuelve el snapshot ya mutado (ignorar/quitar
         * solo cambia visibilidad, no requiere re-escaneo completo). Se aplica
         * directo: la UI se actualiza al instante sin esperar el escaneo git
         * (~2.6s) que antes se hacia dos veces (server + cliente). */
        if (data.snapshot) set({ snapshot: data.snapshot, desdeCache: false });
      } catch (err) {
        const detalle = (err as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle;
        throw new Error(detalle ?? 'no se pudo guardar la config');
      }
    },

    /* Exime/quita la exencion de gate de glory-sentinel (plan 308A-1 F6). El
     * server valida que la clave sea glory-sentinel; solo persiste la config. */
    cambiarSinGate: async (clave, eximir) => {
      try {
        const { data } = await axios.post<{ ok: boolean; snapshot?: SnapshotWorkspace }>('/api/config/singate', {
          op: eximir ? 'eximir' : 'quitar',
          clave,
        });
        if (data.snapshot) set({ snapshot: data.snapshot, desdeCache: false });
      } catch (err) {
        const detalle = (err as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle;
        throw new Error(detalle ?? 'no se pudo guardar la config');
      }
    },

    /* Persiste automatico+intervalo (switch/input del PanelConfig). */
    configurarScan: async (scan: ConfigScan) => {
      const { data } = await axios.post<{ ok: boolean; config: ConfigWorkspace }>('/api/config/scan', scan);
      set((s) => ({
        snapshot: s.snapshot ? { ...s.snapshot, config: data.config } : s.snapshot,
      }));
    },

    /* Estado del checkout compartido del gate (plan 308A-1 F7): reusa la
     * validacion de quality-sync via endpoint y la cachea en el store. Se
     * refresca con el boton 'Verificar' del panel (nunca en el arranque para no
     * correr git en cada carga). */
    cargarSincronizacion: async () => {
      try {
        const { data } = await axios.get<{ reporte: ReporteSincronizacion }>('/api/gate/sincronizacion');
        if (data && data.reporte) set({ sincronizacion: data.reporte, errorSincronizacion: null });
      } catch (err) {
        /* [por que] Antes solo se logueaba y la vista seguia mostrando el hint
         * inicial ('pulsa verificar') aunque ya se habia intentado: el usuario
         * no distinguia 'sin pedir' de 'fallo'. Se guarda el motivo para
         * mostrarlo en VistaGate sin inventar datos. */
        const motivo = (err as { message?: string })?.message ?? 'error desconocido';
        set({ errorSincronizacion: `no se pudo verificar el gate: ${motivo}` });
        logger.warn('no se pudo verificar la sincronizacion del gate:', err);
      }
    },
  };
}
