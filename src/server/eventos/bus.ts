/* Bus de eventos del tablero (20AA-24 F3.1): un solo canal SSE para todo lo que cambia.
 * [por que un bus y no un canal por dominio] El plan tenía tres canales (workspace, vivos,
 * notificaciones); con tres temporizadores y tres reconexiones, una pestaña acaba con datos de
 * instantes distintos y el mapa enseña un estado que nunca existió. Aquí hay un tema por dominio
 * (`workspace`, `dev`, `vivos`, `avisos`), un solo contador de ids y una sola reconexión.
 * [por que el bus no sabe leer nada] Es sólo reparto: quien publica es el servicio que ya tiene
 * el dato (escaneo, vigilancia, sondeo, campana). Así cualquier fuente futura se engancha sin
 * tocar el transporte, y el bus se prueba sin red ni relojes.
 * [por que el id es global y no por tema] `Last-Event-ID` es una sola cabecera por conexión: si
 * cada tema numerara por su cuenta, reconectar no sabría desde dónde reanudar cada uno. Con un
 * contador único, «lo posterior a N» se puede reconstruir tema a tema. */
import { EventEmitter } from 'node:events';

/** Temas del canal. Añadir uno es añadir una clave aquí y un publicador. */
export type TemaEvento = 'workspace' | 'vivos' | 'avisos';

export interface Evento {
  id: number;
  tema: TemaEvento;
  cuando: string;
  datos: unknown;
}

/* Cuántos eventos se guardan para reconexiones con `Last-Event-ID`. [por que acotado] El canal
 * puede quedarse abierto días; un histórico sin tope es una fuga. 200 eventos de estos tamaños
 * (el snapshot entero es el mayor, ~70 KB) son unos pocos MB en el peor caso, y una pestaña que
 * lleve más de 200 eventos desconectada se resincroniza con el GET, no con la historia. */
export const TOPE_HISTORIA = 200;

export interface BusEventos {
  publicar: (tema: TemaEvento, datos: unknown) => Evento;
  /* Suscripción a un tema concreto. Devuelve la baja. */
  suscribir: (tema: TemaEvento, oyente: (e: Evento) => void) => () => void;
  /* Eventos posteriores a `id`, del más viejo al más nuevo. */
  desde: (id: number) => Evento[];
  /* Último evento de cada tema: lo que un cliente nuevo necesita para pintar sin pedir nada. */
  ultimos: () => Partial<Record<TemaEvento, Evento>>;
  ultimoId: () => number;
  suscriptores: () => number;
  detener: () => void;
}

export function crearBusEventos(ahora: () => Date = () => new Date()): BusEventos {
  const emisor = new EventEmitter();
  emisor.setMaxListeners(0);
  const historia: Evento[] = [];
  const ultimoPorTema = new Map<TemaEvento, Evento>();
  let id = 0;
  let oyentes = 0;

  return {
    publicar(tema, datos) {
      const evento: Evento = { id: ++id, tema, cuando: ahora().toISOString(), datos };
      historia.push(evento);
      /* Se recorta de uno en uno: un splice de golpe cada N dejaría picos de memoria. */
      if (historia.length > TOPE_HISTORIA) historia.shift();
      ultimoPorTema.set(tema, evento);
      emisor.emit(tema, evento);
      return evento;
    },
    suscribir(tema, oyente) {
      emisor.on(tema, oyente);
      oyentes += 1;
      return () => {
        emisor.off(tema, oyente);
        oyentes -= 1;
      };
    },
    desde(desdeId) {
      return historia.filter((e) => e.id > desdeId);
    },
    ultimos() {
      return Object.fromEntries(ultimoPorTema) as Partial<Record<TemaEvento, Evento>>;
    },
    ultimoId: () => id,
    suscriptores: () => oyentes,
    detener() {
      emisor.removeAllListeners();
      oyentes = 0;
      historia.length = 0;
      ultimoPorTema.clear();
    },
  };
}
