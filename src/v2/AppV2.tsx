/* Shell v2 del workspace-manager.
 * [por que] Front v2 en monocromo estricto (blanco/negro, sin radios, sin
 * sombras, sin bold). Empieza SOLO con el mapa de proyectos; el resto de
 * vistas (lista, agents, detalle) se ira anadiendo en iteraciones. */
import { useEffect } from 'react';
import { useWorkspaceStore } from '../hooks/useWorkspace.js';
import { MapaV2 } from './mapa/MapaV2.js';
import './styles/v2.css';

export function AppV2() {
  const cargar = useWorkspaceStore((s) => s.cargar);
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const error = useWorkspaceStore((s) => s.error);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="v2App">
      <header className="v2Cabecera">
        <span className="v2CabeceraTitulo">workspace-manager</span>
        <span className="v2CabeceraEstado">
          {cargando ? 'escaneando…' : snapshot ? `${snapshot.resumen.total} proyectos` : ''}
        </span>
      </header>

      <main className="v2Contenido">
        {error && <div className="v2Error">{error}</div>}
        {!snapshot && cargando && <div className="v2Cargando">Cargando workspace…</div>}
        {!snapshot && !cargando && !error && <div className="v2Cargando">Sin datos. Reintenta.</div>}
        {snapshot && <MapaV2 />}
      </main>
    </div>
  );
}
