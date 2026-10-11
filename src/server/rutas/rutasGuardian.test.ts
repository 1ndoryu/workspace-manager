/* Test de las rutas del Guardián (10AA-2 F11.4, /api/guardian/*): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/rutas/rutasGuardian.test.ts`.
 * [por que] Servidor HTTP real en un puerto libre para ejercer las guardas de origen
 * y el cuerpo tal como llegan. Proyectos y comandos son falsos e inyectados: ningún
 * test toca el área real ni ejecuta Sentinel. Fixtures en C:/tmp (protocolo de temporales). */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manejarRutasGuardian, type DependenciasGuardian } from './rutasGuardian.js';
import { hashDe } from '../guardian/escritura.js';
import { leerActividad } from '../guardian/operacion/actividad.js';
import type { Proyecto } from '../../shared/types.js';

const BASE_TMP = 'C:/tmp/guardian-test';
const RAIZ_TABLERO = join(import.meta.dirname, '..', '..', '..');
const temporales: string[] = [];

/* Formato de workspace-manager: CRLF y sangría 2 y 4. */
const CONFIG_BASE = [
  '{',
  '  "schemaVersion": 2,',
  '  "mode": "enforce",',
  '  "budgets": {',
  '    "mode": "enforce"',
  '  },',
  '  "guard": {',
  '    "directCommands": {',
  '      "npmScripts": ["lint", "test"],',
  '      "npxTools": ["tsc"],',
  '      "cargoSubcommands": ["check"],',
  '      "tools": ["cargo"]',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');

/* Las listas que CONFIG_BASE declara; el router debe devolverlas tal cual. */
const LISTAS_BASE = {
  npmScripts: ['lint', 'test'],
  npxTools: ['tsc'],
  cargoSubcommands: ['check'],
  tools: ['cargo'],
};

const proyectos: Proyecto[] = [];
const llamadas = { probar: [] as Array<{ raiz: string; ejecutable: string; args: string[] }>, mantenimiento: [] as unknown[] };

/* Crea un proyecto temporal y lo registra en el área falsa. */
function registrar(clave: string, puerta: string, config: string | null): string {
  mkdirSync(BASE_TMP, { recursive: true });
  const ruta = mkdtempSync(join(BASE_TMP, `rutas-${clave}-`));
  temporales.push(ruta);
  if (config !== null) writeFileSync(join(ruta, 'sentinel.config.json'), config, 'utf8');
  proyectos.push({ clave, ruta, gate: { puerta } } as unknown as Proyecto);
  return ruta;
}

const deps: DependenciasGuardian = {
  raizTablero: RAIZ_TABLERO,
  proyectos: () => proyectos,
  proyectoPorClave: (clave) => proyectos.find((p) => p.clave === clave) ?? null,
  leerActividad,
  probarComando: async (entrada) => {
    llamadas.probar.push(entrada);
    return { estado: 'ok', codigo: 78, decision: { blocked: true, reason: 'falso' } };
  },
  ejecutarMantenimiento: async (entrada) => {
    llamadas.mantenimiento.push(entrada);
    return { estado: 'ok', modo: 'simulacion', codigo: 0, salida: '' };
  },
};

let servidor: Server;
let puerto: number;

before(async () => {
  servidor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void manejarRutasGuardian(req, res, url, url.pathname, deps).then((atendida) => {
      if (!atendida) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  puerto = (servidor.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

interface Opciones {
  cuerpo?: unknown;
  crudo?: string;
  cabeceras?: Record<string, string>;
}

interface Respuesta {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cuerpo: any;
}

/* Por defecto, una petición de escritura llega como lo haría la página local. */
function pedir(metodo: string, ruta: string, opciones: Opciones = {}): Promise<Respuesta> {
  const texto = opciones.crudo ?? (opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo));
  const cabeceras: Record<string, string> = {
    Host: 'localhost:8787',
    ...(metodo === 'POST' ? { Origin: 'http://localhost:5175', 'Content-Type': 'application/json' } : {}),
    ...opciones.cabeceras,
  };
  if (texto !== undefined) cabeceras['Content-Length'] = String(Buffer.byteLength(texto));
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: cabeceras }, (res) => {
      let datos = '';
      res.setEncoding('utf8');
      res.on('data', (trozo: string) => {
        datos += trozo;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, cuerpo: datos === '' ? null : JSON.parse(datos) }));
    });
    req.on('error', reject);
    if (texto !== undefined) req.write(texto);
    req.end();
  });
}

const leer = (ruta: string, fichero: string): string => readFileSync(join(ruta, fichero), 'utf8');

