/* Sincronia automatica del roadmap con TASK (20AA-10 F6).
 * [por que existe] La sincronizacion tiene que correr sola —en el ciclo de escaneo y tras cada
 * accion del tab— y sin botones: si hay que acordarse de pulsarla, el roadmap y el tab se separan
 * y quien mira uno de los dos ve trabajo que no existe (o no ve el que hay). Aqui vive el CUANDO;
 * el QUE (leer los roadmaps y escribir en TASK) sigue en `sincronizar-tareas.ts`, que no sabe de
 * tiempos y por eso se puede probar sin ellos.
 * [por que con calma] Los cambios llegan a rafagas (guardar un roadmap, varios gestos seguidos en
 * el tab): una ventana corta los junta en una pasada en vez de una por gesto.
 * [por que de una en una] Dos pasadas a la vez escribirian lo mismo dos veces y competirian por la
 * cuota de TASK; si llega una peticion mientras corre, se rearma al terminar en vez de solaparse.
 * [por que nunca lanza] Esto corre detras de un escaneo o de un gesto de la usuaria: un fallo de
 * TASK no puede tumbar lo que lo disparo. Lo que falle se dice en `estado()`, no en el vacio. */
import {
  sincronizarTareasRoadmap,
  type DepsSincronizarTareas,
  type InformeSync,
} from './sincronizar-tareas.js';

/* Ventana de calma: lo que llega dentro de ella se atiende en la misma pasada. */
export const CALMA_MS = 5000;
/* Tope de escrituras por pasada (medido: 197 PUT en 51 s). Con el, una pasada de fondo no pasa de
 * ~15 s; lo que sobra lo sigue la siguiente, que se rearma sola. */
export const TOPE_ESCRITURAS = 60;
/* Espera entre pasadas cuando la anterior dejo trabajo aplazado: no hay nada nuevo que agrupar,
 * asi que no se espera la ventana entera. */
export const CALMA_APLAZADAS_MS = 1500;

export interface OpcionesFondo {
  calmaMs?: number;
  topeEscrituras?: number;
  calmaAplazadasMs?: number;
}

export interface EstadoSincronia {
  /* Hay una pasada en vuelo ahora mismo. */
  enCurso: boolean;
  /* Se pidio otra mientras corria: se lanza al terminar. */
  rearmada: boolean;
  /* Pasadas terminadas desde que arranco el proceso. */
  pasadas: number;
  /* Ultima pasada terminada, con su informe, o null si aun no ha corrido ninguna. */
  ultima: { cuando: string; informe: InformeSync } | null;
  /* Por que fallo la ultima pasada entera (TASK caido, roadmap ilegible). Los fallos de una sola
   * tarea van dentro del informe, en `errores`. */
  ultimoError: string | null;
}

export interface SincroniaFondo {
  /* Pide una pasada. Repetir la peticion antes de que corra no acumula pasadas: rearma la calma. */
  programar: () => void;
  estado: () => EstadoSincronia;
  /* Cancela lo programado y espera a que termine lo que este en vuelo (cierre ordenado y tests). */
  detener: () => Promise<void>;
}

/* Escrituras que el tope dejo fuera, sumando los proyectos de la pasada. */
function aplazadasDe(informe: InformeSync): number {
  return informe.detalle.reduce((n, d) => n + d.aplazadas, 0);
}

export function crearSincroniaFondo(
  deps: DepsSincronizarTareas,
  opciones: OpcionesFondo = {},
): SincroniaFondo {
  const calmaMs = opciones.calmaMs ?? CALMA_MS;
  const topeEscrituras = opciones.topeEscrituras ?? TOPE_ESCRITURAS;
  const calmaAplazadasMs = opciones.calmaAplazadasMs ?? CALMA_APLAZADAS_MS;

  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enCurso: Promise<InformeSync | null> | null = null;
  let rearmada = false;
  let pasadas = 0;
  let ultima: EstadoSincronia['ultima'] = null;
  let ultimoError: string | null = null;

  function programarEn(ms: number): void {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      void correr();
    }, ms);
    /* Un temporizador de fondo no debe mantener vivo el proceso: si el servidor ya no tiene nada
     * que servir, no se espera a esta pasada. */
    (temporizador as { unref?: () => void }).unref?.();
  }

  async function correr(): Promise<void> {
    /* Ya hay una en vuelo: no se solapa, se apunta para despues. */
    if (enCurso !== null) {
      rearmada = true;
      return;
    }
    enCurso = (async () => {
      let informe: InformeSync | null = null;
      try {
        informe = await sincronizarTareasRoadmap(deps, { topeEscrituras });
        ultima = { cuando: new Date().toISOString(), informe };
        ultimoError = null;
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e);
      }
      pasadas += 1;
      return informe;
    })();
    const informe = await enCurso;
    enCurso = null;
    if (rearmada) {
      rearmada = false;
      programarEn(calmaMs);
      return;
    }
    /* Quedo trabajo: se sigue sin esperar la ventana entera, pero solo si la pasada avanzo. Una
     * pasada que no escribe nada y lo aplaza todo (TASK rechazando el mismo bloque) se pararia
     * aqui: rearmarla seria un bucle. */
    if (informe !== null && aplazadasDe(informe) > 0 && informe.crear + informe.actualizar > 0) {
      programarEn(calmaAplazadasMs);
    }
  }

  return {
    programar: () => programarEn(calmaMs),
    estado: () => ({ enCurso: enCurso !== null, rearmada, pasadas, ultima, ultimoError }),
    detener: async () => {
      if (temporizador !== null) {
        clearTimeout(temporizador);
        temporizador = null;
      }
      rearmada = false;
      await enCurso;
    },
  };
}
