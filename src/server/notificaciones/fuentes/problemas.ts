/* Fuente «problemas» de la campana (20AA-25 N1): las líneas de la consola de problemas.
 * [por que reutiliza la consola] Es la misma agregación que pinta el botón «problemas (N)»: la
 * campana no puede tener su propia idea de qué es un problema, o avisaría de cosas que el tablero
 * no cuenta. Entran las entradas ya clasificadas (`grupos`), no se vuelve a leer el disco.
 * Clave: `grupo|categoría|huella del motivo`, normalizada. [por que no el índice] La consola no
 * tiene ids: reordenar líneas o cambiar un contador de commits no puede convertir un problema
 * viejo en uno nuevo. La huella quita lo que fluctúa (números, tiempos, pids) y deja lo que
 * identifica: la categoría, el archivo, el paquete, la regla. */
import type { Entrada } from '../../../shared/consola/clasificacionConsola/consola-tipos.js';
/* La huella es una sola para toda la consola (20AA-30 N4-1): aquí ya no se calcula, se usa. */
import { huellaMotivo } from '../../../shared/consola/clasificacionConsola/consola-util.js';
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

/* Lo que devuelve una lectura: los grupos y qué proyectos no se pudieron mirar. [por que una sola
 * lectura] `sinVer` describe ESA agregación; pedirlos por separado daría dos fotos distintas. */
export interface LecturaProblemas {
  grupos: GrupoProblemas[];
  /* Prefijos de clave (`proyecto|`) cuyos problemas no se pueden dar de baja por no haberlos
   * mirado (sin análisis vigente): no verlos no es resolverlos (20AA-31). */
  sinVer: string[];
}

/* La fuente. `leer` la inyecta el servidor con la agregación de la consola ya resuelta (la misma
 * función que responde `/api/consola/problemas`), así que aquí no hay E/S ni rutas. */
export function fuenteProblemas(
  leer: () => LecturaProblemas | Promise<LecturaProblemas>,
): Fuente {
  return {
    nombre: 'problemas',
    tipoAlta: 'problema-detectado',
    tipoBaja: 'problema-resuelto',
    async leer() {
      try {
        const r = await leer();
        return { entidades: entidadesDeProblemas(r.grupos), problema: null, sinVer: r.sinVer };
      } catch (err) {
        /* `sinLectura`: sin la consola no se puede decir que los problemas se resolvieron. */
        return {
          entidades: [],
          problema: `no se pudo leer la consola: ${err instanceof Error ? err.message : String(err)}`,
          sinLectura: true,
        };
      }
    },
  };
}
