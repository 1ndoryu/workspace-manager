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
import type {
  Aviso,
  EstadoNotificaciones,
  Fuente,
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

export interface OpcionesServicio {
  rutaFichero: string;
  fuentes: Fuente[];
  /* Reloj inyectable para las pruebas. */
  ahora?: () => Date;
  calmaMs?: number;
  latidoMs?: number;
  /* Se llama por cada aviso nuevo, además de los suscriptores del canal propio. [por que existe]
   * El canal único del tablero (20AA-24) y la campana son dos transportes del mismo hecho: quien
   * compone el servidor engancha aquí el bus y el aviso viaja por los dos sin releer nada. */
  alAviso?: (aviso: Aviso) => void;
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
  /* Suscripción para el SSE: devuelve la baja. */
  suscribir: (aviso: (a: Aviso) => void) => () => void;
  detener: () => Promise<void>;
  almacen: AlmacenNotificaciones;
}

export function crearServicioNotificaciones(opciones: OpcionesServicio): ServicioNotificaciones {
  const almacen = crearAlmacenNotificaciones(opciones.rutaFichero, () => (opciones.ahora ?? (() => new Date()))().getTime());
  const ahora = opciones.ahora ?? (() => new Date());
  const calmaMs = opciones.calmaMs ?? CALMA_MS;
  const latidoMs = opciones.latidoMs ?? LATIDO_MS;

  const emisor = new EventEmitter();
  emisor.setMaxListeners(0);
  let suscriptores = 0;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let latido: ReturnType<typeof setInterval> | null = null;
  let enVuelo: Promise<Aviso[]> | null = null;

  function avisar(aviso: Aviso): void {
    emisor.emit('aviso', aviso);
    opciones.alAviso?.(aviso);
  }

  async function correr(): Promise<Aviso[]> {
    /* Una sola pasada a la vez: dos lecturas seguidas de las mismas fuentes producirían el mismo
     * diff, y el segundo intentaría emitir avisos ya emitidos. Quien llega mientras corre espera
     * a la que hay. */
    if (enVuelo !== null) return enVuelo;
    enVuelo = (async () => {
      try {
        const r = await pasada(opciones.fuentes, almacen.motor(), () => ahora());
        almacen.guardarPasada(r.estado, ahora().toISOString(), r.rotas);
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

  function programar(): void {
    if (temporizador !== null) return;
    const t = setTimeout(() => {
      temporizador = null;
      /* `correr` nunca lanza: las fuentes rotas vienen en el resultado. */
      void correr();
    }, calmaMs);
    temporizador = t;
    (t as { unref?: () => void }).unref?.();
  }

  /* El latido solo existe mientras haya alguien escuchando. */
  function ajustarLatido(): void {
    if (suscriptores > 0 && latido === null) {
      latido = setInterval(() => void correr(), latidoMs);
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
