import { useEffect, useRef, useState } from 'react';
import type { VpsAgenteRespuesta, VpsConfig, VpsSitio } from '../../shared/types.js';
import { agenteVps, configVps, invalidarVps, recursosVps, sitiosVps } from './apiVps.js';
import { useHistorialSitios } from './useHistorialSitios.js';
import {
  agruparSitios,
  calcularAvisos,
  construirFilas,
  contenedoresDeSeleccion,
  extraerDisco,
} from './panelVpsCalculo.js';

/* [por que] Reexport: PanelVps importa el tipo de fila desde esta ruta. */
export type { FilaDespliegue } from './panelVpsCalculo.js';

/* [07AA-19] Estado del panel VPS: vive aquí —no en PanelVps— para no
 * engordar el componente (gate: limite-lineas, usestate-excesivo,
 * componente-sin-hook-glory). */
export function usePanelVps() {
  const [config, setConfig] = useState<VpsConfig | null>(null);
  /* Último snapshot bueno (SWR manual): se muestra lo último válido
   * mientras se repide. `null` = aún sin respuesta. */
  const [agente, setAgente] = useState<VpsAgenteRespuesta | null>(null);
  const agenteEnVuelo = useRef(false);
  const agenteAbort = useRef<AbortController | null>(null);
  /* Despliegue elegido para el detalle lateral (`sitio:<nombre>` o
   * `infra`; null = tabla sola). Es solo una clave: sobrevive a los
   * ticks de 5 s y se sigue actualizando en vivo. */
  const [sel, setSel] = useState<string | null>(null);

  /* % de disco del host (viene del audit, no de pulse: los contadores
   * blk de los contenedores llegan a cero). null = aún sin respuesta. */
  const [discoPct, setDiscoPct] = useState<number | null>(null);

  /* Lista completa de sitios desde Coolify (incluye detenidos, que no tienen
   * contenedores en vivo y sin esto desaparecían de la tabla). null = aún
   * sin respuesta: se muestra solo lo vivo hasta entonces (fail-open). */
  const [sitios, setSitios] = useState<VpsSitio[] | null>(null);

  const snapAgente = agente?.disponible ? (agente.snapshot ?? null) : null;

  /* [0110A-3 F2] Historial por despliegue (anillo propio, no el global):
   * vive en el hook para no engordar este componente. */
  const { rangoId, elegirRango, seriePara } = useHistorialSitios(snapAgente);

  async function tickAgente() {
    if (agenteEnVuelo.current || document.hidden) return;
    agenteEnVuelo.current = true;
    agenteAbort.current?.abort();
    const ctrl = new AbortController();
    agenteAbort.current = ctrl;
    try {
      setAgente(await agenteVps(ctrl.signal));
    } catch {
      if (ctrl.signal.aborted) return;
      /* Sin red: se conserva el último bueno (SWR); si nunca hubo respuesta
       * se registra el error para no decir "conectando" eternamente. */
      setAgente((prev) =>
        prev?.disponible
          ? { disponible: false, snapshot: prev.snapshot, error: 'pulse-inaccesible' }
          : (prev ?? { disponible: false, snapshot: null, error: 'pulse-inaccesible' }),
      );
    } finally {
      if (agenteAbort.current === ctrl) agenteAbort.current = null;
      agenteEnVuelo.current = false;
    }
  }

  function recargar() {
    void tickAgente();
  }

  /* Poll cada 5 s: barato (el backend cachea), sin solapes (abort del
   * tick anterior), pausado con la tab oculta y repedido al volver. El
   * audit (disco del host) es más pesado: cadencia propia de 60 s. */
  useEffect(() => {
    configVps()
      .then((c) => setConfig(c))
      .catch(() => {});
    const pedirDisco = () => {
      /* Sin invalidar, el cliente devolvería la primera respuesta
       * cacheada para siempre. SWR manual: un audit fallido no borra
       * el último % bueno (el audit falla a ratos por SSH). */
      invalidarVps();
      recursosVps()
        .then((r) => {
          const pct = extraerDisco(r);
          if (pct !== null) setDiscoPct(pct);
        })
        .catch(() => {});
      /* La lista de sitios es lenta en frío: cadencia propia de 60 s junto
       * al disco (no cada 5 s con lo vivo). Un fallo no borra la última
       * lista buena: lo detenido seguiría visible. */
      sitiosVps()
        .then((s) => setSitios(s.sitios))
        .catch(() => {});
    };
    pedirDisco();
    const discoCadaMinuto = setInterval(pedirDisco, 60000);
    void tickAgente();
    const intervalo = setInterval(() => {
      void tickAgente();
    }, 5000);
    const alVisibilidad = () => {
      if (!document.hidden) void tickAgente();
    };
    document.addEventListener('visibilitychange', alVisibilidad);
    return () => {
      clearInterval(intervalo);
      clearInterval(discoCadaMinuto);
      document.removeEventListener('visibilitychange', alVisibilidad);
      agenteAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Grupos por sitio y contenedores de la lista: ver agruparSitios (panelVpsCalculo.ts). */
  const grupos = agruparSitios(snapAgente?.contenedores ?? [], sitios);

  /* Tabla: una fila por despliegue + infra al final (si hay). */
  const filas = construirFilas(grupos);
  const selFila = sel ? (filas.find((f) => f.clave === sel) ?? null) : null;
  const selFilas = contenedoresDeSeleccion(grupos, selFila);

  /* Avisos: ver calcularAvisos (panelVpsCalculo.ts). */
  const { bannerAgente, avisoTruncado } = calcularAvisos(agente, snapAgente);

  function elegir(clave: string) {
    setSel((prev) => (prev === clave ? null : clave));
  }

  function cerrarDetalle() {
    setSel(null);
  }

  return {
    config,
    agente,
    snapAgente,
    filas,
    selFila,
    selFilas,
    rangoId,
    elegirRango,
    seriePara,
    discoPct,
    recargar,
    elegir,
    cerrarDetalle,
    bannerAgente,
    avisoTruncado,
  };
}
