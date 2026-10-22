/* Diagnostico rapido del escaner con datos reales: muestra el resumen del area,
 * agentes globales y un resumen por proyecto. Uso: npx tsx scripts/diagnostico-escaner.ts */
import { escanearWorkspace } from '../src/server/scanner/workspace.js';
import { RAIZ_AREA, CARPETA_SKILLS } from './shared/rutas.mjs';

const s = escanearWorkspace({
  raiz: RAIZ_AREA,
  carpetaSkills: CARPETA_SKILLS,
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
