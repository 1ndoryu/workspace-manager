/* Panel de la VPS: tiempo real via pulse + lista completa via Coolify
 * (2026-10-05). Una sola caja: sitios agrupados por nombre legible (el
 * backend resuelve `app-{uuid}`) + infra sin sitio al final. Lo detenido no
 * tiene contenedores en vivo y antes desaparecía: ahora la lista de Coolify
 * aporta todos los sitios y pulse solo el vivo (fila con estado Coolify y
 * ceros si está detenido). Sin legacy: detalle de 7 piezas y resumen del
 * audit salieron (solo queda el % de disco del host). */
import { fmtBytes } from '../../../shared/format.js';
import { PanelVpsRecursos } from './PanelVpsRecursos.js';
import { FilaCajas } from '../../ui/caja/FilaCajas.js';
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import { HistorialSitioDetalle } from '../../vps/HistorialSitioDetalle.js';
import { PiezasSitio } from '../../vps/PiezasSitio.js';
import { usePanelVps } from '../../vps/usePanelVps.js';
import '../paneles.css';

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

/* [07AA-19] Solo JSX: el estado vive en usePanelVps (gate:
 * limite-lineas, usestate-excesivo, componente-sin-hook-glory). */
export function PanelVps() {
  const {
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
  } = usePanelVps();

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
      {/* [2026-10-01] Fila redimensionable con divisor arrastrable
       * (FilaCajas persistida, defecto [3,1,1.2]): el ancho lo decide el
       * usuario, no la tab. Sin detalle son 2 ids, con detalle 3. */}
      <FilaCajas
        fila="vps"
        ids={selFila ? ['tabla', 'recursos', 'detalle'] : ['tabla', 'recursos']}
        defectos={[3, 1, 1.2]}
      >
        <Caja
          titulo={`vps${snapAgente ? ` (${snapAgente.contenedores.length})` : ''}`}
          meta={
            snapAgente ? `en vivo · hace ${Math.round(snapAgente.frescura.edadMs / 1000)}s` : undefined
          }
          etiqueta="VPS en vivo"
          acciones={
            <Button pequeno onClick={recargar} title="Pide el snapshot ahora">
              ⟳ recargar
            </Button>
          }
        >
          {!snapAgente && (
            <div className="docsVacio">
              {agente?.error ? `pulse no disponible (${agente.error})` : 'conectando con pulse…'}
            </div>
          )}
          {snapAgente && (
            <table className="vpsTabla">
              <thead>
                <tr>
                  <th>Despliegue</th>
                  <th>Dominio</th>
                  <th>Estado</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>Cont.</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr
                    key={f.clave}
                    className={
                      f.clave === selFila?.clave ? 'vpsTablaFila vpsTablaFila--elegida' : 'vpsTablaFila'
                    }
                    onClick={() => elegir(f.clave)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        elegir(f.clave);
                      }
                    }}
                    title="Ver detalle en el panel lateral"
                  >
                    <td>{f.nombre}</td>
                    <td>{f.dominio ?? '—'}</td>
                    <td>
                      <span className={claseEstado(f.estado)} title={f.estado}>
                        {f.estado}
                      </span>
                    </td>
                    <td>{f.cpu.toFixed(1)}%</td>
                    <td>{Math.round(f.mem)} MiB</td>
                    <td>{f.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Caja>
        <PanelVpsRecursos snap={snapAgente} discoPct={discoPct} />
        {selFila && (
          <Caja
            titulo={selFila.nombre}
            meta={selFila.dominio ?? undefined}
            etiqueta={`detalle ${selFila.nombre}`}
            onCerrar={cerrarDetalle}
            cerrarTitulo="Cierra el detalle"
          >
            <div className="vpsLinea">
              {selFila.n} contenedores · {selFila.cpu.toFixed(1)}% cpu · {Math.round(selFila.mem)} MiB
            </div>
            {/* [0110A-3 F2] Historial del despliegue (componente aparte;
              * el vivo va en la línea de arriba). */}
            <HistorialSitioDetalle
              serie={seriePara(selFila.clave)}
              rangoId={rangoId}
              onRango={elegirRango}
            />
            {/* [0110A-3 F3] Piezas pesadas bajo demanda (una por clic,
              * con timeout): solo sitios, nunca infra. */}
            {selFila.clave !== 'infra' && <PiezasSitio sitio={selFila.nombre} />}
            {selFilas.map((c) => (
              <div key={c.id} className="vpsLinea">
                <span className={claseEstado(c.estado)} title={c.estado}>
                  {c.estado}
                </span>{' '}
                {selFila.clave === 'infra' ? c.nombre : rolContenedor(c.nombre)} ·{' '}
                {c.cpuPct.toFixed(1)}% · {Math.round(c.memMiB)} MiB
                {c.memLimiteMiB !== null ? ` / ${Math.round(c.memLimiteMiB)}` : ''}
                <div className="vpsFilaDominio">
                  red ↓{fmtBytes(c.redRxBytes)} ↑{fmtBytes(c.redTxBytes)} · disco{' '}
                  {fmtBytes(c.blkReadBytes)}/{fmtBytes(c.blkWriteBytes)}
                </div>
              </div>
            ))}
          </Caja>
        )}
      </FilaCajas>
    </div>
  );
}
