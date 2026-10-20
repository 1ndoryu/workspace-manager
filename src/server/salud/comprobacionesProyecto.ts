/* Comprobaciones por proyecto (10AA-2 F8). Funciones puras sobre DatosProyecto: el
 * tablero las muestra en el proyecto y `problemas (N)` las cuenta. Cada una nombra la
 * acción siguiente, no solo el síntoma. */
import type { Hallazgo } from '../../shared/salud/salud.js';
import { SIN_SHIM } from '../guardian/configuracion/politica.js';
import { DIA_MS, esVersionAnterior, lista } from './comprobacionesArea.js';
import { COMPROBACIONES_ROADMAP } from './comprobacionesRoadmap.js';
import type { Comprobacion, DatosProyecto } from './tipos.js';

const DIAS_RAMA_SUELTA = 2;
/* [por que] Versiones de la plantilla de frontend: por debajo, el proyecto va atrasado.
 * Aviso informativo, no error: no bloquea ningún gate. */
const TOOLCHAIN_REFERENCIA = { vite: '8.3.0', typescript: '6.0.0' } as const;

/* [por que] Cada condición pide solo el campo que lee (ISP): así se puede probar con
 * un fragmento y no hace falta armar un DatosProyecto completo. */
const noRust = (d: Pick<DatosProyecto, 'esRust'>): string | null => (d.esRust ? null : 'no es un proyecto Rust');
const sinGuard = (d: Pick<DatosProyecto, 'esElegible'>): string | null =>
  d.esElegible ? null : 'sin Guardián: su puerta no es sentinel';
/* Primera versión numérica del rango declarado ('^6.4.0' → '6.4.0'); null si no hay ninguna (p. ej. 'latest'). */
const minimoDeclarado = (rango: string): string | null => rango.match(/\d+(?:\.\d+)*/)?.[0] ?? null;

