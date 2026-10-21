/* Composición de las fuentes con lo que ya corre en el servidor (20AA-25 N2).
 * [por que aquí y no en `index.ts`] El entry compone y arranca; esto es la fontanería de las
 * fuentes —qué función del servidor sirve cada dato— y conviene leerla de un vistazo. Cada fuente
 * llama a la FUNCIÓN que responde la ruta, nunca a la ruta por HTTP: una petición a sí mismo
 * costaría la vuelta de red y el token, y además el servidor escucharía en un puerto que la app
 * de escritorio elige al azar.
 * [por que ninguna abre conexiones] Tareas sale del snapshot ya cacheado, problemas de la consola
 * ya agregada, sitios de la caché de 20 s de producción y taller de la de 5 s de pulse. Una pasada
 * con todo igual no añade ni una lectura de disco ni un SSH: es diff en memoria. */
import type { Fuente } from '../../shared/notificaciones/tipos.js';
import type { Proyecto } from '../../shared/tipos/proyecto.js';
import { snapshotArea } from '../snapshot.js';
import { recogerFuentes, agruparProblemas } from '../rutas/rutasConsola.js';
import { leerSitios } from '../vps/rutas/rutasVps.js';
import { agenteTaller } from '../taller/agenteTaller.js';
import { proyectosDelTaller } from '../taller/proyectosTaller.js';
import { leerRegistroOpcional } from '../registro.js';
import { fuenteTareas } from './fuentes/tareas.js';
import { fuenteProblemas } from './fuentes/problemas.js';
import { fuenteSitios, fuenteTaller } from './fuentes/servicios.js';

/* Las cuatro fuentes del plan, en el orden en que se enseñan los grupos de la campana. */
export function fuentesReales(): Fuente[] {
  return [
    fuenteTareas(leerProyectosDelSnapshot),
    fuenteProblemas(leerGruposDeProblemas),
    fuenteSitios(leerSitios),
    fuenteTaller(leerTaller),
  ];
}

async function leerProyectosDelSnapshot(): Promise<Proyecto[]> {
  /* `false`: la caché del escáner. Forzar aquí volvería a recorrer el área entera por cada pasada
   * de avisos, que es justo lo que el tablero hace al refrescar. */
  const { snapshot } = await snapshotArea(false);
  return snapshot.proyectos;
}

async function leerGruposDeProblemas() {
  /* La misma agregación que responde `/api/consola/problemas`, sin forzar nada: análisis,
   * auditoría, salud y taller salen de sus cachés. */
  const fuentes = await recogerFuentes(false, false);
  return agruparProblemas(fuentes);
}

async function leerTaller() {
  const agente = agenteTaller();
  if (!agente) {
    return { disponible: false, contenedores: [], proyectos: [], error: 'sin-configurar' };
  }
  const proyectos = proyectosDelTaller(leerRegistroOpcional());
  const r = await agente.snapshot();
  return {
    disponible: r.disponible,
    contenedores: r.snapshot?.contenedores ?? [],
    proyectos,
    error: r.error,
  };
}
