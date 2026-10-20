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

/* % de uso de disco del host desde el resumen del audit (`Disco:
 * ... use=N%`). La forma es `datos desconocido`: se extrae a la
 * defensiva y se devuelve null si el formato cambió. */
export function extraerDisco(r: VpsRecursos): number | null {
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

/* Peor estado del despliegue para la tabla: degraded manda, luego
 * cualquier no-running; en caso contrario, running. */
function peorEstado(cs: VpsAgenteContenedor[]): string {
  const deg = cs.find((c) => c.estado.startsWith('degraded'));
  if (deg) return deg.estado;
  const otro = cs.find((c) => !c.estado.startsWith('running'));
  return otro ? otro.estado : 'running';
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

/* Avisos: solo existen cuando hay algo que decir. */
export function calcularAvisos(
  agente: VpsAgenteRespuesta | null,
  snapAgente: VpsAgenteSnapshot | null,
): { bannerAgente: string | null; avisoTruncado: string | null } {
  const bannerAgente =
    agente && !agente.disponible && agente.error !== null && agente.error !== 'sin-configurar'
      ? `pulse-inaccesible${agente.error === 'pulse-inaccesible' ? '' : `: ${agente.error}`}`
      : null;
  const avisoTruncado =
    snapAgente?.truncado === true
      ? `vista parcial (${snapAgente.contenedores.length} de ${snapAgente.totalContenedores})`
      : null;
  return { bannerAgente, avisoTruncado };
}
