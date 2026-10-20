/* Formas del reporte de sentinel/varsense y del runtime que lo ejecuta.
 * [por que] Tipos puros, sin importar nada del runtime: `analizador.ts` normaliza el
 * JSON en la frontera, así que estas formas no salen de aquí sin normalizar. */
/* Tipos del JSON real que devuelve `sentinel analyze --format json` (varsense
 * `all` comparte la forma: severityCounts + entries con findings). No se
 * importa nada del runtime: se normaliza en `analizador.ts` para aislar el
 * formato. */
export interface FindingJson {
  ruleId?: unknown;
  message?: unknown;
  mensaje?: unknown;
  severity?: unknown;
  severidad?: unknown;
  suggestion?: unknown;
  range?: { start?: { line?: unknown } };
}

export interface EntryJson {
  ruta?: unknown;
  path?: unknown;
  archivo?: unknown;
  findings?: FindingJson[];
}

export interface ReporteJson {
  severityCounts?: Partial<Record<string, number>>;
  entries?: EntryJson[];
}

export interface ResultadoSpawn {
  version: string;
  commit: string | null;
  dato: ReporteJson;
}

export interface FuentesRuntime {
  base: string;
  version: string;
}
