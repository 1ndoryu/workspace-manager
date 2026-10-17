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
  entradaEfectiva,
  esDelProyecto,
  esEntradaRemota,
  esSistemaIgnorado,
  leerRegistro,
  modoDe,
  paresTunel,
  parsearNetstat,
  puertoDeSaludValido,
  reenviosTunel,
  tunelDeEntrada,
  tunelDeQuien,
  validarBloqueBuild,
  validarIgnoradoSistema,
  validarVps,
  veredictoUpSinCobertura,
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

test('leerRegistro: vps — 89 completo con alias y 66 solo lectura sin alias; el registro real los declara', () => {
  const reg = leerRegistro();
  assert.deepEqual(
    reg.vps.map((v) => [v.id, v.modo, v.alias]),
    [['89', 'completo', 'dev89'], ['66', 'lectura', null]],
  );
});

test('validarVps: rechaza lectura con alias SSH, completo sin alias, modo ajeno y claves extra', () => {
  assert.doesNotThrow(() => validarVps({ id: 'x', alias: null, modo: 'lectura' }));
  assert.throws(() => validarVps({ id: '66', alias: 'dev66', modo: 'lectura' }), /no admite alias/);
  assert.throws(() => validarVps({ id: '89', alias: null, modo: 'completo' }), /necesita alias/);
  assert.throws(() => validarVps({ id: '89', alias: 'dev89', modo: 'root' }), /modo debe ser/);
  assert.throws(() => validarVps({ id: '89', alias: 'dev89', modo: 'completo', clave: 'x' }), /clave desconocida/);
  assert.throws(() => validarVps({ id: 'Con Espacios', alias: 'dev', modo: 'completo' }), /vps.id no valido/);
});

