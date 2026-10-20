/* Tests de registro y fichas del mando (doctor --all): carga y validacion de
 * registro.json (vps, ignorados, auxiliares, bloque build) y modo de una ficha
 * remota. Puros salvo los ficheros temporales de cada caso. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../../shared/rutas.mjs';
import {
  auxiliarDe,
  entradaEfectiva,
  esEntradaRemota,
  leerRegistro,
  modoDe,
  validarBloqueBuild,
  validarIgnoradoSistema,
  validarVps,
} from '../../doctor.mjs';
import { FICHA } from './test-utils.mjs';

test('validarIgnoradoSistema: imagen exige nombre .exe sin ruta y excluyente con exe/pid/servicio', () => {
  const ok = { imagen: 'SvrWCF.exe', motivo: 'proveedor-tpv TPV, exe oculto' };
  assert.doesNotThrow(() => validarIgnoradoSistema(ok, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'C:\\Ejemplo\\SvrWCF.exe', motivo: 'ruta no vale' }, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'SvrWCF.exe', pid: 21252, motivo: 'dos claves' }, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'SvrWCF.dll', motivo: 'no es exe' }, 't'));
  assert.throws(() => validarIgnoradoSistema({ imagen: 'SvrWCF.exe', cmdContiene: 'algo', motivo: 'cmd sin exe' }, 't'));
});

test('leerRegistro: auxiliares con puerto de puertos quedan como aviso de registro', () => {
  const dir = mkdtempSync(join(raizTemporales(), 'wm-registro-test-'));
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
  const dir = mkdtempSync(join(raizTemporales(), 'wm-registro-test-'));
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

test('validarVps: rechaza lectura con alias SSH, completo sin alias, modo ajeno y claves extra', () => {
  assert.doesNotThrow(() => validarVps({ id: 'x', alias: null, modo: 'lectura' }));
  assert.throws(() => validarVps({ id: '66', alias: 'dev66', modo: 'lectura' }), /no admite alias/);
  assert.throws(() => validarVps({ id: '89', alias: null, modo: 'completo' }), /necesita alias/);
  assert.throws(() => validarVps({ id: '89', alias: 'taller-ejemplo', modo: 'root' }), /modo debe ser/);
  assert.throws(() => validarVps({ id: '89', alias: 'taller-ejemplo', modo: 'completo', clave: 'x' }), /clave desconocida/);
  assert.throws(() => validarVps({ id: 'Con Espacios', alias: 'dev', modo: 'completo' }), /vps.id no valido/);
});

test('leerRegistro: vps duplicado o no array falla cerrado; ausente es lista vacia', () => {
  const dir = mkdtempSync(join(raizTemporales(), 'wm-registro-test-'));
  const ruta = join(dir, 'registro.json');
  try {
    writeFileSync(ruta, JSON.stringify({ version: 1, proyectos: [] }));
    assert.deepEqual(leerRegistro(ruta).vps, []);
    writeFileSync(ruta, JSON.stringify({ version: 1, proyectos: [], vps: { id: '89' } }));
    assert.throws(() => leerRegistro(ruta), /vps no es array/);
    writeFileSync(
      ruta,
      JSON.stringify({ version: 1, proyectos: [], vps: [{ id: '89', alias: 'taller-ejemplo', modo: 'completo' }, { id: '89', alias: null, modo: 'lectura' }] }),
    );
    assert.throws(() => leerRegistro(ruta), /vps id duplicado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

// [18AA-1] `autologinDev` hornea las credenciales de dev en el bundle del modo build. Sin las dos
// claves en `envRemoto` no hay con qué entrar y el fallo se veía como un login normal: falla cerrado.
test('validarBloqueBuild: autologinDev booleano y con credenciales en envRemoto', () => {
  const e = (b, envRemoto) => ({ modo: 'build', envRemoto, build: { ...bloqueOk, ...b } });
  assert.equal(validarBloqueBuild(e({})), null);
  assert.equal(validarBloqueBuild(e({ autologinDev: false })), null);
  assert.match(validarBloqueBuild(e({ autologinDev: 'si' })), /autologinDev debe ser booleano/);
  assert.match(validarBloqueBuild(e({ autologinDev: true })), /exige VITE_DEV_EMAIL y VITE_DEV_PASSWORD en envRemoto/);
  assert.match(validarBloqueBuild(e({ autologinDev: true }, ['VITE_DEV_EMAIL'])), /exige VITE_DEV_PASSWORD en envRemoto/);
  assert.equal(validarBloqueBuild(e({ autologinDev: true }, ['VITE_DEV_EMAIL', 'VITE_DEV_PASSWORD'])), null);
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

test('esEntradaRemota: solo una ficha con host no vacio', () => {
  assert.equal(esEntradaRemota({ host: 'taller-ejemplo' }), true);
  assert.equal(esEntradaRemota({ host: '' }), false);
  assert.equal(esEntradaRemota({ host: null }), false);
  assert.equal(esEntradaRemota({ puertos: [8787] }), false);
  assert.equal(esEntradaRemota(undefined), false);
});

test('modoDe: el defecto es build, pero solo si hay bloque al que cambiar', () => {
  assert.equal(modoDe(FICHA), 'build');
  // Una ficha sin bloque se queda en dev: `entradaEfectiva` daria puertos vacios.
  assert.equal(modoDe({ host: 'taller-ejemplo', puertos: [3105] }), 'dev');
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

test('leerRegistro: un auxiliar sobre un puerto que el mando solo sirve en dev es valido en build', () => {
  const dir = mkdtempSync(join(raizTemporales(), 'wm-registro-test-'));
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

test('validarIgnoradoSistema: puerto exige rango y es excluyente con exe/pid/imagen/servicio', () => {
  assert.throws(() => validarIgnoradoSistema({ puerto: 80, motivo: 'puerto privilegiado' }, 't'), /exactamente uno/);
  assert.throws(() => validarIgnoradoSistema({ puerto: 8790, pid: 4, motivo: 'los dos' }, 't'), /exactamente uno/);
  assert.throws(() => validarIgnoradoSistema({ puerto: 8790, imagen: 'algo.exe', motivo: 'los dos' }, 't'), /exactamente uno/);
  assert.doesNotThrow(() => validarIgnoradoSistema({ puerto: 8790, motivo: 'gateway local de Claude Desktop' }, 't'));
});

test('leerRegistro: externosPropios acepta un exe de Windows aunque el test corra en Linux', () => {
  const dir = mkdtempSync(join(raizTemporales(), 'wm-registro-test-'));
  try {
    const ruta = join(dir, 'registro.json');
    writeFileSync(ruta, JSON.stringify({ version: 1, proyectos: [], externosPropios: [{ exe: 'C:\\tmp\\glory-web\\glory-web-app.exe', motivo: 'app propia' }] }));
    assert.equal(leerRegistro(ruta).externosPropios.length, 1);
    writeFileSync(ruta, JSON.stringify({ version: 1, proyectos: [], externosPropios: [{ motivo: 'sin identidad' }] }));
    assert.throws(() => leerRegistro(ruta), /externosPropios\[0\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
