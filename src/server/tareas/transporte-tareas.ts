/* Transporte HTTP nativo para el puente TASKS (07AA-5 F3).
 * [por que] El fetch global (undici) aplica la lista de puertos prohibidos de
 * la Fetch-spec y rechaza el puerto permanente 4190 con `bad port` sin tocar
 * red (medido: 127.0.0.2:4190 -> bad port, 127.0.0.2:8787 -> ECONNREFUSED).
 * `node:http/https` no aplica ese bloqueo (medido: 401/200 reales a 4190), asi
 * que el transporte de produccion usa el stack clasico con el mismo contrato
 * `FetchPuente` (inyectable en tests). */
import {request as pedirHttp} from 'node:http';
import {request as pedirHttps} from 'node:https';
import type {FetchPuente, RespuestaPuente} from './puente-tareas.js';

export function crearHttpNativo(timeoutMs: number): FetchPuente {
  return (url, init) =>
    new Promise<RespuestaPuente>((resolver, rechazar) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        rechazar(new Error('url-rota'));
        return;
      }
      const pedir = u.protocol === 'https:' ? pedirHttps : pedirHttp;
      const t = setTimeout(() => peticion.destroy(new Error('timeout')), timeoutMs);
      const peticion = pedir(
        url,
        {method: init.method ?? 'GET', headers: init.headers},
        (respuesta) => {
          const trozos: Buffer[] = [];
          respuesta.on('data', (trozo) => trozos.push(Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo)));
          respuesta.on('end', () => {
            clearTimeout(t);
            const estado = respuesta.statusCode ?? 0;
            const texto = Buffer.concat(trozos).toString('utf8');
            const crudas = respuesta.headers['set-cookie'];
            resolver({
              ok: estado >= 200 && estado < 300,
              estado,
              cabeceras: {
                obtener: (nombre) => {
                  const v = respuesta.headers[nombre.toLowerCase()];
                  if (Array.isArray(v)) return v.join(', ');
                  return v ?? null;
                },
              },
              json: () => {
                try {
                  return Promise.resolve(JSON.parse(texto) as unknown);
                } catch {
                  return Promise.reject(new Error('json-roto'));
                }
              },
              /* `set-cookie` ya viene separado por cabecera: sin el pegado
               * de `get('set-cookie')` que rompia la sesion D1 con fetch. */
              cookies: crudas === undefined ? [] : Array.isArray(crudas) ? crudas : [crudas],
            });
          });
        },
      );
      peticion.on('error', (e) => {
        clearTimeout(t);
        rechazar(e);
      });
      if (init.body !== undefined) peticion.write(init.body);
      peticion.end();
    });
}
