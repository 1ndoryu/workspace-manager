/* Pruebas de los planes por ubicación: los vivos salen del disco, no del roadmap. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raizTemporales } from '../../plataforma/sistema/temporales.js';
import { abiertasDelPlan, planesEnDisco } from './planesDisco.js';

describe('abiertasDelPlan', () => {
  const PLAN = 'plan-f4-split-2026-09-12.md';

  it('plan declarado activo sin casillas sigue abierto', () => {
    assert.equal(abiertasDelPlan('1. **F4.1** hacer algo\n2. **F4.2** otra cosa', [`Agente/planes/${PLAN}`], PLAN), 1);
  });

  it('plan sin declarar y sin casillas está cerrado', () => {
    assert.equal(abiertasDelPlan('1. **F1** hecho', [], PLAN), 0);
  });

  it('las casillas abiertas se cuentan aunque no esté declarado', () => {
    assert.equal(abiertasDelPlan('- [ ] paso uno\n- [x] paso dos\n* [ ] paso tres', [], PLAN), 2);
  });

  it('la declaración de otro plan no cuenta', () => {
    assert.equal(abiertasDelPlan('1. **F1** hecho', ['Agente/planes/otro-plan.md'], PLAN), 0);
  });
});

describe('planesEnDisco', () => {
  let raiz: string;

  before(() => {
    mkdirSync(raizTemporales(), { recursive: true });
    raiz = mkdtempSync(join(raizTemporales(), 'planes-disco-'));
    const planes = join(raiz, 'Agente', 'planes');
    mkdirSync(join(planes, 'completados'), { recursive: true });
    mkdirSync(join(planes, 'fase-d', 'completados'), { recursive: true });
    writeFileSync(join(planes, 'README.md'), '# Índice\n');
    writeFileSync(join(planes, 'plan-vivo-2026-10-03.md'), '- [ ] paso\n- [ ] otro\n');
    writeFileSync(join(planes, 'fase-d', 'plan-anidado-2026-10-10.md'), '- [ ] paso\n');
    /* Un plan en `completados/` (también en subcarpeta) no está vivo por definición. */
    writeFileSync(join(planes, 'completados', 'plan-hecho.md'), '- [ ] resto\n');
    writeFileSync(join(planes, 'fase-d', 'completados', 'plan-viejo.md'), '- [ ] resto\n');
  });

  after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('cuenta los planes del disco fuera de completados, con subcarpetas', () => {
    const vivos = planesEnDisco(raiz).map((p) => p.archivo);
    assert.deepEqual(vivos, ['fase-d/plan-anidado-2026-10-10.md', 'plan-vivo-2026-10-03.md']);
  });

  it('un proyecto sin Agente/planes/ no tiene planes', () => {
    assert.deepEqual(planesEnDisco(join(raiz, 'no-existe')), []);
  });

  it('sin casillas no hay trabajo abierto aunque no lo declare el roadmap', () => {
    assert.equal(planesEnDisco(raiz).find((p) => p.archivo.includes('anidado'))?.abiertas, 1);
  });
});
