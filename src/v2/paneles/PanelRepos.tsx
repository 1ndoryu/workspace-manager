/* Panel de repositorios: estados de los repos (git/github) desde el
 * snapshot, sin llamadas extra al server.
 * [por que] El usuario pidio un panel central para ver los estados de los
 * repositorios: remoto, rama, push pendiente (ahead/behind), dirty y ultimo
 * commit. El remoto github se enlaza para abrirlo. */
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import type { DetalleRepoSync } from '../../shared/types.js';
import { detalleRepo, invalidarDetallesRepos } from '../repos/apiRepos.js';
import { DetalleRepo } from './DetalleRepo.js';
import './paneles.css';

/* Extrae el nombre corto "org/repo" de una URL de remoto para el enlace.
 * [por que] github.com es redundante en la etiqueta (el href ya lleva la URL
 * completa y el icono/dominio se sobreentiende); se conserva el host cuando
 * el remoto NO es de GitHub para que el enlace siga siendo identificable. */
function remotoCorto(remoto: string): string {
  const limpia = remoto
    .replace(/^git@[^:]+:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '');
  return limpia.replace(/^(www\.)?github\.com\//, '');
}

export function PanelRepos() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  /* [por que] El snapshot se sirve cacheado (desdeCache) y solo se re-escanea
   * pidiendo forzar=1; sin boton, el panel quedaba desactualizado tras un
   * cambio en disco (p. ej. rama/remote) hasta recargar la pagina. */
  const cargar = useWorkspaceStore((s) => s.cargar);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const desdeCache = useWorkspaceStore((s) => s.desdeCache);

  const repos = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.proyectos]
      .filter((p) => p.esGit && p.git)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [snapshot]);

  /* Acordeon estricto (289A-6): una sola expandida (por id) o ninguna; el
   * detalle se pide bajo demanda y se cachea por clave hasta el recargar. */
  const [expandida, setExpandida] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, DetalleRepoSync>>({});
  const [cargandoClave, setCargandoClave] = useState<string | null>(null);
  const [errorClave, setErrorClave] = useState<string | null>(null);

  async function alternar(id: string, clave: string) {
    if (expandida === id) {
      setExpandida(null);
      return;
    }
    seleccionar(id);
    setExpandida(id);
    setErrorClave(null);
    if (detalles[clave]) return;
    setCargandoClave(clave);
    try {
      const d = await detalleRepo(clave);
      setDetalles((prev) => ({ ...prev, [clave]: d }));
    } catch {
      setErrorClave(clave);
    } finally {
      setCargandoClave(null);
    }
  }

  function recargar() {
    setExpandida(null);
    setDetalles({});
    setErrorClave(null);
    invalidarDetallesRepos();
    cargar(true);
  }

  if (!snapshot) return null;

  const conRemoto = repos.filter((p) => p.git?.remoto).length;
  const conPush = repos.filter((p) => (p.git?.ahead ?? 0) > 0).length;

  return (
    <div className="panelRepos" aria-label="Estados de los repositorios">
      <header className="panelReposCabecera">
        repositorios ({repos.length})
        <span className="panelReposMeta">
          {conRemoto} con remoto · {conPush} con push pendiente
          {desdeCache ? ' · desde caché' : ''}
        </span>
        <button
          type="button"
          className="reposRecargar"
          onClick={recargar}
          disabled={cargando}
          title="Re-escanea los repositorios (ignora la caché)"
        >
          {cargando ? '…' : '⟳ recargar'}
        </button>
      </header>
      <div className="panelReposContenido">
        {repos.length === 0 && <div className="docsVacio">no hay repositorios</div>}
        {repos.map((p) => {
          const g = p.git!;
          const seleccionado = p.id === seleccionadoId;
          const abierta = expandida === p.id;
          /* Total sin commitear para el badge ~N de la fila (conteo ya
           * disponible en el snapshot, sin pedir el detalle). */
          const sinCommitear = g.cambios.staged + g.cambios.unstaged + g.cambios.untracked;
          const detalle = detalles[p.clave];
          return (
            <div key={p.id} className="reposGrupo">
            <button
              type="button"
              className={`reposFila${seleccionado ? ' reposFila--seleccionada' : ''}${abierta ? ' reposFila--abierta' : ''}`}
              onClick={() => alternar(p.id, p.clave)}
              title={`${p.ruta} — clic para ${abierta ? 'plegar' : 'ver cambios por subir/traer'}`}
              aria-expanded={abierta}
            >
              <span className="reposFilaNombre">{p.id}</span>
              <span className="reposFilaRama">{g.rama}</span>
              <span className="reposFilaPush">
                {g.ahead > 0 ? `${g.ahead}↑` : '·'}
                {g.behind > 0 ? `${g.behind}↓` : ''}
                {sinCommitear > 0 ? ` ~${sinCommitear}` : ''}
              </span>
              <span className="reposFilaDirty" aria-label={g.dirty ? 'con cambios' : 'limpio'}>
                {g.dirty ? 'dirty' : 'limpio'}
              </span>
              <span className="reposFilaCommit">
                {g.ultimoCommit ? g.ultimoCommit.hash.slice(0, 7) : '—'}
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
                  <DetalleRepo detalle={detalle} />
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
      </div>
    </div>
  );
}
