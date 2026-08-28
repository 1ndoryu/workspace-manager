/* Gestion de AGENTS.md y skills globales.
 * [por que] El manager gestiona AGENTS.md (global + por proyecto) y las skills
 * de ~/.agents/skills: vista de lectura + estado, apertura via VS Code. */
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { Tarjeta } from '../ui/Tarjeta.js';
import { Badge } from '../ui/Badge.js';
import './agents.css';

export function AgentsManager() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const agentes = snapshot?.agentes;

  if (!agentes) return null;

  const proyectosConAgents = (snapshot?.proyectos ?? []).filter((p) => p.agents?.tieneAgentsMd);
  const proyectosSinAgents = (snapshot?.proyectos ?? []).filter((p) => p.esGit && !p.agents?.tieneAgentsMd);

  return (
    <div className="agentsContenedor">
      <Tarjeta titulo="AGENTS.md global">
        <div className="agentsFila">
          <span>Estado:</span>{' '}
          <Badge estado={agentes.global.tieneAgentsMd ? 'ok' : 'danger'}>
            {agentes.global.tieneAgentsMd ? 'presente' : 'ausente'}
          </Badge>
          {agentes.global.ruta && <code className="agentsRuta">{agentes.global.ruta}</code>}
        </div>
        {agentes.global.reglas.length > 0 && (
          <div className="agentsChips">
            {agentes.global.reglas.map((r) => (
              <Badge key={r} estado="info">{r}</Badge>
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo="AGENTS.md por proyecto">
        <div className="agentsColumnas">
          <div>
            <h3 className="agentsSubTitulo">Con AGENTS.md ({proyectosConAgents.length})</h3>
            <ul className="agentsLista">
              {proyectosConAgents.map((p) => (
                <li key={p.id}>
                  <code>{p.id}</code>
                  <span className="agentsReglas">{p.agents?.reglas.length ?? 0} reglas</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="agentsSubTitulo">Sin AGENTS.md ({proyectosSinAgents.length})</h3>
            <ul className="agentsLista">
              {proyectosSinAgents.map((p) => (
                <li key={p.id}>
                  <code>{p.id}</code>
                  <Badge estado="warn">falta</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Skills globales (${agentes.skills.length})`}>
        <ul className="agentsLista skills">
          {agentes.skills.map((s) => (
            <li key={s.nombre} className="agentsSkill">
              <code>{s.nombre}</code>
              <span className="agentsSkillDesc">{s.descripcion}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </div>
  );
}
