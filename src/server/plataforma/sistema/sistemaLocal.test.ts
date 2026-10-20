/* Pruebas de la lectura única del sistema: parsers de netstat, lectura con puerto falso,
 * caché de 60 s y single-flight, y paridad con los parsers espejo del doctor. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  crearCacheSistema,
  leerSistemaLocal,
  escuchasConProceso,
  parsearNetstatEscucha,
  parsearNetstatEstablecidas,
} from './sistemaLocal.js';
import type { SistemaLocal } from './sistemaLocal.js';
import type { PuertoProcesos, SalidaProceso } from './procesos.js';

/* [por que] El doctor es JS puro: se importa por URL (sin tipos, como gemelos.test.ts) y se comparan
 * sus parsers con los espejos TS para que no se separen. */
type ParsersDoctor = {
  parsearNetstat: (sal: string) => unknown;
  parsearEstablecidas: (sal: string) => unknown;
};
const cargarDoctor = async () =>
  (await import(new URL('../../../scripts/dev/doctor/sistema/procesos.mjs', import.meta.url).href)) as ParsersDoctor;

const NETSTAT = [
  'Conexión activa a TCP',
  '  Proto  Dirección local          Dirección remota        Estado           PID',
  '  TCP    0.0.0.0:5175             0.0.0.0:0               LISTENING        4321',
  '  TCP    [::1]:5174               [::]:0                  LISTENING        9999',
  '  TCP    127.0.0.1:55001          127.0.0.1:3110          ESTABLISHED      1200',
  '  TCP    127.0.0.1:3110           127.0.0.1:55001         ESTABLISHED      3300',
  '  UDP    0.0.0.0:5353             *:*                                      777',
].join('\r\n');

function salida(stdout: string): SalidaProceso {
  return { stdout, stderr: '' };
}

/* Puerto falso: CIM devuelve el JSON dado y netstat la salida fija. Cuenta llamadas. */
function puertoFalso(cim: string, net = NETSTAT): PuertoProcesos & { llamadas: number } {
  const p = {
    llamadas: 0,
    ejecutar(bin: string) {
      p.llamadas++;
      return Promise.resolve(salida(bin === 'netstat.exe' ? net : cim));
    },
  };
  return p;
}

describe('parsearNetstatEscucha', () => {
  it('toma solo LISTENING TCP, con IPv6 entre corchetes', () => {
    assert.deepEqual(parsearNetstatEscucha(NETSTAT), [
      { ip: '0.0.0.0', puerto: 5175, pid: 4321 },
      { ip: '::1', puerto: 5174, pid: 9999 },
    ]);
  });
});

describe('parsearNetstatEstablecidas', () => {
  it('toma el puerto remoto de cada conexión establecida', () => {
    assert.deepEqual(parsearNetstatEstablecidas(NETSTAT), [
      { puertoRemoto: 3110, pid: 1200 },
      { puertoRemoto: 55001, pid: 3300 },
    ]);
  });
});

describe('paridad con el doctor (espejos JS)', () => {
  it('parsearNetstat del doctor da lo mismo que el espejo TS', async () => {
    const doctor = await cargarDoctor();
    assert.deepEqual(doctor.parsearNetstat(NETSTAT), parsearNetstatEscucha(NETSTAT));
  });
  it('parsearEstablecidas del doctor da lo mismo que el espejo TS', async () => {
    const doctor = await cargarDoctor();
    assert.deepEqual(doctor.parsearEstablecidas(NETSTAT), parsearNetstatEstablecidas(NETSTAT));
  });
});

describe('leerSistemaLocal', () => {
  it('normaliza un solo proceso sin array (ConvertTo-Json con un elemento)', async () => {
    const cim = JSON.stringify({
      procesos: { pid: 4321, creado: null, exe: null, cmd: null, imagen: 'node.exe' },
      servicios: { pid: 4321, nombre: 'svc' },
    });
    const s = await leerSistemaLocal(puertoFalso(cim));
    assert.equal(s.procesos.length, 1);
    assert.equal(s.servicios[0].nombre, 'svc');
    assert.equal(s.escucha.length, 2);
    assert.equal(s.establecidas.length, 2);
  });

  it('descarta filas sin pid entero', async () => {
    const cim = JSON.stringify({ procesos: [{ pid: 'x' }, { pid: 5, imagen: 'a.exe' }], servicios: [] });
    const s = await leerSistemaLocal(puertoFalso(cim));
    assert.deepEqual(
      s.procesos.map((p) => p.pid),
      [5],
    );
  });

  it('lanza un error claro si CIM no devuelve JSON', async () => {
    await assert.rejects(leerSistemaLocal(puertoFalso('no es json')), /JSON inesperado de Get-CimInstance/);
  });
});

describe('escuchasConProceso', () => {
  it('pone el nombre de imagen del dueño de cada listener', () => {
    const sistema: SistemaLocal = {
      procesos: [{ pid: 4321, creado: null, exe: null, cmd: null, imagen: 'node.exe' }],
      servicios: [],
      escucha: [
        { ip: '0.0.0.0', puerto: 5175, pid: 4321 },
        { ip: '::1', puerto: 1, pid: 1 },
      ],
      establecidas: [],
      tomadoEn: '',
    };
    assert.deepEqual(escuchasConProceso(sistema), [
      { direccion: '0.0.0.0', puerto: 5175, proceso: 'node.exe' },
      { direccion: '::1', puerto: 1, proceso: '' },
    ]);
  });
});

describe('crearCacheSistema', () => {
  const sistema = (): SistemaLocal => ({ procesos: [], servicios: [], escucha: [], establecidas: [], tomadoEn: '' });

  it('reutiliza la lectura dentro del TTL y relee al expirar', async () => {
    let t = 0;
    let cargas = 0;
    const obtener = crearCacheSistema(async () => (cargas++, sistema()), 60_000, () => t);
    await obtener();
    t = 59_999;
    await obtener();
    assert.equal(cargas, 1);
    t = 60_000;
    await obtener();
    assert.equal(cargas, 2);
  });

  it('comparte una sola lectura entre peticiones concurrentes', async () => {
    let cargas = 0;
    const obtener = crearCacheSistema(async () => {
      cargas++;
      await new Promise((r) => setTimeout(r, 10));
      return sistema();
    });
    await Promise.all([obtener(), obtener(), obtener()]);
    assert.equal(cargas, 1);
  });

  it('no cachea un fallo: la siguiente petición vuelve a leer', async () => {
    let cargas = 0;
    const obtener = crearCacheSistema(async () => {
      cargas++;
      if (cargas === 1) throw new Error('CIM caído');
      return sistema();
    });
    await assert.rejects(obtener(), /CIM caído/);
    await obtener();
    assert.equal(cargas, 2);
  });
});
