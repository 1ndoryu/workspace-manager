/* Tests de puertos, derivas y tuneles del mando (doctor --all): auxiliares,
 * PORT del .env, veredicto de up sin cobertura, target de Rust y tuneles ssh.
 * Puros salvo los ficheros temporales de cada caso. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../../shared/rutas.mjs';
import {
  accionParaPuerto,
  auxiliarDe,
  detectarDerivaEnv,
  detectarRust,
  duenoDePuerto,
  paresTunel,
  reenviosTunel,
  tunelDeEntrada,
  tunelDeListener,
  tunelDeQuien,
  veredictoUpSinCobertura,
} from '../../doctor.mjs';
import { FICHA, ssh } from './test-utils.mjs';

test('auxiliarDe: script declarado (puerto + marcador en el cmd) es del proyecto', () => {
  const entradas = [
    { id: 'sitio-api', puertos: [3110], auxiliares: [{ puerto: 3122, marcador: 'mejora.mjs', motivo: 'manual' }] },
  ];
  const cmd = '"C:\\Program Files\\nodejs\\node.exe" server/mejora.mjs';
  assert.equal(auxiliarDe(3122, cmd, entradas), 'sitio-api');
  assert.equal(auxiliarDe(3123, cmd, entradas), null, 'otro puerto no casa');
  assert.equal(auxiliarDe(3122, 'node otro.mjs', entradas), null, 'sin marcador no casa');
  assert.equal(auxiliarDe(3122, null, entradas), null, 'cmd no verificable no casa');
  assert.equal(auxiliarDe(3122, cmd, [{ ...entradas[0], _avisoRegistro: 'roto' }]), null, 'entrada con aviso no cuenta');
});

/* Fixture de target/ en C:\tmp (AGENTS 0.2: temporales fuera de %TEMP%). */
function fixtureTarget(bytesPorFichero, n) {
  mkdirSync(raizTemporales(), { recursive: true });
  const raiz = mkdtempSync(join(raizTemporales(), 'wm-doctor-test-'));
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

test('duenoDePuerto: un auxiliar declarado nombra a su dueno (no es proceso ajeno)', () => {
  const entradas = [{ id: 'proyecto-a', puertos: [5183], auxiliares: [{ puerto: 3001, marcador: 'glory-backend', motivo: 'backend' }] }];
  const procs = new Map([[77, { pid: 77, exe: 'C:/x/glory-backend.exe', cmd: 'C:/x/glory-backend.exe' }]]);
  assert.deepEqual(duenoDePuerto(3001, [77], procs, entradas), { id: 'proyecto-a', pid: 77, via: 'auxiliar' });
  assert.equal(duenoDePuerto(3001, [88], procs, entradas), null);
});

test('accionParaPuerto: nunca mata, y nombra el siguiente paso por caso', () => {
  const ajeno = accionParaPuerto('proyecto-a', 3000, [9], null);
  assert.match(ajeno, /lo ocupa un proceso ajeno \(pid 9\); no se mata/);
  const dueno = accionParaPuerto('proyecto-a', 3000, [9], { id: 'proyecto-b', pid: 9, via: 'proceso' });
  assert.match(dueno, /lo ocupa proyecto-b \(pid 9, proceso\); no se mata/);
  assert.match(dueno, /mueve el puerto de proyecto-a/);
  const compartido = accionParaPuerto('proyecto-a', 5183, [], null, ['otro']);
  assert.match(compartido, /deja un solo dueño/);
});

test('detectarDerivaEnv: PORT no declarado avisa; PORT declarado como auxiliar no', () => {
  const raiz = mkdtempSync(join(raizTemporales(), 'wm-deriva-test-'));
  try {
    const proyectoI = join(raiz, 'proyecto-i');
    const pulse = join(raiz, 'pulse');
    mkdirSync(proyectoI);
    mkdirSync(pulse);
    writeFileSync(join(proyectoI, '.env'), 'DATABASE_URL=x\nPORT=3002 # cambiado a mano\n');
    writeFileSync(join(proyectoI, '.env.example'), 'PORT=3001\n');
    writeFileSync(join(pulse, '.env'), 'PORT=3001\n');
    const entradas = new Map([
      ['proyecto-a', { id: 'proyecto-a', ruta: proyectoI, puertos: [5183], auxiliares: [{ puerto: 3001, marcador: 'glory-backend', motivo: 'backend' }] }],
      ['proyecto-b', { id: 'proyecto-b', ruta: pulse, puertos: [3000] }],
    ]);
    const avisos = detectarDerivaEnv({ entradas }, { raiz });
    assert.deepEqual(avisos, [
      { id: 'proyecto-a', archivo: '.env', puerto: 3002, motivo: 'PORT=3002 no esta en puertos/auxiliares de proyecto-a' },
      { id: 'proyecto-b', archivo: '.env', puerto: 3001, motivo: 'PORT=3001 lo declara proyecto-a' },
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('veredictoUpSinCobertura: probe verde = ya-arriba degradado, no arranca', () => {
  const r = veredictoUpSinCobertura('sitio-api', { estado: 'bajo-mando', motivo: 'probe verde' }, 'snapshot del servidor: timeout');
  assert.equal(r.codigo, 2);
  assert.match(r.resumen, /ya-arriba \(probe verde\)/);
  assert.match(r.resumen, /cobertura no verificada \(snapshot del servidor: timeout\)/);
  assert.doesNotMatch(r.resumen, /arranc(ado|ando)/);
});

test('veredictoUpSinCobertura: sin probe verde rehusa (parado o deriva), nunca arranca', () => {
  for (const estado of ['parado', 'deriva']) {
    const r = veredictoUpSinCobertura('sitio-api', { estado, motivo: 'puerto 3110 libre (parado)' }, 'snapshot del servidor: timeout');
    assert.equal(r.codigo, 1);
    assert.match(r.resumen, new RegExp(`rehusado \\(${estado}: `));
    assert.match(r.resumen, /sin cobertura \(snapshot del servidor: timeout\) no se arranca/);
  }
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
  assert.deepEqual(paresTunel({ host: 'taller-remoto' }), []);
});

test('reenviosTunel: lee `-L` con y sin bind explicito, y con localhost', () => {
  assert.deepEqual(reenviosTunel('ssh -N -L 3110:127.0.0.1:3110 taller-remoto'), [[3110, 3110]]);
  assert.deepEqual(reenviosTunel('ssh -N -L 127.0.0.1:13110:127.0.0.1:3110 taller-remoto'), [[13110, 3110]]);
  assert.deepEqual(reenviosTunel('ssh -N -L 12024:localhost:20241 taller-remoto'), [[12024, 20241]]);
  assert.deepEqual(reenviosTunel('ssh -N -L 3110:127.0.0.1:3110 -L 5199:127.0.0.1:5199 taller-remoto'), [
    [3110, 3110],
    [5199, 5199],
  ]);
  // `-R` (saliente) no es un reenvio local, y sin `-L` no hay nada.
  assert.deepEqual(reenviosTunel('ssh -N -R 3102:127.0.0.1:3102 taller-remoto'), []);
  assert.deepEqual(reenviosTunel(undefined), []);
});

test('tunelDeEntrada: el tunel declarado es suyo; uno con un reenvio de mas, no', () => {
  // Los dos tuneles de la ficha (dev en 3110/5199) y los del modo build.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 3110:127.0.0.1:3110 taller-remoto'), FICHA), true);
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 5199:127.0.0.1:5199 taller-remoto'), FICHA), true);
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 13110:127.0.0.1:3110 taller-remoto'), FICHA), true);
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 12024:127.0.0.1:20241 taller-remoto'), FICHA), true);
  // Un reenvio que la ficha no declara no es el tunel de la ficha.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 3110:127.0.0.1:3110 -L 9999:127.0.0.1:9999 taller-remoto'), FICHA), false);
  // De otra maquina no es nuestro.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 3110:127.0.0.1:3110 dev66'), FICHA), false);
  // Un proceso que no es ssh, o sin linea de comando, no es un tunel.
  assert.equal(tunelDeEntrada({ creado: true, imagen: 'node.exe', cmd: 'ssh -N -L 3110:127.0.0.1:3110 taller-remoto' }, FICHA), false);
  assert.equal(tunelDeEntrada({ creado: true, imagen: 'ssh.exe' }, FICHA), false);
  // Y una entrada local no tiene tunel.
  assert.equal(tunelDeEntrada(ssh('ssh -N -L 8787:127.0.0.1:8787 taller-remoto'), { puertos: [8787] }), false);
});

test('tunelDeQuien: nombra la ficha del tunel y null si no es de nadie', () => {
  assert.equal(tunelDeQuien(ssh('ssh -N -L 13110:127.0.0.1:3110 taller-remoto'), [FICHA])?.id, 'X');
  // Testigo: el mismo barrido si reconoce el tunel de la ficha, asi que el
  // null de la lab no es un «no existe» ciego.
  assert.equal(tunelDeQuien(ssh('ssh -N -L 12024:127.0.0.1:20241 taller-remoto'), [FICHA])?.id, 'X');
  // Los tres tuneles de la lab no son de ninguna ficha: siguen siendo lo que son.
  assert.equal(tunelDeQuien(ssh('ssh -N -L 13103:127.0.0.1:3103 taller-remoto'), [FICHA]), null);
  assert.equal(tunelDeQuien(ssh('ssh -N -L 14190:127.0.0.1:4190 taller-remoto'), [FICHA]), null);
});

// [por que] netstat atribuye el 3105 a un pid muerto (padre de `ssh -f`): el
// túnel vivo se reconoce por su reenvío, no por el pid del listener.
test('tunelDeListener: un listener con pid muerto es el túnel vivo de su ficha', () => {
  const proyectoA = { id: 'proyecto-a', host: 'taller-remoto', puertos: [3105] };
  const vivos = [ssh('ssh -f -N -L 127.0.0.1:3105:127.0.0.1:3105 taller-remoto')];
  assert.equal(tunelDeListener(3105, vivos, [proyectoA])?.id, 'proyecto-a');
  // Otro puerto no es ese túnel.
  assert.equal(tunelDeListener(3110, vivos, [proyectoA, FICHA]), null);
  // Un túnel con un reenvío de más no es el de la ficha, aunque ocupe el puerto.
  const extra = [ssh('ssh -N -L 3105:127.0.0.1:3105 -L 9999:127.0.0.1:9999 taller-remoto')];
  assert.equal(tunelDeListener(3105, extra, [proyectoA]), null);
  // Sin túneles vivos, nada que atribuir (lo que no es túnel sigue como huérfano).
  assert.equal(tunelDeListener(3105, [], [proyectoA]), null);
});

test('paresTunel: `tunelesExtra` añade el puente del gateway (33110 -> 3110 de la 89)', () => {
  const conPuente = { ...FICHA, tunelesExtra: [[33110, 3110]] };
  assert.ok(paresTunel(conPuente).some(([l, r]) => l === 33110 && r === 3110));
  // El puente es del proyecto aunque el local (33110) no salga de sus puertos.
  const puente = ssh('ssh -N -o ControlMaster=no -L 33110:127.0.0.1:3110 -R 3102:127.0.0.1:3102 taller-remoto');
  assert.equal(tunelDeEntrada(puente, conPuente), true);
  // Sin declararlo no es suyo: asi salia huerfano «(sin proyecto)» en 16AA-20.
  assert.equal(tunelDeEntrada(puente, FICHA), false);
  assert.equal(tunelDeQuien(puente, [conPuente])?.id, 'X');
});

