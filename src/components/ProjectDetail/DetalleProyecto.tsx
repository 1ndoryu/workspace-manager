/* Detalle de un proyecto: pestañas Git / Gate / Roadmap / AGENTS.
 * [por que] Vista de profundidad; el gate doctor se pide bajo demanda. */
import { useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { Tarjeta } from '../ui/Tarjeta.js';
import { Badge } from '../ui/Badge.js';
import { Boton } from '../ui/Boton.js';
import './detalle.css';

type Pestana = 'git' | 'gate' | 'roadmap' | 'agents';

const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: 'git', etiqueta: 'Git' },
  { id: 'gate', etiqueta: 'Gate' },
  { id: 'roadmap', etiqueta: 'Roadmap' },
  { id: 'agents', etiqueta: 'AGENTS' },
];

function BadgeEstado({ p }: { p: Proyecto }) {
  if (!p.esGit) return <Badge estado="muted">carpeta</Badge>;
  if (p.git?.dirty) return <Badge estado="warn">dirty</Badge>;
  return <Badge estado="ok">limpio</Badge>;
}

export function DetalleProyecto({ proyecto }: { proyecto: Proyecto }) {
  const [pestana, setPestana] = useState<Pestana>('git');
  const [doctor, setDoctor] = useState<string | null>(null);
  const [cargandoDoctor, setCargandoDoctor] = useState(false);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);

  const pedirDoctor = async () => {
    setCargandoDoctor(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/api/proyectos/doctor?id=${encodeURIComponent(proyecto.id)}`, { signal: ctrl.signal });
      const data = await res.json();
      setDoctor(data.doctor ?? 'sin salida');
    } catch {
      setDoctor('no disponible');
    } finally {
      clearTimeout(t);
      setCargandoDoctor(false);
    }
  };

  const git = proyecto.git;
  const gate = proyecto.gate;
  const roadmap = proyecto.roadmap;
  const agents = proyecto.agents;

  return (
    <Tarjeta
      titulo={`${proyecto.id} — ${proyecto.tipo}`}
      accion={
        <>
          <BadgeEstado p={proyecto} />
          <Boton variante="secundario" onClick={() => seleccionar(null)}>
            Cerrar
          </Boton>
        </>
      }
    >
      <div className="detallePestanas">
        {PESTANAS.map((t) => (
          <button
            key={t.id}
            className={`detallePestana ${pestana === t.id ? 'detallePestana--activa' : ''}`}
            onClick={() => setPestana(t.id)}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div className="detalleContenido">
        {pestana === 'git' && (
          <div className="detalleGrilla">
            <div><span className="detalleEtiqueta">Rama</span>{git?.rama ?? '—'}</div>
            <div><span className="detalleEtiqueta">Rama primaria</span>{git?.ramaPrimaria ?? '—'}</div>
            <div><span className="detalleEtiqueta">Remoto</span>{git?.remoto ?? '—'}</div>
            <div><span className="detalleEtiqueta">Dirty</span>{git?.dirty ? 'sí' : 'no'}</div>
            <div><span className="detalleEtiqueta">Ahead</span>{git?.ahead ?? 0}</div>
            <div><span className="detalleEtiqueta">Behind</span>{git?.behind ?? 0}</div>
            {git?.submodulos && git.submodulos.length > 0 && (
              <div className="detalleSubmodulos">
                <span className="detalleEtiqueta">Submódulos</span>
                {git.submodulos.join(', ')}
              </div>
            )}
            {git?.ultimoCommit && (
              <div className="detalleCommit">
                <span className="detalleEtiqueta">Último commit</span>
                <div className="detalleCommitHash">{git.ultimoCommit.hash.slice(0, 10)}</div>
                <div>{git.ultimoCommit.mensaje}</div>
                <div className="detalleCommitFecha">{git.ultimoCommit.fecha}</div>
              </div>
            )}
          </div>
        )}

        {pestana === 'gate' && (
          <div className="detalleGrilla">
            <div><span className="detalleEtiqueta">Declarado</span>{gate?.declarado ? 'sí' : 'no'}</div>
            <div><span className="detalleEtiqueta">Sentinel</span>{gate?.sentinel ?? 'none'}</div>
            <div><span className="detalleEtiqueta">VarSense</span>{gate?.varsense ? 'sí' : 'no'}</div>
            <div><span className="detalleEtiqueta">Puerta</span>{gate?.puerta ?? 'none'}</div>
            <div><span className="detalleEtiqueta">Disponible</span>{gate?.gateDisponible ? 'sí' : 'no'}</div>
            <div className="detalleDoctor">
              <Boton onClick={pedirDoctor} disabled={cargandoDoctor}>
                {cargandoDoctor ? 'Consultando…' : 'Consultar doctor'}
              </Boton>
              {doctor && <pre className="detalleDoctorSalida">{doctor}</pre>}
            </div>
          </div>
        )}

        {pestana === 'roadmap' && (
          <div>
            <div className="detalleGrilla">
              <div><span className="detalleEtiqueta">Pendientes</span>{roadmap?.pendientes ?? 0}</div>
              <div><span className="detalleEtiqueta">Activos</span>{roadmap?.activos ?? 0}</div>
            </div>
            {roadmap?.ids && roadmap.ids.length > 0 && (
              <div className="detalleIds">
                {roadmap.ids.map((id) => (
                  <Badge key={id} estado="info">{id}</Badge>
                ))}
              </div>
            )}
            {roadmap?.resumen && <p className="detalleResumen">{roadmap.resumen}</p>}
          </div>
        )}

        {pestana === 'agents' && (
          <div>
            <div>
              <span className="detalleEtiqueta">AGENTS.md</span>{' '}
              {agents?.tieneAgentsMd ? 'presente' : 'ausente'}
            </div>
            {agents?.reglas && agents.reglas.length > 0 && (
              <div className="detalleIds">
                {agents.reglas.map((r) => (
                  <Badge key={r} estado="muted">{r}</Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
