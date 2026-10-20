/* Esquema de `varsense.config.json`.
 * [por que] No hay binario/schema de varsense instalado en el sistema
 * (verificado: ausente en AppData/Local, a diferencia de sentinel). La unica
 * fuente fiable son los `varsense.config.json` REALES de tres proyectos del area.
 * Este esquema se cura de ellos:
 *   - nucleo (presente en los 3)          -> 'requerida'
 *   - recomendadas (presente en 2 de 3)   -> 'recomendada'
 *   - extensiones nuevas / opcionales     -> 'opcional'
 * Excepcion: `hardcodedDetection.allowedValues` es 'opcional' aunque el
 * nucleo sea requerido —el runtime la suple con su default interno
 * (`buildAnalysisConfig`: `allowedValues ?? DEFAULT_ALLOWED_VALUES` en
 * varsense/src/core/config.ts), asi que exigirla marcaba error en proyectos
 * sanos (proyecto-ejemplo 2026-09-28). La severidad cuando falta una opcion sigue la
 * misma convencion que sentinel:
 * requerida->error, recomendada->advertencia, opcional->silencio en la consola. */
import type { NodoEsquema, Necesidad, OpcionValor } from '../modelo/esquema.js';

const SEVERIDADES_VAR = ['error', 'warning', 'information', 'hint'] as const;

const bool = (def: boolean, necesidad?: Necesidad): OpcionValor => ({ tipo: 'boolean', default: def, necesidad });
const num = (v: number, necesidad?: Necesidad): OpcionValor => ({ tipo: 'number', default: v, necesidad });
const strArr = (necesidad?: Necesidad): NodoEsquema => ({ tipo: 'stringArray', necesidad });
const enumX = (def: string, necesidad?: Necesidad): OpcionValor => ({
  tipo: 'enum',
  // @ts-expect-error —— SEVERIDADES_VAR es readonly; OpcionValor.valores es string[]
  valores: SEVERIDADES_VAR,
  default: def,
  necesidad,
});
const severidadObj = (necesidad: Necesidad): NodoEsquema => ({
  objeto: {
    enabled: bool(true, necesidad),
    severity: enumX('warning', necesidad),
  },
  necesidad,
});

/* [por que] Las dos reglas de tokens aceptan `excludeTokens` (varsense,
 * `core/config.ts`): la lista de alias deliberados del design system. Se
 * declara una sola vez porque si el catálogo se queda corto, el tablero marca
 * la clave como desconocida y convierte en error una config válida —que es
 * justo lo que pasó con `duplicate` en proyecto-ejemplo. */
const reglaTokens = (necesidad: Necesidad): NodoEsquema => ({
  objeto: {
    enabled: bool(true, necesidad),
    severity: enumX('warning', necesidad),
    excludeTokens: strArr(necesidad),
  },
  necesidad,
});

let _esquema: NodoEsquema | null = null;

export function ESQUEMA_VARSENSE(): NodoEsquema {
  if (_esquema) return _esquema;

  const contenido: Record<string, NodoEsquema> = {
    /* nucleo (presente en los 3 reales): variableFiles, patterns, scanAllFiles,
     * hardcodedDetection. */
    variableFiles: strArr('requerida'),
    includePatterns: strArr('requerida'),
    excludePatterns: strArr('requerida'),
    scanAllFiles: bool(false, 'requerida'),
    hardcodedDetection: {
      objeto: {
        enabled: bool(true, 'requerida'),
        severity: enumX('warning', 'requerida'),
        properties: { mapa: bool(false), necesidad: 'opcional' },
        allowedValues: strArr('opcional'),
      },
      necesidad: 'requerida',
    },
    /* recomendadas (presente en 2 de 3 reales). */
    inlineDetection: severidadObj('recomendada'),
    tokenDetection: {
      objeto: {
        /* [por que] `excludeTokens` lo acepta varsense (`core/config.ts`) en las
         * dos reglas; sin declararlo el tablero marcaba error "clave
         * desconocida" en proyecto-ejemplo (unused) y en proyecto-ejemplo
         * (duplicate). */
        duplicate: reglaTokens('opcional'),
        unused: reglaTokens('opcional'),
        crossFile: severidadObj('opcional'),
      },
      necesidad: 'recomendada',
    },
    bannedProperties: {
      objeto: {
        enabled: bool(true, 'opcional'),
        severity: enumX('warning', 'opcional'),
        properties: strArr('opcional'),
      },
      necesidad: 'recomendada',
    },
    orphanClassDetection: {
      objeto: {
        minClassLength: num(3, 'opcional'),
        excludeClassPatterns: strArr('opcional'),
      },
      necesidad: 'recomendada',
    },
  };

  _esquema = { objeto: contenido };
  return _esquema;
}