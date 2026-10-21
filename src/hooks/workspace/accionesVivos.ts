/* Estado vivo del área en el store (20AA-24 F3.2). Lo alimenta el canal único
 * (`v2/canal/canalEventos.ts`). Ese canal manda lo que ya cambió al reconectar, así que no hace
 * falta pedir la foto de `/api/eventos?solo-ultimos=1` al arrancar: sería una segunda fuente.
 * [por que el store y no un hook de cada vista] El mapa y la lista de proyectos tienen que pintar
 * el mismo borde y el mismo color del nodo; con dos fuentes acabarían discrepando (AGENTS §5). */
import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import type { AccionesVivos, DatosVivos } from './tipos.js';

type Set = StoreApi<DatosVivos & AccionesVivos>['setState'];
type Get = StoreApi<DatosVivos & AccionesVivos>['getState'];

/* ¿Los dos conjuntos son el mismo? [por que] El canal publica sólo cuando cambia la huella, así
 * que esto casi nunca ahorra; lo que evita son los re-render de `aplicarVivos` al arrancar dos
 * veces (foto y primer evento) con el mismo contenido. */
function iguales(a: ReadonlySet<string> | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  if (a.size !== b.length) return false;
  return b.every((k) => a.has(k));
}

const conjunto = (claves: string[] | null): ReadonlySet<string> | null =>
  claves === null ? null : new Set(claves);

/* Store mínimo para las pruebas: la acción es pura respecto de set/get, no necesita el global. */
export function crearStoreVivos() {
  return create<DatosVivos & AccionesVivos>((set, get) => ({
    vivosLaptop: null,
    vivosProduccion: null,
    ...crearAccionesVivos(set, get),
  }));
}

export function crearAccionesVivos(set: Set, get: Get): AccionesVivos {
  return {
    aplicarVivos(laptop, produccion) {
      const estado: DatosVivos = get();
      /* `null` = esa fuente no contestó: se conserva lo último bueno. Apagar todos los nodos porque
       * una VPS no responde sería mentir sobre el área. */
      if (laptop === null && produccion === null) return;
      if (iguales(estado.vivosLaptop, laptop) && iguales(estado.vivosProduccion, produccion)) return;
      set({
        vivosLaptop: laptop === null ? estado.vivosLaptop : conjunto(laptop),
        vivosProduccion: produccion === null ? estado.vivosProduccion : conjunto(produccion),
      });
    },
  };
}
