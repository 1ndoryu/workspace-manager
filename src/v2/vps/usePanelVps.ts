import { useEffect, useRef, useState } from 'react';
import type {
  VpsAgenteContenedor,
  VpsAgenteRespuesta,
  VpsConfig,
  VpsRecursos,
  VpsSitio,
} from '../../shared/types.js';
import { agenteVps, configVps, invalidarVps, recursosVps, sitiosVps } from './apiVps.js';
import { useHistorialSitios } from './useHistorialSitios.js';

/* % de uso de disco del host desde el resumen del audit (`Disco:
 * ... use=N%`). La forma es `datos desconocido`: se extrae a la
 * defensiva y se devuelve null si el formato cambió. */
function extraerDisco(r: VpsRecursos): number | null {
  try {
    const pieza = r.piezas?.resumen;
    if (!pieza?.ok) return null;
    const datos = pieza.datos as { metricas?: { metrica: string; pct: number }[] } | null;
    const m = Array.isArray(datos?.metricas)
      ? datos.metricas.find((x) => x?.metrica === 'disco')
      : undefined;
    return typeof m?.pct === 'number' && Number.isFinite(m.pct) ? m.pct : null;
  } catch {
    return null;
  }
}

/* Peor estado del despliegue para la tabla: degraded manda, luego
 * cualquier no-running; en caso contrario, running. */
function peorEstado(cs: VpsAgenteContenedor[]): string {
  const deg = cs.find((c) => c.estado.startsWith('degraded'));
  if (deg) return deg.estado;
  const otro = cs.find((c) => !c.estado.startsWith('running'));
  return otro ? otro.estado : 'running';
}

/* Fila resumen de la tabla: un despliegue = cpu/mem sumadas. Las filas
 * por contenedor no se pintan en la tabla: viven en el detalle lateral. */
export interface FilaDespliegue {
  clave: string;
  nombre: string;
  dominio: string | null;
  estado: string;
  cpu: number;
  mem: number;
  limite: number | null;
  n: number;
}

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

  /* Grupos por sitio (nombre legible del backend) en orden alfabético +
   * infra sin sitio al final: el id largo no se muestra nunca. La lista de
   * Coolify aporta TODOS los sitios (vivos o detenidos); lo vivo de pulse
   * aporta contenedores y métricas. Un sitio detenido queda con fila propia
   * (estado Coolify, ceros) en vez de desaparecer. */
  const grupos = (() => {
    const porSitio = new Map<string, { dominio: string | null; filas: VpsAgenteContenedor[] }>();
    const infra: VpsAgenteContenedor[] = [];
    for (const c of snapAgente?.contenedores ?? []) {
      if (!c.sitio) {
        infra.push(c);
        continue;
      }
      let g = porSitio.get(c.sitio);
      if (!g) {
        g = { dominio: null, filas: [] };
        porSitio.set(c.sitio, g);
      }
      if (!g.dominio && c.dominio) g.dominio = c.dominio;
      g.filas.push(c);
    }
    const estadoSitio = new Map<string, string>();
    for (const s of sitios ?? []) {
      estadoSitio.set(s.nombre, s.estadoReal || 'detenido');
      let g = porSitio.get(s.nombre);
      if (!g) {
        g = { dominio: s.dominio || null, filas: [] };
        porSitio.set(s.nombre, g);
      } else if (!g.dominio && s.dominio) {
        g.dominio = s.dominio;
      }
    }
    const sitiosOrdenados = [...porSitio.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { sitios: sitiosOrdenados, infra, estadoSitio };
  })();

  /* Tabla: una fila por despliegue + infra al final (si hay). */
  function resumir(
    nombre: string,
    dominio: string | null,
    cs: VpsAgenteContenedor[],
    estadoBase: string,
  ): FilaDespliegue {
    return {
      clave: nombre === 'infra' ? 'infra' : `sitio:${nombre}`,
      nombre,
      dominio: dominio ? dominio.replace(/^https?:\/\//, '') : null,
      estado: cs.length > 0 ? peorEstado(cs) : estadoBase,
      cpu: cs.reduce((a, c) => a + c.cpuPct, 0),
      mem: cs.reduce((a, c) => a + c.memMiB, 0),
      limite: cs.every((c) => c.memLimiteMiB !== null)
        ? cs.reduce((a, c) => a + (c.memLimiteMiB ?? 0), 0)
        : null,
      n: cs.length,
    };
  }
  const filas: FilaDespliegue[] = [
    ...grupos.sitios.map(([nombre, g]) =>
      resumir(nombre, g.dominio, g.filas, grupos.estadoSitio.get(nombre) ?? 'detenido'),
    ),
    ...(grupos.infra.length > 0 ? [resumir('infra', null, grupos.infra, 'infra')] : []),
  ];
  const selFila = sel ? (filas.find((f) => f.clave === sel) ?? null) : null;
  const selFilas: VpsAgenteContenedor[] = !selFila
    ? []
    : selFila.clave === 'infra'
      ? grupos.infra
      : (grupos.sitios.find(([n]) => `sitio:${n}` === selFila.clave)?.[1].filas ?? []);

  /* Avisos: solo existen cuando hay algo que decir. */
  const bannerAgente =
    agente && !agente.disponible && agente.error !== null && agente.error !== 'sin-configurar'
      ? `pulse-inaccesible${agente.error === 'pulse-inaccesible' ? '' : `: ${agente.error}`}`
      : null;
  const avisoTruncado =
    snapAgente?.truncado === true
      ? `vista parcial (${snapAgente.contenedores.length} de ${snapAgente.totalContenedores})`
      : null;

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
