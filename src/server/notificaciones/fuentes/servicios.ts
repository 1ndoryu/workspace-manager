/* Fuente de sitios: los despliegues de producción (VPS 66, Coolify) y los proyectos del taller
 * (VPS 89, pulse). Dos fuentes distintas porque tienen dos ciclos distintos —20 s y 5 s—, pero una
 * sola regla: se anuncia la transición entre «sirve» y «no sirve», no el estado.
 * [por que la entidad es el que SIRVE] El motor avisa cuando una clave aparece («recuperado») y
 * cuando desaparece («caído»), así que la lista de entidades tiene que ser la de lo que está vivo.
 * Lo dudoso (`desconocido`) no es ni una cosa ni la otra: no entra. Un sitio que se queda sin
 * datos pasa por dos lecturas sin entrar antes de declararse caído (la amortiguación del motor),
 * y uno que vuelve entra en la primera lectura buena. */
import type { VpsSitio } from '../../../shared/tipos/vps.js';
import type { VpsAgenteContenedor } from '../../../shared/tipos/vps.js';
import type { Entidad, Fuente } from '../../../shared/notificaciones/tipos.js';
import { estaVivo } from '../../../shared/vps/salud.js';
import type { ProyectoTaller } from '../../../shared/taller/proyecto.js';

/* --- Producción (VPS 66) ------------------------------------------------------------------- */

export interface DatosSitios {
  sitios: VpsSitio[];
  /* El listado no se pudo leer (sin binario o la VPS no contesta). [por que se distingue] sin
   * esta señal, «no hay sitios» y «no pude preguntar» son lo mismo, y lo segundo declararía
   * caída toda la producción. Con ella, el motor lo lee como fuente rota y no toca su memoria. */
  sinLectura: string | null;
}

export function entidadesDeSitios(datos: DatosSitios): Entidad[] {
  return datos.sitios
    .filter((s) => estaVivo(s.estadoReal))
    .map((s) => ({
      clave: `sitio:${s.nombre}`,
      titulo: s.dominio === '' ? s.nombre : `${s.nombre} — ${s.dominio}`,
      detalle: s.estadoReal,
    }));
}

export function fuenteSitios(leer: () => Promise<DatosSitios>): Fuente {
  return {
    nombre: 'sitios',
    tipoAlta: 'sitio-recuperado',
    tipoBaja: 'sitio-caido',
    async leer() {
      try {
        const datos = await leer();
        if (datos.sinLectura !== null) return { entidades: [], problema: datos.sinLectura, sinLectura: true };
        return { entidades: entidadesDeSitios(datos), problema: null };
      } catch (err) {
        return { entidades: [], problema: `no se pudo leer producción: ${mensaje(err)}`, sinLectura: true };
      }
    },
  };
}

/* --- Taller (VPS 89) ----------------------------------------------------------------------- */

/* Un proyecto del taller sirve si alguno de sus procesos está vivo. [por que por proyecto y no
 * por contenedor] Lo que la usuaria llama «el proyecto está caído» es que no queda nada suyo
 * corriendo; mientras uno de sus procesos viva, el sitio está arriba. El registro aporta la lista
 * completa (incluido lo parado), así que también se detecta el proyecto que no aparece en pulse. */
export function entidadesDeTaller(contenedores: VpsAgenteContenedor[], proyectos: ProyectoTaller[]): Entidad[] {
  const vivos = new Set<string>();
  for (const c of contenedores) if (estaVivo(c.estado)) vivos.add(c.nombre);
  /* Solo los proyectos del registro y los procesos vivos que no figuran en él: un proceso suelto
   * que corre no se anuncia como proyecto (no tiene dueño identificable). */
  const nombres = new Set<string>([...proyectos.map((p) => p.id), ...vivos]);
  const salida: Entidad[] = [];
  for (const nombre of [...nombres].sort()) {
    if (!vivos.has(nombre)) continue;
    const ficha = proyectos.find((p) => p.id === nombre) ?? null;
    salida.push({
      clave: `taller:${nombre}`,
      /* El nombre del proyecto a secas no decía qué había pasado: la fila se lee «workspace-manager
       * y nada más». El título dice el hecho y el detalle, dónde. */
      titulo: `proyecto del taller: ${nombre}`,
      detalle: ficha?.hostname ?? 'sin hostname en el taller',
    });
  }
  return salida;
}

export interface DatosTaller {
  /* false = no hay pulse configurado (falta el token). [por que] Sin agente no se puede saber
   * nada del taller; eso es «no hay lectura», no «está todo caído». */
  disponible: boolean;
  contenedores: VpsAgenteContenedor[];
  proyectos: ProyectoTaller[];
  error: string | null;
}

export function fuenteTaller(leer: () => Promise<DatosTaller>): Fuente {
  return {
    nombre: 'taller',
    /* Tipos propios: la campana dice «sitio caído» de producción y «proyecto parado» del taller.
     * Compartir tipo hacía que un mismo aviso significara dos cosas según de dónde viniera. */
    tipoAlta: 'proyecto-recuperado',
    tipoBaja: 'proyecto-caido',
    async leer() {
      try {
        const datos = await leer();
        if (!datos.disponible) {
          return { entidades: [], problema: `taller sin pulse: ${datos.error ?? 'sin-configurar'}`, sinLectura: true };
        }
        return {
          entidades: entidadesDeTaller(datos.contenedores, datos.proyectos),
          problema: datos.error === null ? null : `taller: ${datos.error}`,
        };
      } catch (err) {
        return { entidades: [], problema: `no se pudo leer el taller: ${mensaje(err)}`, sinLectura: true };
      }
    },
  };
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
