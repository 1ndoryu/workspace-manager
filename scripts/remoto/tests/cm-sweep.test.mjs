/* Señuelos de `cm-sweep.sh` (plan 19AA-5, paso 3). Ejecuta el limpiador de verdad, en dry-run y
 * dentro de una caja aislada, para probar lo único que importa: que no toque nada en uso ni nada
 * que sean datos. Cada señuelo lleva su control positivo —sin él, un limpiador que no borrase nada
 * pasaría todas las pruebas de seguridad.
 * [por que] Solo tiene sentido en Linux: el predicado de «en uso» se apoya en /proc y el script usa
 * `flock`, `find -printf` y `du --files0-from`. En otro sistema se salta, en vez de dar un verde
 * falso. Nada de esto toca el disco real: todas las raíces viven en una caja temporal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readlinkSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// El script vive un nivel por encima: el test está en `tests/` para no saturar `remoto/`.
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cm-sweep.sh');
const HAY_GIT = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
/* El script aborta el borrado entero si no encuentra git (fail-closed), así que sin él el control
 * positivo no puede pasar y el resto de señuelos no probaría nada. */
const OMITIR = process.platform === 'linux' && HAY_GIT ? false : 'solo Linux y con git';

/* Caja con la forma real de la 89. Las hojas las comprueba el script (si el último componente no
 * es el esperado, no limpia), así que las dos raíces de temporales acaban en `tmp` y el objetivo en
 * `glory-target`: con otros nombres no se probaría el limpiador, sino la hoja. */
function caja() {
  const raiz = mkdtempSync(path.join(tmpdir(), 'cm-sweep-senuelos-'));
  const d = {
    raiz,
    varTmp: path.join(raiz, 'var', 'tmp'),
    tmp: path.join(raiz, 'tmp'),
    target: path.join(raiz, 'glory-target'),
    calidad: path.join(raiz, 'glory-quality'),
    casa: path.join(raiz, 'casa'),
    log: path.join(raiz, 'cm-sweep.log'),
    estado: path.join(raiz, 'estado'),
    lock: path.join(raiz, 'cm-heavy.lock'),
  };
  for (const x of [d.varTmp, d.tmp, d.target, d.calidad, path.join(d.casa, '.cache')]) {
    mkdirSync(x, { recursive: true });
  }
  writeFileSync(d.lock, '');
  return d;
}

function dir(d, nombre) {
  const r = path.join(d.varTmp, nombre);
  mkdirSync(r, { recursive: true });
  return r;
}

/* Entorno de una corrida. `suelo=99` fuerza el nivel 2 (sin umbrales: cualquier candidato vale) y
 * `objetivo=99` con `suelo=1` fuerza el nivel 1, que es el único que respeta umbrales en dry-run
 * —las pasadas sin umbrales y la poda agresiva están detrás de `! DRY`—. */
function entorno(d, { suelo = 99, objetivo = 25, extra = {} } = {}) {
  return {
    ...process.env,
    // El mapa de «en uso» cae en $TMPDIR: fuera de las raíces que se limpian saldría vacío y el
    // script, fail-closed, no borraría nada (y el control positivo fallaría sin decir por qué).
    TMPDIR: d.tmp,
    CM_SWEEP_LOG: d.log,
    CM_SWEEP_ESTADO: d.estado,
    CM_SWEEP_LOCK: d.lock,
    CM_TARGET_BASE: d.target,
    CM_QUALITY_BASE: d.calidad,
    CM_VAR_TMP: d.varTmp,
    CM_TMP: d.tmp,
    CM_SWEEP_CASA: d.casa,
    CM_SWEEP_SUELO_GB: String(suelo),
    CM_SWEEP_OBJETIVO_GB: String(objetivo),
    ...extra,
  };
}

function correr(d, opts = {}) {
  execFileSync('bash', [SCRIPT, '--dry-run'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    env: entorno(d, opts),
  });
  return readFileSync(d.log, 'utf8');
}

