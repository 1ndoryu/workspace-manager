/* Panel de la VPS: solo tiempo real via pulse (2026-10-01). Una caja por
 * despliegue: titulo = nombre legible (el backend resuelve `app-{uuid}`),
 * meta = dominio, filas = app/db/web/proxy + cpu% + MiB; infra sin sitio en
 * su propia caja al final. Sin legacy: lo que no venia de pulse salio
 * (lista lenta, detalle de 7 piezas, resumen del audit). */
import { useEffect, useRef, useState } from 'react';
import type { VpsAgenteContenedor, VpsAgenteRespuesta, VpsConfig } from '../../shared/types.js';
import { agenteVps, configVps } from '../vps/apiVps.js';
import { Button } from '../ui/form/Button.js';
import { Caja } from '../ui/caja/Caja.js';
import './paneles.css';

/* Fase del estado "fase:detalle" (running:healthy, degraded:unhealthy...):
 * running = relleno, degraded = borde, resto = atenuado. */
function claseEstado(estado: string): string {
  if (estado.startsWith('running')) return 'vpsEstado vpsEstado--ok';
  if (estado.startsWith('degraded')) return 'vpsEstado vpsEstado--mal';
  return 'vpsEstado vpsEstado--apagado';
}

/* Rol legible del contenedor: `app-…`/`postgres-…` ya van agrupados bajo su
 * sitio, asi que la fila muestra el rol, no el id. */
function rolContenedor(nombre: string): string {
  if (nombre.startsWith('app-')) return 'app';
  if (nombre.startsWith('postgres-') || nombre.startsWith('mariadb-')) return 'db';
  if (nombre.startsWith('socket-proxy')) return 'proxy';
  if (nombre.startsWith('wordpress-')) return 'web';
  return nombre;
}

export function PanelVps() {
  const [config, setConfig] = useState<VpsConfig | null>(null);
  /* Último snapshot bueno (SWR manual): se muestra lo último válido
   * mientras se repide. `null` = aún sin respuesta. */
  const [agente, setAgente] = useState<VpsAgenteRespuesta | null>(null);
  const agenteEnVuelo = useRef(false);
  const agenteAbort = useRef<AbortController | null>(null);

  const snapAgente = agente?.disponible ? (agente.snapshot ?? null) : null;

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
      /* Sin red: se conserva el último bueno (SWR); el banner solo salta
       * si hubo agente y cayó. */
      setAgente((prev) =>
        prev?.disponible ? { disponible: false, snapshot: prev.snapshot, error: 'pulse-inaccesible' } : prev,
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
   * tick anterior), pausado con la tab oculta y repedido al volver. */
  useEffect(() => {
    configVps()
      .then((c) => setConfig(c))
      .catch(() => {});
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
      document.removeEventListener('visibilitychange', alVisibilidad);
      agenteAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Grupos por sitio (nombre legible del backend) en orden alfabético +
   * infra sin sitio al final: el id largo no se muestra nunca. */
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
    const sitios = [...porSitio.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { sitios, infra };
  })();

  /* Avisos: solo existen cuando hay algo que decir. */
  const bannerAgente =
    agente && !agente.disponible && agente.error !== null && agente.error !== 'sin-configurar'
      ? `pulse-inaccesible${agente.error === 'pulse-inaccesible' ? '' : `: ${agente.error}`}`
      : null;
  const avisoTruncado =
    snapAgente?.truncado === true
      ? `vista parcial (${snapAgente.contenedores.length} de ${snapAgente.totalContenedores})`
      : null;

  return (
    <div className="panelVps">
      {(config && !config.binario.ok) || bannerAgente || avisoTruncado ? (
        <div className="panelVpsAvisos">
          {config && !config.binario.ok && (
            <div className="vpsAviso">sin binario ({config.binario.ruta}): sin nombres de sitio</div>
          )}
          {bannerAgente && <div className="vpsAviso">{bannerAgente}</div>}
          {avisoTruncado && <div className="vpsAviso">{avisoTruncado}</div>}
        </div>
      ) : null}
      <div className="panelVpsCabecera">
        <span className="vpsLinea">
          vps{snapAgente ? ` (${snapAgente.contenedores.length})` : ''} ·{' '}
          {snapAgente ? `en vivo · hace ${Math.round(snapAgente.frescura.edadMs / 1000)}s` : 'conectando con pulse…'}
        </span>
        <Button pequeno onClick={recargar} title="Pide el snapshot ahora">
          ⟳ recargar
        </Button>
      </div>
      {snapAgente && (
        <div className="panelVpsRejilla">
          {grupos.sitios.map(([nombre, g]) => (
            <Caja
              key={nombre}
              titulo={nombre}
              meta={g.dominio ? g.dominio.replace(/^https?:\/\//, '') : undefined}
              etiqueta={`despliegue ${nombre}`}
            >
              {g.filas.map((c) => (
                <div key={c.id} className="vpsLinea">
                  <span className={claseEstado(c.estado)} title={c.estado}>
                    {c.estado}
                  </span>{' '}
                  {rolContenedor(c.nombre)} · {c.cpuPct.toFixed(1)}% · {Math.round(c.memMiB)} MiB
                </div>
              ))}
            </Caja>
          ))}
          {grupos.infra.length > 0 && (
            <Caja titulo="infra" etiqueta="infraestructura Coolify">
              {grupos.infra.map((c) => (
                <div key={c.id} className="vpsLinea">
                  <span className={claseEstado(c.estado)} title={c.estado}>
                    {c.estado}
                  </span>{' '}
                  {c.nombre} · {c.cpuPct.toFixed(1)}% · {Math.round(c.memMiB)} MiB
                </div>
              ))}
            </Caja>
          )}
        </div>
      )}
    </div>
  );
}
