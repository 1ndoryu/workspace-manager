/* Datos de la pestaña Guardián: área completa y el proyecto elegido.
 * [por que] `estadoArea` no trae hashes y las ediciones los necesitan como
 * hashPrevio: el proyecto elegido se pide aparte con GET /estado. Una respuesta
 * que llega tarde para un proyecto ya no elegido se descarta. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeDeError } from '../../toast.js';
import { estadoArea, estadoProyecto, leerOk } from './apiGuardian.js';
import type { EstadoArea, EstadoProyecto } from './tiposGuardian.js';
import { useVolverARevalidar } from '../../canal/useVolverARevalidar.js';

export interface GuardianDatos {
  area: EstadoArea | null;
  errorArea: string | null;
  claveSel: string | null;
  /* Null mientras carga, si el proyecto no tiene Guardián o si la petición falla. */
  detalle: EstadoProyecto | null;
  cargandoDetalle: boolean;
  errorDetalle: string | null;
  elegir: (clave: string) => void;
  /* Recarga área y proyecto elegido: tras escribir cambian los hashes. */
  refrescar: () => Promise<void>;
}

export function useGuardian(): GuardianDatos {
  const [area, setArea] = useState<EstadoArea | null>(null);
  const [errorArea, setErrorArea] = useState<string | null>(null);
  const [claveSel, setClaveSel] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<EstadoProyecto | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const claveActual = useRef<string | null>(null);

  const cargarArea = useCallback(async (): Promise<void> => {
    try {
      setArea(leerOk(await estadoArea()));
      setErrorArea(null);
    } catch (err) {
      setErrorArea(mensajeDeError(err));
    }
  }, []);

  const cargarDetalle = useCallback(async (clave: string): Promise<void> => {
    setCargandoDetalle(true);
    try {
      const datos = leerOk(await estadoProyecto(clave));
      if (claveActual.current !== clave) return;
      setDetalle(datos.elegible ? datos : null);
      setErrorDetalle(null);
    } catch (err) {
      if (claveActual.current !== clave) return;
      setDetalle(null);
      setErrorDetalle(mensajeDeError(err));
    } finally {
      if (claveActual.current === clave) setCargandoDetalle(false);
    }
  }, []);

  useEffect(() => {
    void cargarArea();
  }, [cargarArea]);

  /* 20AA-24 F4: la política y los leases cambian desde fuera del tablero (el guardián, otra
   * sesión); al volver a la pestaña se releen. */
  useVolverARevalidar(() => void cargarArea());

  const elegir = useCallback(
    (clave: string) => {
      claveActual.current = clave;
      setClaveSel(clave);
      setDetalle(null);
      void cargarDetalle(clave);
    },
    [cargarDetalle],
  );

  const refrescar = useCallback(async (): Promise<void> => {
    await cargarArea();
    const clave = claveActual.current;
    if (clave) await cargarDetalle(clave);
  }, [cargarArea, cargarDetalle]);

  return { area, errorArea, claveSel, detalle, cargandoDetalle, errorDetalle, elegir, refrescar };
}
