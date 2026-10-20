import { useEffect, useRef, useState } from 'react';
import {
  cargarHistorialSitios,
  claveHistorialSitios,
  guardarHistorialSitios,
  muestrearSitios,
  serieEnRango,
  type HistorialSitios,
  type MuestraSitio,
} from './historialSitios.js';
import { guardarTexto, leerTexto } from '../../shared/vista/storage.js';
import { bajarVentana, suscribirVentana } from '../../shared/platform/plataforma.js';
import { RANGOS } from '../paneles/vps/vpsRecursosSeries.js';
import type { VpsAgenteSnapshot } from '../../shared/types.js';
/* [07AA-4] Base persistente del servidor: se fusiona con la cola viva para
 * que el detalle sobreviva a recargas y cambios de origen. */
import { historialSitioVps } from './apiVps.js';
import { fusionarSeries, normalizarTs } from '../../shared/historialVps.js';

/* Rango elegido para el detalle por sitio (vive en el navegador). La tab va en la clave por lo
 * mismo que en el historial: cada tab recuerda el suyo. */
export function claveRangoSitios(tab: string): string {
  return `workspaceManager:${tab}-sitios-rango-v1`;
}

const CLAVE_RANGO_SITIO = claveRangoSitios('vps');

function leerRango(clave: string): string {
  const r = leerTexto(clave);
  if (r && RANGOS.some((x) => x.id === r)) return r;
  return RANGOS[0].id;
}

/* Opciones de reutilización (20AA-16). [por que] El panel del taller enseña el mismo detalle que el
 * de vps y reutiliza este anillo, pero sus filas son proyectos del registro (no sitios de Coolify)
 * y no tiene base persistente por proyecto: en vez de duplicar el hook, se le inyectan las dos
 * piezas que cambian. Sin opciones, el comportamiento es el de siempre (tab vps). */
export interface OpcionesHistorialSitios {
  /* Tab dueña del historial en localStorage: `'vps'` (defecto) o `'taller'`. */
  tab?: string;
  /* Sumas por fila ya calculadas por el llamante (claves propias). Sin esto se derivan del
   * snapshot con las claves de vps (`sitio:<nombre>` / `infra`). */
  sumas?: Map<string, { cpu: number; mem: number }>;
  /* Base persistente del servidor por clave. El taller no la tiene (el historial de su sonda es
   * global, no por proyecto), así que pasa una que devuelve vacío. */
  base?: (clave: string) => Promise<MuestraSitio[]>;
}

/* [0110A-3 F2] Historial por sitio: carga al montar, añade una muestra
 * por sitio con filas vivas en cada tick y guarda con cadencia propia
 * (≤1/min) más guardado al salir. Vive aquí —no en PanelVps— para no
 * engordar el componente (gate: useState-excesivo, limite-lineas). */
/* Sumas del snapshot con las claves de vps (`sitio:<nombre>` de Coolify, `infra` sin sitio). */
function sumasPorSitioVps(
  snap: VpsAgenteSnapshot,
): Map<string, { cpu: number; mem: number }> {
  const sumas = new Map<string, { cpu: number; mem: number }>();
  for (const c of snap.contenedores) {
    const clave = c.sitio ? `sitio:${c.sitio}` : 'infra';
    const s = sumas.get(clave) ?? { cpu: 0, mem: 0 };
    s.cpu += c.cpuPct;
    s.mem += c.memMiB;
    sumas.set(clave, s);
  }
  return sumas;
}

export function useHistorialSitios(
  snap: VpsAgenteSnapshot | null,
  opts: OpcionesHistorialSitios = {},
): {
  rangoId: string;
  elegirRango: (id: string) => void;
  seriePara: (clave: string) => MuestraSitio[];
} {
  const tab = opts.tab ?? 'vps';
  const claveHistorial = claveHistorialSitios(tab);
  const claveRango = claveRangoSitios(tab);
  const base = opts.base ?? historialSitioVps;
  /* Refs para no reiniciar los efectos (ni releer el historial) si el llamante pasa un mapa
   * nuevo en cada render: lo que manda es `snap.ts`. */
  const sumasExternas = useRef(opts.sumas);
  sumasExternas.current = opts.sumas;
  const historial = useRef<HistorialSitios>({});
  const ultimoGuardado = useRef(0);
  const [rangoId, setRangoId] = useState<string>(() => leerRango(claveRango));
  const [, setVersion] = useState(0);
  /* [07AA-4] Base servida por clave (una petición por clave y montaje; la
   * cola viva de arriba cubre lo nuevo desde entonces). */
  const [bases, setBases] = useState<Record<string, MuestraSitio[]>>({});
  const basesPedidas = useRef(new Set<string>());

  /* Carga una vez + guarda al salir (igual que el historial global). */
  useEffect(() => {
    historial.current = cargarHistorialSitios(claveHistorial);
    setVersion((v) => v + 1);
    function alSalir() {
      guardarHistorialSitios(historial.current, claveHistorial);
    }
    suscribirVentana('beforeunload', alSalir);
    return () => bajarVentana('beforeunload', alSalir);
  }, [claveHistorial]);

  /* Una muestra por sitio y tick (el muestreo decide si toca). El t es el
   * del snapshot de pulse (ms): servidor y frente estampan lo mismo y la
   * fusión con la base dedupa exacto (07AA-4). */
  useEffect(() => {
    if (!snap) return;
    const sumas = sumasExternas.current ?? sumasPorSitioVps(snap);
    /* [07AA-4] Pide la base persistida de las claves vistas (fail-open: sin
     * base la cola viva sigue funcionando; vacía = no reintentar en bucle). */
    for (const clave of sumas.keys()) {
      if (basesPedidas.current.has(clave)) continue;
      basesPedidas.current.add(clave);
      base(clave)
        .then((ms) => setBases((prev) => ({ ...prev, [clave]: ms })))
        .catch(() => setBases((prev) => (prev[clave] ? prev : { ...prev, [clave]: [] })));
    }
    const ahora = normalizarTs(snap.ts, Date.now());
    const r = muestrearSitios(historial.current, sumas, ahora);
    historial.current = r.siguiente;
    if (!r.cambio) return;
    if (ahora - ultimoGuardado.current > 60000) {
      ultimoGuardado.current = ahora;
      guardarHistorialSitios(historial.current, claveHistorial);
    }
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirRango(id: string) {
    setRangoId(id);
    guardarTexto(claveRango, id);
  }

  function seriePara(clave: string): MuestraSitio[] {
    const rango = RANGOS.find((x) => x.id === rangoId) ?? RANGOS[0];
    /* [07AA-4] Base del servidor + cola viva, dedupadas por t. */
    const fusionada = fusionarSeries(bases[clave] ?? [], historial.current[clave] ?? []);
    return serieEnRango(fusionada, rango.ms, Date.now());
  }

  return { rangoId, elegirRango, seriePara };
}
