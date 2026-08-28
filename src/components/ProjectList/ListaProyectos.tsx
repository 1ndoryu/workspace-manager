/* Lista de proyectos: tabla compacta con filtros y busqueda.
 * [por que] Vista rapida del estado global; los filtros viven en el store. */
import { useWorkspaceStore, proyectosFiltrados } from '../../hooks/useWorkspace.js';
import { Badge, type EstadoBadge } from '../ui/Badge.js';
import './lista.css';

function estadoBadge(p: { esGit: boolean; git?: { dirty: boolean }; gate?: { declarado: boolean } }): { estado: EstadoBadge; texto: string } {
  if (!p.esGit) return { estado: 'muted', texto: 'carpeta' };
  if (p.git?.dirty) return { estado: 'warn', texto: 'dirty' };
  if (p.gate?.declarado) return { estado: 'info', texto: 'gate' };
  return { estado: 'ok', texto: 'limpio' };
}

export function ListaProyectos() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const filtro = useWorkspaceStore((s) => s.filtro);
  const setFiltro = useWorkspaceStore((s) => s.setFiltro);
  const buscar = useWorkspaceStore((s) => s.buscar);
  const setBuscar = useWorkspaceStore((s) => s.setBuscar);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);

  const proyectos = snapshot ? proyectosFiltrados({ ...useWorkspaceStore.getState() }) : [];

  return (
    <div className="listaContenedor">
      <div className="listaControles">
        <input
          className="listaBuscar"
          placeholder="Buscar proyecto…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <div className="listaFiltros">
          {(['todos', 'repos', 'dirty', 'conGate'] as const).map((f) => (
            <button
              key={f}
              className={`listaFiltro ${filtro === f ? 'listaFiltro--activo' : ''}`}
              onClick={() => setFiltro(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <table className="listaTabla">
        <thead>
          <tr>
            <th>Proyecto</th>
            <th>Tipo</th>
            <th>Rama</th>
            <th>Estado</th>
            <th>Gate</th>
            <th>Roadmap</th>
          </tr>
        </thead>
        <tbody>
          {proyectos.map((p) => {
            const badge = estadoBadge(p);
            return (
              <tr key={p.id} className="listaFila" onClick={() => seleccionar(p.id)}>
                <td className="listaNombre">{p.id}</td>
                <td>{p.tipo}</td>
                <td>{p.git?.rama ?? '—'}</td>
                <td>
                  <Badge estado={badge.estado}>{badge.texto}</Badge>
                </td>
                <td>{p.gate?.declarado ? p.gate.puerta : '—'}</td>
                <td>{p.roadmap?.pendientes ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
