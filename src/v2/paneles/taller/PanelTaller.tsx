/* Panel del taller (20AA-16): la misma forma que el de vps —tabla de despliegues, cuadro de
 * recursos y detalle lateral— pero con los proyectos del taller de la VPS 89, en vivo por pulse en
 * modo `procesos` (sin Docker: un «contenedor» es un proyecto).
 * [por que] Los componentes son los de vps (`.vpsTabla`, `.vpsEstado`, PanelVpsRecursos,
 * HistorialSitioDetalle, PiezasSitio) y solo se les inyecta lo que cambia: el cliente de piezas, la
 * tab del historial y la nota del disco. Nada de HTML ni de clases paralelas.
 * Solo JSX: el estado vive en usePanelTaller (gate: limite-lineas, componente-sin-hook-glory). */
import { fmtBytes } from '../../../shared/vista/format.js';
import { Caja } from '../../ui/caja/Caja.js';
import { FilaCajas } from '../../ui/caja/FilaCajas.js';
import { Button } from '../../ui/form/Button.js';
import { PanelVpsRecursos } from '../vps/PanelVpsRecursos.js';
import { HistorialSitioDetalle } from '../../vps/HistorialSitioDetalle.js';
import { PiezasSitio } from '../../vps/PiezasSitio.js';
import { claseEstado } from '../../vps/panelVpsCalculo.js';
import { piezaTaller } from '../../taller/apiTaller.js';
import { usePanelTaller } from '../../taller/usePanelTaller.js';
import '../paneles.css';
import './taller.css';

/* Dónde se llega al proyecto desde el portátil: el puerto del túnel si lo hay, si no el hostname
 * público. Un proyecto sin ninguno de los dos se dice, no se deja el hueco en blanco. */
function destino(puertoLocal: number | null, hostname: string | null): string {
  if (puertoLocal !== null) return `local http://127.0.0.1:${puertoLocal}`;
  return hostname ? `https://${hostname}` : 'sin túnel ni hostname';
}

export function PanelTaller() {
  const {
    agente,
    snapAgente,
    filas,
    selFila,
    rangoId,
    elegirRango,
    seriePara,
    discoPct,
    recargar,
    elegir,
    cerrarDetalle,
    banner,
    truncado,
  } = usePanelTaller();

  return (
    <div className="panelTaller">
      {banner || truncado ? (
        <div className="panelVpsAvisos">
          {banner && <div className="vpsAviso">{banner}</div>}
          {truncado && <div className="vpsAviso">{truncado}</div>}
        </div>
      ) : null}
      {/* Fila redimensionable con divisor arrastrable (FilaCajas persistida): el ancho lo decide el
       * usuario, no la tab. Sin detalle son 2 ids, con detalle 3. */}
      <FilaCajas
        fila="taller"
        ids={selFila ? ['tabla', 'recursos', 'detalle'] : ['tabla', 'recursos']}
        defectos={[3, 1, 1.2]}
      >
        <Caja
          titulo={`taller${snapAgente ? ` (${filas.length})` : ''}`}
          meta={
            snapAgente ? `en vivo · hace ${Math.round(snapAgente.frescura.edadMs / 1000)}s` : undefined
          }
          etiqueta="Taller en vivo"
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
                  <th>Proyecto</th>
                  <th>Sesión</th>
                  <th>Hostname</th>
                  <th>Estado</th>
                  <th>CPU</th>
                  <th>RAM</th>
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
                    /* [por que] La fila elegida se distingue por color, que no llega a quien usa
                     * lector. `aria-selected` no vale aquí: la tabla es `role="table"` y solo lo
                     * admite en grid. `aria-current` sí es global, y anuncia «actual». */
                    aria-current={f.clave === selFila?.clave ? 'true' : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        elegir(f.clave);
                      }
                    }}
                    title="Ver detalle en el panel lateral"
                  >
                    <td>{f.nombre}</td>
                    <td className="tallerSesion">{f.sesion}</td>
                    <td>{f.hostname ?? '—'}</td>
                    <td>
                      <span className={claseEstado(f.estado)} title={f.estado}>
                        {f.estado}
                      </span>
                    </td>
                    <td>{f.cpu.toFixed(1)}%</td>
                    <td>{Math.round(f.mem)} MiB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Caja>
        {/* Los recursos del taller son los de la 89 y su disco lo mide la sonda del taller: de ahí
         * la tab propia (historial aparte) y la nota. */}
        <PanelVpsRecursos
          snap={snapAgente}
          discoPct={discoPct}
          tab="taller"
          etiqueta="Recursos del taller (VPS 89)"
          notaDisco="sin dato de disco (sonda del taller sin totalGb)"
        />
        {selFila && (
          <Caja
            titulo={selFila.nombre}
            meta={selFila.hostname ?? undefined}
            etiqueta={`detalle ${selFila.nombre}`}
            onCerrar={cerrarDetalle}
            cerrarTitulo="Cierra el detalle"
          >
            <div className="vpsLinea">
              {selFila.n} procesos · {selFila.cpu.toFixed(1)}% cpu · {Math.round(selFila.mem)} MiB
            </div>
            <div className="vpsLinea">
              <div className="vpsFilaDominio">
                sesión {selFila.sesion} · {destino(selFila.puertoLocal, selFila.hostname)}
              </div>
            </div>
            {/* Historial del proyecto (el vivo va en la línea de arriba). */}
            <HistorialSitioDetalle
              serie={seriePara(selFila.clave)}
              rangoId={rangoId}
              onRango={elegirRango}
            />
            {/* Las mismas 7 piezas que en vps, pedidas al pulse de la 89. */}
            <PiezasSitio sitio={selFila.nombre} pedir={piezaTaller} />
            {selFila.contenedores.map((c) => (
              <div key={c.id} className="vpsLinea">
                <span className={claseEstado(c.estado)} title={c.estado}>
                  {c.estado}
                </span>{' '}
                {c.cpuPct.toFixed(1)}% · {Math.round(c.memMiB)} MiB
                <div className="vpsFilaDominio">
                  red ↓{fmtBytes(c.redRxBytes)} ↑{fmtBytes(c.redTxBytes)} · disco{' '}
                  {fmtBytes(c.blkReadBytes)}/{fmtBytes(c.blkWriteBytes)}
                </div>
                {/* El comando principal del grupo: en modo procesos es lo que dice qué es. */}
                <div className="vpsFilaDominio tallerComando">{c.imagen}</div>
              </div>
            ))}
          </Caja>
        )}
      </FilaCajas>
    </div>
  );
}
