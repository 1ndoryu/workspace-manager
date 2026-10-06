import { useEffect, useRef, useState } from 'react';
import {
  cargarHistorialSitios,
  guardarHistorialSitios,
  muestrearSitios,
  serieEnRango,
  type HistorialSitios,
  type MuestraSitio,
} from './historialSitios.js';
import { guardarTexto, leerTexto } from '../../shared/storage.js';
import { RANGOS } from '../paneles/PanelVpsRecursos.js';
import type { VpsAgenteSnapshot } from '../../shared/types.js';

/* Rango elegido para el detalle por sitio (vive en el navegador). */
const CLAVE_RANGO_SITIO = 'workspaceManager:vps-sitios-rango-v1';

function leerRango(): string {
  const r = leerTexto(CLAVE_RANGO_SITIO);
  if (r && RANGOS.some((x) => x.id === r)) return r;
  return RANGOS[0].id;
}

/* [0110A-3 F2] Historial por sitio: carga al montar, añade una muestra
 * por sitio con filas vivas en cada tick y guarda con cadencia propia
 * (≤1/min) más guardado al salir. Vive aquí —no en PanelVps— para no
 * engordar el componente (gate: useState-excesivo, limite-lineas). */
export function useHistorialSitios(snap: VpsAgenteSnapshot | null): {
  rangoId: string;
  elegirRango: (id: string) => void;
  seriePara: (clave: string) => MuestraSitio[];
} {
  const historial = useRef<HistorialSitios>({});
  const ultimoGuardado = useRef(0);
  const [rangoId, setRangoId] = useState<string>(leerRango);
  const [, setVersion] = useState(0);

  /* Carga una vez + guarda al salir (igual que el historial global). */
  useEffect(() => {
    historial.current = cargarHistorialSitios();
    setVersion((v) => v + 1);
    function alSalir() {
      guardarHistorialSitios(historial.current);
    }
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, []);

  /* Una muestra por sitio y tick (el muestreo decide si toca). */
  useEffect(() => {
    if (!snap) return;
    const sumas = new Map<string, { cpu: number; mem: number }>();
    for (const c of snap.contenedores) {
      /* Misma clave que la tabla (`sitio:<uuid>`, `infra` sin sitio). */
      const clave = c.sitio ? `sitio:${c.sitio}` : 'infra';
      const s = sumas.get(clave) ?? { cpu: 0, mem: 0 };
      s.cpu += c.cpuPct;
      s.mem += c.memMiB;
      sumas.set(clave, s);
    }
    const ahora = Date.now();
    const r = muestrearSitios(historial.current, sumas, ahora);
    historial.current = r.siguiente;
    if (!r.cambio) return;
    if (ahora - ultimoGuardado.current > 60000) {
      ultimoGuardado.current = ahora;
      guardarHistorialSitios(historial.current);
    }
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirRango(id: string) {
    setRangoId(id);
    guardarTexto(CLAVE_RANGO_SITIO, id);
  }

  function seriePara(clave: string): MuestraSitio[] {
    const rango = RANGOS.find((x) => x.id === rangoId) ?? RANGOS[0];
    return serieEnRango(historial.current[clave] ?? [], rango.ms, Date.now());
  }

  return { rangoId, elegirRango, seriePara };
}