export const COMPROBACIONES_PROYECTO: Comprobacion<DatosProyecto>[] = [
  {
    id: 'target-en-arbol',
    evaluar: (d) =>
      d.compilacionEnArbol.length === 0
        ? []
        : [
            {
              id: 'target-en-arbol',
              severidad: 'error',
              mensaje: `compilación dentro del árbol: ${lista(d.compilacionEnArbol)}`,
              /* [por que] Las compilaciones corren en la VPS: la carpeta sale del árbol hacia su target-dir (CM_TARGET_BASE), no hacia el portátil. */
              accion: 'mueve la compilación fuera del árbol (target-dir de la VPS, CM_TARGET_BASE) con los wrappers del proyecto y borra la carpeta',
              doc: 'AGENTS.md',
            },
          ],
  },
  {
    id: 'target-dir',
    omitirSi: noRust,
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      /* [por que] No avisamos por la ausencia de target-dir: en la VPS rcargo.mjs fija CARGO_TARGET_DIR
       * por checkout, y en el portátil la compilación dentro del árbol ya la mide target-en-arbol. */
      if (d.targetDirCompartidoCon.length > 0) {
        hallazgos.push({
          id: 'target-dir',
          severidad: 'aviso',
          mensaje: `target-dir compartido con ${lista(d.targetDirCompartidoCon)}: las compilaciones se pisan`,
          /* [por que] Las compilaciones corren en la VPS: la sugerencia no nombra una ruta del portátil. */
          accion: 'dale a cada checkout su propio target-dir en el equipo que compila (la VPS del taller, con CM_TARGET_BASE)',
        });
      }
      return hallazgos;
    },
  },
  {
    id: 'perfil-dev',
    omitirSi: noRust,
    evaluar: (d) =>
      d.tieneProfileDev
        ? []
        : [
            {
              id: 'perfil-dev',
              severidad: 'aviso',
              mensaje: 'Cargo.toml sin [profile.dev]: la compilación de desarrollo es la completa',
              accion: 'añade un [profile.dev] reducido (referencia: scripts/dev/doctor.mjs)',
            },
          ],
  },
  {
    id: 'incremental',
    omitirSi: noRust,
    evaluar: (d) =>
      d.incrementalDesactivadoEn.length === 0
        ? []
        : [
            {
              id: 'incremental',
              severidad: 'aviso',
              mensaje: `CARGO_INCREMENTAL=0 en ${lista(d.incrementalDesactivadoEn)}: cada compilación parte de cero`,
              accion: 'quita CARGO_INCREMENTAL=0 salvo que una prueba concreta lo necesite',
            },
          ],
  },
  {
    id: 'guard-huecos',
    omitirSi: sinGuard,
    evaluar: (d) => {
      const g = d.guard;
      if (g.estado === 'ausente') {
        return [
          {
            id: 'guard-huecos',
            severidad: 'aviso',
            mensaje: 'sin política del Guardián: los comandos no pasan por el shim',
            accion: 'crea la política desde la pestaña Guardián del tablero',
          },
        ];
      }
      if (g.estado === 'invalida') {
        return [
          {
            id: 'guard-huecos',
            severidad: 'aviso',
            mensaje: `política del Guardián no válida: ${g.motivo}`,
            accion: 'corrige sentinel.config.json desde la pestaña Guardián del tablero',
          },
        ];
      }
      const hallazgos: Hallazgo[] = [];
      if (g.modo !== 'enforce') {
        hallazgos.push({
          id: 'guard-huecos',
          severidad: 'aviso',
          mensaje: `modo ${g.modo}: el Guardián no bloquea`,
          accion: 'pasa el modo a enforce desde la pestaña Guardián',
        });
      }
      if (g.faltanPlantilla.length > 0) {
        hallazgos.push({
          id: 'guard-huecos',
          severidad: 'aviso',
          mensaje: `la plantilla exige y no están: ${lista(g.faltanPlantilla)}`,
          accion: 'añádelos desde la pestaña Guardián (Editar) o revisa la plantilla',
        });
      }
      const sinShim = Object.values(g.listas).flat().filter((v) => (SIN_SHIM as readonly string[]).includes(v));
      if (sinShim.length > 0) {
        hallazgos.push({
          id: 'guard-huecos',
          severidad: 'aviso',
          mensaje: `listados sin shim, no se interceptan: ${lista(sinShim)}`,
          accion: 'quítalos de la política: listarlos no bloquea nada',
        });
      }
      return hallazgos;
    },
  },
  {
    id: 'sentinel-desfasado',
    omitirSi: (d) => {
      // [por que] El runtime de Sentinel es la fuente, no un consumidor: su versión la
      // vigila `sentinel-runtime` (comprobacionesArea), no un lock propio.
      if (d.esRuntimeSentinel) return 'es el runtime de Sentinel: no consume su propio lock';
      if (!d.esElegible) return 'sin Sentinel: su puerta no es sentinel';
      return d.sentinelPin === null ? 'sin versión fijada en quality-tools.json' : null;
    },
    evaluar: (d) => {
      if (d.sentinelLock === d.sentinelPin) return [];
      const enLock = d.sentinelLock ?? 'sin lock';
      return [
        {
          id: 'sentinel-desfasado',
          severidad: 'aviso',
          mensaje: `Sentinel ${enLock} en el proyecto, fijado ${d.sentinelPin}`,
          accion: 'alinea con node scripts/quality/bump.mjs --tool sentinel --write',
          doc: 'AGENTS.md',
        },
      ];
    },
  },
  {
    id: 'ramas-sueltas',
    evaluar: (d) => {
      const limite = d.ahora - DIAS_RAMA_SUELTA * DIA_MS;
      const viejas = d.ramas.filter((r) => r.nombre !== 'main' && r.ultimoCommitMs < limite);
      if (viejas.length === 0) return [];
      return [
        {
          id: 'ramas-sueltas',
          severidad: 'aviso',
          mensaje: `${viejas.length} rama(s) sin integrar de más de ${DIAS_RAMA_SUELTA} días: ${lista(viejas.map((r) => r.nombre))}`,
          accion: 'integra en main (fast-forward o merge) o respáldala con git bundle y bórrala (AGENTS §5)',
          doc: 'AGENTS.md',
        },
      ];
    },
  },
  {
    id: 'instrucciones-prohibidas',
    evaluar: (d) =>
      d.instruccionesProhibidas.length === 0
        ? []
        : [
            {
              id: 'instrucciones-prohibidas',
              severidad: 'error',
              mensaje: `${lista(d.instruccionesProhibidas)} dentro del proyecto: se autocargan y encarecen cada compactación`,
              accion: 'muévelo a Agente/documentacion/ o a README.md y bórralo del proyecto',
              doc: 'AGENTS.md',
            },
          ],
  },
  ...COMPROBACIONES_ROADMAP,
  {
    id: 'toolchain',
    omitirSi: (d) => (d.toolchainFrontend === null ? 'sin frontend/package.json' : null),
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      const tc = d.toolchainFrontend;
      if (tc === null) return hallazgos;
      for (const herramienta of ['vite', 'typescript'] as const) {
        const declarada = tc[herramienta];
        const minimo = declarada === null ? null : minimoDeclarado(declarada);
        const referencia = TOOLCHAIN_REFERENCIA[herramienta];
        if (minimo !== null && esVersionAnterior(minimo, referencia)) {
          hallazgos.push({
            id: 'toolchain',
            severidad: 'info',
            mensaje: `${herramienta} ${declarada} por debajo de la referencia ${referencia}`,
            accion: `sube ${herramienta} a ${referencia} o más en frontend/package.json`,
          });
        }
      }
      return hallazgos;
    },
  },
];
