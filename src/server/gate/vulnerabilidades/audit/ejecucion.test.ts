/* Pruebas de la tabla de comandos de audit. [por que] Sin lanzar npm ni cargo: el
 * caso local de pnpm sondea el CLI, así que solo se prueba la rama remota. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cliDeAudit } from './ejecucion.js';

/* Carpeta sin `.cargo/audit.toml`: ninguna excepción, el comando sale sin `--ignore`. */
const SIN_CARGO = join(process.cwd(), 'no-existe-carpeta');

test('cliDeAudit: cada gestor devuelve su comando', async () => {
  assert.equal(await cliDeAudit('npm', SIN_CARGO, false), 'npm audit --json');
  assert.equal(await cliDeAudit('pnpm', SIN_CARGO, true), 'corepack pnpm audit --json');
  assert.equal(await cliDeAudit('cargo', SIN_CARGO, false), 'cargo audit --json');
});
