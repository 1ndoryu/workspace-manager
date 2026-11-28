/* El `up` adopta el túnel del portátil que ya cubre sus reenvíos en vez de abrir otro ssh encima.
 * [por que] El túnel permanente guarda su PID en `remoto-tunel-<id>.json`, que el camino del `up`
 * no lee: sin adoptarlo, el segundo ssh choca en el puerto local (`ExitOnForwardFailure`) y el
 * comando decía «túnel ssh no levantó» con el servicio sano.
 * Puro: se prueba el criterio de aceptación sin lanzar ssh (misma forma que `tunelPortatilDe`). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entradaEfectiva, puertosRemotosDe, reenviosTunel, tunelPortatilDe } from '../../doctor.mjs';
import { puertosLocalesDe } from '../red/tunel.mjs';

const HOST = 'vps-prueba';

function entrada(extra = {}) {
  return {
    id: 'PRUEBA',
    host: HOST,
    puertos: [3105, 5182],
    tunelSsh: true,
    ...extra,
  };
}

function ssh(cmd, pid = 100) {
  return { pid, creado: '2026-11-28T10:00:00', imagen: 'ssh.exe', cmd };
}

/* Mismo criterio que `tunelPortatilVivo`: el ssh pasa `tunelPortatilDe` y lleva TODOS los pares del
 * modo efectivo. Se replica aquí para poder probar el caso del túnel permanente sin procesos. */
function loAdoptaria(ef, proc) {
  if (!tunelPortatilDe({ ...proc, creado: proc.creado }, ef)) return false;
  const delProyecto = puertosRemotosDe(ef).map((r, i) => `${puertosLocalesDe(ef)[i]}:${r}`);
  const reenvios = new Set(reenviosTunel(proc.cmd).map(([l, r]) => `${l}:${r}`));
  return delProyecto.every((par) => reenvios.has(par));
}

test('el túnel permanente con los reenvíos del proyecto se adopta', () => {
  const ef = entradaEfectiva(entrada());
  const proc = ssh(`ssh -N -L 127.0.0.1:3105:127.0.0.1:3105 -L 127.0.0.1:5182:127.0.0.1:5182 ${HOST}`);
  assert.equal(loAdoptaria(ef, proc), true);
});

test('el túnel permanente con un reenvío del portátil de más también vale', () => {
  const ef = entradaEfectiva(entrada({ tunelPortatil: [[33110, 3110]] }));
  const proc = ssh(
    `ssh -N -L 127.0.0.1:3105:127.0.0.1:3105 -L 127.0.0.1:5182:127.0.0.1:5182 -L 127.0.0.1:33110:127.0.0.1:3110 ${HOST}`,
  );
  assert.equal(loAdoptaria(ef, proc), true);
});

test('un ssh que solo lleva `tunelPortatil` NO se adopta: el proyecto quedaría sin sondear', () => {
  const ef = entradaEfectiva(entrada({ tunelPortatil: [[33110, 3110]] }));
  const proc = ssh(`ssh -N -L 127.0.0.1:33110:127.0.0.1:3110 ${HOST}`);
  assert.equal(loAdoptaria(ef, proc), false);
});

test('un ssh a otro host no se adopta', () => {
  const ef = entradaEfectiva(entrada());
  const proc = ssh('ssh -N -L 127.0.0.1:3105:127.0.0.1:3105 -L 127.0.0.1:5182:127.0.0.1:5182 otrohost');
  assert.equal(loAdoptaria(ef, proc), false);
});

test('un ssh con un reenvío de más que no está declarado no se adopta (túnel viejo)', () => {
  const ef = entradaEfectiva(entrada());
  const proc = ssh(
    `ssh -N -L 127.0.0.1:3105:127.0.0.1:3105 -L 127.0.0.1:5182:127.0.0.1:5182 -L 127.0.0.1:3999:127.0.0.1:3999 ${HOST}`,
  );
  assert.equal(loAdoptaria(ef, proc), false);
});
