/* Tests minimos de la atribucion del mando (doctor --all): evitan volver a
 * marcar como ajeno un proceso del proyecto o como hueco un tercero declarado.
 * Puros: sin procesos reales ni red. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  atribuirHuerfano,
  auxiliarDe,
  detectarRust,
  enRuta,
  esDelProyecto,
  esSistemaIgnorado,
  leerRegistro,
  validarIgnoradoSistema,
} from './doctor.mjs';

const AREA = 'C:\\Users\\Owner\\OneDrive\\Documentos\\area-trabajo';

test('esDelProyecto: exe bajo la ruta del proyecto', () => {
  const proc = { exe: `${AREA}\\MN-Inmobiliaria\\backend\\glory-backend.exe`, cmd: '' };
  assert.equal(esDelProyecto(proc, `${AREA}\\MN-Inmobiliaria`, 'nada'), true);
});

test('esDelProyecto: cmd con la ruta del proyecto aunque el exe sea otro (regresion PROYECTO TASKS 4191)', () => {
  const proc = {
    exe: 'C:\\Program Files\\nodejs\\node.exe',
    cmd: `node "${AREA}\\PROYECTO TASKS\\frontend\\node_modules\\vite\\bin\\vite.js" --port 4191`,
  };
  assert.equal(esDelProyecto(proc, `${AREA}\\PROYECTO TASKS`, 'glory-backend'), true);
});

test('esDelProyecto: frontera de ruta, "glory" no casa con "glory-pulse"', () => {
  const proc = { exe: '', cmd: `node "${AREA}\\glory-pulse\\run.js"` };
  assert.equal(esDelProyecto(proc, `${AREA}\\glory`, 'nada-que-casa'), false);
});

test('esDelProyecto: proceso ajeno sin ruta ni marcador', () => {
  const proc = { exe: 'C:\\Windows\\System32\\svchost.exe', cmd: '' };
  assert.equal(esDelProyecto(proc, `${AREA}\\NAKOMI`, 'glory-backend'), false);
});

test('enRuta: exige frontera de ruta', () => {
  assert.equal(enRuta('c:\\a\\glory-pulse\\x', 'c:\\a\\glory'), false);
  assert.equal(enRuta('c:\\a\\glory\\x', 'c:\\a\\glory'), true);
  assert.equal(enRuta('"c:\\a\\glory" --x', 'c:\\a\\glory'), true);
  assert.equal(enRuta('', 'c:\\a\\glory'), false);
});

test('atribuirHuerfano: gana la ruta mas larga que contiene el proceso', () => {
  const pool = [
    { clave: 'area', ruta: AREA },
    { clave: 'PROYECTO TASKS', ruta: `${AREA}\\PROYECTO TASKS` },
  ];
  const proc = { exe: `${AREA}\\PROYECTO TASKS\\backend\\glory-backend.exe`, cmd: '' };
  assert.equal(atribuirHuerfano(proc, pool), 'PROYECTO TASKS');
});

test('atribuirHuerfano: ignorado del area (opencode-propio) se atribuye, no queda mudo', () => {
  const pool = [{ clave: 'opencode-propio', ruta: `${AREA}\\opencode-propio` }];
  const proc = { exe: `${AREA}\\opencode-propio\\app\\electron.exe`, cmd: '' };
  assert.equal(atribuirHuerfano(proc, pool), 'opencode-propio');
});

test('atribuirHuerfano: sin dueño conocido devuelve null', () => {
  const proc = { exe: 'C:\\Users\\Owner\\AppData\\Roaming\\uTorrent Web\\helper\\helper.exe', cmd: '' };
  assert.equal(atribuirHuerfano(proc, [{ clave: 'NAKOMI', ruta: `${AREA}\\NAKOMI` }]), null);
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

test('validarIgnoradoSistema: imagen exige nombre .exe sin ruta y excluyente con exe/pid/servicio', () => {
  const ok = { imagen: 'SvrWCF.exe', motivo: 'BDP-Net TPV, exe oculto' };
  assert.doesNotThrow(() => validarIgnoradoSistema(ok, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'C:\\Bdp-Net\\SvrWCF.exe', motivo: 'ruta no vale' }, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'SvrWCF.exe', pid: 21252, motivo: 'dos claves' }, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'SvrWCF.dll', motivo: 'no es exe' }, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'SvrWCF.exe', cmdContiene: 'algo', motivo: 'cmd sin exe' }, 't'));
});

test('auxiliarDe: script declarado (puerto + marcador en el cmd) es del proyecto', () => {
  const entradas = [
    { id: 'MN-Inmobiliaria', puertos: [3110], auxiliares: [{ puerto: 3122, marcador: 'mejora.mjs', motivo: 'manual' }] },
  ];
  const cmd = '"C:\\Program Files\\nodejs\\node.exe" server/mejora.mjs';
  assert.equal(auxiliarDe(3122, cmd, entradas), 'MN-Inmobiliaria');
  assert.equal(auxiliarDe(3123, cmd, entradas), null, 'otro puerto no casa');
  assert.equal(auxiliarDe(3122, 'node otro.mjs', entradas), null, 'sin marcador no casa');
  assert.equal(auxiliarDe(3122, null, entradas), null, 'cmd no verificable no casa');
  assert.equal(auxiliarDe(3122, cmd, [{ ...entradas[0], _avisoRegistro: 'roto' }]), null, 'entrada con aviso no cuenta');
});

test('leerRegistro: auxiliares con puerto de puertos quedan como aviso de registro', () => {
  const dir = mkdtempSync(join('C:/tmp', 'wm-registro-test-'));
  const ruta = join(dir, 'registro.json');
  try {
    const registro = {
      version: 1,
      proyectos: [
        {
          id: 'X',
          ruta: '.',
          boton: [['npm', 'run', 'dev']],
          puertos: [3110],
          expectedCmdline: 'x',
          auxiliares: [{ puerto: 3110, marcador: 'mejora.mjs', motivo: 'duplica puerto de puertos' }],
        },
      ],
    };
    writeFileSync(ruta, JSON.stringify(registro));
    const e = leerRegistro(ruta).entradas.get('X');
    assert.match(e._avisoRegistro ?? '', /auxiliares/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leerRegistro: el registro real carga y declara los auxiliares e ignorados de BDP-Net y MN-Inmobiliaria', () => {
  const reg = leerRegistro();
  assert.equal(reg.entradas.get('MN-Inmobiliaria')._avisoRegistro, undefined);
  assert.equal(auxiliarDe(3122, 'node server/mejora.mjs', reg.entradas.values()), 'MN-Inmobiliaria');
  assert.equal(esSistemaIgnorado(53394, { exe: null, cmd: null, imagen: 'TpvNet.exe' }, reg.ignoradosSistema), true);
  assert.equal(esSistemaIgnorado(53401, { exe: null, cmd: null, imagen: 'SvrWCF.exe' }, reg.ignoradosSistema), true);
});

test('esSistemaIgnorado: pid 4 solo sin exe (System)', () => {
  const lista = [{ pid: 4, motivo: 'System, sin exe' }];
  assert.equal(esSistemaIgnorado(4, { exe: null, cmd: '' }, lista), true);
  assert.equal(esSistemaIgnorado(4, { exe: 'C:\\x.exe', cmd: '' }, lista), false);
  assert.equal(esSistemaIgnorado(5, { exe: null, cmd: '' }, lista), false);
});

test('esSistemaIgnorado: cmdContiene acota un exe generico (bun del app, no otro bun)', () => {
  const lista = [{ exe: 'C:\\Users\\Owner\\.bun\\bin\\bun.exe', cmdContiene: 'serve --port 4096', motivo: 'opencode-propio' }];
  const exe = 'C:\\Users\\Owner\\.bun\\bin\\bun.exe';
  assert.equal(esSistemaIgnorado(8084, { exe, cmd: `"${exe}"  run ./src/index.ts serve --port 4096` }, lista), true);
  assert.equal(esSistemaIgnorado(9001, { exe, cmd: `"${exe}" run ./otro.ts --port 5000` }, lista), false);
});

/* Fixture de target/ en C:\tmp (AGENTS 0.2: temporales fuera de %TEMP%). */
function fixtureTarget(bytesPorFichero, n) {
  mkdirSync('C:/tmp', { recursive: true });
  const raiz = mkdtempSync(join('C:/tmp', 'wm-doctor-test-'));
  const target = join(raiz, 'target');
  mkdirSync(join(target, 'debug'), { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(target, 'debug', `f${i}.bin`), Buffer.alloc(bytesPorFichero));
  const registro = {
    entradas: new Map([
      ['fixture', { id: 'fixture', ruta: raiz, boton: [['cargo', 'run']], env: { CARGO_TARGET_DIR: target, RUSTC_WRAPPER: 'sccache' } }],
    ]),
  };
  return { raiz, registro };
}

test('detectarRust: el tamano del target se mide solo hasta el umbral y avisa como cota', () => {
  const { raiz, registro } = fixtureTarget(10, 5);
  try {
    const avisos = detectarRust(registro, { umbralBytes: 15, incluirLimpiador: false, stats: { peticiones: 0, hit: 100 } });
    const tamano = avisos.filter((a) => a.chequeo === 'tamano');
    assert.equal(tamano.length, 1);
    assert.match(tamano[0].detalle, /medido hasta el umbral/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('detectarRust: por debajo del umbral no hay aviso de tamano', () => {
  const { raiz, registro } = fixtureTarget(10, 5);
  try {
    const avisos = detectarRust(registro, { umbralBytes: 1e6, incluirLimpiador: false, stats: { peticiones: 0, hit: 100 } });
    assert.equal(avisos.filter((a) => a.chequeo === 'tamano').length, 0);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('atribuirHuerfano: opencode-propio-dev no se atribuye a opencode-propio (frontera de ruta)', () => {
  const pool = [
    { clave: 'opencode-propio', ruta: `${AREA}\\opencode-propio` },
    { clave: 'opencode-propio-dev', ruta: `${AREA}\\opencode-propio-dev` },
  ];
  const proc = { exe: `${AREA}\\opencode-propio-dev\\src\\node_modules\\electron.exe`, cmd: '' };
  assert.equal(atribuirHuerfano(proc, pool), 'opencode-propio-dev');
});
