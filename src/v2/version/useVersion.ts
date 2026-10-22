/* Versión del manager en el cliente (2026-10-22). [por que hook y no store global] Solo lo
 * consumen el indicador del nav y el panel del changelog, y el dato no cambia mientras la pestaña
 * vive: un estado local con una carga al montar basta. El store global añadiría una fuente más que
 * mantener sin que dos componentes lo compartan de verdad.
 * [por que se compara la hora de arranque con la del commit] Un número de versión no dice si el
 * proceso en marcha va por detrás del código: si el backend arrancó antes del último commit, la
 * app se está sirviendo con código viejo aunque la versión coincida.
 */
import { useCallback, useEffect, useState } from 'react';

export interface InfoVersion {
  version: string;
  commit: string | null;
  rama: string | null;
  fecha: string | null;
  arrancadoEn: string;
}

export interface EstadoVersion {
  info: InfoVersion | null;
  /* El proceso quedó atrás: arrancó antes del último commit del árbol.
   * null = no se puede saber (sin git o sin datos), que no es «está mal». */
  desactualizada: boolean | null;
  error: string | null;
}

function calcularDesactualizada(info: InfoVersion): boolean | null {
  if (!info.fecha || !info.arrancadoEn) return null;
  const commit = new Date(info.fecha).getTime();
  const arranque = new Date(info.arrancadoEn).getTime();
  if (Number.isNaN(commit) || Number.isNaN(arranque)) return null;
  /* Un minuto de holgura: el commit y el arranque pueden caer en el mismo instante al desplegar. */
  return arranque + 60_000 < commit;
}

export function useVersion(): EstadoVersion & { recargar: () => void } {
  const [estado, setEstado] = useState<EstadoVersion>({ info: null, desactualizada: null, error: null });

  const cargar = useCallback(() => {
    const ctrl = new AbortController();
    fetch('/api/version', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((info: InfoVersion) => setEstado({ info, desactualizada: calcularDesactualizada(info), error: null }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setEstado({ info: null, desactualizada: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => cargar(), [cargar]);
  return { ...estado, recargar: cargar };
}
