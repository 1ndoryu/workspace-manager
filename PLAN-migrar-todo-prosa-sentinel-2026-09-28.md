# PLAN 289A-1 — Migrar `todo-prosa-sin-marcador` de VarSense a Sentinel (2026-09-28)

> Origen: hallazgo `todoProsaSinMarcador` en `workspace-manager/src/v2/ui/Toaster.tsx:1`.
> Decisión del usuario: es higiene de código → debe ser regla de Sentinel, no de VarSense.
> Clasificación skill quality-gate-setup: regla estática genérica → **regla de Sentinel Core**,
> migrar upstream; una regla, un dueño.

## Objetivo

`todo-prosa-sin-marcador` vive solo en Sentinel Core (warning, `EstructuraNomenclatura`,
complemento de `todo-pendiente`); la copia de VarSense (`TodoProsaSinMarcador`, [149A-1 F3.13])
se retira con paridad demostrada y compatibilidad de config.

## Alcance / no alcance

- SÍ: regla nueva en `glory-sentinel` + retirada en `varsense` + tests + docs + CHANGELOGs +
  bumps de versión (sentinel 0.7.14→0.7.15, varsense 2.2.4→2.2.5) + paridad medida.
- NO: push a GitHub, tags remotos, `bump.mjs --write` en consumidores ni gitlinks familia B
  (requieren autorización explícita; quedan como paso gated §6).

## Diseño Sentinel (dueño nuevo)

- Id: `todo-prosa-sin-marcador` (kebab, continuidad con el nombre VarSense).
  Registro en `src/config/ruleRegistry.ts`: nombre `Mención 'todo' sin marcador`,
  `severidadDefault: 'warning'` (paridad con default VarSense),
  `categoria: EstructuraNomenclatura` (misma que `todo-pendiente`).
- Implementación: `verificarTodoProsaSinMarcador(texto, documento)` en
  `src/analyzers/static/staticCodeRules.ts`. Porte fiel del algoritmo VarSense
  (`extraerRegionesComentario` `//`+`/* */` con máscara de literales; guardas: marcador
  `:`/`(`/`[`, compuesto `-`, artículo el|la|los|las|lo, cuantificador final minúsculo,
  `/todo` URL; `FIXME`/`XXX` nunca marcan). Hallazgo por match:
  `{reglaId, mensaje, severidad: obtenerSeveridadRegla(id), linea, columna, fuente:'estatico'}`.
- Semántica disable como `verificarAnyType`: salta línea con
  `sentinel-disable todo-prosa-sin-marcador` y si la anterior trae
  `sentinel-disable-next-line todo-prosa-sin-marcador`. (La propia línea de disable
  contiene "todo-prosa…" → el guarda de compuesto `-` la exime; verificar con test.)
- Dispatch en `src/analyzers/staticAnalyzer.ts`, mismo scope que `todo-pendiente`:
  `['.php','.ts','.tsx','.js','.jsx','.css','.rs']`, gated por `reglaHabilitada(id)`.
- Tests: `src/test/suite/todoProsaSinMarcador.test.ts` (mocha TDD): positivo
  (`// todo revisar esto`), marcador válido (`// TODO: ...`, `// FIXME ...`),
  prosa española (`// todo el historial`, `// re-parsear todo.`), compuesto
  (`// todo-list`), URL (`// ver https://x/todo`), string (`const s = "todo"`),
  bloque `/* */`, disable-next-line/disable, regla deshabilitada → 0.
- Docs: `rules.md` (si enumera reglas — verificar), `CHANGELOG.md` entrada `[289A-1]`,
  `package.json` 0.7.15.

## Retirada VarSense (dueño antiguo)

- Quitar: `DiagnosticType.TodoProsaSinMarcador` (`src/types/index.ts:184`),
  `analyzeTodoProse` + llamada (`src/core/analyzeDocument.ts:32,229-375`),
  campo `todoProse` de `VarsenseDocumentAnalysisConfig` y su construcción
  (`src/core/config.ts:198-200`), tests F3.13 (`coreContracts.test.ts:1226-1337`).
- **NO quitar** `todoProseDetection` de `CONFIG_KEYS`/`NESTED_KEYS`
  (`config.ts:76-87`): `validateVarsenseConfig` lanza con clave desconocida y rompería
  todos los `varsense.config.json` que aún la traen. Queda aceptada-pero-ignorada
  (deprecada, comentario explícito). Sunset: eliminar la clave en la próxima major.
- Tests: la suite debe seguir verde (menos los 3 F3.13 eliminados, más uno
  289A-1 que afirma que `todoProseDetection` en config no rompe y no produce
  hallazgos): headless 99/99 (`coreContracts` 78/78 + CLI/equivalencia/LSP
  21/21); `extension.test.ts` (23 tests) exige host VS Code, área no tocada.
