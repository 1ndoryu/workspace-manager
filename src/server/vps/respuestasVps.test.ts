/* Test de respuestasVps (07AA-19): se corre con
 * `node node_modules/tsx/dist/cli.mjs --test src/server/vps/respuestasVps.test.ts`.
 * Puro: ningun test toca el binario ni la VPS. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsearListado, pieza, recortar, resumirAuditoria, sanearJson } from './respuestasVps.js';

const LISTADO = [
  'NOMBRE  DOMINIO  TARGET  STACK UUID  ESTADO',
  'pulse  pulse.wandori.us  vps  abc123  running:healthy',
  'tienda  tienda.example.com  vps  def456  running',
  'Minecraft Bedrock',
  'socket-proxy  -  infra  -  ',
].join('\n');

void describe('respuestasVps', () => {
  void it('parsea el listado por posicion del header y salta Minecraft', () => {
    const sitios = parsearListado(LISTADO, true);
    assert.equal(sitios.length, 3);
    assert.equal(sitios[0].nombre, 'pulse');
    assert.equal(sitios[0].uuid, 'abc123');
    assert.equal(sitios[0].estadoReal, 'running:healthy');
    assert.equal(sitios[2].nombre, 'socket-proxy');
  });

  void it('sin header devuelve vacio, nunca inventa', () => {
    assert.deepEqual(parsearListado('basura sin tabla', false), []);
  });

  void it('sanea secretos por clave en cualquier profundidad', () => {
    const r = sanearJson({ api_key: 'X', anidado: { token: 'Y' }, cpu: 1.5 }) as {
      api_key: string;
      anidado: { token: string };
      cpu: number;
    };
    assert.equal(r.api_key, '···');
    assert.equal(r.anidado.token, '···');
    assert.equal(r.cpu, 1.5);
  });

  void it('recorta el texto largo con marca', () => {
    const t = recortar('x'.repeat(5000));
    assert.ok(t.endsWith('…(recortado)'));
    assert.equal(recortar('corto'), 'corto');
  });

  void it('envuelve ok/fallo en pieza', async () => {
    const ok = await pieza(async () => 42);
    assert.deepEqual(ok, { ok: true, datos: 42, error: null });
    const mal = await pieza(async () => {
      throw new Error('roto');
    });
    assert.equal(mal.ok, false);
    assert.ok((mal.error ?? '').includes('roto'));
  });

  void it('resume el audit con metricas y sanos/no-sanos', () => {
    const crudo = [
      'Load: 0.10 0.20 0.30',
      'CPU: sample1 busy=10.0%',
      'CPU: sample2 busy=30.0%',
      'Memoria: used=1000MB free=3000MB total=4000MB',
      'Disco: /dev/vda1 use=42%',
      'pulse=Up 2 hours (healthy)',
      'tienda=Up 5 minutes ',
    ].join('\n');
    const r = resumirAuditoria(crudo);
    assert.equal(r.ok, true);
    const d = r.datos as {
      metricas: { metrica: string; pct: number }[];
      carga: string | null;
      contenedores: { total: number; sanos: number; noSanos: string[] };
    };
    assert.equal(d.metricas.find((m) => m.metrica === 'cpu')?.pct, 20);
    assert.equal(d.metricas.find((m) => m.metrica === 'memoria')?.pct, 25);
    assert.equal(d.metricas.find((m) => m.metrica === 'disco')?.pct, 42);
    assert.equal(d.carga, '0.10 0.20 0.30');
    assert.equal(d.contenedores.total, 2);
    assert.equal(d.contenedores.sanos, 1);
    assert.deepEqual(d.contenedores.noSanos, ['tienda']);
  });

  void it('sin formato conocido cae a sin-metricas', () => {
    const r = resumirAuditoria('otro formato');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'sin-metricas');
  });
});
