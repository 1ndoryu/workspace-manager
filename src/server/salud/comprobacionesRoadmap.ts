/* Comprobaciones del roadmap y de los planes (protocolo D8). Funciones puras sobre
 * DatosProyecto: el tablero las muestra en el proyecto y `problemas (N)` las cuenta.
 * [por que] Separadas de comprobacionesProyecto.ts para mantener cada archivo bajo el
 * límite de líneas del gate. */
import type { Hallazgo } from '../../shared/salud/salud.js';
import { TOPE_LINEAS_ROADMAP, TOPE_TAREAS } from '../scanner/roadmap/roadmap.js';
import type { Comprobacion, DatosProyecto } from './tipos.js';
import { DIA_MS, lista } from './comprobacionesArea.js';

const DIAS_PLAN_INACTIVO = 14;

/* El roadmap cita planes con la ruta desde la raíz (`Agente/planes/x.md`) y el lector da la
 * relativa a `Agente/planes/`: se compara por el nombre del fichero, que es único en la carpeta
 * y tolera que un plan viva en una subcarpeta. */
function declarado(d: DatosProyecto, archivo: string): boolean {
  return d.roadmap.planes.some((r) => r === archivo || r.endsWith(`/${archivo}`) || archivo.endsWith(`/${r}`));
}

export const COMPROBACIONES_ROADMAP: Comprobacion<DatosProyecto>[] = [
  {
    /* Forma del roadmap segun el protocolo (D8 de AGENTS-detalle.md). [por que] El tablero
     * solo ve trabajo abierto si las tareas tienen la forma canonica: sin esta comprobacion,
     * un roadmap con las tareas en negrita o en tabla parecia vacio. */
    id: 'roadmap-protocolo',
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      const accion = 'escríbelas como «- [ ] `ID` — **Título.**» (D8 de AGENTS-detalle.md)';
      if (d.roadmap.lineas === 0) {
        return [
          {
            id: 'roadmap-protocolo',
            severidad: 'aviso',
            mensaje: 'sin roadmap.md: el trabajo abierto del proyecto no se ve',
            accion: 'créalo con las secciones fijas (D8 de AGENTS-detalle.md)',
          },
        ];
      }
      /* [por que] Se agrupa por motivo: un roadmap sin migrar tiene decenas de lineas fuera
       * de forma y una entrada por linea inundaria la consola. */
      const porMotivo = new Map<string, number[]>();
      for (const pr of d.roadmap.problemas) {
        porMotivo.set(pr.motivo, [...(porMotivo.get(pr.motivo) ?? []), pr.linea]);
      }
      for (const [motivo, lineas] of porMotivo) {
        const sitios = lineas
          .slice(0, 5)
          .map((n) => `roadmap.md:${n}`)
          .join(', ');
        hallazgos.push({
          id: 'roadmap-protocolo',
          severidad: 'aviso',
          mensaje: `${lineas.length} ${motivo}: ${sitios}${lineas.length > 5 ? ' …' : ''}`,
          accion,
        });
      }
      /* [por que 20AA-10] El tope recorta la lista de tareas que llega al tablero y lo hacia sin
       * decirlo: un pendiente de mas no aparecia en la consola ni en TASK y nadie se enteraba. */
      if (d.roadmap.tareas.length > TOPE_TAREAS) {
        hallazgos.push({
          id: 'roadmap-protocolo',
          severidad: 'aviso',
          mensaje: `roadmap.md con ${d.roadmap.tareas.length} pendientes: el tablero solo ve los ${TOPE_TAREAS} primeros`,
          accion: 'cierra o archiva trabajo abierto: el tope son 60 pendientes (D8 de AGENTS-detalle.md)',
        });
      }
      if (d.roadmap.lineas > TOPE_LINEAS_ROADMAP) {
        hallazgos.push({
          id: 'roadmap-protocolo',
          severidad: 'aviso',
          mensaje: `roadmap.md con ${d.roadmap.lineas} líneas (tope ${TOPE_LINEAS_ROADMAP}): demasiado abierto`,
          accion: 'archiva lo cerrado en Agente/completados/roadmap-historico-YYYY-MM-DD.md',
        });
      }
      if (d.roadmap.faltantes.length > 0) {
        hallazgos.push({
          id: 'roadmap-protocolo',
          severidad: 'aviso',
          mensaje: `roadmap.md sin las secciones: ${lista(d.roadmap.faltantes)}`,
          accion: 'añádelas en su orden (D8: siguiente bloque, pendientes, bloqueos, planes activos)',
        });
      }
      if (d.roadmap.noCanonicas.length > 0) {
        hallazgos.push({
          id: 'roadmap-protocolo',
          severidad: 'aviso',
          mensaje: `roadmap.md con secciones fuera del protocolo: ${lista(d.roadmap.noCanonicas.slice(0, 4))}`,
          accion: 'deja solo las secciones fijas; lo cerrado va a Agente/completados/',
        });
      }
      return hallazgos;
    },
  },
  {
    id: 'planes-y-roadmap',
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      const limite = d.ahora - DIAS_PLAN_INACTIVO * DIA_MS;
      /* [por que] Solo se avisa del plan sin casillas abiertas: con trabajo pendiente (p. ej.
       * esperando una decisión externa) está activo, y «ciérralo» sería un consejo falso. */
      for (const plan of d.planesActivos) {
        if (plan.abiertas === 0 && plan.modificadoMs < limite) {
          const dias = Math.floor((d.ahora - plan.modificadoMs) / DIA_MS);
          hallazgos.push({
            id: 'planes-y-roadmap',
            severidad: 'info',
            mensaje: `plan ${plan.archivo} sin casillas abiertas y sin cambios hace ${dias} días`,
            accion: 'ciérralo (planes/completados/) si está terminado',
          });
        } else if (plan.abiertas > 0 && !declarado(d, plan.archivo)) {
          /* Trabajo en vuelo que el roadmap no declara: invisible desde la cola. */
          hallazgos.push({
            id: 'planes-y-roadmap',
            severidad: 'info',
            mensaje: `plan ${plan.archivo} con trabajo abierto y sin declarar en «Planes activos»`,
            accion: 'decláralo en la sección «Planes activos» del roadmap o ciérralo si terminó',
          });
        }
      }
      /* [por que] El plan existe por su ubicación, no por su línea en el MD: una ruta declarada
       * que ya no está en disco es un enlace muerto en la cola de trabajo (pasó el 2026-10-23). */
      for (const ruta of d.roadmap.planes) {
        const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
        if (d.planesActivos.some((p) => p.archivo === nombre || p.archivo.endsWith(`/${nombre}`))) continue;
        hallazgos.push({
          id: 'planes-y-roadmap',
          severidad: 'aviso',
          mensaje: `el roadmap declara un plan que no está en Agente/planes/: ${ruta}`,
          accion: 'corrige la ruta o quita la línea de «Planes activos»',
        });
      }
      if (d.enlacesRotos.length > 0) {
        hallazgos.push({
          id: 'planes-y-roadmap',
          severidad: 'info',
          mensaje: `enlace roto en roadmap.md: ${lista(d.enlacesRotos)}`,
          accion: 'corrige la ruta o quita el enlace',
        });
      }
      return hallazgos;
    },
  },
];
