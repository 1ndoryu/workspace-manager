/* Dominio analisis: resultados de sentinel/varsense y de la auditoria de
 * vulnerabilidades. [por que] Es el contrato del gate; cambia con sus
 * herramientas, no con el proyecto. */
/* Hallazgo real que sentinel analyze / varsense detectan (desnormalizado y
 * plano para que la consola no conozca el formato del runtime: aísla cambios
 * de sentinel/varsense). `fuente` distingue qué herramienta emitió el
 * hallazgo (fase G: el analisis fusiona ambos reportes). */
export interface HallazgoSentinel {
  ruleId: string;
  mensaje: string;
  severidad: 'error' | 'warning' | 'information' | 'hint';
  /* Ruta relativa al workspace si resolvible, si no la absoluta. */
  archivo: string;
  linea: number | null;
  sugerencia?: string;
  /* 'sentinel' | 'varsense'. Ausente => sentinel (retrocompat cache vieja). */
  fuente?: 'sentinel' | 'varsense';
}

export type SeveridadSentinel = 'error' | 'warning' | 'information' | 'hint';
export type NombreSeveridad = Record<SeveridadSentinel, number>;

/* Cabecera de un analisis: que proyecto, con que runtime y en que estado quedo.
 * Subinterface de AnalisisSentinel (ISP cohesiva, contrato intacto). */
export interface CabeceraAnalisis {
  clave: string;
  version: string;
  /* Commit corto del binario que produjo el análisis: el declarado en el
   * `quality-tools.json` del proyecto cuando fija su propio `provisionPath`
   * (039A-4). Ausente en análisis con el checkout compartido/instalado y en
   * caché persistida vieja: el panel solo lo muestra si viene. */
  commitCli?: string;
  fuente: 'runtime' | 'estatico' | null;
  estado: 'ok' | 'conHallazgos' | 'error';
  analizadoEn: string;
  /* Detalle del error si estado === 'error'. */
  error?: string;
  /* El análisis salió, pero no donde tocaba (p. ej. la VPS del taller no responde
   * y se hizo en el portátil). No es `error`: hay resultado; es el porqué de que
   * venga de donde viene. */
  aviso?: string;
}

/* Estado de VarSense fusionado al analisis (fase G): version del runtime
 * y conteos de sus hallazgos (ya incluidos en `resumen`/`hallazgos`, con
 * `fuente: 'varsense'`). Ausente => varsense no declarado o no corrido. */
export interface DetalleVarsense {
  version: string;
  resumen: NombreSeveridad;
}

/* Cuerpo de un analisis: conteos, hallazgos y detalle VarSense. */
export interface CuerpoAnalisis {
  resumen: NombreSeveridad;
  hallazgos: HallazgoSentinel[];
  varsense?: DetalleVarsense;
}

/* Resultado del analisis real de sentinel sobre un proyecto. Nunca anida el
 * formato de sentinel (entries[]): va desnormalizado y plano. Los hallazgos
 * van COMPLETOS (sin cap): el render del cliente es acotado, pero los conteos
 * del agregado deben coincidir con el CLI directo (308A-6J11). */
export interface AnalisisSentinel extends CabeceraAnalisis, CuerpoAnalisis {}

/* Conteo por severidad de la auditoria de dependencias. [por que] Separado del
 * resto de la consola igual que el analisis: critical/high/moderate/low son la
 * nube de severidades que npm/pnpm/cargo audit reportan. */
export interface ConteoVulnerabilidades {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export interface HallazgoVulnerabilidad {
  paquete: string;
  severidad: 'critical' | 'high' | 'moderate' | 'low';
  /* Rango de versiones afectadas (del advisory). */
  rango: string;
  /* Identidad del aviso (`RUSTSEC-2026-0369`, `GHSA-...`). [por que] Sin esto,
   * cuatro avisos distintos de `rustls` parcheados en la misma version se pintan
   * como cuatro lineas identicas y no se sabe que hay que arreglar. */
  id?: string;
  /* Titulo del aviso, si el audit lo trae. */
  titulo?: string;
  /* El audit no declara severidad para este aviso (RUSTSEC sin `cvss`). [por que]
   * Antes caia en el `low` por defecto y se confundia con una severidad baja de
   * verdad; marcado, el motivo lo dice en vez de mentir. */
  sinSeveridad?: true;
  url?: string;
  /* Lockfile de origen (p. ej. `frontend/package-lock.json`); un proyecto puede tener varios. */
  origen?: string;
}

/* Resultado de la auditoria de dependencias de un proyecto (plan
 * vulnerabilidades-consola 308A-4). El cliente es 'tonto': pide, el server
 * resuelve el gestor (npm/pnpm/cargo) segun el lockfile y devuelve este shape
 * plano, con fallback 'noAuditable' si el proyecto no tiene lockfile o el CLI
 * de audit no esta disponible (cargo-audit no instalado). */
export interface AnalisisVulnerabilidades {
  clave: string;
  gestor: 'npm' | 'pnpm' | 'cargo' | null;
  lockfile: string;
  estado: 'ok' | 'conHallazgos' | 'noAuditable' | 'error';
  analizadoEn: string;
  resumen: ConteoVulnerabilidades;
  hallazgos: HallazgoVulnerabilidad[];
  /* Hallazgos de cargo descartados por no alcanzar el build (cargo tree -i). */
  noAlcanzables?: HallazgoVulnerabilidad[];
  /* Detalle cuando estado === 'error' o 'noAuditable'. */
  error?: string;
  /* El audit salió, pero no donde tocaba (el proyecto se analiza en el taller y
   * el envío del árbol no salió, así que corrió en el portátil). No es `error`:
   * hay resultado; es el porqué de que venga de donde viene. */
  aviso?: string;
}
