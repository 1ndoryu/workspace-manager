/* App raiz: cabecera + navegacion entre vistas (Mapa / Lista / AGENTS). */
import { useEffect } from 'react';
import { useWorkspaceStore } from './hooks/useWorkspace.js';
import { IsoMap } from './components/IsoMap/IsoMap.js';
import { ListaProyectos } from './components/ProjectList/ListaProyectos.js';
import { DetalleProyecto } from './components/ProjectDetail/DetalleProyecto.js';
import { Resumen } from './components/Resumen/Resumen.js';
import { AgentsManager } from './components/AgentsManager/AgentsManager.js';
import { Boton } from './components/ui/Boton.js';
import './styles/app.css';

type Vista = 'mapa' | 'lista' | 'agents';

export function App() {
  const cargar = useWorkspaceStore((s) => s.cargar);
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const error = useWorkspaceStore((s) => s.error);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const vista = (useWorkspaceStore((s) => s.vista) ?? 'mapa') as Vista;

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const proyectoSeleccionado = snapshot?.proyectos.find((p) => p.id === seleccionadoId) ?? null;

  return (
    <div className="appContenedor">
      <header className="cabecera">
        <span className="cabeceraTitulo">workspace-manager</span>
        <nav className="cabeceraNav">
          <Boton variante={vista === 'mapa' ? 'primario' : 'secundario'} onClick={() => seleccionarVista('mapa')}>
            Mapa
          </Boton>
          <Boton variante={vista === 'lista' ? 'primario' : 'secundario'} onClick={() => seleccionarVista('lista')}>
            Lista
          </Boton>
          <Boton variante={vista === 'agents' ? 'primario' : 'secundario'} onClick={() => seleccionarVista('agents')}>
            AGENTS
          </Boton>
        </nav>
        <span className="cabeceraEstado">
          {cargando ? 'escaneando…' : snapshot ? `${snapshot.resumen.total} proyectos` : ''}
        </span>
      </header>

      <main className="contenido">
        {error && <div className="error">{error}</div>}
        {!snapshot && cargando && <div className="cargando">Cargando workspace…</div>}
        {!snapshot && !cargando && !error && <div className="cargando">Sin datos. Reintenta.</div>}

        {snapshot && (
          <>
            {vista === 'mapa' && (
              <>
                <Resumen />
                <div style={{ marginTop: 16 }}>
                  <IsoMap />
                </div>
              </>
            )}
            {vista === 'lista' && <ListaProyectos />}
            {vista === 'agents' && <AgentsManager />}
          </>
        )}

        {proyectoSeleccionado && (
          <div style={{ marginTop: 20 }}>
            <DetalleProyecto proyecto={proyectoSeleccionado} />
          </div>
        )}
      </main>
    </div>
  );

  function seleccionarVista(v: Vista) {
    useWorkspaceStore.setState({ vista: v });
    seleccionar(null);
  }
}
