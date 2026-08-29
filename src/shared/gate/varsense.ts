/* Esquema de `varsense.config.json`.
 * [por que] No hay binario/schema de varsense instalado en el sistema
 * (verificado: ausente en AppData/Local, a diferencia de sentinel). La unica
 * fuente fiable son los 3 `varsense.config.json` REALES del area (PROYECTO
 * TASKS, RESTAURANTE, WANDORIUS). Este esquema se cura de ellos:
 *   - nucleo (presente en los 3)          -> 'requerida'
 *   - recomendadas (presente en 2 de 3)   -> 'recomendada'
 *   - extensiones nuevas / opcionales     -> 'opcional'
 * La severidad cuando falta una opcion sigue la misma convencion que sentinel:
 * requerida->error, recomendada->advertencia, opcional->silencio en la consola. */
import type { NodoEsquema, Necesidad, OpcionValor } from './esquema.js';

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
        allowedValues: strArr('requerida'),
      },
      necesidad: 'requerida',
    },
    /* recomendadas (presente en 2 de 3 reales). */
    inlineDetection: severidadObj('recomendada'),
    tokenDetection: {
      objeto: {
        duplicate: severidadObj('opcional'),
        unused: severidadObj('opcional'),
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