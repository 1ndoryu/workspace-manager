/* Estado del panel del taller (20AA-16): la tabla, los recursos y el detalle, en vivo desde pulse.
 * [por que] Mismo patrón que usePanelVps —SWR manual con sondeo de 5 s, abort del tick anterior,
 * pausado con la tab oculta y repedido al volver— para que las dos tabs se lean igual. Lo que
 * cambia es de dónde sale cada cosa: pulse aporta lo vivo y el registro las filas, porque un
 * proyecto parado no tiene procesos que mirar pero sí sesión, puerto y hostname.
 * Vive aquí y no en el componente (regla componente-sin-hook-glory). */
import { useEffect, useRef, useState } from 'react';
import { sumarPorSitio } from '../vps/historialSitios.js';
import { useHistorialSitios } from '../vps/useHistorialSitios.js';
import { useEstadoTaller } from '../paneles/taller/useEstadoTaller.js';
import { agenteTaller, type RespuestaAgenteTaller } from './apiTaller.js';
import { avisosTaller, construirFilasTaller, discoPctTaller } from './panelTallerCalculo.js';

/* Igual que la tab vps: el backend cachea 5 s, así que sondear más a menudo no aporta. */
const INTERVALO_MS = 5000;

/* [por que] Reexport: PanelTaller importa el tipo de fila desde esta ruta, igual que en vps. */
export type { FilaTaller } from './panelTallerCalculo.js';

export function usePanelTaller() {
  const [agente, setAgente] = useState<RespuestaAgenteTaller | null>(null);
  const enVuelo = useRef(false);
  const abort = useRef<AbortController | null>(null);
  /* Proyecto elegido para el detalle lateral. Es solo una clave: sobrevive a los ticks de 5 s y
   * se sigue actualizando en vivo. */
  const [sel, setSel] = useState<string | null>(null);

  const snapAgente = agente?.disponible ? (agente.snapshot ?? null) : null;
  const filas = construirFilasTaller(snapAgente?.contenedores ?? [], agente?.proyectos ?? []);
  const selFila = sel ? (filas.find((f) => f.clave === sel) ?? null) : null;

  /* El historial de cada fila se alimenta de las MISMAS sumas que la tabla: una sola verdad, y las
   * claves coinciden (`proyecto:<id>`), que es lo que enlaza fila y chispa. Sin base persistente:
   * el historial de la sonda del taller es global, no por proyecto. */
  const sumas = sumarPorSitio(filas.map((f) => ({ clave: f.clave, cpu: f.cpu, mem: f.mem })));
  const { rangoId, elegirRango, seriePara } = useHistorialSitios(snapAgente, {
    tab: 'taller',
    sumas,
    base: async () => [],
  });

  /* El % de disco de la 89 viene de la sonda del taller (no del audit de Coolify, que es de la 66):
   * es el mismo store que usa la consola, así que no hay una segunda lectura. */
  const { datos: estado } = useEstadoTaller();
  const discoPct = discoPctTaller(estado?.taller89 ?? null);

  const { banner, truncado } = avisosTaller(agente, snapAgente);

  async function tick() {
    if (enVuelo.current || document.hidden) return;
    enVuelo.current = true;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      setAgente(await agenteTaller(ctrl.signal));
    } catch {
      if (ctrl.signal.aborted) return;
      /* Sin red: se conserva el último bueno (SWR); si nunca hubo respuesta se registra el error
       * para no decir «conectando» eternamente. */
      setAgente((prev) =>
        prev?.disponible
          ? { ...prev, disponible: false, error: 'pulse-inaccesible' }
          : (prev ?? { disponible: false, snapshot: null, error: 'pulse-inaccesible' }),
      );
    } finally {
      if (abort.current === ctrl) abort.current = null;
      enVuelo.current = false;
    }
  }

  useEffect(() => {
    void tick();
    const intervalo = setInterval(() => void tick(), INTERVALO_MS);
    const alVisibilidad = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', alVisibilidad);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVisibilidad);
      abort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    agente,
    snapAgente,
    filas,
    selFila,
    rangoId,
    elegirRango,
    seriePara,
    discoPct,
    recargar: () => void tick(),
    /* Segundo clic en la fila elegida: vuelve a la tabla sola. */
    elegir: (clave: string) => setSel((prev) => (prev === clave ? null : clave)),
    cerrarDetalle: () => setSel(null),
    banner,
    truncado,
  };
}
