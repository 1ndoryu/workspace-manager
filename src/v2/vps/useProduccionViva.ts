/* Claves de proyectos que corren de verdad en producción (Coolify).
 * [por que] Tener un despliegue registrado no es estar corriendo: se consulta
 * el estado real (`estadoReal` = running[:healthy]) y, si no hay respuesta
 * (sin binario, sin red), nada se pinta como vivo. "degraded" cuenta: el contenedor
 * corre aunque algún check de salud falle.
 * [por que `estaVivo`] La regex de aquí era la cuarta copia del mismo criterio; el caído/desconocido
 * se decide en `shared/vps/salud.ts`, que es lo que también lee la campana. */
import { useEffect, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { estaVivo } from '../../shared/vps/salud.js';
import { sitiosVps } from './apiVps.js';

export function useProduccionViva(proyectos: Proyecto[]): ReadonlySet<string> {
  const [corriendo, setCorriendo] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let activo = true;
    sitiosVps()
      .then(({ sitios }) => {
        if (!activo) return;
        const vivos = new Set(sitios.filter((s) => estaVivo(s.estadoReal)).map((s) => s.nombre));
        setCorriendo(new Set(proyectos.filter((p) => p.despliegue && vivos.has(p.despliegue.sitio)).map((p) => p.clave)));
      })
      .catch(() => activo && setCorriendo(new Set()));
    return () => {
      activo = false;
    };
  }, [proyectos]);

  return corriendo;
}
