/* Panel de repositorios: estados de los repos (git/github) desde el
 * snapshot, sin llamadas extra al server.
 * [por que] El usuario pidio un panel central para ver los estados de los
 * repositorios: remoto, rama, push pendiente (ahead/behind), dirty y ultimo
 * commit. El remoto github se enlaza para abrirlo. */
import { useMemo } from 'react';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
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
          onClick={() => cargar(true)}
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
          return (
            <button
              key={p.id}
              type="button"
              className={`reposFila${seleccionado ? ' reposFila--seleccionada' : ''}`}
              onClick={() => seleccionar(p.id)}
              title={p.ruta}
            >
              <span className="reposFilaNombre">{p.id}</span>
              <span className="reposFilaRama">{g.rama}</span>
              <span className="reposFilaPush">
                {g.ahead > 0 ? `${g.ahead}↑` : '·'}
                {g.behind > 0 ? `${g.behind}↓` : ''}
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
          );
        })}
      </div>
    </div>
  );
}
