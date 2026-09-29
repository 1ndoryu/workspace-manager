/* Panel de la VPS: despliegues Coolify en solo lectura (299A-5).
 * [por que] El usuario pidio ver despliegues, estado y uso de recursos con
 * un panel de la VPS al lado y el detalle al dar clic, con el patron de la
 * tab repos (lista + zonas, monocromo v2).
 * [299A-6] Tres CAJAS externas independientes (primitiva `Caja`) en una fila
 * que llena el marco central: despliegues, vps y detalle. El detalle solo se
 * renderiza al elegir (como el detalle de mapa: al cerrarse, las hermanas se
 * expanden solas por flex). Las piezas del detalle son `Seccion` (panel
 * interno sin borde). Cada pieza es una consulta remota y puede tardar; el
 * refresco es configurable por VPS_REFRESH_MS, 0 = manual. v1 sin botones de
 * accion: solo lectura.
 * [299A-9] La fila es `FilaCajas`: los anchos se arrastran (Resizer
 * central, igual que el mapa) y se persisten por tab; el defecto es el
 * reparto anterior. */
import { useEffect, useRef, useState } from 'react';
import type { VpsConfig, VpsDetalle, VpsRecursos, VpsSitio, VpsSitios } from '../../shared/types.js';
import { configVps, detalleVps, invalidarVps, recursosVps, sitiosVps } from '../vps/apiVps.js';
import { Button } from '../ui/Button.js';
import { Caja, Seccion } from '../ui/Caja.js';
import { FilaCajas } from '../ui/FilaCajas.js';
import './paneles.css';

/* Fase del estado "fase:detalle" (running:healthy, degraded:unhealthy...):
 * running = relleno, degraded = borde, resto = atenuado. */
function claseEstado(estado: string): string {
  if (estado.startsWith('running')) return 'vpsEstado vpsEstado--ok';
  if (estado.startsWith('degraded')) return 'vpsEstado vpsEstado--mal';
  return 'vpsEstado vpsEstado--apagado';
}

/* Inspector JSON generico y acotado: escalares como filas, objetos un nivel,
 * arrays como "N elementos" + los primeros. [por que] Las formas del
 * --json del manager pueden cambiar entre versiones; esto nunca rompe. */
function JsonVista({ datos, prof = 0 }: { datos: unknown; prof?: number }): React.ReactNode {
  if (datos === null || datos === undefined) return <span className="vpsJsonNulo">—</span>;
  if (typeof datos === 'string') {
    const t = datos.length > 300 ? `${datos.slice(0, 300)}…` : datos;
    return <span className="vpsJsonTexto">{t}</span>;
  }
  if (typeof datos !== 'object' || prof > 2) return <span>{String(datos)}</span>;
  if (Array.isArray(datos)) {
    if (datos.length === 0) return <span className="vpsJsonNulo">vacío</span>;
    return (
      <div className="vpsJsonGrupo">
        <span className="vpsJsonClave">{datos.length} elementos</span>
        {datos.slice(0, 8).map((d, i) => (
          <div key={i} className="vpsJsonItem">
            <JsonVista datos={d} prof={prof + 1} />
          </div>
        ))}
      </div>
    );
  }
  const filas = Object.entries(datos as Record<string, unknown>).slice(0, 40);
  return (
    <div className="vpsJsonGrupo">
      {filas.map(([k, v]) => (
        <div key={k} className="vpsJsonFila">
          <span className="vpsJsonClave">{k}</span>
          <span className="vpsJsonValor">
            <JsonVista datos={v} prof={prof + 1} />
          </span>
        </div>
      ))}
    </div>
  );
}

const ETIQUETAS_PIEZA: Record<string, string> = {
  salud: 'salud',
  stats: 'recursos del contenedor',
  inspeccion: 'inspección',
  eventos: 'eventos',
  bd: 'base de datos',
  diagnostico: 'diagnóstico',
  logs: 'logs (100 líneas)',
};

