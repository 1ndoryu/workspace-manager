/* Test de la actividad del Guardián (10AA-2 F11.4, «Actividad»): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/guardian/actividad.test.ts`.
 * Fixtures en C:/tmp/guardian-test (protocolo de temporales): ningún test toca el
 * diario ni los leases reales. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { guardLogDirPorDefecto, guardRootPorDefecto, leerActividad, LIMITE_ACTIVIDAD_DEFECTO } from './actividad.js';
import { ErrorValidacion } from './politica.js';

const BASE_TMP = 'C:/tmp/guardian-test';
const temporales: string[] = [];
after(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-11T12:00:00Z');

function raizTmp(): string {
  mkdirSync(BASE_TMP, { recursive: true });
  const d = mkdtempSync(join(BASE_TMP, 'actividad-'));
  temporales.push(d);
  return d;
}

/* Escribe un fichero con una línea por elemento: los objetos se serializan, las
 * cadenas se añaden tal cual (para simular líneas corruptas). */
function escribir(ruta: string, lineas: Array<unknown>): void {
  mkdirSync(join(ruta, '..'), { recursive: true });
  const texto = lineas.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  writeFileSync(ruta, texto, 'utf8');
}

function decision(fecha: string, proyecto: string, comando: string, dec: string, motivo = ''): Record<string, string> {
  return { fecha, proyecto, comando, decision: dec, motivo };
}

function rutasDe(r: string): { logDir: string; guardRoot: string } {
  return { logDir: join(r, 'log'), guardRoot: join(r, 'root') };
}

describe('leerActividad: sin datos', () => {
  it('sin registro ni leases devuelve listas vacías sin lanzar', () => {
    const r = raizTmp();
    const a = leerActividad({}, { ...rutasDe(r), ahora: AHORA });
    assert.equal(a.diario.disponible, false);
    assert.deepEqual(a.diario.entradas, []);
    assert.equal(a.auditoria.disponible, false);
    assert.deepEqual(a.leases, { activos: [], expirados: 0 });
    assert.equal(a.limite, LIMITE_ACTIVIDAD_DEFECTO);
  });
});

describe('diario de decisiones', () => {
  it('más reciente primero, con filtros por proyecto, comando y decisión', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    escribir(join(logDir, 'guard-log.ndjson'), [
      decision('2026-10-10T09:00:00Z', 'C:/proy/a', 'cargo clippy', 'bloqueado', 'budget-exhausted'),
      decision('2026-10-10T10:00:00Z', 'C:/proy/b', 'npm run lint', 'paso'),
      decision('2026-10-11T08:00:00Z', 'C:/proy/a', 'npm test', 'observado'),
    ]);
    const opc = { logDir, guardRoot, ahora: AHORA };

    const todo = leerActividad({}, opc);
    assert.equal(todo.diario.disponible, true);
    assert.deepEqual(
      todo.diario.entradas.map((e) => e.comando),
      ['npm test', 'npm run lint', 'cargo clippy'],
    );
    assert.equal(todo.diario.total, 3);

    /* Ruta con barras invertidas, mayúsculas y barra final: mismo proyecto. */
    const proyA = leerActividad({ proyecto: 'c:\\PROY\\a\\' }, opc);
    assert.deepEqual(
      proyA.diario.entradas.map((e) => e.comando),
      ['npm test', 'cargo clippy'],
    );

    const clippy = leerActividad({ comando: 'CLIPPY' }, opc);
    assert.equal(clippy.diario.entradas.length, 1);

    const bloqueos = leerActividad({ decision: 'bloqueado' }, opc);
    assert.equal(bloqueos.diario.entradas[0]?.motivo, 'budget-exhausted');
    assert.equal(bloqueos.diario.total, 1);
  });

  it('incluye el diario rotado en orden cronológico (antes que el actual)', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    escribir(join(logDir, 'guard-log.1.ndjson'), [decision('2026-10-09T10:00:00Z', 'C:/proy/a', 'old', 'paso')]);
    escribir(join(logDir, 'guard-log.ndjson'), [decision('2026-10-11T10:00:00Z', 'C:/proy/a', 'new', 'paso')]);
    const a = leerActividad({}, { logDir, guardRoot, ahora: AHORA });
    assert.deepEqual(
      a.diario.entradas.map((e) => e.comando),
      ['new', 'old'],
    );
    assert.equal(a.diario.total, 2);
  });

  it('líneas corruptas se cuentan y no rompen la lectura; las vacías se ignoran', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    escribir(join(logDir, 'guard-log.ndjson'), [
      decision('2026-10-11T08:00:00Z', 'C:/proy/a', 'npm test', 'paso'),
      'no es json',
      '[1]',
      { fecha: '2026-10-11T09:00:00Z', proyecto: 'C:/proy/a', comando: 'npm', decision: 'raro' },
      '',
      decision('2026-10-11T10:00:00Z', 'C:/proy/a', 'npm run lint', 'paso'),
    ]);
    const a = leerActividad({}, { logDir, guardRoot, ahora: AHORA });
    assert.equal(a.diario.entradas.length, 2);
    assert.equal(a.diario.corruptas, 3);
  });

  it('limite acota las entradas; total cuenta todas las filtradas', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    escribir(
      join(logDir, 'guard-log.ndjson'),
      Array.from({ length: 5 }, (_, i) => decision(`2026-10-11T0${i}:00:00Z`, 'C:/proy/a', `cmd${i}`, 'paso')),
    );
    const a = leerActividad({ limite: 2 }, { logDir, guardRoot, ahora: AHORA });
    assert.equal(a.diario.entradas.length, 2);
    assert.equal(a.diario.total, 5);
    assert.equal(a.limite, 2);
  });
});

