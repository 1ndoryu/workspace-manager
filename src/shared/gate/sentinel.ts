/* Esquema canonico de `sentinel.config.json`.
 * [por que] La fuente de verdad es el runtime de sentinel v0.7.4
 * (`out/core/config.d.ts` -> `SentinelConfigFile`), no una lista inventada.
 * Cada opcion aqui sale del esquema real. `analyzerSubConfig`/`config` es
 * recursivo (el mismo tipo anidado), por eso `config` apunta al propio esquema
 * y ademas permite venir como string (ruta a otro archivo de config).
 * `necesidad` (requerida/recomendada/opcional) marca la severidad en la consola
 * cuando una opcion FALTA: requerida->error, recomendada->advertencia,
 * opcional->silencio. Vive en shared/gate para que server y editor coincidan. */
import type { NodoEsquema, NodoObjeto, Necesidad, OpcionValor } from './esquema.js';
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
    includePatterns: strArr('archivos que el analizador considera', 'recomendada'),
    excludePatterns: strArr('archivos excluidos del análisis', 'recomendada'),
    directoryExceptions: strArr('directorios exentos', 'recomendada'),
    rules: { mapaCatalogo: REGLA, catalogo: CATALOGO_REGLAS, necesidad: 'recomendada' },
    portableBoundaries: {
      objeto: {
        dom: strArr(undefined, 'opcional'),
        window: strArr(undefined, 'opcional'),
        services: strArr(undefined, 'opcional'),
        loggerModules: strArr(undefined, 'opcional'),
      },
      necesidad: 'recomendada',
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