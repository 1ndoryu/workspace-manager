/* Pruebas del puerto de procesos: la implementación real (node como binario
 * neutro, sin red) y un consumidor con puerto falso inyectado. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PUERTO_PROCESOS } from './procesos.js';
import type { OpcionesProceso, PuertoProcesos } from './procesos.js';
import { ejecutarClean } from '../pc/limpiezaBase.js';

describe('PUERTO_PROCESOS', () => {
  it('devuelve stdout y stderr como texto', async () => {
    const r = await PUERTO_PROCESOS.ejecutar(process.execPath, ['-e', "process.stdout.write('hola'); process.stderr.write('aviso')"]);
    assert.deepEqual(r, { stdout: 'hola', stderr: 'aviso' });
  });

  it('pasa las opciones (env) al proceso', async () => {
    const r = await PUERTO_PROCESOS.ejecutar(process.execPath, ['-e', 'process.stdout.write(process.env.WM_PRUEBA)'], {
      env: { ...process.env, WM_PRUEBA: 'valor' },
    });
    assert.equal(r.stdout, 'valor');
  });

  it('con exit != 0 rechaza y el error conserva stdout y code', async () => {
    /* [por que] Los llamadores (sentinel, doctor) leen la salida parcial de err.stdout. */
    await assert.rejects(
      PUERTO_PROCESOS.ejecutar(process.execPath, ['-e', "process.stdout.write('parcial'); process.exit(1)"]),
      (err: { stdout?: string; code?: number }) => err.stdout === 'parcial' && err.code === 1,
    );
  });
});

describe('consumidor con puerto inyectado', () => {
  it('ejecutarClean usa el puerto recibido y pasa el timeout', async () => {
    const llamadas: { bin: string; args: string[]; opciones?: OpcionesProceso }[] = [];
    const falso: PuertoProcesos = {
      async ejecutar(bin, args, opciones) {
        llamadas.push({ bin, args, opciones });
        return { stdout: '{"acciones":[]}', stderr: '' };
      },
    };
    const r = await ejecutarClean('limpiador', ['--json'], falso);
    assert.equal(r.salida, '{"acciones":[]}');
    assert.equal(llamadas[0].bin, 'limpiador');
    assert.equal(llamadas[0].opciones?.timeout, 300000);
  });

  it('ejecutarClean acepta exit 1 con JSON parcial y relanza el resto', async () => {
    const parcial: PuertoProcesos = {
      async ejecutar() {
        throw Object.assign(new Error('exit 1'), { code: 1, stdout: '{"acciones":[{"estado":"rechazada"}]}' });
      },
    };
    const r = await ejecutarClean('limpiador', [], parcial);
    assert.match(r.salida, /rechazada/);

    const fatal: PuertoProcesos = {
      async ejecutar() {
        throw Object.assign(new Error('exit 2'), { code: 2, stdout: '' });
      },
    };
    await assert.rejects(ejecutarClean('limpiador', [], fatal), /exit 2/);
  });
});
