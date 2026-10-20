/* Panel lateral derecho con la lista de proyectos.
 * [por que] El usuario pidio un panel que muestre cada proyecto en forma de
 * lista. Cada fila selecciona el proyecto (estado compartido con el mapa y
 * el panel de detalle). Mismo orden del mapa: por estado (repo < dirty <
 * gate < carpeta). */
import { useMemo, type CSSProperties } from 'react';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { estadoProyecto, ETIQUETA_ESTADO, PESO_ESTADO } from '../estado.js';
import { useConexiones } from '../useConexiones.js';
import { ETIQUETA_HUB } from '../mapa/geometria/disposicion.js';
import { coloresDeConexion } from '../mapa/geometria/tiles.js';
import './paneles.css';

export function PanelLista() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  /* A donde corre cada proyecto: mismos colores que el mapa, en tiempo real. */
  const { destinos } = useConexiones();

  const orden = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.proyectos].sort(
      (a, b) => PESO_ESTADO[estadoProyecto(a)] - PESO_ESTADO[estadoProyecto(b)],
    );
  }, [snapshot]);

  if (!snapshot) return null;

  return (
    <aside className="panelProyectos" aria-label="Lista de proyectos">
      <header className="panelListaCabecera">proyectos ({snapshot.proyectos.length})</header>
      <div className="panelListaContenido">
        {orden.map((p) => {
          const estado = estadoProyecto(p);
          const nodos = destinos.get(p.clave) ?? [];
          const colores = coloresDeConexion(nodos);
          /* [por que] El cuadro es solo color, y el estado ya no se pinta: el título lo dice
           * con palabras, y de paso dónde corre. */
          const donde = nodos.length
            ? `corre en: ${nodos.map((h) => ETIQUETA_HUB[h]).join(' y ')}`
            : 'sin conexión: no corre en ningún sitio';
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
              title={`${p.ruta} · ${ETIQUETA_ESTADO[estado]} · ${donde}`}
            >
              <span
                className={`estadoMarcador estadoMarcador--${colores ? 'conectado' : 'libre'}`}
                style={
                  colores
                    ? ({ '--marcador-1': colores[0], '--marcador-2': colores[1] } as CSSProperties)
                    : undefined
                }
                aria-hidden="true"
              />
              <span className="listaFilaNombre">{p.id}</span>
              <span className="listaFilaRama">{p.esGit && p.git ? p.git.rama : '—'}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