describe('lecturas', () => {
  it('un proyecto desconocido responde 404', async () => {
    const r = await pedir('GET', '/api/guardian/estado?clave=no-existe');
    assert.equal(r.status, 404);
  });

  it('una ruta conocida con otro método responde 405 antes que las guardas', async () => {
    const r = await pedir('POST', '/api/guardian/estado', { cabeceras: { Origin: 'http://evil.example' } });
    assert.equal(r.status, 405);
  });

  it('las rutas retiradas (/api/guard/*) ya no las atiende este módulo', async () => {
    const r = await pedir('GET', '/api/guard/estado?clave=sentinel-a');
    assert.equal(r.status, 404);
  });

  it('un proyecto sin puerta sentinel figura como no elegible', async () => {
    registrar('lectura-no-elegible', 'otra', null);
    const r = await pedir('GET', '/api/guardian/estado?clave=lectura-no-elegible');
    assert.equal(r.status, 200);
    assert.deepEqual(r.cuerpo, { clave: 'lectura-no-elegible', elegible: false });
  });

  it('un proyecto elegible devuelve estado y hashes para la siguiente escritura', async () => {
    registrar('lectura-elegible', 'sentinel', CONFIG_BASE);
    const r = await pedir('GET', '/api/guardian/estado?clave=lectura-elegible');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.elegible, true);
    assert.deepEqual(r.cuerpo.hashes, { config: hashDe(CONFIG_BASE), extra: null });
    assert.deepEqual(r.cuerpo.listas, { estado: 'ok', listas: LISTAS_BASE });
  });

  it('una política que no valida se devuelve con su motivo, sin listas inventadas', async () => {
    registrar('lectura-invalida', 'sentinel', '{"schemaVersion":1}');
    const r = await pedir('GET', '/api/guardian/estado?clave=lectura-invalida');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.listas.estado, 'invalida');
    assert.equal(typeof r.cuerpo.listas.motivo, 'string');
  });

  it('el barrido del área cuenta todos los proyectos y trae las listas de los elegibles', async () => {
    const r = await pedir('GET', '/api/guardian/estado-todo');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.total, proyectos.length);
    const elegible = r.cuerpo.proyectos.find((p: { clave: string }) => p.clave === 'lectura-elegible');
    assert.deepEqual(elegible.listas, { estado: 'ok', listas: LISTAS_BASE });
    const noElegible = r.cuerpo.proyectos.find((p: { clave: string }) => p.clave === 'lectura-no-elegible');
    assert.deepEqual(noElegible, { clave: 'lectura-no-elegible', elegible: false });
  });

  it('la plantilla del tablero se lee válida', async () => {
    const r = await pedir('GET', '/api/guardian/plantilla');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.estado, 'ok');
  });

  it('una decisión de actividad desconocida es 422', async () => {
    const r = await pedir('GET', '/api/guardian/actividad?decision=nope');
    assert.equal(r.status, 422);
  });
});

describe('guardas de escritura', () => {
  it('un Origin ajeno responde 403 sin escribir', async () => {
    const r = await pedir('POST', '/api/guardian/topes', {
      cabeceras: { Origin: 'http://evil.example' },
      cuerpo: { clave: 'lectura-elegible', hashes: {}, cambio: {} },
    });
    assert.equal(r.status, 403);
  });

  it('un Host ajeno responde 403', async () => {
    const r = await pedir('POST', '/api/guardian/topes', {
      cabeceras: { Host: 'evil.example' },
      cuerpo: { clave: 'lectura-elegible', hashes: {}, cambio: {} },
    });
    assert.equal(r.status, 403);
  });

  it('un Content-Type que no es JSON responde 415', async () => {
    const r = await pedir('POST', '/api/guardian/topes', {
      cabeceras: { 'Content-Type': 'text/plain' },
      crudo: '{}',
    });
    assert.equal(r.status, 415);
  });

  it('un cuerpo que no es JSON responde 400', async () => {
    const r = await pedir('POST', '/api/guardian/topes', { crudo: '{no json' });
    assert.equal(r.status, 400);
  });
});

