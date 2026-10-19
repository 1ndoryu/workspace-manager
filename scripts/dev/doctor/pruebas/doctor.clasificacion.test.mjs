/* Tests de clasificacion de procesos del mando (doctor --all): quien es del
 * proyecto, que es sistema ignorado y como se atribuye un huerfano. Puros. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atribuirHuerfano,
  enRuta,
  esDelProyecto,
  esSistemaIgnorado,
  parsearNetstat,
  puertoDeSaludValido,
} from '../../doctor.mjs';
import { parsearEstablecidas } from '../sistema/procesos.mjs';

const AREA = 'C:\\area';

test('parsearNetstat: lee listeners IPv4 e IPv6 (regresion: [::1]:5176 se perdia con -p TCP)', () => {
  const sal = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:3103         0.0.0.0:0              LISTENING       32296',
    '  TCP    [::1]:5176             [::]:0                 LISTENING       688',
    '  TCP    [::]:5174              [::]:0                 LISTENING       9999',
    '  TCP    127.0.0.1:50000        127.0.0.1:3103         ESTABLISHED     4444',
  ].join('\r\n');
  assert.deepEqual(parsearNetstat(sal), [
    { ip: '127.0.0.1', puerto: 3103, pid: 32296 },
    { ip: '::1', puerto: 5176, pid: 688 },
    { ip: '::', puerto: 5174, pid: 9999 },
  ]);
});

test('esDelProyecto: exe bajo la ruta del proyecto', () => {
  const proc = { exe: `${AREA}\\sitio-api\\backend\\glory-backend.exe`, cmd: '' };
  assert.equal(esDelProyecto(proc, `${AREA}\\sitio-api`, 'nada'), true);
});

test('esDelProyecto: cmd con la ruta del proyecto aunque el exe sea otro (regresion app-tareas 4191)', () => {
  const proc = {
    exe: 'C:\\Program Files\\nodejs\\node.exe',
    cmd: `node "${AREA}\\app-tareas\\frontend\\node_modules\\vite\\bin\\vite.js" --port 4191`,
  };
  assert.equal(esDelProyecto(proc, `${AREA}\\app-tareas`, 'glory-backend'), true);
});

test('esDelProyecto: frontera de ruta, "glory" no casa con "glory-pulse"', () => {
  const proc = { exe: '', cmd: `node "${AREA}\\glory-pulse\\run.js"` };
  assert.equal(esDelProyecto(proc, `${AREA}\\glory`, 'nada-que-casa'), false);
});

test('esDelProyecto: proceso ajeno sin ruta ni marcador', () => {
  const proc = { exe: 'C:\\Windows\\System32\\svchost.exe', cmd: '' };
  assert.equal(esDelProyecto(proc, `${AREA}\\catalogo-web`, 'glory-backend'), false);
});

test('enRuta: exige frontera de ruta', () => {
  assert.equal(enRuta('c:\\a\\glory-pulse\\x', 'c:\\a\\glory'), false);
  assert.equal(enRuta('c:\\a\\glory\\x', 'c:\\a\\glory'), true);
  assert.equal(enRuta('"c:\\a\\glory" --x', 'c:\\a\\glory'), true);
  assert.equal(enRuta('', 'c:\\a\\glory'), false);
});

test('puertoDeSaludValido: acepta un puerto solo remoto (readiness del conector 20241), rechaza uno ajeno', () => {
  const e = { puertos: [3110, 5199, 3102], puertosRemotos: [3110, 5199, 20241] };
  assert.equal(puertoDeSaludValido(20241, e), true);
  assert.equal(puertoDeSaludValido(3110, e), true);
  assert.equal(puertoDeSaludValido(9999, e), false);
  assert.equal(puertoDeSaludValido(20241, { puertos: [3110] }), false);
});

test('atribuirHuerfano: gana la ruta mas larga que contiene el proceso', () => {
  const pool = [
    { clave: 'area', ruta: AREA },
    { clave: 'app-tareas', ruta: `${AREA}\\app-tareas` },
  ];
  const proc = { exe: `${AREA}\\app-tareas\\backend\\glory-backend.exe`, cmd: '' };
  assert.equal(atribuirHuerfano(proc, pool), 'app-tareas');
});

test('atribuirHuerfano: ignorado del area (editor-propio) se atribuye, no queda mudo', () => {
  const pool = [{ clave: 'editor-propio', ruta: `${AREA}\\editor-propio` }];
  const proc = { exe: `${AREA}\\editor-propio\\app\\electron.exe`, cmd: '' };
  assert.equal(atribuirHuerfano(proc, pool), 'editor-propio');
});

test('atribuirHuerfano: sin dueño conocido devuelve null', () => {
  const proc = { exe: 'C:\\Users\\usuario\\AppData\\Roaming\\uTorrent Web\\helper\\helper.exe', cmd: '' };
  assert.equal(atribuirHuerfano(proc, [{ clave: 'catalogo-web', ruta: `${AREA}\\catalogo-web` }]), null);
  assert.equal(atribuirHuerfano(undefined, []), null);
});

test('esSistemaIgnorado: exe exacto sin distinguir mayusculas', () => {
  const lista = [{ exe: 'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe', motivo: 'VPN del usuario' }];
  const proc = { exe: 'c:\\program files\\openvpn\\bin\\OPENVPN.exe', cmd: '' };
  assert.equal(esSistemaIgnorado(31568, proc, lista), true);
  assert.equal(esSistemaIgnorado(1, { exe: 'C:\\otro\\openvpn.exe', cmd: '' }, lista), false);
});

test('esSistemaIgnorado: servicio de Windows por nombre, exe oculto (SurfaceBroker)', () => {
  const lista = [{ servicio: 'SurfaceExperienceService-76.5120.174', motivo: 'Microsoft Surface, LocalSystem' }];
  const svc = { nombre: 'SurfaceExperienceService-76.5120.174' };
  assert.equal(esSistemaIgnorado(9200, { exe: null, cmd: '' }, lista, svc), true);
  assert.equal(esSistemaIgnorado(9200, { exe: null, cmd: '' }, lista, { nombre: 'OtroServicio' }), false);
  assert.equal(esSistemaIgnorado(9200, { exe: null, cmd: '' }, lista, null), false);
});

test('esSistemaIgnorado: imagen por nombre .exe, exe oculto (TpvNet.exe de BDP-Net)', () => {
  const lista = [{ imagen: 'TpvNet.exe', motivo: 'BDP-Net TPV, exe oculto sin elevar' }];
  assert.equal(esSistemaIgnorado(22312, { exe: null, cmd: null, imagen: 'TpvNet.exe' }, lista), true);
  assert.equal(esSistemaIgnorado(22312, { exe: null, cmd: null, imagen: 'tpvnet.EXE' }, lista), true);
  assert.equal(esSistemaIgnorado(22312, { exe: null, cmd: null, imagen: 'Otro.exe' }, lista), false);
  assert.equal(esSistemaIgnorado(22312, { exe: null, cmd: null, imagen: null }, lista), false);
  assert.equal(esSistemaIgnorado(22312, undefined, lista), false);
});

test('esSistemaIgnorado: pid 4 solo sin exe (System)', () => {
  const lista = [{ pid: 4, motivo: 'System, sin exe' }];
  assert.equal(esSistemaIgnorado(4, { exe: null, cmd: '' }, lista), true);
  assert.equal(esSistemaIgnorado(4, { exe: 'C:\\x.exe', cmd: '' }, lista), false);
  assert.equal(esSistemaIgnorado(5, { exe: null, cmd: '' }, lista), false);
});

test('esSistemaIgnorado: cmdContiene acota un exe generico (bun del app, no otro bun)', () => {
  const lista = [{ exe: 'C:\\Users\\usuario\\.bun\\bin\\bun.exe', cmdContiene: 'serve --port 4096', motivo: 'editor-propio' }];
  const exe = 'C:\\Users\\usuario\\.bun\\bin\\bun.exe';
  assert.equal(esSistemaIgnorado(8084, { exe, cmd: `"${exe}"  run ./src/index.ts serve --port 4096` }, lista), true);
  assert.equal(esSistemaIgnorado(9001, { exe, cmd: `"${exe}" run ./otro.ts --port 5000` }, lista), false);
});

test('atribuirHuerfano: editor-propio-dev no se atribuye a editor-propio (frontera de ruta)', () => {
  const pool = [
    { clave: 'editor-propio', ruta: `${AREA}\\editor-propio` },
    { clave: 'editor-propio-dev', ruta: `${AREA}\\editor-propio-dev` },
  ];
  const proc = { exe: `${AREA}\\editor-propio-dev\\src\\node_modules\\electron.exe`, cmd: '' };
  assert.equal(atribuirHuerfano(proc, pool), 'editor-propio-dev');
});

test('atribuirHuerfano: el marcador del puerto reclama un proceso fuera de la carpeta (PROYECTO TASKS 4190)', () => {
  const entrada = { puertos: [4190, 4191], expectedCmdline: ['glory-backend', '4191'] };
  const pool = [{ clave: 'PROYECTO TASKS', ruta: `${AREA}\\PROYECTO TASKS`, entrada }];
  const proc = { exe: 'D:\\apps-ejemplo\\fuera\\glory-backend.exe', cmd: 'glory-backend.exe --port 4190' };
  assert.equal(atribuirHuerfano(proc, pool, 4190), 'PROYECTO TASKS');
  // En 4191 el marcador es '4191': este proceso no lo lleva ni está bajo la ruta, así que no es del proyecto.
  assert.equal(atribuirHuerfano(proc, pool, 4191), null);
  assert.equal(atribuirHuerfano({ exe: 'C:\\otro\\node.exe', cmd: 'node x.js' }, pool, 4190), null);
});

test('parsearEstablecidas: conexiones ESTABLISHED con el pid del cliente; ignora LISTENING', () => {
  const sal = [
    '  TCP    127.0.0.1:15433        0.0.0.0:0              LISTENING       31216',
    '  TCP    127.0.0.1:50001        127.0.0.1:15433        ESTABLISHED     9276',
    '  TCP    [::1]:50002            [::1]:15433            ESTABLISHED     9276',
  ].join('\r\n');
  assert.deepEqual(parsearEstablecidas(sal), [
    { puertoRemoto: 15433, pid: 9276 },
    { puertoRemoto: 15433, pid: 9276 },
  ]);
});

test('esSistemaIgnorado: identidad por puerto solo para un proceso ilegible', () => {
  const lista = [{ puerto: 8790, motivo: 'gateway local de Claude Desktop' }];
  const ilegible = { exe: null, cmd: '', imagen: null };
  assert.equal(esSistemaIgnorado(8204, ilegible, lista, null, 8790), true);
  // Otro puerto no casa.
  assert.equal(esSistemaIgnorado(8204, ilegible, lista, null, 8791), false);
  // Sin puerto (llamada vieja) tampoco: no se ignora por accidente.
  assert.equal(esSistemaIgnorado(8204, ilegible, lista), false);
  /* Testigo de que no tapa un hueco real: si el puerto pasa a ser de un
   * proyecto, su proceso tiene exe legible y el ignorado deja de casar. */
  assert.equal(esSistemaIgnorado(9001, { exe: 'C:\area\laboratorio\node.exe', cmd: 'node server' }, lista, null, 8790), false);
});

