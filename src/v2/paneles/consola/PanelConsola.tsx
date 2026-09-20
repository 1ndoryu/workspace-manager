/* Consola de problemas del workspace (panel inferior).
 * [por que] El usuario pidio una consola para ver problemas con filtros:
 * todos, sin git, sin push, sin sentinel o con sentinel/varsense
 * desactualizado. La clasificacion se deriva del snapshot, sin llamada extra
 * al server. */
import { usePanelConsola } from './usePanelConsola.js';
import {
  categoriasDe,
  rutaRelativa,
  type Categoria,
  type Problema,
  type SeveridadSentinel,
} from './clasificacionConsola.js';
import './consola.css';

const SEV_ETIQUETA: Record<SeveridadSentinel, string> = {
  error: 'error',
  warning: 'warning',
  information: 'info',
  hint: 'hint',
};

const FILTROS: { clave: 'todos' | Categoria; etiqueta: string }[] = [
  { clave: 'todos', etiqueta: 'todos' },
  { clave: 'sinGit', etiqueta: 'sin git' },
  { clave: 'sinCommit', etiqueta: 'sin commit' },
  { clave: 'sinPush', etiqueta: 'sin push' },
  { clave: 'gate', etiqueta: 'sentinel/varsense' },
  { clave: 'config', etiqueta: 'config' },
  { clave: 'sentinel', etiqueta: 'análisis' },
  { clave: 'vulnerabilidad', etiqueta: 'vulnerabilidades' },
  { clave: 'huerfano', etiqueta: 'huérfanos' },
];

const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  sinGit: 'sin git',
  sinCommit: 'sin commit',
  sinPush: 'sin push',
  gate: 'sentinel',
  config: 'config',
  sentinel: 'análisis',
  vulnerabilidad: 'vulnerabilidades',
  huerfano: 'huérfano',
};

/* Severidad que pinta el badge del proyecto en la categoria 'sentinel':
 * error si algun hallazgo es error; si no, advertencia (warning/info/hint). */
const severidadProyectoSentinel = (pr: Problema): 'error' | 'warn' =>
  pr.entradas.some((e) => e.sentinelSeveridad === 'error') ? 'error' : 'warn';

/* Badge del proyecto en la categoria 'vulnerabilidad': error si hay algun
 * paquete critical/high; si no, advertencia (moderate/low). */
const severidadProyectoVuln = (pr: Problema): 'error' | 'warn' =>
  pr.entradas.some((e) => e.vulnSeveridad === 'critical' || e.vulnSeveridad === 'high')
    ? 'error'
    : 'warn';

export function PanelConsola() {
  const {
    snapshot,
    filtro,
    setFiltro,
    visibles,
    contar,
    seleccionadoId,
    seleccionar,
    irAArchivos,
    abrirMenuContextual,
  } = usePanelConsola();

  if (!snapshot) return null;

  return (
    <aside className="panelConsola" aria-label="Consola de problemas">
      <header className="panelConsolaCabecera">
        <span className="panelConsolaTitulo">problemas ({contar('todos')})</span>
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            type="button"
            className={`panelConsolaFiltro${filtro === f.clave ? ' panelConsolaFiltro--activo' : ''}`}
            onClick={() => setFiltro(f.clave)}
            aria-pressed={filtro === f.clave}
          >
            {f.etiqueta} ({contar(f.clave)})
          </button>
        ))}
      </header>
      <div className="panelConsolaContenido">
        {visibles.length === 0 ? (
          <div className="consolaVacio">sin problemas en esta categoría</div>
        ) : (
          visibles.map((pr) => (
            /* [por que] Problemas AGRUPADOS por proyecto: cabecera con el
             * nombre (clic = seleccionar) y cada motivo en su propia linea
             * debajo, indentada con borde izquierdo. Antes todo iba en una
             * sola fila con badges y motivo a la derecha. */
            <div className="consolaGrupo" key={pr.p.id}>
              <button
                type="button"
                className={`consolaFila${pr.p.id === seleccionadoId ? ' consolaFila--seleccionada' : ''}`}
                onClick={() => {
                  seleccionar(pr.p.id);
                  /* Abrir la carpeta del proyecto en el navegador de archivos. */
                  irAArchivos(rutaRelativa(snapshot?.raiz, pr.p.ruta));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  abrirMenuContextual({ x: e.clientX, y: e.clientY, id: pr.p.id, clave: pr.p.clave });
                }}
                title={pr.p.ruta}
              >
                <span className="consolaFilaNombre">{pr.p.id}</span>
                {categoriasDe(pr).map((c) => {
                  let severidadBadge = '';
                  if (c === 'config') {
                    severidadBadge = pr.entradas.some(
                      (e) => e.categoria === 'config' && e.seriedad === 'error',
                    )
                      ? '--error'
                      : '--warn';
                  } else if (c === 'sentinel') {
                    severidadBadge = `--${severidadProyectoSentinel(pr)}`;
                  } else if (c === 'vulnerabilidad') {
                    severidadBadge = `--${severidadProyectoVuln(pr)}`;
                  }
                  return (
                    <span key={c} className={`consolaFilaBadge${severidadBadge}`}>
                      {ETIQUETA_CATEGORIA[c]}
                    </span>
                  );
                })}
              </button>
              <ul className="consolaMotivos">
                {pr.entradas.map((e, i) => (
                  <li
                    key={`${e.motivo}-${i}`}
                    className={`consolaMotivo${e.seriedad ? ` consolaMotivo--${e.seriedad === 'error' ? 'error' : 'warn'}` : ''}`}
                  >
                    {e.sentinelSeveridad ? (
                      <span className={`consolaSeveridad consolaSeveridad--${e.sentinelSeveridad}`}>
                        {SEV_ETIQUETA[e.sentinelSeveridad]}
                      </span>
                    ) : null}
                    {e.vulnSeveridad ? (
                      <span className={`consolaSeveridad consolaSeveridad--${e.vulnSeveridad}`}>
                        {e.vulnSeveridad}
                      </span>
                    ) : null}
                    {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
