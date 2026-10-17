/* Reporte del análisis: del JSON de las herramientas a `AnalisisSentinel`.
 * [por qué está aparte] `analizador.ts` mezclaba la traducción de formato (y la
 * fusión de sentinel con varsense) con la ejecución (auditoría SOLID, E3).
 * Aquí no se lanza nada: solo se lee lo que devolvieron las corridas. */
import { posix, relative } from 'node:path';
import { varsenseAplica } from '../ejecucion.js';
import type { EntryJson, FindingJson, ReporteJson, ResultadoSpawn } from '../ejecucion.js';
import type { AnalisisSentinel, HallazgoSentinel, NombreSeveridad, Proyecto, SeveridadSentinel } from '../../../shared/types.js';

/* Normaliza una severidad arbitraria del JSON a las 4 conocidas. */
function sev(s: unknown): SeveridadSentinel {
  const t = String(s ?? 'warning').toLowerCase();
  if (t === 'error' || t === 'warning' || t === 'information' || t === 'hint') return t;
  return 'warning';
}

/* Convierte la ruta absoluta del entry a relativa al workspace si aplica. */
function relArchivo(abs: string, raiz: string): string {
  if (!abs || !raiz) return abs;
  try {
    /* [por que] S3.7: los reportes de la 89 traen rutas POSIX; `relative` de Windows
     * las trataría como rutas de unidad y no relativizaría nada. */
    const rel = raiz.startsWith('/') ? posix.relative(raiz, abs) : relative(raiz, abs);
    if (rel && !rel.startsWith('..')) return rel;
  } catch {
    /* ruta no relativizable */
  }
  return abs;
}

/* Normaliza el JSON real de `analyze` a un AnalisisSentinel plano y acotado.
 * `fuenteHallazgo` taguea cada hallazgo con la herramienta que lo emitio
 * ('sentinel' | 'varsense', fase G). */
export function normalizar(
  dato: ReporteJson,
  clave: string,
  version: string,
  raiz: string,
  fuenteHallazgo: 'sentinel' | 'varsense' = 'sentinel',
  commitCli: string | null = null,
): AnalisisSentinel {
  const sc = dato.severityCounts ?? {};
  const resumen = {
    error: Number(sc.error) || 0,
    warning: Number(sc.warning) || 0,
    information: Number(sc.information) || 0,
    hint: Number(sc.hint) || 0,
  };
  const hallazgos: HallazgoSentinel[] = [];
  for (const entry of dato.entries ?? []) {
    const archivo = relArchivo(String(entry.ruta ?? entry.path ?? entry.archivo ?? ''), raiz);
    for (const f of entry.findings ?? []) {
      /* `range.start.line` de sentinel es 0-based (contrato LSP); el tablero
       * muestra numeros de linea humanos, asi que suma 1. Sin esto cada aviso
       * apunta a la linea anterior a la real. */
      const lineaRaw = f.range?.start?.line;
      const linea = typeof lineaRaw === 'number' ? lineaRaw + 1 : null;
      const sugerencia = typeof f.suggestion === 'string' ? f.suggestion : undefined;
      hallazgos.push({
        ruleId: String(f.ruleId ?? 'regla-desconocida'),
        mensaje: String(f.message ?? f.mensaje ?? 'sin mensaje'),
        severidad: sev(f.severity ?? f.severidad),
        archivo,
        linea,
        sugerencia,
        fuente: fuenteHallazgo,
      });
    }
  }
  const total = resumen.error + resumen.warning + resumen.information + resumen.hint;
  return {
    clave,
    version,
    /* [por que] 039A-4: commit del binario que midió (solo cuando el proyecto
     * declara provisionPath propio; null = compartido/instalado o caché vieja). */
    commitCli: commitCli ?? undefined,
    fuente: 'runtime',
    estado: total > 0 ? 'conHallazgos' : 'ok',
    analizadoEn: new Date().toISOString(),
    resumen,
    /* [por que] 308A-6J11: los hallazgos se guardan COMPLETOS (sin cap 500).
     * El cap truncaba la lista y los conteos por regla del agregado no
     * coincidian con el CLI directo (p.ej. claseHuerfana de PT: 298 en la
     * consola vs 1083 reales). El render del cliente sigue siendo acotado;
     * aqui la fuente de verdad es el reporte completo. */
    hallazgos,
  };
}

/* Suma dos resumenes por severidad (merge de sentinel + varsense). */
function sumarResumen(a: NombreSeveridad, b: NombreSeveridad): NombreSeveridad {
  return {
    error: a.error + b.error,
    warning: a.warning + b.warning,
    information: a.information + b.information,
    hint: a.hint + b.hint,
  };
}

/* [por que] Varsense declarado y provisionado que no devuelve reporte (timeout,
 * salida no JSON o spawn fallido) no puede dar 'ok': el tablero afirmaria "sin
 * problemas" sin haber analizado varsense. Queda en 'error' (no se cachea, el
 * siguiente analisis reintenta) y conserva los hallazgos de sentinel. */
export function marcarVarsenseFallido(dato: AnalisisSentinel, motivo?: string): AnalisisSentinel {
  return {
    ...dato,
    estado: 'error',
    error: dato.error ?? (motivo
      ? `varsense declarado no produjo reporte: ${motivo}`
      : 'varsense declarado no produjo reporte (timeout, salida no JSON o fallo de spawn)'),
  };
}

/* Resultado de error de un análisis que no llegó a obtener reportes. */
export function datoError(clave: string, error: string): AnalisisSentinel {
  return {
    clave,
    version: '—',
    fuente: null,
    estado: 'error',
    analizadoEn: new Date().toISOString(),
    resumen: { error: 0, warning: 0, information: 0, hint: 0 },
    hallazgos: [],
    error,
  };
}

/* Motivos de fallo por herramienta (remoto: el error de la corrida; local: sin motivo). */
export interface Motivos {
  sentinel?: string;
  varsense?: string;
}

/* Une los reportes de sentinel y varsense en un AnalisisSentinel. `raiz` es la ruta que
 * se quita de los archivos del reporte: la local, o la de la réplica en la 89. */
export function montarAnalisis(
  p: Proyecto,
  res: ResultadoSpawn | null,
  resVs: ResultadoSpawn | null,
  raiz: string = p.ruta,
  motivos: Motivos = {},
): AnalisisSentinel {
  const clave = p.clave;
  let dato: AnalisisSentinel;
  if (!res) {
    dato = datoError(clave, motivos.sentinel ?? 'runtime sentinel no disponible o analisis fallo');
    if (resVs) {
      const vs = normalizar(resVs.dato, clave, resVs.version, raiz, 'varsense');
      dato.resumen = vs.resumen;
      dato.hallazgos = vs.hallazgos;
      dato.varsense = { version: resVs.version, resumen: vs.resumen };
    }
  } else {
    dato = normalizar(res.dato, clave, res.version, raiz, 'sentinel', res.commit);
    if (resVs) {
      const vs = normalizar(resVs.dato, clave, resVs.version, raiz, 'varsense');
      dato.resumen = sumarResumen(dato.resumen, vs.resumen);
      dato.hallazgos = [...dato.hallazgos, ...vs.hallazgos];
      dato.varsense = { version: resVs.version, resumen: vs.resumen };
      if (dato.estado === 'ok' && vs.estado === 'conHallazgos') dato.estado = 'conHallazgos';
    }
  }
  if (!resVs && varsenseAplica(p.ruta)) dato = marcarVarsenseFallido(dato, motivos.varsense);
  return dato;
}
