/* Panel lateral derecho con la lista de proyectos.
 * [por que] El usuario pidio un panel que muestre cada proyecto en forma de
 * lista. Cada fila selecciona el proyecto (estado compartido con el mapa y
 * el panel de detalle). Mismo orden del mapa: por estado (repo < dirty <
 * gate < carpeta). */
import { useMemo } from 'react';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { estadoProyecto, PESO_ESTADO } from '../estado.js';
import './paneles.css';

export function PanelLista() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);

  const orden = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.proyectos].sort(
      (a, b) => PESO_ESTADO[estadoProyecto(a)] - PESO_ESTADO[estadoProyecto(b)],
    );
  }, [snapshot]);

  if (!snapshot) return null;

  return (
    <aside className="panelLista" aria-label="Lista de proyectos">
      <header className="panelListaCabecera">proyectos ({snapshot.proyectos.length})</header>
      <div className="panelListaContenido">
        {orden.map((p) => {
          const estado = estadoProyecto(p);
          return (
            <button
              key={p.id}
              type="button"
              className={`listaFila${p.id === seleccionadoId ? ' listaFila--seleccionada' : ''}`}
              onClick={() => seleccionar(p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                abrirMenuContextual({ x: e.clientX, y: e.clientY, id: p.id, clave: p.clave });
              }}
              title={p.ruta}
            >
              <span className={`estadoMarcador estadoMarcador--${estado}`} aria-hidden="true" />
              <span className="listaFilaNombre">{p.id}</span>
              <span className="listaFilaRama">{p.esGit && p.git ? p.git.rama : '—'}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
