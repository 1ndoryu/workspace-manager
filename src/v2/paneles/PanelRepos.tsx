/* Panel de repositorios: estados de los repos (git/github) desde el
 * snapshot, sin llamadas extra al server.
 * [por que] El usuario pidio un panel central para ver los estados de los
 * repositorios: remoto, rama, push pendiente (ahead/behind), dirty y ultimo
 * commit. El remoto github se enlaza para abrirlo.
 * [299A-7] Dos CAJAS externas (primitiva `Caja`) en `.cajaFila`: la lista
 * (titulo + meta + ⟳ canonico) y el lateral del diff (solo al elegir
 * archivo, con × que limpia la eleccion; al cerrarse, la lista se expande
 * por flex). Sin cabeceras ni botones ad-hoc.
 * [299A-11] Estado en `usePanelRepos`: el componente renderiza. */
import { Button } from '../ui/form/Button.js';
import { Caja } from '../ui/caja/Caja.js';
import { FilaCajas } from '../ui/caja/FilaCajas.js';
import { usePanelRepos, remotoCorto } from '../../hooks/usePanelRepos.js';
import { DetalleRepo, fechaCorta } from './repos/DetalleRepo.js';
import { PanelCambiosRepo } from './repos/PanelCambiosRepo.js';
import './paneles.css';
import './repos/repos.css';

export function PanelRepos() {
  const {
    snapshot,
    seleccionadoId,
    repos,
    conRemoto,
    conPush,
    desdeCache,
    cargando,
    expandida,
    detalles,
    cargandoClave,
    errorClave,
    archivoSel,
    stats,
    lateralArchivo,
    alternar,
    elegirArchivo,
    recargar,
    setArchivoSel,
  } = usePanelRepos();

  if (!snapshot) return null;

  return (
    /* [299A-9] Fila redimensionable (defecto [1,1.25], el reparto que habia). */
    <FilaCajas
      fila="repos"
      ids={lateralArchivo ? ['lista', 'diff'] : ['lista']}
      defectos={[1, 1.25]}
    >
      <Caja
        titulo={`repositorios (${repos.length})`}
        meta={`${conRemoto} con remoto · ${conPush} con push pendiente${desdeCache ? ' · desde caché' : ''}`}
        etiqueta="Estados de los repositorios"
        acciones={
          <Button pequeno onClick={recargar} disabled={cargando} title="Re-escanea los repositorios (ignora la caché)">
            {cargando ? '…' : '⟳ recargar'}
          </Button>
        }
      >
        {repos.length === 0 && <div className="docsVacio">no hay repositorios</div>}
        {repos.map((p) => {
          const g = p.git!;
          const seleccionado = p.id === seleccionadoId;
          const abierta = expandida === p.id;
          /* Total sin commitear para el badge ~N de la fila (conteo ya
           * disponible en el snapshot, sin pedir el detalle). */
          const sinCommitear = g.cambios.staged + g.cambios.unstaged + g.cambios.untracked;
          /* Sin cambios = limpio y al día (nada que subir/traer/commitear):
           * opacidad reducida para no distraer; la seleccionada se mantiene
           * plena para que siga legible. */
          const sinCambios = !g.dirty && g.ahead === 0 && g.behind === 0;
          const detalle = detalles[p.clave];
          return (
            <div key={p.id} className="reposGrupo">
              <button
                type="button"
                className={`reposFila${seleccionado ? ' reposFila--seleccionada' : ''}${abierta ? ' reposFila--abierta' : ''}${sinCambios && !seleccionado ? ' reposFila--sin-cambios' : ''}`}
                onClick={() => alternar(p.id, p.clave)}
                title={`${p.ruta} — clic para ${abierta ? 'plegar' : 'ver cambios (si los hay)'}`}
                aria-expanded={abierta}
              >
                <span className="reposFilaNombre">{p.id}</span>
                <span className="reposFilaRama">{g.rama}</span>
                <span className="reposFilaPush">
                  {g.ahead > 0 ? `${g.ahead}↑` : '·'}
                  {g.behind > 0 ? `${g.behind}↓` : ''}
                  {sinCommitear > 0 ? ` ~${sinCommitear}` : ''}
                  {cargandoClave === p.clave ? ' …' : ''}
                </span>
                <span className="reposFilaDirty" aria-label={g.dirty ? 'con cambios' : 'limpio'}>
                  {g.dirty ? 'dirty' : 'limpio'}
                </span>
                <span className="reposFilaCommit">
                  {g.ultimoCommit ? g.ultimoCommit.hash.slice(0, 7) : '—'}
                </span>
                <span className="reposFilaFecha" title={g.ultimoCommit?.mensaje ?? 'sin commits'}>
                  {g.ultimoCommit ? fechaCorta(g.ultimoCommit.fecha) : '—'}
                </span>
                {g.remoto ? (
                  <a
                    className="reposFilaRemoto"
                    href={g.remoto}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    title={g.remoto}
                  >
                    {remotoCorto(g.remoto)}
                  </a>
                ) : (
                  <span className="reposFilaRemoto reposFilaRemoto--sin">sin remoto</span>
                )}
              </button>
              {abierta && (
                <div className="reposDetalleContenedor">
                  {detalle ? (
                    <DetalleRepo
                      detalle={detalle}
                      archivoSeleccionado={archivoSel?.clave === p.clave ? archivoSel.ruta : null}
                      alElegirArchivo={(ruta) => elegirArchivo(p.clave, ruta)}
                      stats={stats?.clave === p.clave ? stats.mapa : undefined}
                    />
                  ) : errorClave === p.clave ? (
                    <div className="docsVacio">no se pudo leer el detalle (¿repo con bloqueo?)</div>
                  ) : (
                    <div className="docsVacio">{cargandoClave === p.clave ? 'leyendo cambios…' : '…'}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Caja>
      {lateralArchivo && (
        <Caja
          titulo={lateralArchivo.ruta}
          etiqueta={`Diff de ${lateralArchivo.ruta}`}
          onCerrar={() => setArchivoSel(null)}
          cerrarTitulo="cerrar el diff"
        >
          <PanelCambiosRepo key={lateralArchivo.clave} clave={lateralArchivo.clave} ruta={lateralArchivo.ruta} />
        </Caja>
      )}
    </FilaCajas>
  );
}