- `CHANGELOG.md` + `package.json` 2.2.5. Línea de release: la 2.2.4 vive en el clon
  `RESTAURANTE/tools/varsense` (el dev `area-trabajo/varsense` main=2.2.2 NO contiene
  `d9185c0`); verificar ramas antes de commitear. `main` (2.2.2) también trae F3.13
  (`7dac28e`): aplicar la retirada allí también o registrar la divergencia.

## Paridad (sunset hasta paridad, skill)

- Fixtures compartidos: correr regla nueva (sentinel) y vieja (varsense 2.2.4) sobre
  los mismos casos (tests §diseño + `Toaster.tsx:1`): mismo veredicto por caso.
- Caso `Toaster.tsx:1`: clasificar (FP prosa vs tarea real sin marcador) y documentar.

## Certificación por commit

- Sentinel: `npm run compile` + `check:core` + `smoke:lsp` + `mocha` completa
  (spec fijo en `.mocharc.json`; no aislar por archivo) + `lint` 0 errors.
- VarSense: `compile` + `compile:tests` + `lint` + `check:core` + `smoke:lsp` +
  suite (`125/125` ajustada) + rebuild `dist`.

## Estado (2026-09-28, CIERRE 289A-1)

- Sentinel 0.7.15 PUBLICADO: commit `8f56ca8` + tag `v0.7.15` en `main`,
  push a GitHub OK (rama + tag). Suite 17/17 + 717 passing 1 pending.
- VarSense 2.2.5 PUBLICADO: commit `eeb036f` + tag `v2.2.5` en rama
  `289A-1-retiro-todo-prosa`, push a GitHub OK (rama + tag). Suite 99/99,
  sunset 15→0, paridad 15/15.
- Propagación COMPLETA: familia A (9 con sentinel incl. ONG AGAPE; 8 con
  varsense — gloryapi sin varsense) vía `bump.mjs --write` con evidencias OK;
  familia B con gitlinks commiteados (WANDORIUS `d08d49f5`+`f127ec85`,
  RESTAURANTE `77f3364`+`f7c1631`, sin push) + setups/locks/doctors propios
  verdes (WANDORIUS `readyForGate:true` issues 0; RESTAURANTE doctor
  `blocked:false`, lock con pins nuevos, evidencias OK).
- Guard de sync: `sync:quality` 12/12 alineados;
  `verificar-alineacion.mjs` 17 filas ALINEADO; upstream sentinel al día con
  tags `v0.7.15` publicados; varsense tags `v2.2.5` publicados.
- Lecciones del lote: (a) los setups de familia B NO los corre el bump
  compartido (usa `setup.mjs` propio del consumidor con su cwd); el setup
  compartido ignora `--only`. (b) El lock compartido no sirve para familia B
  (resuelve `cli` contra `.quality-tools/` sin el nombre de herramienta);
  usar el `lock-generator.mjs` propio. (c) El setup con certificación
  reutilizada OMITE el provisioning (copia a `.quality-tools/`): pre-copiar
  `node_modules`+artefactos+`package.json` desde el submódulo construido.
  (d) Las llamadas largas mueren con el timeout del turno: setup de familia B
  (~15 min) en una sola llamada de 30 min con log a fichero. (e) `Start-Job` y
  `launcher.cjs` no sobreviven entre turnos en este entorno (jobs por-sesión,
  `cmd.exe` bloqueado).
- Divergencia REGISTRADA (no bloqueante): varsense `main` local sigue en
  2.2.2 con F3.13; el release vive en rama `289A-1-retiro-todo-prosa` + tag
  `v2.2.5` (publicados, `publicado=SI` en las 17 filas). Aplicar la retirada
  en `main` (merge/PR) es decisión separada. Igual: pushes de los 4 commits
  de familia B quedan pendientes del mecanismo de cada repo.

## Release y propagación (COMPLETADO 2026-09-28 con autorización «release completo»)

1. Commit + tag local en cada herramienta (`v0.7.15`, `v2.2.5`); comparar working tree
   con HEAD antes de commitear (gotcha deshacer del editor).
2. Con autorización: push ramas+tags (alcanzable desde releaseRefs), `bump.mjs --write`
   en los 11 consumidores, setups/locks/doctors, gitlinks familia B (WANDORIUS,
   RESTAURANTE), `sync:quality` + `verificar-alineacion.mjs` en verde, idempotencia
   y vuelta-atrás byte-a-byte del escritor.

## DoD

- `sentinel analyze` sobre fixture reporta `todo-prosa-sin-marcador` warning;
  `varsense scan/all` ya no conoce la regla y no rompe con `todoProseDetection` en config.
- Suites verdes + lint 0 en ambos repos; commits + tags publicados; §Release
  ejecutado y verificado (sync 12/12, alineación 17/17).
