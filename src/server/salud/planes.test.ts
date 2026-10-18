/* Pruebas de `abiertasDelPlan`: un plan enlazado desde roadmap.md cuenta como abierto
 * aunque no tenga casillas (pasos numerados), y sin enlace solo cuentan las casillas. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abiertasDelPlan } from './recoger.js';

const PLAN = 'plan-f4-split-2026-09-12.md';
const ROADMAP_CON_ENLACE = `| 267A-9 | Sub-plan \`Agente/planes/${PLAN}\` | pendiente |`;

describe('abiertasDelPlan', () => {
  it('plan enlazado desde el roadmap sin casillas sigue abierto', () => {
    assert.equal(abiertasDelPlan('1. **F4.1** hacer algo\n2. **F4.2** otra cosa', ROADMAP_CON_ENLACE, PLAN), 1);
  });

  it('plan sin enlace y sin casillas está cerrado', () => {
    assert.equal(abiertasDelPlan('1. **F1** hecho', '| otra cosa |', PLAN), 0);
  });

  it('las casillas abiertas se cuentan aunque no haya enlace', () => {
    const texto = '- [ ] paso uno\n- [x] paso dos\n* [ ] paso tres';
    assert.equal(abiertasDelPlan(texto, '', PLAN), 2);
  });

  it('enlace y casillas suman', () => {
    assert.equal(abiertasDelPlan('- [ ] paso', ROADMAP_CON_ENLACE, PLAN), 2);
  });
});
