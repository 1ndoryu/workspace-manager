/* Comprobaciones del área y del entorno (10AA-2 F8): cruzan proyectos o miran la
 * máquina (disco, variables, runtime global). Funciones puras sobre DatosArea. */
import type { Hallazgo } from '../../shared/salud/salud.js';
import type { Comprobacion, DatosArea } from './tipos.js';

const GB = 1024 ** 3;
const DISCO_MINIMO_GB = 15;
const TMP_MAXIMO_GB = 20;
/* [por que] 19 KB: por encima de ese tamaño AGENTS.md se carga entero en cada sesión
 * y en cada compactación (F3). */
const AGENTS_MAXIMO_BYTES = 19 * 1024;

const lista = (valores: string[]): string => valores.join(', ');

/* Versiones x.y.z; sin partes no numéricas, se comparan como cadena. */
export function esVersionAnterior(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return a < b;
    if (x !== y) return x < y;
  }
  return false;
}

export const COMPROBACIONES_AREA: Comprobacion<DatosArea>[] = [
  {
    id: 'sin-mando',
    evaluar: (d) => {
      const sinRegistrar = d.carpetasGit.filter((id) => !d.registradas.includes(id));
      if (sinRegistrar.length === 0) return [];
      return [
        {
          id: 'sin-mando',
          severidad: 'aviso',
          mensaje: `${sinRegistrar.length} repo(s) sin registrar: ${lista(sinRegistrar)}`,
          accion: 'decláralos en registro.json: como proyecto, o en noAplica con sin-mando-intencional si es a propósito',
          doc: 'workspace-manager/config/registro.json',
        },
      ];
    },
  },
  {
    id: 'disco-c',
    omitirSi: (d) => (d.discoLibreGb === null ? 'no se pudo medir C:' : null),
    evaluar: (d) => {
      if (d.discoLibreGb === null || d.discoLibreGb >= DISCO_MINIMO_GB) return [];
      return [
        {
          id: 'disco-c',
          severidad: 'error',
          mensaje: `C: con ${d.discoLibreGb.toFixed(1)} GB libres (mínimo ${DISCO_MINIMO_GB})`,
          accion: 'borra targets sin uso en C:\\tmp\\glory-target\\<rama> y archiva descargas',
          doc: 'AGENTS.md',
        },
      ];
    },
  },
  {
    id: 'tmp-tamano',
    omitirSi: (d) => (d.tmp === null ? 'C:\\tmp no existe' : null),
    evaluar: (d) => {
      if (!d.tmp) return [];
      const gb = d.tmp.bytes / GB;
      if (gb > TMP_MAXIMO_GB) {
        return [
          {
            id: 'tmp-tamano',
            severidad: 'aviso',
            mensaje: `C:\\tmp ocupa ${gb.toFixed(1)} GB (máximo ${TMP_MAXIMO_GB})`,
            accion: 'borra targets sin uso (GloryTmpSweep purga los de más de 12 h)',
            doc: 'AGENTS.md',
          },
        ];
      }
      if (d.tmp.parcial) {
        return [
          {
            id: 'tmp-tamano',
            severidad: 'info',
            mensaje: `medición parcial de C:\\tmp: ${gb.toFixed(1)} GB hasta el tope de tiempo`,
            accion: 'nada: el tamaño real puede ser mayor; repite con forzar=1 si importa',
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'incremental-usuario',
    evaluar: (d) =>
      d.incrementalUsuario === '0'
        ? [
            {
              id: 'incremental-usuario',
              severidad: 'aviso',
              mensaje: 'CARGO_INCREMENTAL=0 en el entorno de este proceso: todas las compilaciones parten de cero',
              accion: 'quítala de las variables de usuario o de sistema de Windows y reinicia la sesión; si la hereda del proceso que lanzó el tablero, reábrelo desde una sesión limpia',
            },
          ]
        : [],
  },
  {
    id: 'sentinel-runtime',
    omitirSi: (d) => (d.sentinelPin === null ? 'sin versión fijada en quality-tools.json' : null),
    evaluar: (d) => {
      if (d.sentinelRuntime === null) {
        return [
          {
            id: 'sentinel-runtime',
            severidad: 'aviso',
            mensaje: 'runtime global de Sentinel no encontrado en AppData\\Local\\GlorySentinel\\current.json',
            accion: 'instala la versión fijada con scripts/quality/bump.mjs',
            doc: 'AGENTS.md',
          },
        ];
      }
      if (!esVersionAnterior(d.sentinelRuntime, d.sentinelPin as string)) return [];
      return [
        {
          id: 'sentinel-runtime',
          severidad: 'aviso',
          mensaje: `runtime de Sentinel ${d.sentinelRuntime} < fijada ${d.sentinelPin}`,
          accion: 'actualiza el runtime global a la versión fijada',
          doc: 'AGENTS.md',
        },
      ];
    },
  },
  {
    id: 'instrucciones-infladas',
    omitirSi: (d) => (d.agentsBytes === null ? 'sin AGENTS.md en el área' : null),
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      if ((d.agentsBytes as number) > AGENTS_MAXIMO_BYTES) {
        hallazgos.push({
          id: 'instrucciones-infladas',
          severidad: 'aviso',
          mensaje: `AGENTS.md ocupa ${((d.agentsBytes as number) / 1024).toFixed(1)} KB (máximo 19 KB)`,
          accion: 'mueve el detalle a Agente/documentacion/ y deja en AGENTS.md solo las reglas',
          doc: 'AGENTS.md',
        });
      }
      const duplicadas = d.titulosAgents.filter((t) => d.titulosClaudeMd.includes(t));
      if (duplicadas.length > 0) {
        hallazgos.push({
          id: 'instrucciones-infladas',
          severidad: 'aviso',
          mensaje: `secciones duplicadas con ~/.claude/CLAUDE.md: ${lista(duplicadas)}`,
          accion: 'deja cada regla en una sola fuente y enlázala desde la otra',
          doc: 'AGENTS.md',
        });
      }
      return hallazgos;
    },
  },
  {
    id: 'skill-desfasada',
    omitirSi: (d) => (d.subcomandosArranque.length === 0 ? 'no se pudo leer el mando Arranque' : null),
    evaluar: (d) => {
      const hallazgos: Hallazgo[] = [];
      if (d.skillArranque !== null) {
        const skill = d.skillArranque;
        const sinDocumentar = d.subcomandosArranque.filter((c) => !skill.includes(`Arranque ${c}`));
        if (sinDocumentar.length > 0) {
          hallazgos.push({
            id: 'skill-desfasada',
            severidad: 'aviso',
            mensaje: `skill workspace-manager no documenta: ${lista(sinDocumentar)}`,
            accion: 'añade cada subcomando (Arranque <subcomando>) a ~/.agents/skills/workspace-manager/SKILL.md',
            doc: 'workspace-manager/scripts/dev/dev.mjs',
          });
        }
      }
      for (const copia of d.copiasSkill.filter((c) => !c.coincide)) {
        hallazgos.push({
          id: 'skill-desfasada',
          severidad: 'aviso',
          mensaje: `copia de skill desfasada: ${copia.nombre}`,
          accion: 'sincroniza desde ~/.agents/skills (AGENTS §10); no se corrige sola',
          doc: 'AGENTS.md',
        });
      }
      return hallazgos;
    },
  },
];
