/* Tests de las comprobaciones de cierre (10AA-2 F9.6) que no dependen de Git
 * ni del backend: roadmap, procesos y la clasificación de puertos protegidos. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { raizTemporales } from '../../shared/rutas.mjs';
import { comprobarRoadmap, comprobarProcesos, PUERTOS_PROTEGIDOS } from './cierre.mjs';

/* [por que] AGENTS §0.2: los temporales van a la raíz de temporales, nunca a %TEMP%. */
const BASE_TMP = join(raizTemporales(), 'cierre-tests');

/* Los fixtures van dentro de una sección de tareas salvo que traigan sus propios headings:
 * fuera de ella (Bloqueos, Planes activos) un bullet con ID es una mención, no una tarea. */
function dirConRoadmap(texto) {
  mkdirSync(BASE_TMP, { recursive: true });
  const dir = mkdtempSync(join(BASE_TMP, 'd-'));
  if (texto !== undefined) {
    const cuerpo = /^## /m.test(texto) ? texto : `## Pendientes\n\n${texto}`;
    writeFileSync(join(dir, 'roadmap.md'), cuerpo);
  }
  return dir;
}

test('roadmap: sin --tarea se omite aunque haya líneas abiertas', () => {
  const dir = dirConRoadmap('- `11AA-1` **ACTIVA (2026-10-11): F9\n');
  try {
    const c = comprobarRoadmap(dir);
    assert.equal(c.ok, true);
    assert.match(c.detalle, /omitida/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: la tarea abierta falla y lista su línea', () => {
  const dir = dirConRoadmap('- `11AA-1` **ACTIVA (2026-10-11): F9\n- otra\n');
  try {
    const c = comprobarRoadmap(dir, '11AA-1');
    assert.equal(c.ok, false);
    assert.equal(c.lineas.length, 1);
    assert.match(c.lineas[0], /11AA-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: **EN CURSO** también cuenta como abierta', () => {
  const dir = dirConRoadmap('- `11AA-1` **EN CURSO**: F9\n');
  try {
    assert.equal(comprobarRoadmap(dir, '11AA-1').ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: un ID que es prefijo de otro no cuenta', () => {
  const dir = dirConRoadmap('- `11AA-10` **ACTIVA (2026-10-11): otra\n- depende de `11AA-1` para cerrar\n');
  try {
    const c = comprobarRoadmap(dir, '11AA-1');
    assert.equal(c.ok, true);
    assert.match(c.detalle, /no está abierta/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Forma canonica del protocolo (D8): `- [ ] \`ID\` — **Titulo.**`. */
test('roadmap: la tarea canonica sin marcar falla', () => {
  const dir = dirConRoadmap('- [ ] `19AA-9` — **Algo pendiente.**\n');
  try {
    const c = comprobarRoadmap(dir, '19AA-9');
    assert.equal(c.ok, false);
    assert.match(c.lineas[0], /19AA-9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: casilla marcada o tachada no cuenta como abierta', () => {
  const dir = dirConRoadmap('- [x] `19AA-9` — **Ya hecha.**\n- [ ] ~~`19AA-8` — **Anulada.**~~\n');
  try {
    assert.equal(comprobarRoadmap(dir, '19AA-9').ok, true);
    assert.equal(comprobarRoadmap(dir, '19AA-8').ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Fuera de una sección de tareas el ID va de referencia («ver Bloqueos», un plan activo), no
 * como tarea abierta: contarlo bloqueaba cierres legítimos (22 casos el 2026-10-19). */
test('roadmap: un ID en «Bloqueos» o «Planes activos» no es una tarea abierta', () => {
  const dir = dirConRoadmap(
    '## Pendientes\n\n- [ ] `19AA-1` — **Viva.**\n\n' +
      '## Bloqueos\n\n- `19AA-2` — **Bloqueado por la suscripción.**\n\n' +
      '## Planes activos\n\n- `Agente/planes/plan-x-2026-10-19.md` — `19AA-3` — algo.\n',
  );
  try {
    assert.equal(comprobarRoadmap(dir, '19AA-1').ok, false);
    assert.equal(comprobarRoadmap(dir, '19AA-2').ok, true);
    assert.equal(comprobarRoadmap(dir, '19AA-3').ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Los roadmap del área llevan CRLF y sub-pasos sangrados bajo la tarea. */
test('roadmap: con CRLF sigue viendo la tarea abierta y no cuenta los sub-pasos', () => {
  const dir = dirConRoadmap(
    '## Pendientes\r\n\r\n- [ ] `19AA-1` — **Viva.**\r\n  - `19AA-2` sub-paso sangrado\r\n',
  );
  try {
    assert.equal(comprobarRoadmap(dir, '19AA-1').ok, false);
    assert.equal(comprobarRoadmap(dir, '19AA-2').ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Las palabras «hecho»/«cerrado» en el TITULO no cierran nada: en la forma canonica
 * describen criterios («Criterio de hecho: …») o estados ajenos («PENDIENTE DE HECHO
 * EXTERNO»). Contarlas daba un falso verde que dejaba cerrar trabajo vivo. */
test('roadmap: las palabras «hecho» y «cerrado» en el titulo no cierran la tarea', () => {
  const dir = dirConRoadmap(
    '- [ ] `19AA-10` — **PENDIENTE DE HECHO EXTERNO.**\n' +
      '- [ ] `19AA-12` — **Criterio de hecho: F1 hecho; F2-F4 abiertos.**\n',
  );
  try {
    assert.equal(comprobarRoadmap(dir, '19AA-10').ok, false);
    assert.equal(comprobarRoadmap(dir, '19AA-12').ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* 19AA-3: MN escribe el ID en negrita (`- **18AA-7 — …**`) y el chequeo daba falso verde. */
test('roadmap: el ID en negrita al principio del bullet sigue contando como abierta', () => {
  const dir = dirConRoadmap('## Pendientes\n\n- **18AA-7 — Algo.** Cuerpo.\n');
  try {
    assert.equal(comprobarRoadmap(dir, '18AA-7').ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: una mención en prosa o un enlace a un plan no cuenta como tarea', () => {
  const dir = dirConRoadmap(
    '- [ ] `19AA-1` — **Otra cosa.** Depende de `19AA-9` para no medir mal.\n- `Agente/planes/plan-x-2026-10-19.md` — `19AA-9` (este encargo).\n',
  );
  try {
    assert.equal(comprobarRoadmap(dir, '19AA-9').ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap ausente o tarea no listada: pasa', () => {
  const sinArchivo = dirConRoadmap(undefined);
  const sinTarea = dirConRoadmap('- `07AA-5` **ACTIVA (2026-10-07): otra\n');
  try {
    assert.match(comprobarRoadmap(sinArchivo, '11AA-1').detalle, /omitida/);
    const c = comprobarRoadmap(sinTarea, '11AA-1');
    assert.equal(c.ok, true);
    assert.match(c.detalle, /no está abierta/);
  } finally {
    rmSync(sinArchivo, { recursive: true, force: true });
    rmSync(sinTarea, { recursive: true, force: true });
  }
});

test('procesos: puertos protegidos no cuentan; puerto propio libre pasa', async () => {
  assert.ok(PUERTOS_PROTEGIDOS.includes(8787));
  const c = await comprobarProcesos([8787, 5175]);
  assert.equal(c.ok, true);
});

test('procesos: el túnel ssh gestionado del proyecto no cuenta como dev server', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  // Testigo: el mismo listener sin túnel sí falla; así el pase depende del túnel, no del puerto.
  const entrada = { id: 'x', host: 'dev89', puertos: [puerto] };
  const tunel = { creado: true, imagen: 'ssh.exe', cmd: `ssh -N -L ${puerto}:127.0.0.1:${puerto} dev89` };
  try {
    const conTunel = await comprobarProcesos([puerto], null, entrada, async () => [tunel]);
    assert.equal(conTunel.ok, true);
    assert.match(conTunel.detalle, new RegExp(`túnel gestionado: ${puerto}`));
    const sinTunel = await comprobarProcesos([puerto], null, entrada, async () => []);
    assert.equal(sinTunel.ok, false);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('procesos: un puerto propio escuchando falla con su número', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  try {
    const c = await comprobarProcesos([puerto]);
    assert.equal(c.ok, false);
    assert.match(c.detalle, new RegExp(`escuchan: ${puerto}`));
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
