/* Barra de navegacion del front v2.
 * [por que] El usuario pidio un nav como otro panel: un menu para cambiar el
 * panel central (mapa, documentacion, repos) y botones para controlar la
 * visibilidad de cada panel lateral/consola. Iconos lucide-react. */
import { BookOpen, Boxes, GitBranch, PanelLeft, PanelRight, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useWorkspaceStore, type PanelCentral, type VisibilidadPaneles } from '../hooks/useWorkspace.js';

const CENTRALES: { clave: PanelCentral; icono: LucideIcon; etiqueta: string }[] = [
  { clave: 'mapa', icono: Boxes, etiqueta: 'mapa' },
  { clave: 'docs', icono: BookOpen, etiqueta: 'documentación' },
  { clave: 'repos', icono: GitBranch, etiqueta: 'repos' },
];

const TOGGLES: {
  clave: keyof VisibilidadPaneles;
  icono: LucideIcon;
  etiqueta: string;
}[] = [
  { clave: 'detalle', icono: PanelLeft, etiqueta: 'panel de detalle' },
  { clave: 'lista', icono: PanelRight, etiqueta: 'panel de lista' },
  { clave: 'consola', icono: SquareTerminal, etiqueta: 'consola de problemas' },
];

export function NavBar() {
  const panelCentral = useWorkspaceStore((s) => s.panelCentral);
  const setPanelCentral = useWorkspaceStore((s) => s.setPanelCentral);
  const visibles = useWorkspaceStore((s) => s.visibles);
  const setPanelVisible = useWorkspaceStore((s) => s.setPanelVisible);

  return (
    <nav className="v2Nav" aria-label="Navegación principal">
      <div className="v2NavCentral" role="tablist" aria-label="Panel central">
        {CENTRALES.map((c) => (
          <button
            key={c.clave}
            type="button"
            role="tab"
            aria-selected={panelCentral === c.clave}
            className={`v2NavBoton${panelCentral === c.clave ? ' v2NavBoton--activo' : ''}`}
            onClick={() => setPanelCentral(c.clave)}
            title={`Mostrar ${c.etiqueta}`}
          >
            <c.icono size={14} />
            <span>{c.etiqueta}</span>
          </button>
        ))}
      </div>
      <div className="v2NavVisible" role="group" aria-label="Visibilidad de paneles">
        {TOGGLES.map((t) => (
          <button
            key={t.clave}
            type="button"
            className={`v2NavBoton${visibles[t.clave] ? ' v2NavBoton--activo' : ''}`}
            onClick={() => setPanelVisible(t.clave, !visibles[t.clave])}
            aria-pressed={visibles[t.clave]}
            title={`${visibles[t.clave] ? 'Ocultar' : 'Mostrar'} ${t.etiqueta}`}
          >
            <t.icono size={14} />
          </button>
        ))}
      </div>
    </nav>
  );
}
