/* Consola de problemas del workspace (panel inferior).
 * [por que] El usuario pidio una consola para ver problemas con filtros:
 * todos, sin git, sin push, sin sentinel o con sentinel/varsense
 * desactualizado. La clasificacion se deriva del snapshot, sin llamada extra
 * al server. El filtro es un Selector del sistema (no botones sueltos). */
import { usePanelConsola } from './usePanelConsola.js';
import { Selector } from '../../ui/selector/Selector.js';
import {
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

  const etiquetas = FILTROS.map((f) => `${f.etiqueta} (${contar(f.clave)})`);
  const actual = FILTROS.find((f) => f.clave === filtro) ?? FILTROS[0];

  return (
    <aside className="panelConsola" aria-label="Consola de problemas">
      <header className="panelConsolaCabecera">
        <span className="panelConsolaTitulo">problemas ({contar('todos')})</span>
        <Selector
          valor={`${actual.etiqueta} (${contar(actual.clave)})`}
          opciones={etiquetas}
          onChange={(v) => {
            const i = etiquetas.indexOf(v);
            if (i >= 0) setFiltro(FILTROS[i].clave);
          }}
          titulo="Filtro de problemas"
        />
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
                {/* [por que] Sin spans ni badges: la cabecera solo dice el
                  * total de problemas del proyecto; el detalle ya vive en
                  * los motivos de abajo. */}
                {pr.p.id} ({pr.entradas.length})
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
