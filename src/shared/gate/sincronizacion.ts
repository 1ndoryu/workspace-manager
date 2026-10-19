/* Forma del reporte de sincronización del gate, compartida por servidor y presentación.
 * [por que] Antes la UI importaba tipos desde src/server/: la capa de presentación no debe
 * depender del servidor (SOLID, dependencias hacia dentro). Solo tipos: sin código. */

/* Tipos del reporte que devuelve quality-sync.mjs --json (normalizado minimo
 * para tipar la UI; el shape real del script es authoritative). */
export interface ToolSyncState {
  /* 'no-declarado' = el manifiesto no usa esa herramienta: no aplica, no es un
   * problema (antes se reportaba como 'ausente' y el panel lo pintaba rojo). */
  estado: 'ok' | 'desync' | 'ausente' | 'no-declarado';
  checkout?: 'compartido' | 'propio' | null;
  detalle: string;
}

export interface ConsumidorSync {
  nombre: string;
  fase: string;
  ruta: string;
  estado: 'ok' | 'desync' | 'pendiente-F4' | 'sin-manifest' | 'error' | 'sin-directorio';
  detalle?: string;
  problemas?: string[];
  sentinel?: ToolSyncState;
  varsense?: ToolSyncState;
}

export interface ReporteSincronizacion {
  area: string;
  checkout: string;
  consumidores: ConsumidorSync[];
  problemas: number;
  /* Registrados cuyo directorio no está en el área: no hay pin que validar, así
   * que no cuentan como desync (16A-4). */
  sinDirectorio?: string[];
  checkout_sentinel?: { head: string | null; sucio: number };
  checkout_varsense?: { head: string | null; sucio: number };
  /* Alineacion pin/runtime/publicado por consumidor + vigencia upstream
   * (219A-1, script 308A-7V19 cableado al panel). Null si el script fallo:
   * nunca rompe el reporte F7, que sigue siendo la guarda fail-closed. */
  alineacion: ReporteAlineacion | null;
}

/* Fila de verificar-alineacion.mjs --json (shape del script, authoritative). */
export interface FilaAlineacion {
  proyecto: string;
  herramienta?: string;
  tool?: string;
  estado: string;
  problemas?: string[];
  pin: string | null;
  runtime: string | null;
  publicado: boolean | null;
  modo?: string;
  dir?: string;
}

/* Vigencia upstream por checkout (ls-remote, sin fetch; fail-open). */
export interface RemotoUpstream {
  dir: string;
  tool: string | null;
  url: string | null;
  headLocal: string | null;
  headRemoto: string | null;
  tags: { tag: string; commit: string }[];
  /* true = el remoto va por otro commit; false = al dia; null = desconocido
   * (sin remoto o sin red: no es un problema, es falta de dato). */
  desactualizado: boolean | null;
}

export interface ReporteAlineacion {
  filas: FilaAlineacion[];
  alineados: number;
  total: number;
  desalineados: number;
  ok: boolean;
  remotos: RemotoUpstream[];
}
