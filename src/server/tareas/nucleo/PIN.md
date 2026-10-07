# Pin tasks-core (07AA-5 F2)

Snapshot vendorizado de `PROYECTO TASKS/tasks-core/src/` (núcleo kanban
agnóstico F1b): `tipos.ts`, `validaciones.ts`, `cliente.ts`, `operaciones.ts`,
`jerarquia.ts` — sin tests ni `index.ts` (el puente importa directo).

- Origen: `PROYECTO TASKS@ba7dfd4` (`tasks-core` 0.1.0, F1b CERRADA y pusheada).
- Verificado: lógica idéntica al origen salvo cabecera PIN y sufijo `.js` en
  imports relativos (lo exige `tsconfig.server.json`: `allowImportingTsExtensions: false`).
- NO editar estos ficheros a mano: cualquier fix vive en TASKS y aquí se
  re-vendoriza. Cambio rompedor en TASKS = major + aviso (decisión NÚCLEO).
- Re-vendorizar: copiar los 5 ficheros del commit pin, anteponer la cabecera
  PIN, cambiar `./x.ts` → `./x.js` y comprobar paridad con el guion usado en F2
  (compara lógica ignorando cabeceras). Luego `type-check` + tests + gate.