describe('auditoría de leases', () => {
  it('campos permitidos, más reciente primero, eventos desconocidos son corruptos', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    escribir(join(guardRoot, 'leases', 'audit.ndjson'), [
      {
        at: '2026-10-11T09:00:00Z',
        event: 'issue',
        leaseId: 'L1',
        pid: 10,
        projectRoot: 'C:/proy/a',
        command: 'cargo clippy',
        taskId: 'T1',
        secreto: 'NO-DEBE-SALIR',
      },
      { at: '2026-10-11T10:00:00Z', event: 'verify', leaseId: 'L1', pid: 10, valid: true, reason: 'ok' },
      { at: '2026-10-11T11:00:00Z', event: 'raro' },
      { at: '2026-10-11T11:30:00Z', event: 'prune', count: 3 },
    ]);
    const a = leerActividad({}, { logDir, guardRoot, ahora: AHORA });
    assert.equal(a.auditoria.disponible, true);
    assert.deepEqual(
      a.auditoria.entradas.map((e) => e.event),
      ['prune', 'verify', 'issue'],
    );
    assert.equal(a.auditoria.corruptas, 1);
    assert.deepEqual(a.auditoria.entradas[2], {
      at: '2026-10-11T09:00:00Z',
      event: 'issue',
      leaseId: 'L1',
      pid: 10,
      projectRoot: 'C:/proy/a',
      command: 'cargo clippy',
    });
    assert.ok(!JSON.stringify(a).includes('NO-DEBE-SALIR'));
  });

  it('filtra por proyecto (projectRoot) y comando; sin projectRoot no entra en el filtro de proyecto', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    escribir(join(guardRoot, 'leases', 'audit.ndjson'), [
      { at: '2026-10-11T09:00:00Z', event: 'issue', leaseId: 'L1', pid: 1, projectRoot: 'C:/proy/a', command: 'cargo clippy' },
      { at: '2026-10-11T10:00:00Z', event: 'issue', leaseId: 'L2', pid: 2, projectRoot: 'C:/proy/b', command: 'npm test' },
      { at: '2026-10-11T11:00:00Z', event: 'verify', leaseId: 'L1', pid: 1, valid: false, reason: 'expired' },
    ]);
    const opc = { logDir, guardRoot, ahora: AHORA };
    const proyA = leerActividad({ proyecto: 'C:/proy/a' }, opc);
    assert.deepEqual(
      proyA.auditoria.entradas.map((e) => e.leaseId),
      ['L1'],
    );
    const cmd = leerActividad({ comando: 'NPM' }, opc);
    assert.deepEqual(
      cmd.auditoria.entradas.map((e) => e.leaseId),
      ['L2'],
    );
  });

  it('cola acotada: la primera línea parcial se descarta y no cuenta como corrupta', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    /* ~700 KB: por encima del tope de 512 KiB de la cola de auditoría. */
    escribir(
      join(guardRoot, 'leases', 'audit.ndjson'),
      Array.from({ length: 700 }, (_, i) => ({
        at: '2026-10-11T09:00:00Z',
        event: 'verify',
        leaseId: `L${i}`,
        pid: i,
        valid: true,
        reason: 'x'.repeat(900),
      })),
    );
    const a = leerActividad({ limite: 500 }, { logDir, guardRoot, ahora: AHORA });
    assert.equal(a.auditoria.corruptas, 0);
    assert.equal(a.auditoria.entradas[0]?.leaseId, 'L699');
    assert.ok(a.auditoria.total < 700);
  });
});

