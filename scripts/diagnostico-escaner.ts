/* Diagnostico rapido del escaner con datos reales: muestra el resumen del area,
 * agentes globales y un resumen por proyecto. Uso: pnpm exec tsx scripts/diagnostico-escaner.ts */
import { escanearWorkspace } from '../src/server/scanner/workspace.js';

const s = escanearWorkspace({
  raiz: process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo',
  carpetaSkills: process.env.WS_SKILLS_ROOT || 'C:/Users/Owner/.agents/skills',
});

console.log(
  JSON.stringify(
    {
      resumen: s.resumen,
      agentes: { global: s.agentes.global, skills: s.agentes.skills.length },
      proyectos: s.proyectos.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        rama: p.git?.rama,
        dirty: p.git?.dirty,
        gate: p.gate?.declarado,
        pend: p.roadmap?.pendientes,
        agents: p.agents?.tieneAgentsMd,
      })),
    },
    null,
    2,
  ),
);