export function PanelVps() {
  const [config, setConfig] = useState<VpsConfig | null>(null);
  const [sitios, setSitios] = useState<VpsSitios | null>(null);
  const [recursos, setRecursos] = useState<VpsRecursos | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<VpsDetalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enVuelo = useRef(false);

  async function cargar() {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setCargando(true);
    setError(null);
    try {
      const [c, s, r] = await Promise.all([configVps(), sitiosVps(), recursosVps()]);
      setConfig(c);
      setSitios(s);
      setRecursos(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
      enVuelo.current = false;
    }
  }

  function recargar() {
    invalidarVps();
    setDetalle(null);
    void cargar();
  }

  /* Carga inicial + auto-refresco configurable (VPS_REFRESH_MS del server):
   * sin solapes (si hay consulta en vuelo, el tick se salta). */
  useEffect(() => {
    void cargar();
    let intervalo: ReturnType<typeof setInterval> | null = null;
    configVps()
      .then((c) => {
        if (c.refreshMs > 0) {
          intervalo = setInterval(() => {
            if (!enVuelo.current) {
              invalidarVps();
              void cargar();
            }
          }, c.refreshMs);
        }
      })
      .catch(() => {});
    return () => {
      if (intervalo) clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function elegir(sitio: string) {
    if (elegido === sitio) {
      setElegido(null);
      return;
    }
    setElegido(sitio);
    setDetalle(null);
    setCargandoDetalle(true);
    try {
      setDetalle(await detalleVps(sitio));
    } catch (e) {
      setDetalle({
        sitio,
        piezas: {},
      });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargandoDetalle(false);
    }
  }

  function cerrarDetalle() {
    setElegido(null);
  }

  const resumen = (recursos?.piezas.resumen?.ok
    ? (recursos.piezas.resumen.datos as {
        metricas: { metrica: string; pct: number }[];
        carga: string | null;
        contenedores: { total: number; sanos: number; noSanos: string[] };
      })
    : null) ?? null;

  /* [299A-7] Sin barra flotante: la meta y el recargar viven en las
   * cabeceras de las cajas (⟳ = accion de "despliegues", version/modo =
   * meta de "vps"); los avisos solo se renderizan cuando existen
   * (una alerta no es una caja). */
  const metaVps = [
    config?.binario.version ?? null,
    config ? (config.refreshMs > 0 ? `auto ${Math.round(config.refreshMs / 1000)}s` : 'manual') : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  return (
    <div className="panelVps">
      {(config && !config.binario.ok) || error || sitios?.aviso || (sitios && sitios.avisos.length > 0) ? (
        <div className="panelVpsAvisos">
          {config && !config.binario.ok && (
            <div className="vpsAviso">sin binario ({config.binario.ruta}): la tab no puede leer nada</div>
          )}
          {error && <div className="vpsAviso">{error}</div>}
          {sitios?.aviso && <div className="vpsAviso">{sitios.aviso}</div>}
          {sitios && sitios.avisos.length > 0 && (
            <div className="vpsAviso">
              settings ↔ real: {sitios.avisos.map((a) => `${a.nombre} (${a.problema})`).join(' · ')}
            </div>
          )}
        </div>
      ) : null}
      {/* [299A-9] Fila redimensionable: los anchos los decide el usuario
        * con el divisor (igual que el mapa), no la tab; el defecto [1,1,1.6]
        * es el reparto que habia. */}
      <FilaCajas
        fila="vps"
        ids={elegido ? ['despliegues', 'vps', 'detalle'] : ['despliegues', 'vps']}
        defectos={[1, 1, 1.6]}
      >
        <Caja
          titulo={`despliegues${sitios ? ` (${sitios.sitios.length})` : ''}`}
          etiqueta="Despliegues"
          acciones={
            <Button pequeno onClick={recargar} disabled={cargando} title="Re-consulta la VPS (ignora la caché)">
              {cargando ? '…' : '⟳ recargar'}
            </Button>
          }
        >
          {!sitios && <div className="docsVacio">{cargando ? 'leyendo la VPS…' : '…'}</div>}
          {sitios?.sitios.map((s: VpsSitio) => (
            <button
              key={s.nombre}
              type="button"
              className={`vpsFila${elegido === s.nombre ? ' vpsFila--elegida' : ''}${
                s.estadoReal === 'desconocido' || s.estadoReal === 'sin-asignar' ? ' vpsFila--apagada' : ''
              }`}
              onClick={() => void elegir(s.nombre)}
              title={`${s.dominio} — clic para ver el detalle`}
              aria-expanded={elegido === s.nombre}
            >
              <span className="vpsFilaNombre">{s.nombre}</span>
              <span className={claseEstado(s.estadoReal)} title={s.estadoReal}>
                {s.estadoReal}
              </span>
              <span className="vpsFilaDominio" title={s.dominio}>
                {s.dominio.replace(/^https?:\/\//, '')}
              </span>
            </button>
          ))}
        </Caja>
        <Caja titulo="vps" meta={metaVps || undefined} etiqueta="Estado de la VPS">
          {!recursos && <div className="docsVacio">{cargando ? 'leyendo la VPS…' : '…'}</div>}
          {resumen && (
            <>
              {resumen.metricas.map((m) => (
                <div key={m.metrica} className="vpsMetrica">
                  <span className="vpsMetricaNombre">{m.metrica}</span>
                  <span className="vpsMetricaBarra" aria-hidden="true">
                    <span className="vpsMetricaRelleno" style={{ width: `${Math.min(100, m.pct)}%` }} />
                  </span>
                  <span className="vpsMetricaPct">{m.pct}%</span>
                </div>
              ))}
              {resumen.carga && <div className="vpsLinea">carga {resumen.carga}</div>}
              <div className="vpsLinea">
                contenedores {resumen.contenedores.sanos}/{resumen.contenedores.total} sanos
              </div>
              {resumen.contenedores.noSanos.map((n) => (
                <div key={n} className="vpsLinea vpsLinea--mal">
                  {n}
                </div>
              ))}
            </>
          )}
          {recursos && !resumen && (
            <div className="docsVacio">sin métricas (ver texto del audit en consola del server)</div>
          )}
        </Caja>
        {elegido && (
          <Caja
            titulo={elegido}
            etiqueta="Detalle del despliegue"
            onCerrar={cerrarDetalle}
            cerrarTitulo="cerrar el detalle"
          >
            {cargandoDetalle && <div className="docsVacio">leyendo el despliegue… (puede tardar)</div>}
            {!cargandoDetalle && detalle && (
              <>
                {Object.entries(detalle.piezas).map(([clave, p]) => (
                  <Seccion key={clave} titulo={ETIQUETAS_PIEZA[clave] ?? clave} fallo={!p.ok}>
                    <div className="vpsPiezaCuerpo">
                      {p.ok ? (
                        typeof p.datos === 'string' ? (
                          <pre className="vpsPre">{p.datos}</pre>
                        ) : (
                          <JsonVista datos={p.datos} />
                        )
                      ) : (
                        <div className="vpsPiezaError">no disponible ({p.error})</div>
                      )}
                    </div>
                  </Seccion>
                ))}
                {Object.keys(detalle.piezas).length === 0 && (
                  <div className="docsVacio">no se pudo leer el detalle</div>
                )}
              </>
            )}
            {!cargandoDetalle && !detalle && (
              <div className="docsVacio">no se pudo leer el detalle</div>
            )}
          </Caja>
        )}
      </FilaCajas>
    </div>
  );
}