test('leerRegistro: vps duplicado o no array falla cerrado; ausente es lista vacia', () => {
  const dir = mkdtempSync(join('C:/tmp', 'wm-registro-test-'));
  const ruta = join(dir, 'registro.json');
  try {
    writeFileSync(ruta, JSON.stringify({ version: 1, proyectos: [] }));
    assert.deepEqual(leerRegistro(ruta).vps, []);
    writeFileSync(ruta, JSON.stringify({ version: 1, proyectos: [], vps: { id: '89' } }));
    assert.throws(() => leerRegistro(ruta), /vps no es array/);
    writeFileSync(
      ruta,
      JSON.stringify({ version: 1, proyectos: [], vps: [{ id: '89', alias: 'dev89', modo: 'completo' }, { id: '89', alias: null, modo: 'lectura' }] }),
    );
    assert.throws(() => leerRegistro(ruta), /vps id duplicado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('veredictoUpSinCobertura: probe verde = ya-arriba degradado, no arranca', () => {
  const r = veredictoUpSinCobertura('MN-Inmobiliaria', { estado: 'bajo-mando', motivo: 'probe verde' }, 'snapshot del servidor: timeout');
  assert.equal(r.codigo, 2);
  assert.match(r.resumen, /ya-arriba \(probe verde\)/);
  assert.match(r.resumen, /cobertura no verificada \(snapshot del servidor: timeout\)/);
  assert.doesNotMatch(r.resumen, /arranc(ado|ando)/);
});

test('veredictoUpSinCobertura: sin probe verde rehusa (parado o deriva), nunca arranca', () => {
  for (const estado of ['parado', 'deriva']) {
    const r = veredictoUpSinCobertura('MN-Inmobiliaria', { estado, motivo: 'puerto 3110 libre (parado)' }, 'snapshot del servidor: timeout');
    assert.equal(r.codigo, 1);
    assert.match(r.resumen, new RegExp(`rehusado \\(${estado}: `));
    assert.match(r.resumen, /sin cobertura \(snapshot del servidor: timeout\) no se arranca/);
  }
});

// --- Modo del proyecto (16AA-18): validacion del bloque `build` en el registro ---
const bloqueOk = {
  puertos: [3105],
  boton: [['cargo', 'run', '--release']],
  construirFront: [['npm', '--prefix', 'frontend', 'run', 'build']],
  healths: [{ puerto: 3105, ruta: '/', marcador: '<div id="root">' }],
};

test('validarBloqueBuild: sin bloque solo vale si el modo no es build', () => {
  assert.equal(validarBloqueBuild({}), null);
  assert.equal(validarBloqueBuild({ modo: 'dev' }), null);
  assert.match(validarBloqueBuild({ modo: 'build' }), /sin bloque build/);
  assert.match(validarBloqueBuild({ modo: 'produccion' }), /no valido/);
});

test('validarBloqueBuild: exige puertos, un boton por puerto y construirFront', () => {
  const e = (b) => ({ modo: 'build', build: { ...bloqueOk, ...b } });
  assert.equal(validarBloqueBuild(e({})), null);
  assert.match(validarBloqueBuild(e({ puertos: [] })), /build.puertos/);
  assert.match(validarBloqueBuild(e({ puertos: [80] })), /build.puertos/);
  assert.match(validarBloqueBuild(e({ boton: [] })), /un comando por puerto/);
  assert.match(validarBloqueBuild(e({ boton: [['cargo', 'run'], ['npm', 'run']] })), /un comando por puerto/);
  assert.match(validarBloqueBuild(e({ boton: [['cargo', 'run'], []] })), /un comando por puerto/);
  assert.match(validarBloqueBuild(e({ boton: ['cargo run'] })), /lista de comandos/);
  assert.match(validarBloqueBuild(e({ construirFront: [] })), /construirFront/);
  assert.match(validarBloqueBuild(e({ construirFront: ['npm run build'] })), /construirFront/);
  assert.match(validarBloqueBuild(e({ puertosLocales: [13105, 15182] })), /puertosLocales debe tener/);
  assert.match(validarBloqueBuild(e({ puertosLocales: [13105, 13105] })), /puertosLocales debe tener/);
  assert.match(validarBloqueBuild(e({ otra: 1 })), /clave desconocida 'otra'/);
});

test('validarBloqueBuild: healths atados a build.puertos y marcador acotado', () => {
  const e = (healths) => ({ modo: 'build', build: { ...bloqueOk, healths } });
  assert.match(validarBloqueBuild(e([{ puerto: 5199, ruta: '/' }])), /puerto fuera de build.puertos/);
  assert.match(validarBloqueBuild(e([{ puerto: 3105, ruta: 'api' }])), /ruta absoluta/);
  assert.match(validarBloqueBuild(e([{ puerto: 3105, ruta: '/', esperaJson: 'si' }])), /esperaJson no booleano/);
  assert.match(validarBloqueBuild(e([{ puerto: 3105, ruta: '/', marcador: 'ab' }])), /marcador debe ser texto/);
  assert.match(validarBloqueBuild(e([{ puerto: 3105, ruta: '/', marcador: 'x'.repeat(121) }])), /marcador debe ser texto/);
  assert.match(validarBloqueBuild(e([{ puerto: 3105, ruta: '/', espera: true }])), /clave desconocida 'espera'/);
  assert.equal(validarBloqueBuild(e([{ puerto: 3105, ruta: '/', esperaJson: true }])), null);
  // [por que] En build `/` tambien lo sirve la API: sin marcador un 200 no distingue SPA de API.
  assert.equal(validarBloqueBuild(e([{ puerto: 3105, ruta: '/', marcador: 'id="root"' }])), null);
});

/* --- 16AA-20: fichas remotas y sus tuneles --------------------------------
 * El doctor clasificaba una ficha con `host` contra puertos locales que no
 * existen (los de la 89), asi que cinco proyectos que sirven 200 en el taller
 * salian en deriva o parados, y sus tuneles ssh sumaban ocho huerfanos
 * «(sin proyecto)». La ficha de abajo copia la de MN-Inmobiliaria del registro. */

const FICHA = {
  id: 'X',
  host: 'dev89',
  puertos: [3110, 5199, 3102],
  puertosRemotos: [3110, 5199, 20241],
  healths: [
    { puerto: 3110, ruta: '/api/health', esperaJson: true },
    { puerto: 20241, ruta: '/ready', esperaJson: true },
  ],
  tunelSsh: false,
  modo: 'build',
  build: {
    puertos: [3110, 20241],
    puertosLocales: [13110, 12024],
    healths: [{ puerto: 3110, ruta: '/', marcador: '<title>MN Inmobiliaria' }],
    boton: [['cargo', 'run'], ['cloudflared', 'run']],
    construirFront: [['npm', 'run', 'build']],
  },
};

/* Proceso con la forma que le da `procesosDe`: solo lo que miran los ayudantes. */
const ssh = (cmd) => ({ creado: true, imagen: 'ssh.exe', cmd });

test('esEntradaRemota: solo una ficha con host no vacio', () => {
  assert.equal(esEntradaRemota({ host: 'dev89' }), true);
  assert.equal(esEntradaRemota({ host: '' }), false);
  assert.equal(esEntradaRemota({ host: null }), false);
  assert.equal(esEntradaRemota({ puertos: [8787] }), false);
  assert.equal(esEntradaRemota(undefined), false);
});

test('modoDe: el defecto es build, pero solo si hay bloque al que cambiar', () => {
  assert.equal(modoDe(FICHA), 'build');
  // Una ficha sin bloque se queda en dev: `entradaEfectiva` daria puertos vacios.
  assert.equal(modoDe({ host: 'dev89', puertos: [3105] }), 'dev');
  assert.equal(modoDe({ modo: 'dev', build: {} }), 'dev');
  // El override de `up --dev` / `up --build` manda sobre la ficha.
  assert.equal(modoDe(FICHA, 'dev'), 'dev');
  assert.equal(modoDe({ modo: 'dev' }, 'build'), 'build');
});

test('entradaEfectiva: en build cambia puertos, boton, healths y locales; en dev no toca nada', () => {
  const ef = entradaEfectiva(FICHA);
  assert.deepEqual(ef.puertos, [3110, 20241]);
  assert.deepEqual(ef.puertosRemotos, [3110, 20241]);
  assert.deepEqual(ef.puertosLocales, [13110, 12024]);
  assert.deepEqual(ef.botonRemoto, FICHA.build.boton);
  assert.deepEqual(ef.healths, FICHA.build.healths);
  // La entrada original no se muta: el resto del camino la sigue leyendo.
  assert.deepEqual(FICHA.puertos, [3110, 5199, 3102]);
  // En dev es la identidad exacta, no una copia: cero cambios de comportamiento.
  assert.equal(entradaEfectiva(FICHA, 'dev'), FICHA);
});

test('paresTunel: los pares de los dos modos, en orden, sin `puertosLocales` local = remoto', () => {
  assert.deepEqual(paresTunel(FICHA), [
    [3110, 3110],
    [5199, 5199],
    [20241, 20241],
    [13110, 3110],
    [12024, 20241],
  ]);
  // Sin `puertosRemotos` el remoto es `puertos`, y sin locales el local es el remoto.
  assert.deepEqual(paresTunel({ puertos: [3105] }), [[3105, 3105]]);
  // Sin puertos no hay pares (una ficha remota sin `build` ni `puertos`).
  assert.deepEqual(paresTunel({ host: 'dev89' }), []);
});

test('reenviosTunel: lee `-L` con y sin bind explicito, y con localhost', () => {
  assert.deepEqual(reenviosTunel('ssh -N -L 3110:127.0.0.1:3110 dev89'), [[3110, 3110]]);
  assert.deepEqual(reenviosTunel('ssh -N -L 127.0.0.1:13110:127.0.0.1:3110 dev89'), [[13110, 3110]]);
  assert.deepEqual(reenviosTunel('ssh -N -L 12024:localhost:20241 dev89'), [[12024, 20241]]);
  assert.deepEqual(reenviosTunel('ssh -N -L 3110:127.0.0.1:3110 -L 5199:127.0.0.1:5199 dev89'), [
    [3110, 3110],
    [5199, 5199],
  ]);
  // `-R` (saliente) no es un reenvio local, y sin `-L` no hay nada.
  assert.deepEqual(reenviosTunel('ssh -N -R 3102:127.0.0.1:3102 dev89'), []);
  assert.deepEqual(reenviosTunel(undefined), []);
});

test('tunelDeEntrada: el tunel declarado es suyo; uno con un reenvio de mas, no', () => {
  // Los dos tuneles de la ficha (dev en 3110/5199) y los del modo build.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 3110:127.0.0.1:3110 dev89'), FICHA), true);
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 5199:127.0.0.1:5199 dev89'), FICHA), true);
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 13110:127.0.0.1:3110 dev89'), FICHA), true);
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 12024:127.0.0.1:20241 dev89'), FICHA), true);
  // Un reenvio que la ficha no declara no es el tunel de la ficha.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 3110:127.0.0.1:3110 -L 9999:127.0.0.1:9999 dev89'), FICHA), false);
  // De otra maquina no es nuestro.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 3110:127.0.0.1:3110 dev66'), FICHA), false);
  // Un proceso que no es ssh, o sin linea de comando, no es un tunel.
  assert.equal(tunelDeEntrada({ creado: true, imagen: 'node.exe', cmd: 'ssh -N -L 3110:127.0.0.1:3110 dev89' }, FICHA), false);
  assert.equal(tunelDeEntrada({ creado: true, imagen: 'ssh.exe' }, FICHA), false);
  // Y una entrada local no tiene tunel.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 8787:127.0.0.1:8787 dev89'), { puertos: [8787] }), false);
});

test('tunelDeQuien: nombra la ficha del tunel y null si no es de nadie', () => {
  assert.equal(tunelDeQuien(ssh('ssh -N -L 13110:127.0.0.1:3110 dev89'), [FICHA])?.id, 'X');
  // Testigo: el mismo barrido si reconoce el tunel de la ficha, asi que el
  // null de la lab no es un «no existe» ciego.
  assert.equal(tunelDeQuien(ssh('ssh -N -L 12024:127.0.0.1:20241 dev89'), [FICHA])?.id, 'X');
  // Los tres tuneles de la lab no son de ninguna ficha: siguen siendo lo que son.
  assert.equal(tunelDeQuien(ssh('ssh -N -L 13103:127.0.0.1:3103 dev89'), [FICHA]), null);
  assert.equal(tunelDeQuien(ssh('ssh -N -L 14190:127.0.0.1:4190 dev89'), [FICHA]), null);
});

test('paresTunel: `tunelesExtra` añade el puente del gateway (33110 -> 3110 de la 89)', () => {
  const conPuente = { ...FICHA, tunelesExtra: [[33110, 3110]] };
  assert.ok(paresTunel(conPuente).some(([l, r]) => l === 33110 && r === 3110));
  // El puente es del proyecto aunque el local (33110) no salga de sus puertos.
  const puente = ssh('ssh -N -o ControlMaster=no -L 33110:127.0.0.1:3110 -R 3102:127.0.0.1:3102 dev89');
  assert.equal(tunelDeEntrada(puente, conPuente), true);
  // Sin declararlo no es suyo: asi salia huerfano «(sin proyecto)» en 16AA-20.
  assert.equal(tunelDeEntrada(puente, FICHA), false);
  assert.equal(tunelDeQuien(puente, [conPuente])?.id, 'X');
});

test('leerRegistro: un auxiliar sobre un puerto que el mando solo sirve en dev es valido en build', () => {
  const dir = mkdtempSync(join('C:/tmp', 'wm-registro-test-'));
  const ruta = join(dir, 'registro.json');
  try {
    const base = {
      version: 1,
      proyectos: [
        {
          id: 'X',
          ruta: '.',
          boton: [['npm', 'run', 'dev'], ['npm', 'run', 'gateway']],
          puertos: [3110, 3102],
          healths: [{ puerto: 3110, ruta: '/' }],
          expectedCmdline: ['x', 'gateway'],
          auxiliares: [{ puerto: 3102, marcador: '--gateway-x', motivo: 'vive en el portatil' }],
        },
      ],
    };
    // Sin bloque `build` el modo es dev y 3102 si es del mando: auxiliar invalido.
    writeFileSync(ruta, JSON.stringify(base));
    assert.match(leerRegistro(ruta).entradas.get('X')._avisoRegistro ?? '', /auxiliares/);
    // Con `build` el mando sirve 3110 y el gateway queda fuera: auxiliar legitimo.
    base.proyectos[0].modo = 'build';
    base.proyectos[0].build = { puertos: [3110], boton: [['cargo', 'run']], construirFront: [['npm', 'run', 'build']] };
    writeFileSync(ruta, JSON.stringify(base));
    const e = leerRegistro(ruta).entradas.get('X');
    assert.equal(e._avisoRegistro, undefined);
    assert.equal(auxiliarDe(3102, 'node src/index.mjs --gateway-x', [e]), 'X');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leerRegistro: el registro real declara el gateway y el puente de MN sin aviso', () => {
  const reg = leerRegistro();
  const mn = reg.entradas.get('MN-Inmobiliaria');
  assert.equal(mn._avisoRegistro, undefined);
  assert.equal(auxiliarDe(3102, 'node  src/index.mjs --gateway-mn ', reg.entradas.values()), 'MN-Inmobiliaria');
  assert.deepEqual(mn.tunelesExtra, [[33110, 3110]]);
  assert.equal(
    tunelDeEntrada(ssh('ssh.exe -N -o ControlMaster=no -L 33110:127.0.0.1:3110 -R 3102:127.0.0.1:3102 dev89'), mn),
    true,
  );
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
  assert.equal(esSistemaIgnorado(9001, { exe: 'C:\area\glory-lab\node.exe', cmd: 'node server' }, lista, null, 8790), false);
});

test('validarIgnoradoSistema: puerto exige rango y es excluyente con exe/pid/imagen/servicio', () => {
  assert.throws(() => validarIgnoradoSistema({ puerto: 80, motivo: 'puerto privilegiado' }, 't'), /exactamente uno/);
  assert.throws(() => validarIgnoradoSistema({ puerto: 8790, pid: 4, motivo: 'los dos' }, 't'), /exactamente uno/);
  assert.throws(() => validarIgnoradoSistema({ puerto: 8790, imagen: 'algo.exe', motivo: 'los dos' }, 't'), /exactamente uno/);
  assert.doesNotThrow(() => validarIgnoradoSistema({ puerto: 8790, motivo: 'gateway local de Claude Desktop' }, 't'));
});
