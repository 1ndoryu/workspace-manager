/* Claves de proyectos que corren de verdad en producción (Coolify).
 * [por que] Tener un despliegue registrado no es estar corriendo: lo vivo lo decide el servidor,
 * que publica por el canal (`vivos.produccion`) el estado real de cada sitio.
 * [por que ya no hay fetch aquí] Hasta 20AA-24 esta función pedía `/api/vps/sitios` al montar y se
 * quedaba con esa foto para siempre: un sitio que arrancaba o caía después no se veía hasta
 * recargar. Ahora se limita a cruzar el conjunto que llega por el canal con los despliegues de
 * cada proyecto, que es lo único que el mapa necesita y lo único que sabe hacer de más. */
import { useEffect, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';

const SIN_VIVOS: ReadonlySet<string> = new Set();

export function useProduccionViva(
  proyectos: Proyecto[],
  vivos: ReadonlySet<string> | null,
): ReadonlySet<string> {
  const [corriendo, setCorriendo] = useState<ReadonlySet<string>>(SIN_VIVOS);

  useEffect(() => {
    /* Sin datos del canal no se afirma nada: el mapa deja los nodos de producción sin brillo. */
    if (vivos === null) {
      setCorriendo(SIN_VIVOS);
      return;
    }
    const claves = proyectos
      .filter((p) => p.despliegue && vivos.has(p.despliegue.sitio))
      .map((p) => p.clave);
    setCorriendo(claves.length === 0 ? SIN_VIVOS : new Set(claves));
  }, [proyectos, vivos]);

  return corriendo;
}
