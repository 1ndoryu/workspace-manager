/* Trampa del mando dev (F0c, DoD F0): inyector INDEPENDIENTE + test negativo.
 * [por que] Anti-tautologia: si la trampa importara al doctor, probaria el
 * codigo contra si mismo. Este archivo solo usa builtins de node (net, fs,
 * os, crypto, child_process, http) y habla con el doctor como caja negra por
 * CLI. Levanta un listener señuelo en puerto alto ALEATORIO (127.0.0.1, nunca
 * 0.0.0.0: cero interferencia), verifica que el doctor lo reporte como
 * huerfano sin proyecto, lo apaga y verifica que desaparezca. Tambien valida
 * la adopcion completa (0 pendiente-onboarding) y la ruta sin-boton en
 * negativo (registro recortado temporalmente con restore garantizado).
 * Limpieza siempre (hija propia + temporal + restore del registro),
 * aunque falle un check. Exit 0 = todo pasa. */
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const DOCTOR = join(DIR, 'doctor.mjs');
const REGISTRO = join(DIR, 'registro.json');
const API = 'http://127.0.0.1:8787';

function getJson(url) {
  return new Promise((res, rej) => {
    http
      .get(url, (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () => {
          try {
            res(JSON.parse(b));
          } catch (e) {
            rej(new Error(`JSON invalido de ${url}: ${String(e)}`));
          }
        });
      })
      .on('error', rej);
  });
}

/* Ejecuta al doctor como caja negra: nunca rechaza por exit code (el 2 es
 * estado valido); devuelve codigo + informe parseado o falla si no hay JSON. */
function correrDoctor(snapshotTmp) {
  return new Promise((res, rej) => {
    execFile(
      process.execPath,
      [DOCTOR, '--all', '--json', '--snapshot-file', snapshotTmp],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        const codigo = err && typeof err.code === 'number' ? err.code : 0;
        try {
          res({ codigo, informe: JSON.parse(String(stdout)) });
        } catch {
          rej(new Error(`doctor sin JSON (exit ${codigo}): ${String(stdout).slice(0, 200)}`));
        }
      },
    );
  });
}

