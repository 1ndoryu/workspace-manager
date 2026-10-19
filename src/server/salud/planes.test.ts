/* Pruebas de `abiertasDelPlan`: un plan declarado en «Planes activos» del roadmap cuenta
 * como abierto aunque no tenga casillas (pasos numerados), y sin declarar solo cuentan
 * las casillas. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abiertasDelPlan } from './recoger.js';

const PLAN = 'plan-f4-split-2026-09-12.md';
/* Lo que devuelve el analisis del roadmap al leer su seccion «Planes activos» (D8). */
const DECLARADO = [PLAN];

describe('abiertasDelPlan', () => {
  it('plan declarado activo sin casillas sigue abierto', () => {
    assert.equal(abiertasDelPlan('1. **F4.1** hacer algo\n2. **F4.2** otra cosa', DECLARADO, PLAN), 1);
  });

  it('plan sin declarar y sin casillas está cerrado', () => {
    assert.equal(abiertasDelPlan('1. **F1** hecho', [], PLAN), 0);
  });

  it('las casillas abiertas se cuentan aunque no esté declarado', () => {
    const texto = '- [ ] paso uno\n- [x] paso dos\n* [ ] paso tres';
    assert.equal(abiertasDelPlan(texto, [], PLAN), 2);
  });

  it('declaración y casillas suman', () => {
    assert.equal(abiertasDelPlan('- [ ] paso', DECLARADO, PLAN), 2);
  });

  /* [por que] El roadmap declara por nombre de archivo: otro plan declarado no abre este. */
  it('la declaración de otro plan no cuenta', () => {
    assert.equal(abiertasDelPlan('1. **F1** hecho', ['otro-plan.md'], PLAN), 0);
  });
});
