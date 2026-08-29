/* Esquema canonico de `sentinel.config.json`.
 * [por que] La fuente de verdad es el runtime de sentinel v0.7.4
 * (`out/core/config.d.ts` -> `SentinelConfigFile`), no una lista inventada.
 * Cada opcion aqui sale del esquema real. `analyzerSubConfig`/`config` es
 * recursivo (el mismo tipo anidado), por eso `config` apunta al propio esquema
 * y ademas permite venir como string (ruta a otro archivo de config). */
import type { NodoEsquema, NodoObjeto, OpcionValor } from './types.js';
import { CATALOGO_REGLAS } from './reglas.js';

const strArr = (d?: string): NodoEsquema => ({ tipo: 'stringArray', descripcion: d });
const bool = (def: boolean): OpcionValor => ({ tipo: 'boolean', default: def });

/* ConfigUsuario de una regla (ruleRegistry): habilitada + severidad. */
const REGLA: NodoEsquema = {
  objeto: {
    habilitada: bool(true),
    severidad: { tipo: 'enum', valores: ['error', 'warning', 'information', 'hint'], default: 'error' },
  },
};

let _esquema: NodoEsquema | null = null;

export function ESQUEMA_SENTINEL(): NodoEsquema {
  if (_esquema) return _esquema;

  /* Nodo de config: recursivo y `| string`. */
  const config: NodoObjeto = { objeto: {}, permitirString: true };

  const contenido: Record<string, NodoEsquema> = {
    schemaVersion: { tipo: 'number', default: 2 },
    mode: { tipo: 'string', default: 'advisory' },
    project: { objeto: { primaryBranch: { tipo: 'string', default: 'main' } } },
    includePatterns: strArr('archivos que el analizador considera'),
    excludePatterns: strArr('archivos excluidos del análisis'),
    directoryExceptions: strArr('directorios exentos'),
    rules: { mapaCatalogo: REGLA, catalogo: CATALOGO_REGLAS },
    portableBoundaries: {
      objeto: {
        dom: strArr(),
        window: strArr(),
        services: strArr(),
        loggerModules: strArr(),
      },
    },
    gate: {
      objeto: {
        command: strArr('comandos permitidos en el gate'),
        taskIdRequired: bool(false),
      },
    },
    guard: { objeto: { directCommands: { mapa: strArr() } } },
    runtime: {
      objeto: {
        minimumVersion: { tipo: 'string', descripcion: 'versión mínima de sentinel' },
        protocolVersion: { tipo: 'number', descripcion: 'versión del protocolo del lock' },
        lockFile: { tipo: 'string', descripcion: 'nombre del lock file' },
      },
    },
    analyzers: {
      objeto: {
        sentinel: {
          objeto: {
            enabled: bool(true),
            profile: { tipo: 'string' },
            config,
          },
        },
      },
    },
  };

  /* Cierra la recursión: `config` apunta al propio esquema sentinel. */
  config.objeto = contenido;
  _esquema = { objeto: contenido };
  return _esquema;
}