function esperarPuerto(puerto, ms = 5000) {
  const t0 = Date.now();
  return new Promise((res) => {
    const intento = () => {
      const s = net.connect(puerto, '127.0.0.1');
      s.on('connect', () => {
        s.end();
        res(true);
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > ms) res(false);
        else setTimeout(intento, 200);
      });
    };
    intento();
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) =>
  [...randomBytes(n)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function main() {
  const fallos = [];
  const ok = (nombre, cond, detalle = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${nombre}${detalle ? ` (${detalle})` : ''}`);
    if (!cond) fallos.push(nombre);
  };

  let snapshot;
  try {
    snapshot = await getJson(`${API}/api/workspace`);
  } catch (e) {
    console.error(`FAIL snapshot: server 8787 caido o sin respuesta (${String(e)})`);
    return 1;
  }
  const nSnap = snapshot?.proyectos?.length ?? 0;
  ok('snapshot del server', nSnap > 0, `${nSnap} proyectos`);

  const dir = mkdtempSync(join(tmpdir(), 'wm-trampa-'));
  const tmp = join(dir, 'snapshot.json');
  writeFileSync(tmp, JSON.stringify(snapshot));
  let hija = null;
  try {
    const base = await correrDoctor(tmp);
    ok(
      'linea base clasifica todo',
      base.informe.proyectos.length === nSnap && !base.informe.errorSensor,
      `${base.informe.proyectos.length}/${nSnap}, exit ${base.codigo}${base.informe.errorSensor ? `, sensor: ${base.informe.errorSensor}` : ''}`,
    );

    /* Senuelo: puerto y token aleatorios; el token viaja en el cmdline para
     * que el proceso sea identificable sin adivinar por puerto. */
    const puerto = 40000 + Math.floor(Math.random() * 9999);
    const token = hex(8);
    hija = spawn(process.execPath, ['-e', `// senuelo-trampa ${token}\nrequire("net").createServer().listen(${puerto},"127.0.0.1")`], {
      stdio: 'ignore',
    });
    const escucha = await esperarPuerto(puerto);
    let puertoReal = escucha ? puerto : null;
    if (!escucha) {
      /* Puerto ocupado por otro o la hija murio: se reintenta una vez con
       * otro puerto antes de declarar el fallo. */
      hija.kill();
      await dormir(500);
      puertoReal = 40000 + Math.floor(Math.random() * 9999);
      hija = spawn(process.execPath, ['-e', `// senuelo-trampa ${token}\nrequire("net").createServer().listen(${puertoReal},"127.0.0.1")`], {
        stdio: 'ignore',
      });
      if (!(await esperarPuerto(puertoReal))) {
        ok('senuelo escucha', false, `puertos ${puerto}/${puertoReal} no disponibles`);
        return fallos.length > 0 ? 1 : 0;
      }
    }
    ok('senuelo escucha', true, `puerto ${puertoReal}`);
    const conSenuelo = await correrDoctor(tmp);
    const visto = conSenuelo.informe.huerfanos.find((h) => h.puerto === puertoReal);
    ok('senuelo reportado sin proyecto', !conSenuelo.informe.errorSensor && visto !== undefined && visto.clave === null, `puerto ${puertoReal ?? '?'}`);
    /* Adopcion completa: con el registro real no debe quedar ningun
     * pendiente-onboarding. Y la ruta sin-boton se prueba en negativo:
     * registro recortado temporalmente (backup+restore en finally) debe
     * surfear los proyectos sin entrada como sin-boton. */
    const pendientes = conSenuelo.informe.proyectos.filter(
      (p) => p.estado === 'sin-boton' && p.motivo === 'pendiente-onboarding',
    );
    ok('adopcion completa (0 pendiente-onboarding)', !conSenuelo.informe.errorSensor && pendientes.length === 0, `${pendientes.length} pendientes`);
    const backup = readFileSync(REGISTRO, 'utf8');
    let recortadoOk = false;
    let nSinBoton = -1;
    try {
      const rec = JSON.parse(backup);
      rec.proyectos = rec.proyectos.slice(0, 1);
      rec.noAplica = {};
      // [por que] El recorte simula "proyectos sin entrada": las
      // dependencias `requiere` que apunten fuera del recorte se podan para
      // que el registro recortado siga enfocado en la ruta sin-boton (un
      // requiere colgado en produccion es aviso de la entrada [06AA-1], no
      // error global, asi que podar no esconde nada).
      const idsRec = new Set(rec.proyectos.map((p) => p.id));
      for (const p of rec.proyectos) {
        if (Array.isArray(p.requiere)) p.requiere = p.requiere.filter((d) => idsRec.has(d));
      }
      writeFileSync(REGISTRO, JSON.stringify(rec));
      const recortado = await correrDoctor(tmp);
      const sb = recortado.informe.proyectos.filter((p) => p.estado === 'sin-boton');
      nSinBoton = sb.length;
      recortadoOk = !recortado.informe.errorSensor && sb.length === nSnap - 1 && sb.every((p) => p.motivo === 'pendiente-onboarding');
    } finally {
      writeFileSync(REGISTRO, backup);
    }
    ok('ruta sin-boton punta a punta', recortadoOk, `${nSinBoton} sin-boton (esperado ${nSnap - 1})`);

    /* Regresion 06AA-1: una entrada podrida (exe ausente, el caso real que
     * dejo al mando ciego) jamas bloquea el global. Caja negra con el
     * registro real: se rompe el boton de glory-pulse (backup+restore en
     * finally) y el doctor debe seguir clasificando (exit != 1, sin
     * errorSensor) con pulse en deriva y el resto intacto. */
    const backupPodrida = readFileSync(REGISTRO, 'utf8');
    let podridaOk = false;
    let detallePodrida = '';
    try {
      const roto = JSON.parse(backupPodrida);
      const gp = roto.proyectos.find((p) => p.id === 'glory-pulse');
      gp.boton = [['C:\\tmp\\wm-trampa-noexiste\\pulse.exe']];
      delete gp.reconstruir;
      writeFileSync(REGISTRO, JSON.stringify(roto));
      const conPodrida = await correrDoctor(tmp);
      const gpEstado = conPodrida.informe.proyectos.find((p) => p.clave === 'glory-pulse');
      const wmEstado = conPodrida.informe.proyectos.find((p) => p.clave === 'workspace-manager');
      const wmBase = base.informe.proyectos.find((p) => p.clave === 'workspace-manager')?.estado;
      podridaOk =
        conPodrida.codigo !== 1 &&
        !conPodrida.informe.errorSensor &&
        gpEstado?.estado === 'deriva' &&
        /exe inexistente|fuera de allowlist/.test(gpEstado?.motivo ?? '') &&
        wmEstado?.estado === wmBase;
      detallePodrida = `exit ${conPodrida.codigo}, pulse=${gpEstado?.estado} (${gpEstado?.motivo ?? '?'}) wm=${wmEstado?.estado}`;
    } finally {
      writeFileSync(REGISTRO, backupPodrida);
    }
    ok('podrida no bloquea (06AA-1)', podridaOk, detallePodrida);

    /* Deteccion de choques (03AA-3): dos entradas no pueden reclamar el mismo
     * puerto. Caja negra: el informe trae `compartidos`; debe venir vacio. */
    const comp = base.informe.compartidos;
    ok(
      'sin puertos compartidos',
      Array.isArray(comp) && comp.length === 0,
      Array.isArray(comp) ? (comp.length === 0 ? '0 choques' : comp.map((c) => `${c.puerto}:${c.ids.join('+')}`).join(' ')) : 'campo compartidos ausente',
    );

    /* Test negativo: muerta la hija, el puerto debe desaparecer del informe. */
    hija.kill();
    hija = null;
    await dormir(1500);
    const trasMatar = await correrDoctor(tmp);
    ok(
      'negativo: senuelo desaparece',
      !trasMatar.informe.errorSensor && !trasMatar.informe.huerfanos.some((h) => h.puerto === puertoReal),
      `huerfanos ${trasMatar.informe.huerfanos.length}`,
    );
  } finally {
    try {
      hija?.kill();
    } catch {
      /* Hija ya muerta, nada que limpiar. */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Buffer temporal, mejor esfuerzo. */
    }
  }
  return fallos.length > 0 ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`trampa: ${e?.message ?? e}`);
    process.exit(1);
  },
);
