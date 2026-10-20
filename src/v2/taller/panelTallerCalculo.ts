/* Cálculo puro del panel del taller (20AA-16): filas de la tabla, avisos y % de disco.
 * [por que] La tabla del taller tiene una fila por proyecto del REGISTRO, no por contenedor: pulse
 * en modo procesos solo ve lo que está vivo, y un proyecto parado tiene que seguir teniendo fila
 * (en `apagado`) con su sesión y su hostname, igual que en la tab vps lo detenido lo aporta la
 * lista de Coolify. Sin estado ni red: se prueba sin React. */
import type { ProyectoTaller } from '../../shared/taller/proyecto.js';
import type { EstadoTaller89 } from '../../shared/taller/conformidad.js';
import type {
  VpsAgenteContenedor,
  VpsAgenteRespuesta,
  VpsAgenteSnapshot,
} from '../../shared/types.js';
import { calcularAvisos, peorEstado } from '../vps/panelVpsCalculo.js';

/* Una fila de la tabla: el proyecto con lo que pulse sepa de él. */
export interface FilaTaller {
  /* Clave estable de la fila, que es también la clave de su historial (`proyecto:<id>`). */
  clave: string;
  nombre: string;
  hostname: string | null;
  /* Sesión tmux de la 89 (`dev-<slug>-<puerto>`); `—` si el proyecto no declara puerto. */
  sesion: string;
  /* Puerto local del túnel (null sin túnel): es por donde se llega desde el portátil. */
  puertoLocal: number | null;
  estado: string;
  cpu: number;
  mem: number;
  n: number;
  contenedores: VpsAgenteContenedor[];
}

/* [por que] En modo procesos el «sitio» de una fila de pulse es su `nombre` (no hay uuid de
 * Coolify que enlazar: ver `filtrar_por_nombre` de pulse), y ese nombre es el id del proyecto. */
function porNombre(contenedores: VpsAgenteContenedor[]): Map<string, VpsAgenteContenedor[]> {
  const mapa = new Map<string, VpsAgenteContenedor[]>();
  for (const c of contenedores) {
    const lista = mapa.get(c.nombre);
    if (lista) lista.push(c);
    else mapa.set(c.nombre, [c]);
  }
  return mapa;
}

/* Filas de la tabla: una por proyecto del registro (ordenado) y, al final, las filas vivas que no
 * están en el registro. [por que] Un proceso del taller que ya no figure en la ficha sigue
 * consumiendo la máquina: esconderlo sería peor que una fila de más, que se distingue por no
 * tener sesión ni hostname. */
export function construirFilasTaller(
  contenedores: VpsAgenteContenedor[],
  proyectos: ProyectoTaller[],
): FilaTaller[] {
  const vivo = porNombre(contenedores);
  const filas = proyectos.map((p) => filaDe(p.id, vivo.get(p.id) ?? [], p));
  const conocidos = new Set(proyectos.map((p) => p.id));
  for (const [nombre, cs] of [...vivo.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!conocidos.has(nombre)) filas.push(filaDe(nombre, cs, null));
  }
  return filas;
}

function filaDe(id: string, cs: VpsAgenteContenedor[], p: ProyectoTaller | null): FilaTaller {
  return {
    clave: `proyecto:${id}`,
    nombre: id,
    hostname: p?.hostname ?? null,
    sesion: p?.sesiones[0] ?? '—',
    puertoLocal: p?.puertoLocal ?? null,
    /* Sin filas en pulse el proyecto no está vivo y el registro no dice su estado: se dice
     * `apagado` en vez de inventar un running. */
    estado: cs.length > 0 ? peorEstado(cs) : 'apagado',
    cpu: cs.reduce((a, c) => a + c.cpuPct, 0),
    mem: cs.reduce((a, c) => a + c.memMiB, 0),
    n: cs.length,
    contenedores: cs,
  };
}

/* Avisos de la cabecera. Reutiliza los de vps (mismo contrato de pulse) y añade el único caso que
 * allí no existe: en el taller, «sin configurar» es un estado real y accionable (falta el token),
 * no ruido que convenga callar. */
export function avisosTaller(
  agente: VpsAgenteRespuesta | null,
  snap: VpsAgenteSnapshot | null,
): { banner: string | null; truncado: string | null } {
  const { bannerAgente, avisoTruncado } = calcularAvisos(agente, snap);
  const sinConfigurar =
    agente && !agente.disponible && agente.error === 'sin-configurar'
      ? 'pulse del taller sin configurar (falta PULSE_TOKEN en el .env del proyecto que declara tokenPulse)'
      : null;
  return { banner: sinConfigurar ?? bannerAgente, truncado: avisoTruncado };
}

/* % de uso del disco de la 89 desde la sonda del taller (`df` de `/`). null = la sonda todavía no
 * trae el total (versión antigua) o no hay lectura: se dice, no se pinta un cero que parece dato. */
export function discoPctTaller(estado: EstadoTaller89 | null): number | null {
  const libre = estado?.disco?.libreGb;
  const total = estado?.disco?.totalGb;
  if (typeof libre !== 'number' || typeof total !== 'number' || total <= 0) return null;
  const pct = Math.round((1 - libre / total) * 100);
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null;
}