describe('leases activos', () => {
  it('solo activos y sin firma; expirados contados; malformados y claves ignorados', () => {
    const r = raizTmp();
    const { logDir, guardRoot } = rutasDe(r);
    const dir = join(guardRoot, 'leases');
    const base = { pid: 55, projectRoot: 'C:/proy/a', command: 'cargo clippy', taskId: 'T9' };
    escribir(join(dir, 'a1.json'), [
      {
        schemaVersion: 1,
        id: 'a1',
        issuedAt: '2026-10-11T11:00:00Z',
        expiresAt: '2026-10-11T13:00:00Z',
        ...base,
        signature: 'FIRMA-SECRETA',
      },
    ]);
    escribir(join(dir, 'vieja.json'), [
      { schemaVersion: 1, id: 'vieja', issuedAt: '2026-10-11T09:00:00Z', expiresAt: '2026-10-11T11:00:00Z', ...base, signature: 'x' },
    ]);
    escribir(join(dir, 'version.json'), [
      { schemaVersion: 2, id: 'version', issuedAt: '2026-10-11T11:00:00Z', expiresAt: '2026-10-11T13:00:00Z', ...base },
    ]);
    escribir(join(dir, 'roto.json'), ['no json']);
    escribir(join(dir, 'lease.key'), ['CLAVE-SECRETA']);

    const a = leerActividad({}, { logDir, guardRoot, ahora: AHORA });
    assert.equal(a.leases.expirados, 1);
    assert.equal(a.leases.activos.length, 1);
    const activo = a.leases.activos[0];
    assert.ok(activo);
    assert.deepEqual(activo, {
      id: 'a1',
      pid: 55,
      projectRoot: 'C:/proy/a',
      command: 'cargo clippy',
      taskId: 'T9',
      issuedAt: '2026-10-11T11:00:00Z',
      expiresAt: '2026-10-11T13:00:00Z',
    });
    const texto = JSON.stringify(a);
    assert.ok(!texto.includes('FIRMA-SECRETA'));
    assert.ok(!texto.includes('CLAVE-SECRETA'));
  });
});

describe('validación de filtros', () => {
  it('filtros inválidos lanzan ErrorValidacion', () => {
    const r = raizTmp();
    const opc = { ...rutasDe(r), ahora: AHORA };
    const malos: Array<Record<string, unknown>> = [
      { decision: 'raro' },
      { limite: 0 },
      { limite: 501 },
      { limite: 1.5 },
      { proyecto: 'a\0b' },
      { comando: 'x'.repeat(513) },
    ];
    for (const f of malos) {
      assert.throws(() => leerActividad(f, opc), ErrorValidacion, JSON.stringify(f));
    }
  });
});

describe('rutas por defecto', () => {
  it('GLORY_GUARD_LOG_DIR tiene prioridad sobre el valor por defecto', () => {
    assert.equal(guardLogDirPorDefecto({ GLORY_GUARD_LOG_DIR: 'C:/otro/diario' }), 'C:/otro/diario');
    assert.equal(basename(guardLogDirPorDefecto({})), 'glory-quality-guard');
  });

  it('la raíz del guard sigue CARGO_TARGET_DIR_BASE como resolveGuardRoot', () => {
    const r = raizTmp();
    assert.equal(guardRootPorDefecto({ CARGO_TARGET_DIR_BASE: join(r, 'glory-target') }), join(r, 'glory-quality-guard'));
  });
});
