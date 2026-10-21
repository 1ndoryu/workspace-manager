/* Canal de eventos del tablero (20AA-24 F3.1).
 *   GET /api/eventos                   SSE: un evento por tema cuando cambia
 *   GET /api/eventos?vivos=1&dev=0     sólo los temas que la pestaña necesita
 *   GET /api/eventos?solo-ultimos=1    sin canal: la foto de ahora mismo (para pruebas y arranque)
 * [por que un canal y no sondeo] El tablero sondeaba cinco rutas con cinco cadencias distintas y
 * el mapa no sondeaba ninguna: recargar era la única forma de ver un cambio. Con el canal hay una
 * sola conexión por pestaña y el servidor decide cuándo ha cambiado algo.
 * [por que reenvía en flujo] El proxy de la app de escritorio y el túnel cierran una conexión en
 * la que no pasa nada en un minuto; el latido de 20 s la mantiene viva sin despertar al cliente. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import type { BusEventos, Evento, TemaEvento } from './bus.js';

export const PING_MS = 20_000;

const TEMAS: readonly TemaEvento[] = ['workspace', 'vivos', 'avisos'];

/* Qué temas pide la pestaña. [por que por parámetro] El mapa sólo necesita `workspace` y `vivos`;
 * el panel dev, `dev`; la campana, `avisos`. Suscribir a todo haría que cada pestaña recibiera
 * el snapshot entero aunque sólo enseñara el taller. Sin parámetros, todos (el GET de arranque). */
export function temasPedidos(url: URL): TemaEvento[] {
  const pedidos = TEMAS.filter((t) => url.searchParams.get(t) !== '0');
  return pedidos.length > 0 ? pedidos : [...TEMAS];
}

/* `alCambiarSuscriptores` avisa al publicador de vivos para que encienda o apague su ciclo: sin
 * esto, el latido seguiría corriendo con el canal cerrado o no arrancaría nunca. */
export function crearManejadorEventos(bus: BusEventos, alCambiarSuscriptores?: () => void) {
  return async function manejarRutasEventos(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ruta: string,
  ): Promise<boolean> {
    if (ruta !== '/api/eventos') return false;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    if (url.searchParams.get('solo-ultimos') === '1') {
      json(res, 200, { ultimoId: bus.ultimoId(), eventos: bus.ultimos() });
      return true;
    }
    atenderCanal(req, res, bus, temasPedidos(url), alCambiarSuscriptores);
    return true;
  };
}

function atenderCanal(
  req: IncomingMessage,
  res: ServerResponse,
  bus: BusEventos,
  temas: TemaEvento[],
  alCambiarSuscriptores?: () => void,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  /* `writeHead` sólo encola: sin esto el cliente no sabe que el canal está abierto hasta el primer
   * latido si no hay historia que mandar. */
  res.flushHeaders?.();
  try {
    res.socket?.setTimeout(0);
  } catch {
    /* best-effort */
  }

  const desde = idDeReconexion(req);
  const permitidos = new Set<TemaEvento>(temas);
  /* Reconexión: sólo lo posterior al último visto, y sólo de los temas pedidos. */
  for (const evento of bus.desde(desde)) {
    if (permitidos.has(evento.tema)) escribir(res, evento);
  }

  const bajas = temas.map((tema) =>
    bus.suscribir(tema, (evento) => escribir(res, evento)),
  );
  alCambiarSuscriptores?.();
  const ping = setInterval(() => {
    try {
      res.write(': latido\n\n');
    } catch {
      /* El cierre lo detecta `close`. */
    }
  }, PING_MS);
  (ping as { unref?: () => void }).unref?.();

  const cerrar = (): void => {
    clearInterval(ping);
    for (const baja of bajas) baja();
    alCambiarSuscriptores?.();
  };
  req.on('close', cerrar);
  req.on('error', cerrar);
}

/* El nombre del evento SSE es el tema: el cliente hace `addEventListener('workspace', …)` y no
 * tiene que mirar dentro del `data` para saber qué le llegó. */
function escribir(res: ServerResponse, evento: Evento): void {
  try {
    res.write(`id: ${evento.id}\nevent: ${evento.tema}\ndata: ${JSON.stringify(evento)}\n\n`);
  } catch {
    /* Cliente ido: la baja la hace `close`. */
  }
}

/* `Last-Event-ID` es la cabecera estándar y `EventSource` la pone sola al reconectar. El parámetro
 * `desde` existe para las pruebas y para un cliente que no sea `EventSource`. */
function idDeReconexion(req: IncomingMessage): number {
  const cabecera = req.headers['last-event-id'];
  const bruto = Array.isArray(cabecera) ? cabecera[0] : cabecera;
  const n = Number(bruto);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
