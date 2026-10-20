/* Puertos: deriva de PORT en .env (IO), sondeo HTTP (IO) y reexport de los módulos puros
 * puertos/modo.mjs y puertos/atribucion.mjs, así que los importadores no cambian. */

import { cabeceraAutorizacion } from '../../token.mjs';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { isAbsolute, join, normalize, resolve } from 'node:path';

import { RAIZ_REPO } from '../base.mjs';
import { PUERTO_API } from '../../../shared/puertos.mjs';

export * from './puertos/modo.mjs';
export * from './puertos/atribucion.mjs';

/* Puertos que una entrada declara como suyos (puertos + auxiliares). */
function puertosDeclarados(e) {
  return [...(e.puertos ?? []), ...(e.auxiliares ?? []).map((a) => a?.puerto)].filter((p) => Number.isInteger(p));
}


const RE_PORT_ENV = /^[ \t]*PORT[ \t]*=[ \t]*(\d{2,5})[ \t]*(?:#.*)?$/gm;


/* Deriva entre `PORT=` de `.env`/`.env.example` y el registro. Solo aviso (no
 * cambia el exit): el backend Rust lee PORT, y si ese valor no es el declarado
 * (o lo reclama otro proyecto) el `up` del registro no lo ve hasta que falla.
 * Fail-open: un archivo ilegible se omite. */
export function detectarDerivaEnv(registro, { raiz = RAIZ_REPO } = {}) {
  const entradas = [...(registro.entradas?.values() ?? [])].filter((e) => typeof e.ruta === 'string');
  const reclamo = new Map(); // puerto -> ids que lo declaran
  for (const e of entradas) {
    for (const p of puertosDeclarados(e)) {
      if (!reclamo.has(p)) reclamo.set(p, []);
      reclamo.get(p).push(e.id);
    }
  }
  const avisos = [];
  for (const e of entradas) {
    const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(raiz, e.ruta);
    const propios = new Set(puertosDeclarados(e));
    for (const archivo of ['.env', '.env.example']) {
      let texto;
      try {
        texto = readFileSync(join(rutaAbs, archivo), 'utf8');
      } catch {
        continue;
      }
      for (const m of texto.matchAll(RE_PORT_ENV)) {
        const puerto = Number(m[1]);
        if (propios.has(puerto)) continue;
        const otros = (reclamo.get(puerto) ?? []).filter((x) => x !== e.id);
        const motivo = otros.length
          ? `PORT=${puerto} lo declara ${otros.join(', ')}`
          : `PORT=${puerto} no esta en puertos/auxiliares de ${e.id}`;
        avisos.push({ id: e.id, archivo, puerto, motivo });
      }
    }
  }
  return avisos;
}

export function sondear(puerto, rutaRecurso, esperaJson, timeoutMs, dominio) {
  // [por que] Node/SO no resuelven *.localhost (solo el navegador aplica el
  // caso especial). El probe conecta a 127.0.0.1 con cabecera Host = dominio:
  // verifica que el servicio sirve ese nombre virtual. Sin dominio, como antes.
  // [por que 2] Vite por defecto escucha solo en ::1 (IPv6): si 127.0.0.1
  // rehusa la conexion se reintenta contra ::1 con la misma cabecera Host.
  // [por que 3] Host con puerto: la guardia del manager exige host:puerto, como un navegador.
  const cabeceras = dominio && dominio !== '127.0.0.1' ? { Host: `${dominio}:${puerto}` } : undefined;
  // [por que] El token solo va al manager: sondear sirve a todos los puertos y no debe filtrarlo a otros servicios.
  const conAuth = puerto === PUERTO_API ? cabeceraAutorizacion() : undefined;
  const intentar = (host) =>
    new Promise((resolveP) => {
      const req = http.get(
        { host, port: puerto, path: rutaRecurso || '/', timeout: timeoutMs, headers: { ...cabeceras, ...conAuth } },
        (res) => {
          let cuerpo = '';
          res.on('data', (t) => {
            cuerpo += t;
            if (cuerpo.length > 64 * 1024) req.destroy();
          });
          res.on('end', () => {
            const okStatus = res.statusCode === 200;
            let okJson = true;
            if (esperaJson !== false) {
              try {
                JSON.parse(cuerpo);
              } catch {
                okJson = false;
              }
            }
            resolveP({ ok: okStatus && okJson, status: res.statusCode });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => resolveP({ ok: false, status: null }));
    });
  return (async () => {
    const v4 = await intentar('127.0.0.1');
    if (v4.ok) return v4;
    if (v4.status === null) return intentar('::1');
    return v4;
  })();
}
