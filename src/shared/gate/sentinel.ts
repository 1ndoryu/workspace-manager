/* Esquema canonico de `sentinel.config.json`.
 * [por que] La fuente de verdad es el runtime de sentinel v0.7.4
 * (`out/core/config.d.ts` -> `SentinelConfigFile`), no una lista inventada.
 * Cada opcion aqui sale del esquema real. `analyzerSubConfig`/`config` es
 * recursivo (el mismo tipo anidado), por eso `config` apunta al propio esquema
 * y ademas permite venir como string (ruta a otro archivo de config).
 * `necesidad` (requerida/recomendada/opcional) marca la severidad en la consola
 * cuando una opcion FALTA: requerida->error, recomendada->advertencia,
 * opcional->silencio. Vive en shared/gate para que server y editor coincidan. */
import type { Alternativas, NodoEsquema, NodoObjeto, Necesidad, OpcionValor } from './esquema.js';
import { CATALOGO_REGLAS } from './reglas.js';

const strArr = (d?: string, necesidad?: Necesidad): NodoEsquema => ({ tipo: 'stringArray', descripcion: d, necesidad });
const num = (v: number, necesidad?: Necesidad, descripcion?: string): OpcionValor => ({ tipo: 'number', default: v, necesidad, descripcion });
const text = (def: string, necesidad?: Necesidad, descripcion?: string): OpcionValor => ({ tipo: 'string', default: def, necesidad, descripcion });
const bool = (def: boolean, necesidad?: Necesidad): OpcionValor => ({ tipo: 'boolean', default: def, necesidad });
const enumX = (valores: string[], def: string, necesidad?: Necesidad): OpcionValor => ({ tipo: 'enum', valores, default: def, necesidad });

/* ConfigUsuario de una regla (ruleRegistry): habilitada + severidad. */
const REGLA: NodoEsquema = {
  objeto: {
    habilitada: bool(true),
    severidad: enumX(['error', 'warning', 'information', 'hint'], 'error'),
  },
};

let _esquema: NodoEsquema | null = null;

export function ESQUEMA_SENTINEL(): NodoEsquema {
  if (_esquema) return _esquema;

/* Ubicacion alternativa valida: el runtime acepta los patterns/rules/runtime
 * tambien dentro de `analyzers.<nombre>.config` (Glory-Laminal y otros los
 * ponen ahi). `'*'` comodina el nombre del analizador. [por que] Sin esto el
 * diagnostico marcaria "falta" una opcion que el proyecto ya tiene en su
 * config de analizador (falso positivo en la consola). */
const EN_CONFIG_ANALIZADOR: Alternativas = [['analyzers', '*', 'config']];

/* Nodo de config: recursivo y `| string`. */
  const config: NodoObjeto = { objeto: {}, permitirString: true };

  const contenido: Record<string, NodoEsquema> = {
    /* Obligatorias a nivel raiz: el contrato minimo del gate. */
    schemaVersion: num(2, 'requerida'),
    mode: text('advisory', 'requerida'),
    project: { objeto: { primaryBranch: text('main', 'requerida') } },
    /* Patterns: el runtime los acepta en raiz O dentro de analyzers…config
     * (Glory-Laminal los pone anidados); por eso solo 'recomendada': faltar en
     * la raiz no es un error si estan en el sub-config. */
    includePatterns: { ...strArr('archivos que el analizador considera', 'recomendada'), alternativas: EN_CONFIG_ANALIZADOR },
    excludePatterns: { ...strArr('archivos excluidos del análisis', 'recomendada'), alternativas: EN_CONFIG_ANALIZADOR },
    directoryExceptions: { ...strArr('directorios exentos', 'recomendada'), alternativas: EN_CONFIG_ANALIZADOR },
    rules: { mapaCatalogo: REGLA, catalogo: CATALOGO_REGLAS, necesidad: 'recomendada', alternativas: EN_CONFIG_ANALIZADOR },
    portableBoundaries: {
      objeto: {
        dom: strArr(undefined, 'opcional'),
        window: strArr(undefined, 'opcional'),
        services: strArr(undefined, 'opcional'),
        loggerModules: strArr(undefined, 'opcional'),
      },
      necesidad: 'recomendada',
      alternativas: EN_CONFIG_ANALIZADOR,
    },
    gate: {
      objeto: {
        command: strArr('comandos permitidos en el gate'),
        taskIdRequired: bool(false),
      },
    },
    guard: { objeto: { directCommands: { mapa: strArr(), necesidad: 'opcional' } }, necesidad: 'recomendada' },
    runtime: {
      objeto: {
        minimumVersion: text('', 'recomendada', 'versión mínima de sentinel'),
        protocolVersion: { tipo: 'number', default: 0, necesidad: 'recomendada', descripcion: 'versión del protocolo del lock' },
        lockFile: text('', 'recomendada', 'nombre del lock file'),
      },
      necesidad: 'recomendada',
      alternativas: EN_CONFIG_ANALIZADOR,
    },
    /* analyzers es un MAPA de analizadores (sentinel, varsense, php, sql...).
     * [por que] Si se modela como objeto cerrado con solo 'sentinel', analizadores
     * reales (p.ej. varsense) caen como clave desconocida -> falso error en la
     * consola. Como mapa se enumeran los presentes y se validan contra la misma
     * forma (enabled/profile/config). */
    analyzers: {
      mapa: {
        objeto: {
          enabled: bool(true, 'recomendada'),
          profile: text('', 'opcional'),
          config,
        },
      },
      necesidad: 'recomendada',
    },
  };

  /* Cierra la recursión: `config` apunta al propio esquema sentinel. */
  config.objeto = contenido;
  _esquema = { objeto: contenido };
  return _esquema;
}