describe('topes', () => {
  it('la vista previa calcula el diff sin escribir', async () => {
    const ruta = registrar('topes-vista', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-vista', hashes: { config: hashDe(CONFIG_BASE), extra: null }, cambio: { modo: 'observe' } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.escrito, false);
    assert.equal(r.cuerpo.cambia, true);
    assert.notEqual(r.cuerpo.diffConfig, null);
    assert.equal(leer(ruta, 'sentinel.config.json'), CONFIG_BASE);
  });

  it('confirmar escribe el modo de topes y devuelve los hashes nuevos', async () => {
    const ruta = registrar('topes-escribe', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: {
        clave: 'topes-escribe',
        hashes: { config: hashDe(CONFIG_BASE), extra: null },
        cambio: { modo: 'observe' },
        confirmar: true,
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.escrito, true);
    assert.equal(JSON.parse(leer(ruta, 'sentinel.config.json')).budgets.mode, 'observe');
    assert.equal(r.cuerpo.hashes.config, hashDe(leer(ruta, 'sentinel.config.json')));
  });

  it('un hash previo distinto responde 409 y no escribe', async () => {
    const ruta = registrar('topes-conflicto', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-conflicto', hashes: { config: 'deadbeef', extra: null }, cambio: { modo: 'observe' }, confirmar: true },
    });
    assert.equal(r.status, 409);
    assert.equal(leer(ruta, 'sentinel.config.json'), CONFIG_BASE);
  });

  it('un modo fuera de la lista responde 422', async () => {
    registrar('topes-modo-malo', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-modo-malo', hashes: { config: hashDe(CONFIG_BASE), extra: null }, cambio: { modo: 'pass' } },
    });
    assert.equal(r.status, 422);
  });

  it('un extra fuera de rango responde 422', async () => {
    registrar('topes-extra-malo', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: { clave: 'topes-extra-malo', hashes: { config: hashDe(CONFIG_BASE), extra: null }, cambio: { extraTotal: 500 } },
    });
    assert.equal(r.status, 422);
  });

  it('confirmar un extra crea lote-extra.md con el total en la primera línea', async () => {
    const ruta = registrar('topes-extra', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/topes', {
      cuerpo: {
        clave: 'topes-extra',
        hashes: { config: hashDe(CONFIG_BASE), extra: null },
        cambio: { extraTotal: 2, motivo: 'lote de prueba' },
        confirmar: true,
      },
    });
    assert.equal(r.status, 200);
    assert.match(leer(ruta, 'lote-extra.md'), /^\+2 lote de prueba/u);
  });
});

describe('política', () => {
  it('la vista previa no escribe', async () => {
    const ruta = registrar('politica-vista', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/politica', {
      cuerpo: { clave: 'politica-vista', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.escrito, false);
    assert.equal(leer(ruta, 'sentinel.config.json'), CONFIG_BASE);
  });

  it('un proyecto sin puerta sentinel responde 422', async () => {
    registrar('politica-no-elegible', 'otra', null);
    const r = await pedir('POST', '/api/guardian/politica', {
      cuerpo: { clave: 'politica-no-elegible', hashPrevio: 'x', cambio: {} },
    });
    assert.equal(r.status, 422);
  });
});

describe('lote', () => {
  it('una clave repetida responde 422', async () => {
    registrar('lote-repetido', 'sentinel', CONFIG_BASE);
    const entrada = { clave: 'lote-repetido', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } };
    const r = await pedir('POST', '/api/guardian/lote', { cuerpo: { entradas: [entrada, entrada] } });
    assert.equal(r.status, 422);
  });

  it('un lote vacío responde 422', async () => {
    const r = await pedir('POST', '/api/guardian/lote', { cuerpo: { entradas: [] } });
    assert.equal(r.status, 422);
  });

  it('la vista previa de dos proyectos devuelve un resultado por clave sin escribir', async () => {
    const ruta1 = registrar('lote-a', 'sentinel', CONFIG_BASE);
    const ruta2 = registrar('lote-b', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/lote', {
      cuerpo: {
        entradas: [
          { clave: 'lote-a', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } },
          { clave: 'lote-b', hashPrevio: hashDe(CONFIG_BASE), cambio: { modo: 'observe' } },
        ],
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.resultados.length, 2);
    assert.equal(r.cuerpo.escrito, false);
    assert.equal(leer(ruta1, 'sentinel.config.json'), CONFIG_BASE);
    assert.equal(leer(ruta2, 'sentinel.config.json'), CONFIG_BASE);
  });
});

describe('probar y mantenimiento', () => {
  it('probar usa la raíz del proyecto, no la que envía el cliente', async () => {
    const ruta = registrar('probar-a', 'sentinel', CONFIG_BASE);
    const antes = llamadas.probar.length;
    const r = await pedir('POST', '/api/guardian/probar', {
      cuerpo: { clave: 'probar-a', ejecutable: 'npm', args: ['run', 'lint'], raiz: 'C:/otro' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.decision.blocked, true);
    assert.equal(llamadas.probar.length, antes + 1);
    assert.deepEqual(llamadas.probar[antes], { raiz: ruta, ejecutable: 'npm', args: ['run', 'lint'] });
  });

  it('probar con args que no son una lista responde 422', async () => {
    registrar('probar-args', 'sentinel', CONFIG_BASE);
    const r = await pedir('POST', '/api/guardian/probar', {
      cuerpo: { clave: 'probar-args', ejecutable: 'npm', args: 'run lint' },
    });
    assert.equal(r.status, 422);
  });

  it('mantenimiento no reenvía rutas del cliente, solo sus tres banderas', async () => {
    const antes = llamadas.mantenimiento.length;
    const r = await pedir('POST', '/api/guardian/mantenimiento', {
      cuerpo: { sourceRoot: 'C:/evil', targetRoot: 'C:/evil', conShims: true, confirmar: false },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(llamadas.mantenimiento[antes], { conShims: true, confirmar: false });
  });

  it('mantenimiento con una bandera que no es booleana responde 422', async () => {
    const r = await pedir('POST', '/api/guardian/mantenimiento', { cuerpo: { conShims: 'si' } });
    assert.equal(r.status, 422);
  });
});
