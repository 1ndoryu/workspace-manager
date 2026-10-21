/* Rutas de la campana (20AA-25 N2).
 *   GET  /api/notificaciones            estado completo (avisos, preferencias, fuentes rotas)
 *   GET  /api/notificaciones/eventos    SSE: un evento `aviso` por aviso nuevo
 *   POST /api/notificaciones/leidas     { ids?: number[] }  (sin ids = todas)
 *   POST /api/notificaciones/silenciar  { tipos: string[] }
 * [por que SSE y no sondeo] La campana no puede preguntar cada segundo: el servidor ya sabe
 * cuándo hay algo nuevo, y una conexión abierta por pestaña cuesta un descriptor y cero CPU
 * mientras no pasa nada. `Last-Event-ID` hace que reconectar (la app de escritorio reabre el
 * canal al dormir el equipo) no repita lo ya visto.
 * [por que la lista va entera en el GET] Son 500 avisos como mucho y la campana los necesita
 * todos para agrupar por día; paginar aquí sólo añadiría estado en el cliente. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, leerBody } from '../http.js';
import type { TipoAviso } from '../../shared/notificaciones/tipos.js';
import type { ServicioNotificaciones } from './notificaciones.js';

const TIPOS: ReadonlySet<string> = new Set<TipoAviso>([
  'tarea-nueva',
  'tarea-completada',
  'problema-detectado',
  'problema-resuelto',
  'sitio-caido',
  'sitio-recuperado',
]);

/* Latido del canal: un comentario SSE cada 20 s. [por que] Un proxy (el túnel, el proxy de la app
 * de escritorio) cierra una conexión en la que no pasa nada durante un minuto; el comentario la
 * mantiene viva sin despertar a nadie en el cliente. */
const PING_MS = 20_000;

export function crearManejadorNotificaciones(servicio: ServicioNotificaciones) {
  return async function manejarRutasNotificaciones(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ruta: string,
  ): Promise<boolean> {
    if (!ruta.startsWith('/api/notificaciones')) return false;

    if (ruta === '/api/notificaciones' && req.method === 'GET') {
      json(res, 200, servicio.estado());
      return true;
    }

    if (ruta === '/api/notificaciones/eventos' && req.method === 'GET') {
      atenderCanal(req, res, servicio, url);
      return true;
    }

    if (ruta === '/api/notificaciones/leidas' && req.method === 'POST') {
      const cuerpo = await leerBody(req).catch(() => ({}));
      const ids = idsDe(cuerpo);
      if (ids === 'invalido') {
        json(res, 400, { error: 'ids-invalidos' });
        return true;
      }
      servicio.marcarLeidos(ids);
      json(res, 200, { ok: true });
      return true;
    }

    if (ruta === '/api/notificaciones/silenciar' && req.method === 'POST') {
      const cuerpo = await leerBody(req).catch(() => ({}));
      const tipos = tiposDe(cuerpo);
      if (tipos === 'invalido') {
        json(res, 400, { error: 'tipos-invalidos', permitidos: [...TIPOS] });
        return true;
      }
      servicio.silenciar(tipos);
      json(res, 200, { ok: true, silenciados: tipos });
      return true;
    }

    /* Ruta conocida con otro método: se dice, no se deja caer al 404 genérico. */
    if (ruta.startsWith('/api/notificaciones')) {
      json(res, 405, { error: 'Metodo no permitido' });
      return true;
    }
    return false;
  };
}

/* El cuerpo de /leidas: ausente o vacío = todas; lista de enteros = esas. Cualquier otra cosa es
 * un error del cliente, no un «marca todas». */
function idsDe(cuerpo: unknown): number[] | undefined | 'invalido' {
  if (cuerpo === null || typeof cuerpo !== 'object') return 'invalido';
  const bruto = (cuerpo as { ids?: unknown }).ids;
  if (bruto === undefined || bruto === null) return undefined;
  if (!Array.isArray(bruto)) return 'invalido';
  const ids = bruto.filter((v): v is number => Number.isInteger(v) && (v as number) > 0);
  return ids.length === bruto.length ? ids : 'invalido';
}

function tiposDe(cuerpo: unknown): TipoAviso[] | 'invalido' {
  if (cuerpo === null || typeof cuerpo !== 'object') return 'invalido';
  const bruto = (cuerpo as { tipos?: unknown }).tipos;
  if (!Array.isArray(bruto)) return 'invalido';
  if (!bruto.every((t) => typeof t === 'string' && TIPOS.has(t))) return 'invalido';
  return [...new Set(bruto as TipoAviso[])];
}

/* Canal SSE. Se manda la historia reciente al conectar —para que la campana se pinte sin una
 * petición previa— y a partir de ahí sólo lo nuevo. Con `Last-Event-ID`, la historia se recorta a
 * lo posterior: es la reconexión de la app de escritorio tras dormir el equipo. */
function atenderCanal(req: IncomingMessage, res: ServerResponse, servicio: ServicioNotificaciones, url: URL): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  /* [por que] `writeHead` sólo encola las cabeceras: si no hay historia que escribir, el cliente
   * no sabe que el canal está abierto hasta el primer latido (20 s), y todo lo que pase entretanto
   * se pierde si decide reconectar. Esto las manda ya. */
  res.flushHeaders?.();
  try {
    res.socket?.setTimeout(0);
  } catch {
    /* best-effort */
  }

  const desde = idDeReconexion(req);
  const avisos = servicio.estado().avisos;
  /* `?sin-historia=1` es para el toast del sistema (20AA-27): necesita saber en qué id va para no
   * repetir, pero abrir la app no puede soltar cuarenta notificaciones de Windows. La campana, en
   * cambio, sí quiere la historia: pinta con ella y no pide nada más. */
  if (url.searchParams.get('sin-historia') === '1') {
    const maximo = avisos.length === 0 ? 0 : Math.max(...avisos.map((a) => a.id));
    if (maximo > 0) {
      try {
        res.write(`id: ${maximo}
event: sinc
data: ${JSON.stringify({ tipo: 'sinc', id: maximo })}

`);
      } catch {
        /* cliente ido */
      }
    }
  } else {
    for (const aviso of avisos.filter((a) => a.id > desde).reverse()) escribir(res, aviso.id, aviso);
  }

  const baja = servicio.suscribir((aviso) => escribir(res, aviso.id, aviso));
  const ping = setInterval(() => {
    try {
      res.write(': latido\n\n');
    } catch {
      /* El cierre lo detecta `close`; aquí no hay nada que hacer. */
    }
  }, PING_MS);
  (ping as { unref?: () => void }).unref?.();

  const cerrar = (): void => {
    clearInterval(ping);
    baja();
  };
  req.on('close', cerrar);
  req.on('error', cerrar);
}

function escribir(res: ServerResponse, id: number, cuerpo: unknown): void {
  try {
    res.write(`id: ${id}\nevent: aviso\ndata: ${JSON.stringify({ tipo: 'aviso', aviso: cuerpo })}\n\n`);
  } catch {
    /* Cliente ido: la baja la hace `close`. */
  }
}

/* `Last-Event-ID` es la cabecera estándar; el parámetro se acepta porque `EventSource` del
 * navegador no permite ponerla y una pestaña recargada querría lo mismo. */
function idDeReconexion(req: IncomingMessage): number {
  const cabecera = req.headers['last-event-id'];
  const bruto = Array.isArray(cabecera) ? cabecera[0] : cabecera;
  const n = Number(bruto);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