/* Corrida en segundo plano, para mirar el log mientras corre. Devuelve el proceso y el log de
 * ahora mismo (el fichero puede no existir todavía: un fallo ahí es «aún no hay nada»). */
function correrEnFondo(d, opts = {}) {
  const p = spawn('bash', [SCRIPT, '--dry-run'], { stdio: 'ignore', env: entorno(d, opts) });
  const log = () => { try { return readFileSync(d.log, 'utf8'); } catch { return ''; } };
  return { p, log, fin: new Promise((res) => p.on('exit', (codigo) => res(codigo))) };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const esperarA = async (cond, topeMs = 10_000) => {
  for (let t = 0; t < topeMs; t += 25) {
    if (cond()) return true;
    await esperar(25);
  }
  return false;
};

const borraria = (log, ruta) => log.includes(`dry-run: borraría ${ruta} `);
const seNiega = (log, ruta, motivo) => log.includes(`no se toca ${ruta}: ${motivo}`);

/* ¿Existe ya el proceso y su cwd es el que le pedimos? `/proc/<pid>/cwd` es un enlace, así que se
 * lee con readlink: `readFileSync` daría EISDIR y la espera no confirmaría nada. */
const cwdListo = (pid, ruta) => {
  try {
    return readlinkSync(`/proc/${pid}/cwd`) === ruta;
  } catch {
    return false;
  }
};

/* Proceso vivo con el cwd dentro de la ruta. Se espera a que exista de verdad antes de limpiar. */
async function conProcesoEn(ruta, cuerpo) {
  const p = spawn('sleep', ['30'], { cwd: ruta, stdio: 'ignore' });
  try {
    await esperarA(() => cwdListo(p.pid, ruta));
    return await cuerpo();
  } finally {
    p.kill('SIGKILL');
  }
}

test('control positivo: un scratch viejo y sin nadie dentro sí se borra', { skip: OMITIR }, () => {
  const d = caja();
  try {
    const viejo = dir(d, 'viejo');
    writeFileSync(path.join(viejo, 'f.txt'), 'x');
    const log = correr(d);
    assert.ok(borraria(log, viejo), `no lo borró; log:\n${log}`);
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

test('señuelo: un proceso con el cwd dentro lo protege', { skip: OMITIR }, async () => {
  const d = caja();
  try {
    const ocupado = dir(d, 'en-cwd');
    await conProcesoEn(ocupado, () => {
      const log = correr(d);
      assert.ok(seNiega(log, ocupado, 'lo usa un proceso'), `no lo protegió; log:\n${log}`);
      assert.ok(!borraria(log, ocupado), 'lo dio por borrable');
    });
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

test('señuelo: un fichero abierto dentro lo protege', { skip: OMITIR }, () => {
  const d = caja();
  try {
    const abierto = dir(d, 'con-abierto');
    writeFileSync(path.join(abierto, 'log.txt'), 'x');
    const fd = openSync(path.join(abierto, 'log.txt'), 'r');
    try {
      const log = correr(d);
      assert.ok(seNiega(log, abierto, 'lo usa un proceso'), `no lo protegió; log:\n${log}`);
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

test('señuelo: un volcado de datos no se toca', { skip: OMITIR }, () => {
  const d = caja();
  try {
    const conDatos = dir(d, 'con-datos');
    writeFileSync(path.join(conDatos, 'glory.dump'), 'x');
    const log = correr(d);
    assert.ok(seNiega(log, conDatos, 'contiene datos'), `no lo protegió; log:\n${log}`);
    assert.ok(!borraria(log, conDatos), 'lo dio por borrable');
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

test('señuelo: un checkout con cambios sin commitear no se toca', { skip: OMITIR }, () => {
  const d = caja();
  try {
    const repo = dir(d, 'con-git');
    const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' });
    git('init');
    writeFileSync(path.join(repo, 'f.txt'), 'uno');
    git('add', 'f.txt');
    git('commit', '-m', 'base');
    writeFileSync(path.join(repo, 'f.txt'), 'dos'); // sin commitear
    const log = correr(d);
    assert.ok(seNiega(log, repo, 'git con cambios sin commitear'), `no lo protegió; log:\n${log}`);
    assert.ok(!borraria(log, repo), 'lo dio por borrable');
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

test('señuelo: una hoja que no coincide deja la raíz entera sin tocar', { skip: OMITIR }, () => {
  const d = caja();
  try {
    const otra = path.join(d.raiz, 'no-es-tmp');
    mkdirSync(path.join(otra, 'viejo'), { recursive: true });
    writeFileSync(path.join(otra, 'viejo', 'f.txt'), 'x');
    const log = correr(d, { extra: { CM_VAR_TMP: otra } });
    assert.ok(log.includes(`/var/tmp: hoja inesperada en ${otra}, omitido`), `no lo detectó; log:\n${log}`);
    assert.ok(!borraria(log, path.join(otra, 'viejo')), 'borró con la hoja equivocada');
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

test('nivel 1: respeta el umbral de 2 h en /var/tmp', { skip: OMITIR }, () => {
  const d = caja();
  try {
    const viejo = dir(d, 'umbral-viejo');
    const nuevo = dir(d, 'umbral-nuevo');
    writeFileSync(path.join(viejo, 'f.txt'), 'x');
    writeFileSync(path.join(nuevo, 'f.txt'), 'x');
    const hace3dias = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    for (const f of [viejo, path.join(viejo, 'f.txt')]) utimesSync(f, hace3dias, hace3dias);
    const log = correr(d, { suelo: 1, objetivo: 99 });
    assert.ok(log.includes('inicio: nivel 1,'), `no corrió en nivel 1; log:\n${log}`);
    assert.ok(borraria(log, viejo), `no borró el viejo; log:\n${log}`);
    assert.ok(!borraria(log, nuevo), 'borró algo tocado hace un momento');
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});

/* El mapa de «en uso» se construye al empezar y una corrida dura minutos: lo que arranca en medio
 * —un build cruzado, que no pasa por cm-heavy— no estaba en él. El señuelo va al ÚLTIMO objetivo
 * (cachés de casa) y el ruido de /var/tmp, que es el primero, da margen para que la corrida siga
 * viva cuando el proceso arranque. */
test('señuelo: un proceso que arranca a mitad de la corrida también se protege', { skip: OMITIR }, async () => {
  const d = caja();
  try {
    for (let i = 0; i < 1200; i++) mkdirSync(path.join(d.varTmp, `ruido-${i}`));
    const decoy = path.join(d.casa, '.cache', 'en-marcha');
    mkdirSync(decoy, { recursive: true });
    writeFileSync(path.join(decoy, 'f.txt'), 'x');
    // Releer /proc cada segundo: sin el refresco el señuelo no está en el mapa y se lo llevaría.
    const { log, fin } = correrEnFondo(d, { extra: { CM_SWEEP_REFRESCO_S: '1' } });
    assert.ok(await esperarA(() => log().includes(`dry-run: borraría ${d.varTmp}/`)),
      `la corrida no llegó al primer objetivo; log:\n${log()}`);
    const p = spawn('sleep', ['30'], { cwd: decoy, stdio: 'ignore' });
    try {
      assert.ok(await esperarA(() => cwdListo(p.pid, decoy)), 'el señuelo no llegó a existir');
      await fin;
      const l = log();
      assert.ok(seNiega(l, decoy, 'lo usa un proceso'), `no lo protegió; log:\n${l}`);
      assert.ok(!borraria(l, decoy), 'lo dio por borrable');
    } finally {
      p.kill('SIGKILL');
    }
  } finally {
    rmSync(d.raiz, { recursive: true, force: true });
  }
});
