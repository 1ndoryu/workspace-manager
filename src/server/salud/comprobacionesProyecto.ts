/* Comprobaciones por proyecto (10AA-2 F8). Funciones puras sobre DatosProyecto: el
 * tablero las muestra en el proyecto y `problemas (N)` las cuenta. Cada una nombra la
 * acción siguiente, no solo el síntoma. */
import type { Hallazgo } from '../../shared/salud/salud.js';
import { SIN_SHIM } from '../guardian/configuracion/politica.js';
import { esVersionAnterior } from './comprobacionesArea.js';
import type { Comprobacion, DatosProyecto } from './tipos.js';

const DIA_MS = 86_400_000;
const DIAS_RAMA_SUELTA = 2;
const DIAS_PLAN_INACTIVO = 14;
/* [por que] Versiones de la plantilla de frontend: por debajo, el proyecto va atrasado.
 * Aviso informativo, no error: no bloquea ningún gate. */
const TOOLCHAIN_REFERENCIA = { vite: '8.3.0', typescript: '6.0.0' } as const;

const lista = (valores: string[]): string => valores.join(', ');

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
              accion: 'mueve la compilación a C:\\tmp\\glory-target\\<rama> con los wrappers del proyecto y borra la carpeta',
              doc: 'AGENTS.md',
            },
          ],
  },
  {
    id: 'target-dir',
    omitirSi: noRust,
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      if (d.targetDir === null) {
        hallazgos.push({
          id: 'target-dir',
          severidad: 'aviso',
          mensaje: 'sin target-dir en .cargo/config.toml: compila dentro del árbol',
          accion: 'declara target-dir en .cargo/config.toml o usa scripts/run-cargo.mjs',
        });
      }
      if (d.targetDirCompartidoCon.length > 0) {
        hallazgos.push({
          id: 'target-dir',
          severidad: 'aviso',
          mensaje: `target-dir compartido con ${lista(d.targetDirCompartidoCon)}: las compilaciones se pisan`,
          accion: 'dale a cada rama o proyecto su propio target-dir bajo C:\\tmp\\glory-target',
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
        }
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
