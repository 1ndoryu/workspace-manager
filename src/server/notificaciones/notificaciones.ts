/* Servicio de notificaciones (20AA-25 N2): compone fuentes, motor, almacén y suscriptores, y
 * decide CUÁNDO correr una pasada.
 * [por que un servicio y no una ruta] El ciclo de pasadas lo disparan tres cosas que ya existen
 * (fin de un escaneo de verdad, una acción de la usuaria y el sondeo de estado que el panel hace
 * igualmente). Ninguna añade un temporizador: la ruta solo llama a `programar()`, igual que la
 * sincronía de fondo. Una pasada a la vez y con calma: dos gestos seguidos son una pasada.
 * [por que el diff no se recalcula por suscriptor] El motor corre una vez y reparte el mismo
 * aviso a la campana y al toast del sistema (20AA-27). Rust no puede tener su propia idea de qué
 * pasó, o los dos avisos dirían cosas distintas. */
import { EventEmitter } from 'node:events';
import { CAMPANA_ACTIVA } from '../../shared/notificaciones/tipos.js';
import type {
  Aviso,
  EstadoNotificaciones,
  Fuente,
  InterruptorCampana,
  TipoAviso,
} from '../../shared/notificaciones/tipos.js';
import { crearAlmacenNotificaciones, type AlmacenNotificaciones } from './almacen.js';
import { pasada } from './motor.js';

/* Calma entre pasadas: junta lo que llega en ráfaga (un escaneo que descubre diez cambios) en
 * una sola lectura de las fuentes. */
export const CALMA_MS = 1500;

/* Cadencia máxima de las pasadas mientras haya un suscriptor vivo. [por que existe] Las fuentes
 * de estado (sitios, taller) las sirve una caché que se refresca sola, pero nadie las lee si no
 * hay UI abierta: sin este latido una caída se anunciaría con la siguiente interacción, quizás
 * horas después. Una lectura cada 10 s de cachés ya calientes es lo mínimo para que «en tiempo
 * real» no dependa de que alguien mire. Sin suscriptores no corre: no hay a quién avisar. */
export const LATIDO_MS = 10_000;

/* Reintento mientras la sincronía de fondo sigue escribiendo. [por que corto] No es un sondeo de
 * estado: es esperar a que el otro escritor termine, y ese es un plazo de segundos. */
export const ESPERA_SINCRONIA_MS = 1000;

export interface OpcionesServicio {
  rutaFichero: string;
  fuentes: Fuente[];
  /* Interruptor de la función (20AA-32). Apagada: `correr` no lee ninguna fuente, `programar` no
   * arma temporizador y `suscribir` no enciende el latido. [por que aquí y no solo en el entry]
   * Un `if` en cada disparador (escaneo, gesto, latido, ruta SSE) se olvida en el quinto; el
   * servicio es el único sitio por el que pasan todas las pasadas. */
  campana?: InterruptorCampana;
  /* Reloj inyectable para las pruebas. */
  ahora?: () => Date;
  calmaMs?: number;
  latidoMs?: number;
  /* Se llama por cada aviso nuevo, además de los suscriptores del canal propio. [por que existe]
   * El canal único del tablero (20AA-24) y la campana son dos transportes del mismo hecho: quien
   * compone el servidor engancha aquí el bus y el aviso viaja por los dos sin releer nada. */
  alAviso?: (aviso: Aviso) => void;
  /* Hay una sincronía de fondo escribiendo roadmaps ahora mismo. [por que existe] Las dos se
   * programan con el mismo escaneo, pero la sincronía tarda segundos en escribir archivos: una
   * pasada de avisos en medio leería una foto a medias y dispararía otra al terminar. Con esto, la
   * pasada espera a que el área esté quieta y corre una sola vez (20AA-30 N4-3). */
  sincroniaEnCurso?: () => boolean;
}

/* Lo que se emite por SSE. `tipo` es obligatorio para `iniciarSse`; el resto, el aviso entero. */
export interface EventoNotificacion {
  tipo: 'aviso';
  aviso: Aviso;
}

export interface ServicioNotificaciones {
  estado: () => EstadoNotificaciones;
  /* Pide una pasada (con calma). Repetirla no acumula: reinicia la espera. */
  programar: () => void;
  /* Una pasada inmediata; la usan el arranque y las pruebas. */
  correr: () => Promise<Aviso[]>;
  marcarLeidos: (ids?: number[]) => void;
  silenciar: (tipos: TipoAviso[]) => void;
  /* El interruptor que este servicio aplica, para que las rutas no lo dupliquen. */
  campana: InterruptorCampana;
  /* Suscripción para el SSE: devuelve la baja. */
  suscribir: (aviso: (a: Aviso) => void) => () => void;
  detener: () => Promise<void>;
  almacen: AlmacenNotificaciones;
}

