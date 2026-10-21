/* Fuente «problemas» de la campana (20AA-25 N1): las líneas de la consola de problemas.
 * [por que reutiliza la consola] Es la misma agregación que pinta el botón «problemas (N)»: la
 * campana no puede tener su propia idea de qué es un problema, o avisaría de cosas que el tablero
 * no cuenta. Entran las entradas ya clasificadas (`grupos`), no se vuelve a leer el disco.
 * Clave: `grupo|categoría|huella del motivo`, normalizada. [por que no el índice] La consola no
 * tiene ids: reordenar líneas o cambiar un contador de commits no puede convertir un problema
 * viejo en uno nuevo. La huella quita lo que fluctúa (números, tiempos, pids) y deja lo que
 * identifica: la categoría, el archivo, el paquete, la regla. */
import type { Entrada } from '../../../shared/consola/clasificacionConsola/consola-tipos.js';
import type { Entidad, Fuente } from '../../../shared/notificaciones/tipos.js';

export interface GrupoProblemas {
  clave: string;
  id: string;
  entradas: Entrada[];
}

/* Tope de entidades: la consola de un área grande no debe inflar el almacén con los avisos. */
export const TOPE_PROBLEMAS = 1000;

/* Categorías que no son defectos y por tanto no generan avisos. [por que]
 *  - `pendiente`: es trabajo del roadmap, y las tareas ya tienen SU propia fuente (avisar dos
 *    veces de lo mismo, con dos textos, es justo el ruido que la usuaria no quiere).
 *  - `dev`, `taller`: hablan de procesos y conformidad de la máquina; su altibajo es constante y
 *    ya se ve en el panel del mando dev. Un toast por cada arranque no informa de nada. */
const SIN_AVISO = new Set<string>(['pendiente', 'dev', 'taller']);

/* Normaliza el motivo para que su huella sobreviva a lo que cambia sin significar nada: números
 * (líneas, contadores, pids, puertos) se colapsan y los espacios se juntan. Lo que queda es el
 * asunto. */
export function huellaMotivo(motivo: string): string {
  return motivo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function entidadesDeProblemas(grupos: GrupoProblemas[]): Entidad[] {
  const salida: Entidad[] = [];
  const vistos = new Set<string>();
  for (const g of grupos) {
    for (const e of g.entradas) {
      if (SIN_AVISO.has(e.categoria)) continue;
      const huella = huellaMotivo(e.motivo);
      if (huella === '') continue;
      /* Dos líneas con la misma huella en el mismo grupo son el mismo asunto (p. ej. la misma
       * regla repetida en dos líneas): se anuncia una vez. */
      const clave = `${g.clave}|${e.categoria}|${huella}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({ clave, titulo: recortar(e.motivo.trim(), 120), detalle: `${g.id} · ${e.categoria}` });
      if (salida.length >= TOPE_PROBLEMAS) return salida;
    }
  }
  return salida;
}

function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/* La fuente. `leerGrupos` la inyecta el servidor con la agregación de la consola ya resuelta (la
 * misma función que responde `/api/consola/problemas`), así que aquí no hay E/S ni rutas. */
export function fuenteProblemas(leerGrupos: () => GrupoProblemas[] | Promise<GrupoProblemas[]>): Fuente {
  return {
    nombre: 'problemas',
    tipoAlta: 'problema-detectado',
    tipoBaja: 'problema-resuelto',
    async leer() {
      try {
        return { entidades: entidadesDeProblemas(await leerGrupos()), problema: null };
      } catch (err) {
        return { entidades: [], problema: `no se pudo leer la consola: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
