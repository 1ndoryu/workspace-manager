/* Historial de recursos de la VPS: muestras por tick de pulse, persistidas en
 * localStorage y el rango elegido por el usuario (19AA-13).
 * [por que] Sacado de PanelVpsRecursos: el componente solo pinta; aquí viven la
 * retención (7 días, tope de muestras), la migración de tuplas antiguas y el
 * volcado al cerrar. Los contadores de disco del host se repiten entre
 * muestras mientras pulse no los trae (plano = sin dato, no cero). */
import { useEffect, useRef, useState } from 'react';
import type { VpsAgenteSnapshot } from '../../../shared/types.js';
import { guardarJson, guardarTexto, leerJson, leerTexto } from '../../../shared/vista/storage.js';
import { bajarVentana, suscribirVentana } from '../../../shared/platform/plataforma.js';
import type { Muestra } from './vpsRecursosSeries.js';
import { RANGOS, diezmar } from './vpsRecursosSeries.js';

/* Sector diskstats = 512 B (el kernel cuenta en sectores de 512 aunque el
 * disco físico use otro tamaño). */
export const SECTOR_BYTES = 512;

const CLAVE_HISTORIAL = 'workspaceManager:vps-recursos-historial-v1';
const CLAVE_RANGO = 'workspaceManager:vps-recursos-rango-v1';
const MAX_MUESTRAS = 25000;
const RETENCION_MS = 7 * 24 * 3600 * 1000;

function leerHistorial(): Muestra[] {
  const lista = leerJson<unknown>(CLAVE_HISTORIAL, 'no se pudo leer el historial de recursos:');
  if (!Array.isArray(lista)) return [];
  const corte = Date.now() - RETENCION_MS;
  const limpias: Muestra[] = [];
  for (const x of lista) {
    if (
      Array.isArray(x) &&
      (x.length === 7 || x.length === 9) &&
      x.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      (x[0] as number) >= corte
    ) {
      /* [0110A-1] Migración: tuplas de 7 (sin IO del host) se rellenan
       * con dr/dw a cero; las de contenedor ya eran cero, sin distorsión. */
      const t = x.length === 7 ? [...(x as number[]), 0, 0] : x;
      limpias.push(t as Muestra);
    }
  }
  return limpias.slice(-MAX_MUESTRAS);
}

function leerRango(): string {
  const r = leerTexto(CLAVE_RANGO);
  if (r && RANGOS.some((x) => x.id === r)) return r;
  return '30m';
}

/* Cuadro de muestras del rango elegido. `muestras` es un ref: el repintado lo
 * dispara `setVersion` (entra una muestra o cambia el rango). */
export function useRecursosVps(snap: VpsAgenteSnapshot | null) {
  const muestras = useRef<Muestra[]>([]);
  const ultimoTs = useRef<number | null>(null);
  const ultimoGuardado = useRef(0);
  /* [0110A-1] Último IO del host visto: mientras pulse no lo trae (null)
   * se repite el anterior para no inventar deltas (plano = sin dato,
   * no cero). */
  const ultimoDisco = useRef<{ r: number; w: number } | null>(null);
  const [rangoId, setRangoId] = useState<string>(() => leerRango());
  /* Contador para repintar cuando entra una muestra o cambia el rango
   * (el ref no repinta solo). */
  const [, setVersion] = useState(0);

  /* Historial previo (sobrevive a recargas) + volcado al cerrar. */
  useEffect(() => {
    muestras.current = leerHistorial();
    setVersion((v) => v + 1);
    const alCerrar = () => {
      /* Cierre sin almacenamiento: se pierde la cola sin romper nada. */
      guardarJson(CLAVE_HISTORIAL, muestras.current.slice(-MAX_MUESTRAS));
    };
    suscribirVentana('beforeunload', alCerrar);
    return () => bajarVentana('beforeunload', alCerrar);
  }, []);

  /* Muestra nueva por tick de pulse (guardada como tupla redondeada;
   * el localStorage se escribe como mucho cada 30 s para no atascar). */
  useEffect(() => {
    if (!snap) return;
    if (ultimoTs.current === snap.ts) return;
    ultimoTs.current = snap.ts;
    const suma = (campo: (c: VpsAgenteSnapshot['contenedores'][number]) => number) =>
      snap.contenedores.reduce((a, c) => a + campo(c), 0);
    const cpu = Math.round(suma((c) => c.cpuPct) * 10) / 10;
    const mem = Math.round(suma((c) => c.memMiB));
    const rx = Math.round(suma((c) => c.redRxBytes));
    const tx = Math.round(suma((c) => c.redTxBytes));
    const br = Math.round(suma((c) => c.blkReadBytes));
    const bw = Math.round(suma((c) => c.blkWriteBytes));
    if (snap.discoHost) {
      ultimoDisco.current = {
        r: snap.discoHost.sectoresLeidos * SECTOR_BYTES,
        w: snap.discoHost.sectoresEscritos * SECTOR_BYTES,
      };
    }
    const dr = Math.round(ultimoDisco.current?.r ?? 0);
    const dw = Math.round(ultimoDisco.current?.w ?? 0);
    const nueva: Muestra = [Date.now(), cpu, mem, rx, tx, br, bw, dr, dw];
    muestras.current = [...muestras.current, nueva].slice(-MAX_MUESTRAS);
    if (Date.now() - ultimoGuardado.current > 30000) {
      ultimoGuardado.current = Date.now();
      guardarJson(CLAVE_HISTORIAL, muestras.current, 'no se pudo guardar el historial de recursos:');
    }
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirRango(id: string) {
    setRangoId(id);
    /* Sin almacenamiento: el rango vive solo la sesión. */
    guardarTexto(CLAVE_RANGO, id);
    setVersion((v) => v + 1);
  }

  const rango = RANGOS.find((x) => x.id === rangoId) ?? RANGOS[0];
  const corte = Date.now() - rango.ms;
  const enRango = diezmar(muestras.current.filter((x) => x[0] >= corte));
  return { rango, rangoId, enRango, elegirRango };
}
