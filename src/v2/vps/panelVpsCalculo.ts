/* Cálculo puro del panel VPS (partido de usePanelVps.ts): % de disco del audit, agrupación de
 * contenedores por sitio, filas de la tabla y avisos. [por que] Sin estado ni red: el hook solo
 * lo llama, y así estas funciones se prueban sin React. */
import type {
  VpsAgenteContenedor,
  VpsAgenteRespuesta,
  VpsAgenteSnapshot,
  VpsRecursos,
  VpsSitio,
} from '../../shared/types.js';
import { peorSalud, saludDeEstado } from '../../shared/vps/salud.js';

/* % de uso de disco del host desde el resumen del audit (`Disco:
 * ... use=N%`). La forma es `datos desconocido`: se extrae a la
 * defensiva y se devuelve null si el formato cambió. */export function extraerDisco(r: VpsRecursos): number | null {
  try {
    const pieza = r.piezas?.resumen;
    if (!pieza?.ok) return null;
    const datos = pieza.datos as { metricas?: { metrica: string; pct: number }[] } | null;
    const m = Array.isArray(datos?.metricas)
      ? datos.metricas.find((x) => x?.metrica === 'disco')
      : undefined;
    return typeof m?.pct === 'number' && Number.isFinite(m.pct) ? m.pct : null;
  } catch {
    return null;
  }
}

/* Clase del estado en la tabla (fase:detalle → running:healthy, degraded:unhealthy…): vivo =
 * relleno, degradado = borde, resto (apagado, detenido, sin datos) = atenuado. Vive aquí desde
 * 20AA-16 porque el panel del taller pinta el mismo lenguaje de estados. La lectura del estado no
 * se hace aquí: la decide `shared/vps/salud.ts`, la misma que usa la campana de avisos. */
export function claseEstado(estado: string): string {
  const salud = saludDeEstado(estado);
  if (salud === 'vivo') return 'vpsEstado vpsEstado--ok';
  if (salud === 'degradado') return 'vpsEstado vpsEstado--mal';
  return 'vpsEstado vpsEstado--apagado';
}

/* Peor estado del despliegue para la tabla: el degradado manda, luego cualquier no vivo; en caso
 * contrario, vivo. Exportada desde 20AA-16: el panel del taller agrupa distinto (una fila por
 * proyecto del registro) pero el estado se resume igual.
 * [por que devuelve una cadena cruda] La tabla pinta el estado tal cual llegó del agente
 * (`degraded:unhealthy` es información útil en el detalle); aquí sólo se elige CUÁL de los
 * contenedores lo representa. El orden de gravedad sí viene de `peorSalud`. */
export function peorEstado(cs: VpsAgenteContenedor[]): string {
  const peor = peorSalud(cs.map((c) => c.estado));
  if (cs.length === 0) return 'running';
  /* Todo vivo se resume con la palabra corta que ya pintaba la tabla; el `:healthy` del agente es
   * detalle del contenedor, no del despliegue. */
  if (peor === 'vivo') return 'running';
  const delGrado = (grado: string): VpsAgenteContenedor | undefined =>
    cs.find((c) => saludDeEstado(c.estado) === grado);
  return (delGrado(peor) ?? cs[0]).estado;
}

/* Fila resumen de la tabla: un despliegue = cpu/mem sumadas. Las filas
 * por contenedor no se pintan en la tabla: viven en el detalle lateral. */
export interface FilaDespliegue {
  clave: string;
  nombre: string;
  dominio: string | null;
  estado: string;
  cpu: number;
  mem: number;
  limite: number | null;
  n: number;
}

export interface GrupoSitio {
  dominio: string | null;
  filas: VpsAgenteContenedor[];
}

export interface GruposSitios {
  sitios: [string, GrupoSitio][];
  infra: VpsAgenteContenedor[];
  estadoSitio: Map<string, string>;
}

/* Grupos por sitio (nombre legible del backend) en orden alfabético +
 * infra sin sitio al final: el id largo no se muestra nunca. La lista de
 * Coolify aporta TODOS los sitios (vivos o detenidos); lo vivo de pulse
 * aporta contenedores y métricas. Un sitio detenido queda con fila propia
 * (estado Coolify, ceros) en vez de desaparecer. */
