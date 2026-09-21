/* Acciones de carga inicial del store: snapshot, catalogo y esquemas.
 * [por que] Slice del store global: recibe set/get de zustand y devuelve su
 * grupo de acciones para que useWorkspace.ts lo componga sin logica duplicada. */
import axios from 'axios';
import type { StoreApi } from 'zustand';
import type { SnapshotWorkspace } from '../../shared/types.js';
import type { ReglaCatalogo } from '../../shared/gate/reglas.js';
import type { NodoEsquema } from '../../shared/gate/esquema.js';
import type { TipoGate } from '../../shared/gate/proveedores.js';
import type { AccionesCarga, EstadoWorkspace } from './tipos.js';
import { logger } from '../../shared/logger.js';
import { deserializarEsquema } from '../../shared/gate/serial.js';
import { ESQUEMA_SENTINEL } from '../../shared/gate/sentinel.js';
import { ESQUEMA_VARSENSE } from '../../shared/gate/varsense.js';

type Set = StoreApi<EstadoWorkspace>['setState'];
type Get = StoreApi<EstadoWorkspace>['getState'];

export function crearAccionesCarga(set: Set, get: Get): AccionesCarga {
  return {
    cargar: async (forzar = false) => {
      set({ cargando: true, error: null });
      try {
        const { data } = await axios.get<SnapshotWorkspace & { desdeCache?: boolean }>(
          `/api/workspace${forzar ? '?forzar=1' : ''}`,
        );
        set({
          snapshot: data,
          desdeCache: data.desdeCache ?? false,
          cargando: false,
        });
      } catch (err) {
        set({
          cargando: false,
          error: err instanceof Error ? err.message : 'Error al cargar el workspace',
        });
      }
    },

    /* [por que] Solo se pide una vez por sesion: el catalogo esta cacheado por
     * version+mtime en el server, asi que repetir el GET no cuesta. Si falla,
     * queda el estatico embebido (ya inicializado) y se avisa por consola. */
    cargarReglas: async () => {
      try {
        const { data } = await axios.get<{
          version: string;
          fuente: 'runtime' | 'estatica';
          reglas: ReglaCatalogo[];
        }>('/api/gate/reglas');
        if (Array.isArray(data.reglas)) {
          set({ reglasCatalogo: { version: data.version, fuente: data.fuente, reglas: data.reglas } });
        }
      } catch (err) {
        logger.warn('catalogo de reglas vivo no disponible, uso estatico:', err);
      }
    },

    /* [por que] Devuelve el esquema de config de una herramienta servido por la
     * API /gate/dinamico (el server resuelve el proveedor y sirve el esquema
     * SERIALIZADO con ciclos resueltos a refs); se rehidrata y cachea en el
     * store. Si ya esta, no repite. Si el fetch falla, cae al esquema estatico
     * embebido del bundle (fallback tolerante a fallos del plan E1). */
    cargarEsquema: async (tool) => {
      const ya = get().esquemas[tool];
      if (ya) return ya;
      const estatico = (t: TipoGate): NodoEsquema | undefined =>
        t === 'sentinel' ? ESQUEMA_SENTINEL() : t === 'varsense' ? ESQUEMA_VARSENSE() : undefined;
      try {
        const { data } = await axios.get<{ esquema: unknown }>(
          `/api/gate/dinamico?tool=${encodeURIComponent(tool)}`,
        );
        if (data && typeof data.esquema === 'object' && data.esquema !== null) {
          const nodo = deserializarEsquema(JSON.stringify(data.esquema));
          set((s) => ({ esquemas: { ...s.esquemas, [tool]: nodo } }));
          return nodo;
        }
      } catch (err) {
        logger.warn(`esquema ${tool} vivo no disponible, uso estatico:`, err);
      }
      const fb = estatico(tool);
      if (fb) set((s) => ({ esquemas: { ...s.esquemas, [tool]: fb } }));
      return fb;
    },
  };
}
