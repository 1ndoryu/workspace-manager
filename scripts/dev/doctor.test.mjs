/* Tests minimos de la atribucion del mando (doctor --all): evitan volver a
 * marcar como ajeno un proceso del proyecto o como hueco un tercero declarado.
 * Puros: sin procesos reales ni red. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  accionParaPuerto,
  atribuirHuerfano,
  auxiliarDe,
  detectarDerivaEnv,
  detectarRust,
  duenoDePuerto,
  enRuta,
  esDelProyecto,
  esSistemaIgnorado,
  leerRegistro,
  parsearNetstat,
  validarIgnoradoSistema,
} from './doctor.mjs';

const AREA = 'C:\\Users\\usuario\\OneDrive\\Documentos\\area-trabajo';

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
  const proc = { exe: 'C:\\Users\\usuario\\AppData\\Roaming\\uTorrent Web\\helper\\helper.exe', cmd: '' };
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

test('leerRegistro: dos proyectos que reclaman el mismo puerto dejan aviso en el posterior', () => {
  const dir = mkdtempSync(join('C:/tmp', 'wm-registro-test-'));
  const ruta = join(dir, 'registro.json');
  try {
    const registro = {
      version: 1,
      proyectos: [
        { id: 'A', ruta: '.', boton: [['npm', 'run', 'dev']], puertos: [3000], expectedCmdline: 'a' },
        {
          id: 'B',
          ruta: '.',
          boton: [['npm', 'run', 'dev']],
          puertos: [5183],
          expectedCmdline: 'b',
          auxiliares: [{ puerto: 3000, marcador: 'backend', motivo: 'backend que choca con A' }],
        },
      ],
    };
    writeFileSync(ruta, JSON.stringify(registro));
    const reg = leerRegistro(ruta);
    assert.equal(reg.entradas.get('A')._avisoRegistro, undefined);
    assert.match(reg.entradas.get('B')._avisoRegistro ?? '', /puerto 3000 ya declarado por 'A'/);
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
  const lista = [{ exe: 'C:\\Users\\usuario\\.bun\\bin\\bun.exe', cmdContiene: 'serve --port 4096', motivo: 'opencode-propio' }];
  const exe = 'C:\\Users\\usuario\\.bun\\bin\\bun.exe';
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

test('duenoDePuerto: un auxiliar declarado nombra a su dueno (no es proceso ajeno)', () => {
  const entradas = [{ id: 'KAMPLES', puertos: [5183], auxiliares: [{ puerto: 3001, marcador: 'glory-backend', motivo: 'backend' }] }];
  const procs = new Map([[77, { pid: 77, exe: 'C:/x/glory-backend.exe', cmd: 'C:/x/glory-backend.exe' }]]);
  assert.deepEqual(duenoDePuerto(3001, [77], procs, entradas), { id: 'KAMPLES', pid: 77, via: 'auxiliar' });
  assert.equal(duenoDePuerto(3001, [88], procs, entradas), null);
});

test('accionParaPuerto: nunca mata, y nombra el siguiente paso por caso', () => {
  const ajeno = accionParaPuerto('KAMPLES', 3000, [9], null);
  assert.match(ajeno, /lo ocupa un proceso ajeno \(pid 9\); no se mata/);
  const dueno = accionParaPuerto('KAMPLES', 3000, [9], { id: 'glory-pulse', pid: 9, via: 'proceso' });
  assert.match(dueno, /lo ocupa glory-pulse \(pid 9, proceso\); no se mata/);
  assert.match(dueno, /mueve el puerto de KAMPLES/);
  const compartido = accionParaPuerto('KAMPLES', 5183, [], null, ['otro']);
  assert.match(compartido, /deja un solo dueño/);
});

test('detectarDerivaEnv: PORT no declarado avisa; PORT declarado como auxiliar no', () => {
  const raiz = mkdtempSync(join('C:/tmp', 'wm-deriva-test-'));
  try {
    const kamples = join(raiz, 'kamples');
    const pulse = join(raiz, 'pulse');
    mkdirSync(kamples);
    mkdirSync(pulse);
    writeFileSync(join(kamples, '.env'), 'DATABASE_URL=x\nPORT=3002 # cambiado a mano\n');
    writeFileSync(join(kamples, '.env.example'), 'PORT=3001\n');
    writeFileSync(join(pulse, '.env'), 'PORT=3001\n');
    const entradas = new Map([
      ['KAMPLES', { id: 'KAMPLES', ruta: kamples, puertos: [5183], auxiliares: [{ puerto: 3001, marcador: 'glory-backend', motivo: 'backend' }] }],
      ['glory-pulse', { id: 'glory-pulse', ruta: pulse, puertos: [3000] }],
    ]);
    const avisos = detectarDerivaEnv({ entradas }, { raiz });
    assert.deepEqual(avisos, [
      { id: 'KAMPLES', archivo: '.env', puerto: 3002, motivo: 'PORT=3002 no esta en puertos/auxiliares de KAMPLES' },
      { id: 'glory-pulse', archivo: '.env', puerto: 3001, motivo: 'PORT=3001 lo declara KAMPLES' },
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
