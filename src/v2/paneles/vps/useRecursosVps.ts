/* Historial de recursos de la VPS: muestras por tick de pulse, persistidas en
 * localStorage y el rango elegido por el usuario (19AA-13).
 * [por que] Sacado de PanelVpsRecursos: el componente solo pinta; aquí viven la
 * retención (7 días, tope de muestras), la migración de tuplas antiguas y el
 * volcado al cerrar. Los contadores de disco del host se repiten entre muestras
 * mientras pulse no los traiga (plano = sin dato, no cero).
 * [20AA-17] El navegador no puede muestrear con la pestaña de fondo ni con el
 * tablero cerrado, así que su historial solo cubría los ratos con el panel a la
 * vista y cada apertura empezaba de cero. El anillo que alimenta el servidor
 * (que sí está siempre en marcha) se pide al montar y al volver a la pestaña y se
 * mezcla con la cola viva; el localStorage sigue siendo la caché propia. */
import { useEffect, useRef, useState } from 'react';
import type { VpsAgenteSnapshot } from '../../../shared/types.js';
import { guardarJson, guardarTexto, leerJson, leerTexto } from '../../../shared/vista/storage.js';
import {
  bajarDocumento,
  bajarVentana,
  suscribirDocumento,
  suscribirVentana,
} from '../../../shared/platform/plataforma.js';
import {
  MAX_MUESTRAS_RECURSOS,
  RETENCION_RECURSOS_MS,
  fusionarRecursos,
  muestraDeSnapshot,
  normalizarMuestraRecursos,
  type MuestraRecursos,
} from '../../../shared/recursosHistorial.js';
import { historialRecursos } from '../../recursos/apiRecursos.js';
import { RANGOS, diezmar } from './vpsRecursosSeries.js';

/* [20AA-16] La tab va en las claves: el taller reutiliza este mismo cuadro de recursos, pero su
 * historial no puede mezclarse con el de vps (ni al revés). `'vps'` reproduce exactamente las
 * claves de siempre, así que la tab vps no necesita migración. */
function claveHistorial(tab: string): string {
  return `workspaceManager:${tab}-recursos-historial-v1`;
}

function claveRango(tab: string): string {
  return `workspaceManager:${tab}-recursos-rango-v1`;
}

function leerHistorial(clave: string): MuestraRecursos[] {
  const lista = leerJson<unknown>(clave, 'no se pudo leer el historial de recursos:');
  if (!Array.isArray(lista)) return [];
  const corte = Date.now() - RETENCION_RECURSOS_MS;
  const limpias: MuestraRecursos[] = [];
  for (const x of lista) {
    const m = normalizarMuestraRecursos(x, corte);
    if (m) limpias.push(m);
  }
  return limpias.slice(-MAX_MUESTRAS_RECURSOS);
}

function leerRango(clave: string): string {
  const r = leerTexto(clave);
  if (r && RANGOS.some((x) => x.id === r)) return r;
  return '30m';
}

/* Cuadro de muestras del rango elegido. `muestras` es un ref: el repintado lo
 * dispara `setVersion` (entra una muestra o cambia el rango). `tab` decide en qué
 * historial se guarda (vps o taller) y de qué anillo del servidor se lee. */
export function useRecursosVps(snap: VpsAgenteSnapshot | null, tab = 'vps') {
  const claveHist = claveHistorial(tab);
  const claveRng = claveRango(tab);
  const muestras = useRef<MuestraRecursos[]>([]);
  const ultimoTs = useRef<number | null>(null);
  const ultimoGuardado = useRef(0);
  /* [0110A-1] Último IO del host visto: mientras pulse no lo trae (null)
   * se repite el anterior para no inventar deltas (plano = sin dato,
   * no cero). */
  const ultimoDisco = useRef<{ r: number; w: number } | null>(null);
  const [rangoId, setRangoId] = useState<string>(() => leerRango(claveRng));
  /* Contador para repintar cuando entra una muestra o cambia el rango
   * (el ref no repinta solo). */
  const [, setVersion] = useState(0);

  /* Historial previo (sobrevive a recargas) + volcado al cerrar. */
  useEffect(() => {
    muestras.current = leerHistorial(claveHist);
    setVersion((v) => v + 1);
    const alCerrar = () => {
      /* Cierre sin almacenamiento: se pierde la cola sin romper nada. */
      guardarJson(claveHist, muestras.current.slice(-MAX_MUESTRAS_RECURSOS));
    };
    suscribirVentana('beforeunload', alCerrar);
    return () => bajarVentana('beforeunload', alCerrar);
  }, [claveHist]);

  /* [20AA-17] Anillo del servidor: al montar y cada vez que la pestaña vuelve a la
   * vista (es cuando el navegador ha dejado de muestrear). Se mezcla por t —la cola
   * viva gana— y se siembra el último IO visto para no inventar un salto a cero. */
  useEffect(() => {
    let vivo = true;
    const traerBase = () => {
      historialRecursos(tab)
        .then((base) => {
          if (!vivo || base.length === 0) return;
          muestras.current = fusionarRecursos(base, muestras.current);
          const ultima = muestras.current[muestras.current.length - 1];
          if (ultima) ultimoDisco.current = { r: ultima[7], w: ultima[8] };
          setVersion((v) => v + 1);
        })
        .catch(() => {
          /* Sin servidor: queda la caché local, que es lo que había antes. */
        });
    };
    traerBase();
    const alVolver = () => {
      if (document.visibilityState === 'visible') traerBase();
    };
    /* [por que] `visibilitychange` es de `document`, no de `window`: va por el helper de
     * documento (`suscribirDocumento`), que es el que tipa sus eventos. */
    suscribirDocumento('visibilitychange', alVolver);
    return () => {
      vivo = false;
      bajarDocumento('visibilitychange', alVolver);
    };
  }, [tab]);

  /* Muestra nueva por tick de pulse (guardada como tupla redondeada;
   * el localStorage se escribe como mucho cada 30 s para no atascar). */
  useEffect(() => {
    if (!snap) return;
    if (ultimoTs.current === snap.ts) return;
    ultimoTs.current = snap.ts;
    const r = muestraDeSnapshot(snap, ultimoDisco.current, Date.now());
    ultimoDisco.current = r.disco;
    muestras.current = [...muestras.current, r.muestra].slice(-MAX_MUESTRAS_RECURSOS);
    if (Date.now() - ultimoGuardado.current > 30000) {
      ultimoGuardado.current = Date.now();
      guardarJson(claveHist, muestras.current, 'no se pudo guardar el historial de recursos:');
    }
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirRango(id: string) {
    setRangoId(id);
    /* Sin almacenamiento: el rango vive solo la sesión. */
    guardarTexto(claveRng, id);
    setVersion((v) => v + 1);
  }

  const rango = RANGOS.find((x) => x.id === rangoId) ?? RANGOS[0];
  const corte = Date.now() - rango.ms;
  const enRango = diezmar(muestras.current.filter((x) => x[0] >= corte));
  return { rango, rangoId, enRango, elegirRango };
}
