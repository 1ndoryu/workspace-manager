/* Caché del listado de proyectos de TASKS (las columnas del tab).
 * [por que] Cada GET de columnas consultaba al servicio TASKS en cada petición: medido 0,6–1,3 s
 * solo en su 401 sin credenciales, y la tab la pide a menudo. Aquí se guarda unos segundos, las
 * llamadas simultáneas comparten un solo vuelo y solo cuenta lo que llegó bien. */
import type {ProyectoPuente} from '../tarea-unitaria.js';

export interface CacheProyectos {
  obtener(): Promise<ProyectoPuente[]>;
  /* Para cuando cambia el listado (p. ej. al crear una columna): la siguiente lectura va al servicio. */
  invalidar(): void;
}

export function crearCacheProyectos(
  pedir: () => Promise<ProyectoPuente[]>,
  ttlMs: number,
  ahora: () => number = Date.now,
): CacheProyectos {
  let datos: {ts: number; valor: ProyectoPuente[]} | null = null;
  let vuelo: Promise<ProyectoPuente[]> | null = null;
  /* [por que] Cada invalidación sube la generación: un vuelo que termina después trae datos
   * anteriores al cambio y no debe guardarse como buenos. */
  let generacion = 0;

  function lanzar(): Promise<ProyectoPuente[]> {
    const gen = generacion;
    const nuevo: Promise<ProyectoPuente[]> = pedir()
      .then((valor) => {
        if (gen === generacion) datos = {ts: ahora(), valor};
        return valor;
      })
      .finally(() => {
        /* Solo limpia su propio vuelo: si hubo invalidación, ya hay otro en curso. */
        if (vuelo === nuevo) vuelo = null;
      });
    vuelo = nuevo;
    return nuevo;
  }

  return {
    obtener() {
      if (datos && ahora() - datos.ts < ttlMs) return Promise.resolve(datos.valor);
      return vuelo ?? lanzar();
    },
    invalidar() {
      generacion++;
      datos = null;
      vuelo = null;
    },
  };
}