export function crearServicioNotificaciones(opciones: OpcionesServicio): ServicioNotificaciones {
  const campana = opciones.campana ?? CAMPANA_ACTIVA;
  const almacen = crearAlmacenNotificaciones(
    opciones.rutaFichero,
    () => (opciones.ahora ?? (() => new Date()))().getTime(),
    campana,
  );
  const ahora = opciones.ahora ?? (() => new Date());
  const calmaMs = opciones.calmaMs ?? CALMA_MS;
  const latidoMs = opciones.latidoMs ?? LATIDO_MS;

  const emisor = new EventEmitter();
  emisor.setMaxListeners(0);
  let suscriptores = 0;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let latido: ReturnType<typeof setInterval> | null = null;
  let enVuelo: Promise<Aviso[]> | null = null;
  /* Cuándo terminó la última pasada (ms). Sólo lo usa `recienCorrida`. */
  let ultimaPasada: number | null = null;

  function avisar(aviso: Aviso): void {
    emisor.emit('aviso', aviso);
    opciones.alAviso?.(aviso);
  }

  async function correr(): Promise<Aviso[]> {
    /* Apagada no se lee nada: es la promesa entera de la 20AA-32 (cero lecturas, cero avisos). */
    if (!campana.activa) return [];
    /* Una sola pasada a la vez: dos lecturas seguidas de las mismas fuentes producirían el mismo
     * diff, y el segundo intentaría emitir avisos ya emitidos. Quien llega mientras corre espera
     * a la que hay. */
    if (enVuelo !== null) return enVuelo;
    enVuelo = (async () => {
      try {
        const r = await pasada(opciones.fuentes, almacen.motor(), () => ahora());
        almacen.guardarPasada(r.estado, ahora().toISOString(), r.rotas);
        ultimaPasada = ahora().getTime();
        almacen.anadir(r.avisos);
        for (const aviso of r.avisos) avisar(aviso);
        /* Las fuentes rotas no se avisan: no son un suceso del área, son un fallo del propio
         * tablero, y se ven en la campana como banda de estado. */
        return r.avisos;
      } finally {
        enVuelo = null;
      }
    })();
    return enVuelo;
  }

  /* ¿Hay que esperar? Solo por la sincronía. [por que no por `enVuelo`] Con una pasada en vuelo,
   * `correr` ya devuelve la que hay: esperar aquí no añadiría nada. */
  function esperarSincronia(): boolean {
    return opciones.sincroniaEnCurso?.() === true;
  }

  function programar(ms: number = calmaMs): void {
    if (!campana.activa) return;
    if (temporizador !== null) return;
    const t = setTimeout(() => {
      temporizador = null;
      if (recienCorrida()) return;
      /* La sincronía late una vez al terminar; mientras escriba, esta pasada vería media foto. */
      if (esperarSincronia()) {
        programar(ESPERA_SINCRONIA_MS);
        return;
      }
      /* `correr` nunca lanza: las fuentes rotas vienen en el resultado. */
      void correr();
    }, ms);
    temporizador = t;
    (t as { unref?: () => void }).unref?.();
  }

  /* ¿Acaba de correr una pasada? [por que] Quien pide una pasada ya suele ser el final de un
   * escaneo o un gesto, y el motor corre otra vez a los pocos instantes por el mismo hecho: dos
   * lecturas seguidas de las mismas fuentes dan el mismo diff, y la segunda no puede anunciar
   * nada. Este es el único criterio, y no depende de quién haya pedido: si la anterior terminó
   * hace menos de una calma, lo que hay en disco es lo que acaba de leer. `correr` no pasa por
   * aquí (es una pasada inmediata y explícita). */
  function recienCorrida(): boolean {
    return ultimaPasada !== null && ahora().getTime() - ultimaPasada < calmaMs;
  }

  /* El latido solo existe mientras haya alguien escuchando. [por que pasa por `programar`] Para
   * heredar la misma espera que las demás: sin alguien mirando no hay prisa, y leer a mitad de una
   * sincronía da una foto a medias. */
  function ajustarLatido(): void {
    if (!campana.activa) return;
    if (suscriptores > 0 && latido === null) {
      latido = setInterval(() => programar(), latidoMs);
      (latido as { unref?: () => void }).unref?.();
      return;
    }
    if (suscriptores === 0 && latido !== null) {
      clearInterval(latido);
      latido = null;
    }
  }

  return {
    estado: () => almacen.estado(),
    campana,
    programar,
    correr,
    marcarLeidos(ids) {
      almacen.marcarLeidos(ids);
    },
    silenciar: (tipos) => almacen.silenciar(tipos),
    suscribir(aviso) {
      emisor.on('aviso', aviso);
      suscriptores += 1;
      ajustarLatido();
      return () => {
        emisor.off('aviso', aviso);
        suscriptores -= 1;
        ajustarLatido();
      };
    },
    async detener() {
      if (temporizador !== null) {
        clearTimeout(temporizador);
        temporizador = null;
      }
      if (latido !== null) {
        clearInterval(latido);
        latido = null;
      }
      if (enVuelo !== null) await enVuelo.catch(() => undefined);
      almacen.cerrar();
    },
    almacen,
  };
}
