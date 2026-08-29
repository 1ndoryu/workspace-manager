/* Panel de repositorios: estados de los repos (git/github) desde el
 * snapshot, sin llamadas extra al server.
 * [por que] El usuario pidio un panel central para ver los estados de los
 * repositorios: remoto, rama, push pendiente (ahead/behind), dirty y ultimo
 * commit. El remoto github se enlaza para abrirlo. */
import { useMemo } from 'react';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './paneles.css';

/* Extrae el nombre corto "org/repo" de una URL de remoto para el enlace. */
function remotoCorto(remoto: string): string {
  return remoto
    .replace(/^git@[^:]+:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '');
}

export function PanelRepos() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);

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
        </span>
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
