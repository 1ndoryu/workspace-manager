/* Test del muestreo de fondo (20AA-17): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/recursos/muestreador.test.ts`.
 * Fuentes, reloj y anillo inyectados: sin pulse, sin disco y sin temporizadores reales. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearMuestreador, type OpcionesMuestreador } from './muestreador.js';
import type { VpsAgenteSnapshot } from '../../shared/tipos/vps.js';
import type { TabRecursos } from '../../shared/recursosHistorial.js';

const T0 = 1_700_000_000_000_000;

function snap(ts: number, cpuPct: number): VpsAgenteSnapshot {
  return {
    schema: 1,
    hostId: 'h',
    ts,
    contenedores: [
      {
        id: 'c',
        nombre: 'c',
        estado: 'running',
        imagen: 'x',
        cpuPct,
        memMiB: 10,
        memLimiteMiB: null,
        redRxBytes: 1,
        redTxBytes: 2,
        blkReadBytes: 3,
        blkWriteBytes: 4,
        sitioUuid: null,
        dominio: null,
        sitio: null,
      },
    ],
    discoHost: null,
    truncado: false,
    totalContenedores: 1,
    frescura: { fuente: 'agente', edadMs: 0 },
  };
}

/* Anillo de mentira: guarda lo anotado por tab. */
function anilloFalso() {
  const datos: Record<string, unknown[]> = {};
  return {
    datos,
    anotar: (tab: TabRecursos, m: unknown) => {
      (datos[tab] ??= []).push(m);
    },
    leer: (tab: TabRecursos) => (datos[tab] ?? []) as never,
    volcar: () => {},
  };
}

function montar(
  fuentes: Partial<Record<TabRecursos, () => Promise<VpsAgenteSnapshot | null>>>,
  extra: Partial<OpcionesMuestreador> = {},
) {
  const historial = anilloFalso();
  const m = crearMuestreador({
    historial: historial as never,
    fuentes: {
      vps: async () => null,
      taller: async () => null,
      ...fuentes,
    },
    intervaloMs: 10_000,
    ahora: () => T0,
    ...extra,
  });
  return { m, historial };
}

void describe('crearMuestreador', () => {
  void it('una pasada anota una muestra por tab con fuente', async () => {
    const { m, historial } = montar({
      vps: async () => snap(T0, 2),
      taller: async () => snap(T0, 5),
    });
    await m.muestrearAhora();
    assert.deepEqual(historial.datos.vps, [[T0, 2, 10, 1, 2, 3, 4, 0, 0]]);
    assert.deepEqual(historial.datos.taller, [[T0, 5, 10, 1, 2, 3, 4, 0, 0]]);
    assert.deepEqual(m.estado(), { pasadas: 1, muestras: 2, ultimoError: null, detenido: false });
  });

  void it('sin fuente configurada (null) no anota nada y no falla', async () => {
    const { m, historial } = montar({ vps: async () => snap(T0, 1) });
    await m.muestrearAhora();
    assert.equal(historial.datos.vps?.length, 1);
    assert.equal(historial.datos.taller, undefined);
    assert.equal(m.estado().ultimoError, null);
  });

  void it('una fuente caída no tumba la otra ni la pasada', async () => {
    const { m, historial } = montar({
      vps: async () => {
        throw new Error('pulse-http-500');
      },
      taller: async () => snap(T0, 7),
    });
    await m.muestrearAhora();
    assert.equal(historial.datos.vps, undefined);
    assert.equal(historial.datos.taller?.length, 1);
    assert.equal(m.estado().ultimoError, 'pulse-http-500');
    assert.equal(m.estado().pasadas, 1);
  });

  void it('no solapa dos pasadas', async () => {
    let enVuelo = 0;
    let maximo = 0;
    const lenta = async () => {
      enVuelo += 1;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 20));
      enVuelo -= 1;
      return snap(T0, 1);
    };
    const { m, historial } = montar({ vps: lenta });
    await Promise.all([m.muestrearAhora(), m.muestrearAhora(), m.muestrearAhora()]);
    assert.equal(maximo, 1);
    assert.equal(historial.datos.vps?.length, 1);
  });

  void it('arrancar muestrea ya; detener para el temporizador', async () => {
    const { m, historial } = montar({ vps: async () => snap(T0, 1) });
    m.arrancar();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(historial.datos.vps?.length, 1);
    await m.detener();
    assert.equal(m.estado().detenido, true);
    /* Arrancar tras detener no vuelve a muestrear: el cierre es definitivo. */
    m.arrancar();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(historial.datos.vps?.length, 1);
  });
});
