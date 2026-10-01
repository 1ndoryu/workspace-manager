/* Ayudas HTTP compartidas del servidor (respuestas JSON, bodies, archivos).
 * [por que] Extraído de `index.ts` (límite-líneas): los módulos de rutas
 * (`rutasGate`, `rutasConfig`, `rutasDocumentos`) y el snapshot las usan sin
 * importar el entry (sin ciclos). Solo Node + fs/path, cero imports del
 * proyecto. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';

export const RAIZ_AREA = process.env.WS_AREA_ROOT || 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/* Lee el body JSON de un POST. [por que] Node http nativo no parsea bodies;
 * el parseo es minimalista con tope de 1 MB anti-abuso. */
export function leerBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => {
      datos += c;
      if (datos.length > 1_000_000) {
        req.destroy();
        reject(new Error('Body demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(datos.length > 0 ? JSON.parse(datos) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/* Lee el contenido de un archivo; null si no existe o falla. */
export function leerArchivo(ruta: string): string | null {
  try {
    if (!existsSync(ruta)) return null;
    return readFileSync(ruta, 'utf8');
  } catch {
    return null;
  }
}

/* Extrae un campo string de un body ya parseado; fallback si no es string.
 * [por que] F0 midió 9 ternarios `typeof body.x==='string'` repetidos en las
 * rutas (gate/documentos/config); un dueño único evita que diverjan. */
export function campoStr<F extends string | null>(body: unknown, campo: string, fallback: F): string | F {
  if (!body || typeof body !== 'object') return fallback;
  const v = (body as Record<string, unknown>)[campo];
  return typeof v === 'string' ? v : fallback;
}

/* Resuelve una ruta relativa al área dentro del área; null si escapa
 * (path traversal). [por que] El cliente solo envía rutas relativas; nunca
 * se acepta un path absoluto ni una subida fuera de la raíz. */
export function resolverArea(rutaRel: string): string | null {
  const abs = normalize(join(RAIZ_AREA, rutaRel));
  const rel = relative(normalize(RAIZ_AREA), abs);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  return abs;
}

/* Directorio padre de una ruta relativa ('a/b' -> 'a'; '' -> ''). */
export function padreDe(rutaRel: string): string {
  const idx = rutaRel.lastIndexOf('/');
  return idx <= 0 ? '' : rutaRel.slice(0, idx);
}

/* Prepara una respuesta SSE y devuelve el emisor de eventos.
 * [por que] F0 midió el andamiaje SSE duplicado en rutasPc (escanear y
 * limpiar-stream); un dueño único evita que diverjan. */
export function iniciarSse<T extends { tipo: string }>(res: ServerResponse): (ev: T) => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  /* El trabajo roza los minutos: sin timeout de socket. */
  try {
    res.socket?.setTimeout(0);
  } catch {
    /* best-effort */
  }
  return (ev: T): void => {
    try {
      res.write(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`);
    } catch {
      /* cliente desconectado: el trabajo termina igual en background */
    }
  };
}
