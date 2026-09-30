/* Breaker-test del agente glory-pulse (299A-12 F2): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/vps/agente.test.ts`
 * (el repo no tiene runner TS; node --test solo entiende JS). Reloj y fetch
 * inyectados: ningún test toca red ni espera tiempo real. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearAgente } from './agente.js';

/* Fixture con la forma REAL de pulse (contrato F0: filas anidadas, recursos
 * en bytes; copiado de `GET /snapshot` prod 2026-09-30, sin secretos). */
const FILA = {
  id12: 'abcdaca71593',
  nombre: 'app-as0scgwg44wkkkccgwcwg8w0',
  estado: { estado: 'running', salud: 'healthy', reinicios: 0, desde: '2026-09-27T13:50:31Z' },
  puertos: ['3000/tcp'],
  recursos: {
    cpuPct: 2.5,
    memUsada: 134217728,
    memLimite: 1073741824,
    blkRo: 4096,
    blkWo: 8192,
    netRx: 149332550,
    netTx: 45390096,
  },
};

const SNAP = {
  schema: 1,
  hostId: 'vps',
  ts: 1000,
  contenedores: [FILA],
  truncado: false,
  totalContenedores: 1,
};

const TOKEN = 't'.repeat(64);

function respuestaSnap(cuerpo: unknown, ok = true, estado = 200): typeof fetch {
  return (async () => ({
    ok,
    status: estado,
    json: async () => cuerpo,
  })) as unknown as typeof fetch;
}

void describe('agente glory-pulse', () => {
  void it('adapta el snapshot y calcula frescura con reloj del backend', async () => {
    let ahora = 2000;
    const agente = crearAgente({
      baseUrl: 'https://pulse.test',
      token: TOKEN,
      fetchImpl: respuestaSnap(SNAP),
      ahora: () => ahora,
    });
    const r = await agente.snapshot();
    assert.equal(r.disponible, true);
    assert.equal(r.error, null);
    assert.equal(r.snapshot?.schema, 1);
    assert.equal(r.snapshot?.hostId, 'vps');
    assert.deepEqual(r.snapshot?.frescura, { fuente: 'agente', edadMs: 1000 });
    const c = r.snapshot?.contenedores[0];
    assert.equal(c?.id, 'abcdaca71593');
    assert.equal(c?.nombre, 'app-as0scgwg44wkkkccgwcwg8w0');
    assert.equal(c?.estado, 'running');
    assert.equal(c?.imagen, ''); // pulse no sirve imagen
    assert.equal(c?.cpuPct, 2.5);
    assert.equal(c?.memMiB, 128); // bytes → MiB
    assert.equal(c?.memLimiteMiB, 1024);
    assert.equal(c?.redRxBytes, 149332550);
    assert.equal(c?.sitioUuid, null); // sin meta Coolify
    assert.equal(c?.dominio, null);
    ahora = 6000; // dentro de la caché de 5 s: no repide
    const r2 = await agente.snapshot();
    assert.equal(r2.snapshot?.frescura.edadMs, 1000);
  });

  void it('envía el Bearer y rechaza contrato inválido sin exponer el token', async () => {
    let auth: string | null = null;
    const fetchImpl = (async (_url: unknown, init: unknown) => {
      auth = (init as { headers: Record<string, string> }).headers['authorization'] ?? null;
      return { ok: true, status: 200, json: async () => ({ ...SNAP, schema: 2 }) };
    }) as unknown as typeof fetch;
    const agente = crearAgente({ baseUrl: 'https://pulse.test', token: TOKEN, fetchImpl });
    assert.equal(auth, null); // perezoso: sin snapshot no hay red
    const r = await agente.snapshot();
    assert.equal(auth, `Bearer ${TOKEN}`);
    assert.equal(r.disponible, false);
    assert.equal(r.error, 'agente-contrato');
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });

  void it('abre el breaker tras 3 fallos y sonda pasado el intervalo', async () => {
    let llamadas = 0;
    let ahora = 0;
    const fetchImpl = (async () => {
      llamadas += 1;
      throw new Error('caído');
    }) as typeof fetch;
    const agente = crearAgente({
      baseUrl: 'https://pulse.test',
      token: TOKEN,
      fetchImpl,
      ahora: () => ahora,
      cacheMs: 0,
      sondeoMs: 60_000,
    });
    for (let i = 0; i < 3; i += 1) {
      ahora += 1000;
      const r = await agente.snapshot();
      assert.equal(r.disponible, false);
    }
    assert.equal(llamadas, 3);
    ahora += 1000;
    const abierta = await agente.snapshot();
    assert.equal(abierta.error, 'agente-abierto');
    assert.equal(llamadas, 3); // abierta: no toca red
    ahora += 60_000;
    await agente.snapshot();
    assert.equal(llamadas, 4); // sonda: reintenta
  });

  void it('el éxito resetea el contador de fallos', async () => {
    let llamadas = 0;
    let falla = true;
    const fetchImpl = (async () => {
      llamadas += 1;
      if (falla) throw new Error('caído');
      return { ok: true, status: 200, json: async () => SNAP };
    }) as unknown as typeof fetch;
    let ahora = 0;
    const agente = crearAgente({
      baseUrl: 'https://pulse.test',
      token: TOKEN,
      fetchImpl,
      ahora: () => ahora,
      cacheMs: 0,
      sondeoMs: 60_000,
    });
    ahora += 1000;
    await agente.snapshot(); // fallo 1
    ahora += 1000;
    falla = false;
    const ok = await agente.snapshot();
    assert.equal(ok.disponible, true);
    falla = true;
    ahora += 1000;
    await agente.snapshot(); // fallo 1 de nuevo, no 2
    ahora += 1000;
    await agente.snapshot(); // fallo 2
    assert.equal(llamadas, 4); // sin breaker abierto (harían falta 3 seguidos)
  });

  void it('mapea timeout y HTTP a códigos sin texto del origen', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const a1 = crearAgente({
      baseUrl: 'https://pulse.test',
      token: TOKEN,
      fetchImpl: (async () => {
        throw abort;
      }) as typeof fetch,
    });
    assert.equal((await a1.snapshot()).error, 'agente-timeout');
    const a2 = crearAgente({
      baseUrl: 'https://pulse.test',
      token: TOKEN,
      fetchImpl: respuestaSnap({ error: 'secreto-fugado' }, false, 500),
    });
    const r2 = await a2.snapshot();
    assert.equal(r2.error, 'agente-http-500');
    assert.ok(!JSON.stringify(r2).includes('secreto'));
  });
});