export function agruparSitios(contenedores: VpsAgenteContenedor[], sitios: VpsSitio[] | null): GruposSitios {
  const porSitio = new Map<string, GrupoSitio>();
  const infra: VpsAgenteContenedor[] = [];
  for (const c of contenedores) {
    if (!c.sitio) {
      infra.push(c);
      continue;
    }
    let g = porSitio.get(c.sitio);
    if (!g) {
      g = { dominio: null, filas: [] };
      porSitio.set(c.sitio, g);
    }
    if (!g.dominio && c.dominio) g.dominio = c.dominio;
    g.filas.push(c);
  }
  // Coolify manda el estado real de cada sitio, también el de los detenidos.
  const estadoSitio = new Map<string, string>();
  for (const s of sitios ?? []) {
    estadoSitio.set(s.nombre, s.estadoReal || 'detenido');
    let g = porSitio.get(s.nombre);
    if (!g) {
      g = { dominio: s.dominio || null, filas: [] };
      porSitio.set(s.nombre, g);
    } else if (!g.dominio && s.dominio) {
      g.dominio = s.dominio;
    }
  }
  const sitiosOrdenados = [...porSitio.entries()].sort(([a], [b]) => a.localeCompare(b));
  return { sitios: sitiosOrdenados, infra, estadoSitio };
}

/* Una fila de la tabla: el despliegue con sus cpu/mem sumadas y su estado peor. */
function resumir(
  nombre: string,
  dominio: string | null,
  cs: VpsAgenteContenedor[],
  estadoBase: string,
): FilaDespliegue {
  return {
    clave: nombre === 'infra' ? 'infra' : `sitio:${nombre}`,
    nombre,
    dominio: dominio ? dominio.replace(/^https?:\/\//, '') : null,
    estado: cs.length > 0 ? peorEstado(cs) : estadoBase,
    cpu: cs.reduce((a, c) => a + c.cpuPct, 0),
    mem: cs.reduce((a, c) => a + c.memMiB, 0),
    limite: cs.every((c) => c.memLimiteMiB !== null)
      ? cs.reduce((a, c) => a + (c.memLimiteMiB ?? 0), 0)
      : null,
    n: cs.length,
  };
}

/* Tabla: una fila por despliegue + infra al final (si hay). */
export function construirFilas(grupos: GruposSitios): FilaDespliegue[] {
  return [
    ...grupos.sitios.map(([nombre, g]) =>
      resumir(nombre, g.dominio, g.filas, grupos.estadoSitio.get(nombre) ?? 'detenido'),
    ),
    ...(grupos.infra.length > 0 ? [resumir('infra', null, grupos.infra, 'infra')] : []),
  ];
}

/* Contenedores del despliegue elegido para el detalle lateral (ninguno si no hay selección). */
export function contenedoresDeSeleccion(
  grupos: GruposSitios,
  selFila: FilaDespliegue | null,
): VpsAgenteContenedor[] {
  if (!selFila) return [];
  if (selFila.clave === 'infra') return grupos.infra;
  return grupos.sitios.find(([n]) => `sitio:${n}` === selFila.clave)?.[1].filas ?? [];
}

/* Edad en palabras, sin dependencias: lo que hace falta para decidir si esperar o intervenir. */
export function edadTexto(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}

/* « · abierto hace 4 min · último dato hace 2 min» o « · sin ningún dato bueno». */
export function textoBreaker(breaker: { desdeMs: number; ultimoBuenoMs: number | null } | undefined): string {
  if (!breaker) return '';
  const ultimo = breaker.ultimoBuenoMs === null
    ? 'sin ningún dato bueno'
    : `último dato hace ${edadTexto(breaker.ultimoBuenoMs)}`;
  return ` · abierto hace ${edadTexto(breaker.desdeMs)} · ${ultimo}`;
}

/* Avisos: solo existen cuando hay algo que decir. */
export function calcularAvisos(
  agente: VpsAgenteRespuesta | null,
  snapAgente: VpsAgenteSnapshot | null,
): { bannerAgente: string | null; avisoTruncado: string | null } {
  /* [20AA-24 F2] Con el breaker abierto se dice desde cuándo y qué edad tiene el último dato bueno:
   * «agente-abierto» a secas se lee igual a los dos minutos que a los dos días, y la usuaria no sabía
   * si reiniciar algo o esperar. */
  const bannerAgente =
    agente && !agente.disponible && agente.error !== null && agente.error !== 'sin-configurar'
      ? `pulse-inaccesible${agente.error === 'pulse-inaccesible' ? '' : `: ${agente.error}`}${textoBreaker(agente.breaker)}`
      : null;
  const avisoTruncado =
    snapAgente?.truncado === true
      ? `vista parcial (${snapAgente.contenedores.length} de ${snapAgente.totalContenedores})`
      : null;
  return { bannerAgente, avisoTruncado };
}
