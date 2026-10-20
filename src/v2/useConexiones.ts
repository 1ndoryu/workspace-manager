/* Conexiones vivas de cada proyecto: a qué nodos del mapa va (laptop, VPS 89, producción).
 * [por que] El mapa dibuja la línea y el borde de la caja con el color de su nodo, y la lista
 * de proyectos pinta ese mismo color en su cuadro de estado: si cada vista decidiera por su
 * cuenta, el mapa y el panel acabarían diciendo cosas distintas del mismo proyecto (AGENTS §5). */
import { useMemo } from 'react';
import type { Proyecto, UrlDestino } from '../shared/types.js';
import { useWorkspaceStore } from '../hooks/useWorkspace.js';
import { destinosDe, type IdHub } from './mapa/geometria/disposicion.js';
import { useProduccionViva } from './vps/useProduccionViva.js';

export interface Conexiones {
  /* Claves con servicio en marcha: su enlace brilla. */
  enMarcha: ReadonlySet<string>;
  /* Claves corriendo en producción. */
  enProd: ReadonlySet<string>;
  /* Nodos a los que va cada proyecto, por clave. Sin entrada (o lista vacía) = no corre en ningún
   * sitio: el mapa lo deja en el bloque libre, sin línea. */
  destinos: ReadonlyMap<string, IdHub[]>;
}

/* [por que] Estable: `?? []` crearía un array nuevo en cada render y las dependencias de los
 * memos (y el efecto de producción) se dispararían en bucle mientras no haya instantánea. */
const SIN_PROYECTOS: Proyecto[] = [];

/* URLs de los sitios donde el proyecto corre AHORA, en el orden del mapa. [por que] El
 * snapshot trae todas las direcciones posibles y `destinos` dice cuáles están vivas: lo
 * consumen el tooltip y el click de la caja, para que no decidan cosas distintas. */
export function urlsVivas(
  urls: UrlDestino[] | undefined,
  destinos: readonly string[],
): UrlDestino[] {
  if (!urls || destinos.length === 0) return [];
  const porSitio = new Map(urls.map((u) => [u.donde, u]));
  return destinos.flatMap((d) => {
    const u = porSitio.get(d as UrlDestino['donde']);
    return u ? [u] : [];
  });
}

export function useConexiones(): Conexiones {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const dev = useWorkspaceStore((s) => s.dev);
  const proyectos = snapshot?.proyectos ?? SIN_PROYECTOS;

  /* Solo `bajo-mando` = sonda verde real: parado, deriva o sin botón no brillan (05AA-4). */
  const enMarcha = useMemo(() => {
    const set = new Set<string>();
    for (const d of dev?.proyectos ?? []) if (d.estado === 'bajo-mando') set.add(d.clave);
    return set;
  }, [dev]);

  const enProd = useProduccionViva(proyectos);

  const destinos = useMemo(
    () => new Map(proyectos.map((p) => [p.clave, destinosDe(p, enMarcha, enProd)] as const)),
    [proyectos, enMarcha, enProd],
  );

  return { enMarcha, enProd, destinos };
}
