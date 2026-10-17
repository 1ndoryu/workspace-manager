import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualizarRegistro, planificarAccess, planificarDns, planificarIngress, validarHost, validarPuerto,
} from './publicar-host.mjs';

const CATCH = { service: 'http_status:404' };

/* La zona se pasa como argumento: así el test no depende de la config privada
 * (la zona real vive en `config/taller.json`, que no se versiona). */
test('validarHost acepta solo <proyecto>-dev.<zona> de un nivel', () => {
  const zona = 'ejemplo.test';
  assert.equal(validarHost('mn-dev.ejemplo.test', zona), 'mn-dev.ejemplo.test');
  assert.throws(() => validarHost('mn.dev.ejemplo.test', zona), /formato/);
  assert.throws(() => validarHost('mn.ejemplo.test', zona), /formato/);
  assert.throws(() => validarHost('mn-dev.otra.test', zona), /formato/);
  assert.throws(() => validarHost('-dev.ejemplo.test', zona), /formato/);
  assert.throws(() => validarHost(undefined, zona), /formato/);
});

test('validarPuerto exige entero entre 1024 y 65535', () => {
  assert.equal(validarPuerto('5199'), 5199);
  assert.throws(() => validarPuerto(undefined), /puerto/);
  assert.throws(() => validarPuerto('80'), /puerto/);
  assert.throws(() => validarPuerto('5199.5'), /puerto/);
});

test('planificarIngress inserta la regla antes del catch-all', () => {
  const r = planificarIngress([{ hostname: 'a-dev.wandori.us', service: 'http://127.0.0.1:3000' }, CATCH], 'mn-dev.wandori.us', 5199);
  assert.equal(r.accion, 'crear');
  assert.deepEqual(r.ingress, [
    { hostname: 'a-dev.wandori.us', service: 'http://127.0.0.1:3000' },
    { hostname: 'mn-dev.wandori.us', service: 'http://127.0.0.1:5199' },
    CATCH,
  ]);
});

test('planificarIngress no cambia nada si la regla ya existe igual', () => {
  const ing = [{ hostname: 'mn-dev.wandori.us', service: 'http://127.0.0.1:5199' }, CATCH];
  assert.deepEqual(planificarIngress(ing, 'mn-dev.wandori.us', 5199), { accion: 'ya', ingress: ing });
});

test('planificarIngress rechaza un host ya apuntando a otro destino', () => {
  const ing = [{ hostname: 'mn-dev.wandori.us', service: 'http://127.0.0.1:3000' }, CATCH];
  assert.throws(() => planificarIngress(ing, 'mn-dev.wandori.us', 5199), /ya apunta/);
});

test('planificarIngress con --repuntar cambia el destino y deja el resto igual', () => {
  const ing = [
    { hostname: 'a-dev.wandori.us', service: 'http://127.0.0.1:3000' },
    { hostname: 'mn-dev.wandori.us', service: 'http://127.0.0.1:5199' },
    CATCH,
  ];
  const r = planificarIngress(ing, 'mn-dev.wandori.us', 3110, { repuntar: true });
  assert.equal(r.accion, 'repuntar');
  assert.equal(r.de, 'http://127.0.0.1:5199');
  assert.deepEqual(r.ingress, [
    { hostname: 'a-dev.wandori.us', service: 'http://127.0.0.1:3000' },
    { hostname: 'mn-dev.wandori.us', service: 'http://127.0.0.1:3110' },
    CATCH,
  ]);
  // Mismo destino y --repuntar: sigue siendo «nada que hacer», no un repunte inútil.
  assert.equal(planificarIngress(ing, 'mn-dev.wandori.us', 5199, { repuntar: true }).accion, 'ya');
  // Un host nuevo con --repuntar se crea igual que sin la bandera.
  assert.equal(planificarIngress(ing, 'b-dev.wandori.us', 5300, { repuntar: true }).accion, 'crear');
});

test('planificarIngress no reescribe reglas sin hostname ajenas al catch-all', () => {
  assert.throws(() => planificarIngress([{ service: 'http://x:1' }, CATCH], 'a-dev.wandori.us', 5199), /no las reescribo/);
});

