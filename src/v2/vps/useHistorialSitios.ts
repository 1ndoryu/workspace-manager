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
import { bajarVentana, suscribirVentana } from '../../shared/platform/plataforma.js';
import { RANGOS } from '../paneles/vps/PanelVpsRecursos.js';
import type { VpsAgenteSnapshot } from '../../shared/types.js';
/* [07AA-4] Base persistente del servidor: se fusiona con la cola viva para
 * que el detalle sobreviva a recargas y cambios de origen. */
import { historialSitioVps } from './apiVps.js';
import { fusionarSeries, normalizarTs } from '../../shared/historialVps.js';

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
  /* [07AA-4] Base servida por clave (una petición por clave y montaje; la
   * cola viva de arriba cubre lo nuevo desde entonces). */
  const [bases, setBases] = useState<Record<string, MuestraSitio[]>>({});
  const basesPedidas = useRef(new Set<string>());

  /* Carga una vez + guarda al salir (igual que el historial global). */
  useEffect(() => {
    historial.current = cargarHistorialSitios();
    setVersion((v) => v + 1);
    function alSalir() {
      guardarHistorialSitios(historial.current);
    }
    suscribirVentana('beforeunload', alSalir);
    return () => bajarVentana('beforeunload', alSalir);
  }, []);

  /* Una muestra por sitio y tick (el muestreo decide si toca). El t es el
   * del snapshot de pulse (ms): servidor y frente estampan lo mismo y la
   * fusión con la base dedupa exacto (07AA-4). */
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
    /* [07AA-4] Pide la base persistida de las claves vistas (fail-open: sin
     * base la cola viva sigue funcionando; vacía = no reintentar en bucle). */
    for (const clave of sumas.keys()) {
      if (basesPedidas.current.has(clave)) continue;
      basesPedidas.current.add(clave);
      historialSitioVps(clave)
        .then((ms) => setBases((prev) => ({ ...prev, [clave]: ms })))
        .catch(() => setBases((prev) => (prev[clave] ? prev : { ...prev, [clave]: [] })));
    }
    const ahora = normalizarTs(snap.ts, Date.now());
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
    /* [07AA-4] Base del servidor + cola viva, dedupadas por t. */
    const fusionada = fusionarSeries(bases[clave] ?? [], historial.current[clave] ?? []);
    return serieEnRango(fusionada, rango.ms, Date.now());
  }

  return { rangoId, elegirRango, seriePara };
}
