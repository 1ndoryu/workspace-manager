/* Vista de resumen: tarjetas con metricas del area + boton re-escaneo. */
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { Tarjeta } from '../ui/Tarjeta.js';
import { Boton } from '../ui/Boton.js';
import './resumen.css';

export function Resumen() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const cargar = useWorkspaceStore((s) => s.cargar);
  const desdeCache = useWorkspaceStore((s) => s.desdeCache);

  if (!snapshot) return null;
  const r = snapshot.resumen;

  const metricas = [
    { etiqueta: 'Proyectos', valor: r.total },
    { etiqueta: 'Repos', valor: r.repos },
    { etiqueta: 'Worktrees', valor: r.worktrees },
    { etiqueta: 'Carpetas', valor: r.carpetas },
    { etiqueta: 'Dirty', valor: r.dirty },
    { etiqueta: 'Con gate', valor: r.conGate },
    { etiqueta: 'Pendientes roadmap', valor: r.pendientesRoadmap },
  ];

  return (
    <Tarjeta
      titulo="Resumen del área de trabajo"
      accion={
        <Boton onClick={() => cargar(true)} disabled={cargando}>
          {cargando ? 'Escaneando…' : 'Re-escaneo'}
        </Boton>
      }
    >
      <div className="resumenGrid">
        {metricas.map((m) => (
          <div key={m.etiqueta} className="resumenItem">
            <div className="resumenValor">{m.valor}</div>
            <div className="resumenEtiqueta">{m.etiqueta}</div>
          </div>
        ))}
      </div>
      <div className="resumenPie">
        Escaneado: {new Date(snapshot.escaneadoEn).toLocaleString()}
        {desdeCache && <span className="resumenCache"> · desde caché</span>}
      </div>
    </Tarjeta>
  );
}