test('planificarDns crea, no toca lo correcto y rechaza lo distinto', () => {
  const destino = 'id.cfargotunnel.com';
  assert.deepEqual(planificarDns([], 'a-dev.wandori.us', destino), { accion: 'crear' });
  const ok = [{ type: 'CNAME', content: destino, proxied: true }];
  assert.deepEqual(planificarDns(ok, 'a-dev.wandori.us', destino), { accion: 'ya' });
  assert.throws(() => planificarDns([{ type: 'A', content: '1.2.3.4', proxied: false }], 'a-dev.wandori.us', destino), /no lo sobrescribo/);
  assert.throws(() => planificarDns([{ type: 'CNAME', content: destino, proxied: false }], 'a-dev.wandori.us', destino), /no lo sobrescribo/);
});

test('planificarAccess detecta app existente y rechaza tipos ajenos', () => {
  assert.deepEqual(planificarAccess([], 'a-dev.wandori.us'), { accion: 'crear' });
  const apps = [{ domain: 'a-dev.wandori.us', type: 'self_hosted' }];
  assert.equal(planificarAccess(apps, 'a-dev.wandori.us').accion, 'ya');
  assert.throws(() => planificarAccess([{ domain: 'a-dev.wandori.us', type: 'saas' }], 'a-dev.wandori.us'), /tipo saas/);
});

test('actualizarRegistro añade host y puerto solo al proyecto indicado y es idempotente', () => {
  const texto = [
    '{', '  "proyectos": [',
    '    { "id": "otro", "hostsPublicos": [], "puertosPublicos": [] },',
    '    { "id": "MN-Inmobiliaria",',
    '      "hostsPublicos": ["mn-dev.wandori.us"],',
    '      "puertosPublicos": [5199] }',
    '  ]', '}',
  ].join('\n');
  const nuevo = actualizarRegistro(texto, 'MN-Inmobiliaria', 'a-dev.wandori.us', 5300);
  assert.match(nuevo, /"hostsPublicos": \["mn-dev.wandori.us", "a-dev.wandori.us"\]/);
  assert.match(nuevo, /"puertosPublicos": \[5199, 5300\]/);
  assert.match(nuevo, /"id": "otro", "hostsPublicos": \[\], "puertosPublicos": \[\]/);
  assert.equal(actualizarRegistro(nuevo, 'MN-Inmobiliaria', 'a-dev.wandori.us', 5300), nuevo);
});

test('actualizarRegistro cambia el puerto del host ya declarado, sin duplicarlo', () => {
  const texto = [
    '{', '  "proyectos": [',
    '    { "id": "MN-Inmobiliaria",',
    '      "hostsPublicos": ["mn-dev.wandori.us", "otro-dev.wandori.us"],',
    '      "puertosPublicos": [5199, 5300] }',
    '  ]', '}',
  ].join('\n');
  // Pasar la ficha a modo build: el mismo host sirve en otro puerto local.
  const nuevo = actualizarRegistro(texto, 'MN-Inmobiliaria', 'mn-dev.wandori.us', 3110);
  assert.match(nuevo, /"hostsPublicos": \["mn-dev\.wandori\.us", "otro-dev\.wandori\.us"\]/);
  assert.match(nuevo, /"puertosPublicos": \[3110, 5300\]/);
  assert.equal(actualizarRegistro(nuevo, 'MN-Inmobiliaria', 'mn-dev.wandori.us', 3110), nuevo);
});

test('actualizarRegistro conserva el formato multilínea al cambiar el puerto', () => {
  const texto = [
    '{', '  "proyectos": [',
    '    { "id": "MN-Inmobiliaria",',
    '      "hostsPublicos": [',
    '        "mn-dev.wandori.us"',
    '      ],',
    '      "puertosPublicos": [',
    '        5199',
    '      ] }',
    '  ]', '}',
  ].join('\n');
  const nuevo = actualizarRegistro(texto, 'MN-Inmobiliaria', 'mn-dev.wandori.us', 3110);
  assert.match(nuevo, /"puertosPublicos": \[\n        3110\n      \]/);
  assert.match(nuevo, /"hostsPublicos": \[\n        "mn-dev\.wandori\.us"\n      \]/);
});

test('actualizarRegistro falla si el proyecto no existe o le faltan los campos', () => {
  assert.throws(() => actualizarRegistro('{"proyectos":[]}', 'nope', 'a-dev.wandori.us', 5300), /no está en registro/);
  assert.throws(() => actualizarRegistro('{"proyectos":[{ "id": "x" }]}', 'x', 'a-dev.wandori.us', 5300), /falta "hostsPublicos"/);
});
