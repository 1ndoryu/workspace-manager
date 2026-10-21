/* Dominio vps: despliegues, agente glory-pulse e historial por sitio.
 * [por que] Tiene su propio contrato y solo lo usan el server vps y su UI; no
 * se mezcla con git ni con el gate. */
/* Tab vps (GET /api/vps/*, 299A-5): despliegues en solo lectura via el gestor
 * de despliegues del area (papel `despliegue` de config/area.json).
 * El server ejecuta el binario por consulta (execFile sin
 * shell, argv construido solo con comandos de lectura) y aqui solo viajan
 * resumenes parseados: los secretos de settings.json nunca salen del server.
 * Estados: el manager da texto humano en list/health/audit/logs, asi que el
 * parseo es estricto y lo no reconocido es 'desconocido', nunca verde. */
export interface VpsSitio {
  nombre: string;
  dominio: string;
  target: string;
  uuid: string;
  /* Estado real desde `list --detailed` (running/exited/...) o
   * 'sin-asignar' (sin UUID) / 'desconocido' (no parseable). */
  estadoReal: string;
}

export interface VpsAviso {
  nombre: string;
  problema: 'sin-asignar' | 'estado-desconocido' | 'sin-estado-real';
}

export interface VpsSitios {
  sitios: VpsSitio[];
  /* Conciliacion settings <-> real: lo configurado que no cuadra con lo
   * real. Limite honesto: lo real-fuera-de-settings no es visible desde
   * `list` (solo lee settings), asi que no se inventa. */
  avisos: VpsAviso[];
  aviso: string | null;
}

/* Pieza del detalle/de recursos: degradacion parcial (una pieza puede fallar
 * y el resto sigue visible). datos = JSON parseado o texto recortado. */
export interface VpsPieza {
  ok: boolean;
  datos: unknown;
  error: string | null;
}

export interface VpsDetalle {
  sitio: string;
  piezas: Record<string, VpsPieza>;
}

/* Respuesta de /api/vps/pieza (0110A-3 F3): una sola pieza pesada bajo
 * demanda, con la misma forma VpsPieza que el legacy. */
export interface VpsPiezaRespuesta {
  sitio: string;
  pieza: string;
  resultado: VpsPieza;
}

export interface VpsRecursos {
  piezas: Record<string, VpsPieza>;
}

/* Estado del puente + refresco configurable (GET /api/vps/config):
 * refreshMs 0 = manual con boton (defecto). */
export interface VpsConfig {
  refreshMs: number;
  binario: { ruta: string; version: string | null; ok: boolean };
}

/* Snapshot del agente glory-pulse (GET /api/vps/agente, 299A-12 F2): una
 * sola conexión contra la VPS en vez de las 7 piezas legacy en serie. El
 * token Bearer nunca sale del server: aquí viajan solo resúmenes. `frescura`
 * lleva reloj del backend (edad del snapshot servido). */
export interface VpsAgenteContenedor {
  id: string;
  nombre: string;
  estado: string;
  imagen: string;
  cpuPct: number;
  memMiB: number;
  memLimiteMiB: number | null;
  redRxBytes: number;
  redTxBytes: number;
  blkReadBytes: number;
  blkWriteBytes: number;
  sitioUuid: string | null;
  dominio: string | null;
  /* Nombre del sitio resuelto por el backend (uuid de `app-{uuid}` /
   * `postgres-{uuid}` contra el mapa de sitios; pulse aun no lo rellena).
   * null = infra sin sitio (proxy, coolify...) o mapa aun sin cargar. */
  sitio: string | null;
}

export interface VpsAgenteSnapshot {
  schema: 1;
  hostId: string;
  ts: number;
  contenedores: VpsAgenteContenedor[];
  /* [0110A-1] IO del host (`discoHost` de pulse, sectores acumulados de
   * /proc/diskstats). null = pulse anterior a 0.3.0 (la UI lo dice, no
   * pinta ceros). Sin lógica aquí: solo pasar el campo. */
  discoHost: { sectoresLeidos: number; sectoresEscritos: number } | null;
  truncado: boolean;
  totalContenedores: number;
  frescura: { fuente: 'agente'; edadMs: number };
}

export interface VpsAgenteRespuesta {
  disponible: boolean;
  snapshot: VpsAgenteSnapshot | null;
  error: string | null;
  /* Qué contarle a la usuaria cuando el breaker está abierto (20AA-24 F2). [por que] «agente-abierto»
   * a secas no distingue un corte de hace tres minutos de uno de ayer, y el panel no puede decidir
   * si avisar. `desdeMs` = hace cuánto se abrió; `ultimoBuenoMs` = edad del último dato bueno
   * (`null` = nunca hubo). Ausentes cuando la llamada fue bien. */
  breaker?: { desdeMs: number; ultimoBuenoMs: number | null };
}

/* [309A-2] Detalle por sitio en una conexión: subconjunto del snapshot
 * (mismas filas) servido por `GET /detalle?sitio=<uuid>` de pulse y
 * proxificado en `/api/vps/agente-detalle?uuid=<uuid>`. */
export interface VpsAgenteDetalle {
  schema: 1;
  hostId: string;
  ts: number;
  sitio: string;
  contenedores: VpsAgenteContenedor[];
  totalContenedores: number;
}

export interface VpsAgenteDetalleRespuesta {
  disponible: boolean;
  detalle: VpsAgenteDetalle | null;
  error: string | null;
  /* Mismo diagnóstico que el snapshot (20AA-24 F2): el breaker es uno solo por agente. */
  breaker?: { desdeMs: number; ultimoBuenoMs: number | null };
}

/* [07AA-4] Historial persistente por despliegue (`GET /api/vps/historial`):
 * el backend anota las sumas por sitio de cada snapshot ya servido en un
 * fichero acotado; mismas tuplas [t, cpuPct, memMiB] que la cola local. */
export interface VpsHistorialSitio {
  clave: string;
  muestras: [t: number, cpuPct: number, memMiB: number][];
}
