/* Acciones de vulnerabilidades del store: rehidratar, una y barrido.
 * [por que] Slice del store global: recibe set/get de zustand y devuelve su
 * grupo de acciones para que useWorkspace.ts lo componga sin logica duplicada. */
import axios from 'axios';
import type { StoreApi } from 'zustand';
import type { AnalisisVulnerabilidades, SnapshotWorkspace } from '../../shared/types.js';
import type { AccionesVulnerabilidades, EstadoWorkspace } from './tipos.js';
import { logger } from '../../shared/logger.js';

type Set = StoreApi<EstadoWorkspace>['setState'];
type Get = StoreApi<EstadoWorkspace>['getState'];

export function crearAccionesVulnerabilidades(set: Set, get: Get): AccionesVulnerabilidades {
  return {
    /* Rehidrata las vulnerabilidades desde la cache del server (get de toda la
     * cache) para que al recargar no se pierda la info ya auditada. [por que]
     * Igual que cargarAnalisis: best-effort, auditoria de dependencias lenta
     * (5-15 s por lockfile con cambios) y no debe re-ejecutarse al recargar. */
    cargarVulnerabilidades: async () => {
      try {
        const { data } = await axios.get<{
          total: number;
          vulnerabilidades: Record<string, AnalisisVulnerabilidades>;
        }>('/api/gate/vulnerabilidades-cache');
        if (data && typeof data.vulnerabilidades === 'object') {
          set((s) => ({
            vulnerabilidades: { ...s.vulnerabilidades, ...data.vulnerabilidades },
          }));
        }
      } catch (err) {
        logger.warn('no se pudo rehidratar las vulnerabilidades guardadas:', err);
      }
    },

    /* Audita UN proyecto (boton 'Auditar ahora' del detalle/config) y cachea el
     * resultado en el store para que la consola lo agrupe sin volver al server. */
    auditarUno: async (clave, forzar = false) => {
      const { data } = await axios.post<AnalisisVulnerabilidades>(
        '/api/gate/vulnerabilidades',
        { clave, forzar },
      );
      set((s) => ({
        vulnerabilidades: { ...s.vulnerabilidades, [clave]: data },
      }));
      return data;
    },

    /* Barrido serial del workspace (boton 'Auditar todo'). El server reusa la
     * cache por hash-de-lockfile si nada cambio; el boton manual manda
     * forzar=true para re-auditar de verdad. Single-flight con auditando. */
    auditarTodo: async (forzar = false) => {
      if (get().auditando) return;
      set({ auditando: true });
      try {
        const { data } = await axios.post<{
          escaneadoEn: string;
          snapshot?: SnapshotWorkspace;
          proyectos: AnalisisVulnerabilidades[];
        }>('/api/gate/vulnerabilidades-todo', { forzar });
        const vuls: Record<string, AnalisisVulnerabilidades> = {};
        for (const v of data.proyectos) vuls[v.clave] = v;
        set((s) => ({
          snapshot: data.snapshot ?? s.snapshot,
          desdeCache: false,
          vulnerabilidades: { ...s.vulnerabilidades, ...vuls },
        }));
      } finally {
        set({ auditando: false });
      }
    },
  };
}
