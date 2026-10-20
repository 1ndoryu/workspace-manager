/* Tests del sistema compartido del snapshot (doctor --all): los sensores de PID y los ssh.exe
 * salen de snapshot.sistema y no de un CIM propio. Puros. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensoresDeSistema, sshDeSistema } from '../sistema/procesos.mjs';

const SISTEMA = {
  procesos: [
    { pid: 10, creado: '2026-10-20T10:00:00', exe: 'C:\\a\\node.exe', cmd: 'node x', imagen: 'node.exe' },
    { pid: 20, creado: null, exe: null, cmd: 'ssh dev89', imagen: 'ssh.exe' },
    { pid: 30, creado: null, exe: null, cmd: null, imagen: 'SSH.EXE' },
  ],
  servicios: [{ pid: 10, nombre: 'Srv' }, { pid: 99, nombre: 'Otro' }],
};

test('sensoresDeSistema devuelve solo los PID pedidos', () => {
  const { procs, servicios } = sensoresDeSistema(SISTEMA, [10]);
  assert.deepEqual([...procs.keys()], [10]);
  assert.deepEqual(procs.get(10), { creado: '2026-10-20T10:00:00', exe: 'C:\\a\\node.exe', cmd: 'node x', imagen: 'node.exe' });
  assert.deepEqual([...servicios.keys()], [10]);
  assert.deepEqual(servicios.get(10), { nombre: 'Srv' });
});

test('sensoresDeSistema tolera un sistema vacío', () => {
  const { procs, servicios } = sensoresDeSistema({}, [10]);
  assert.equal(procs.size, 0);
  assert.equal(servicios.size, 0);
});

test('sshDeSistema filtra ssh.exe sin distinguir mayúsculas y con la forma de procesosSshVivos', () => {
  const ssh = sshDeSistema(SISTEMA);
  assert.equal(ssh.length, 2);
  assert.deepEqual(ssh[0], { creado: null, exe: null, cmd: 'ssh dev89', imagen: 'ssh.exe' });
  assert.equal(ssh[1].imagen, 'SSH.EXE');
});

test('sshDeSistema sin procesos devuelve lista vacía', () => {
  assert.deepEqual(sshDeSistema({}), []);
});
