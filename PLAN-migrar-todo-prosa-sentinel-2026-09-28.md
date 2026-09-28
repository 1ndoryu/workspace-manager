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

## Estado (2026-09-28, fin de sesión)

- Sentinel 0.7.15 HECHO (certificado): `compile` TSC-EXIT 0, `check:core` OK,
  `smoke:lsp` OK, `lint` 0 errors, suite específica 17/17, suite completa
  717 passing 1 pending. Cambios en working tree de `glory-sentinel` sin
  commitear (commit + tag `v0.7.15` pendientes del paso §Release).
- VarSense 2.2.5 HECHO (certificado): rama `289A-1-retiro-todo-prosa` sobre
  `origin/release/2.2.4`, commit local `eeb036f` (7 archivos, +53/−242).
  `compile:tests` EXIT 0, `eslint` EXIT 0, `check-core-no-vscode` OK,
  `smoke-lsp-stdio` OK, suite headless 99/99, sunset funcional 15 archivos →
  0 hallazgos con `todoProseDetection.enabled:true` (2.2.4 daba 5).
- Paridad 15/15 VERIFICADA (mismos 5 archivos, línea/columna/severidad).
- Pendiente GATED: push rama+tags, `bump.mjs --write` 11 consumidores,
  setups/locks/doctors, gitlinks familia B, `sync:quality` verde. Decisión
  abierta: `main` varsense (2.2.2) también trae F3.13 — aplicar retirada allí
  o registrar divergencia.

## Release y propagación (GATED — requiere autorización)

1. Commit + tag local en cada herramienta (`v0.7.15`, `v2.2.5`); comparar working tree
   con HEAD antes de commitear (gotcha deshacer del editor).
2. Con autorización: push ramas+tags (alcanzable desde releaseRefs), `bump.mjs --write`
   en los 11 consumidores, setups/locks/doctors, gitlinks familia B (WANDORIUS,
   RESTAURANTE), `sync:quality` + `verificar-alineacion.mjs` en verde, idempotencia
   y vuelta-atrás byte-a-byte del escritor.

## DoD

- `sentinel analyze` sobre fixture reporta `todo-prosa-sin-marcador` warning;
  `varsense scan/all` ya no conoce la regla y no rompe con `todoProseDetection` en config.
- Suites verdes + lint 0 en ambos repos; commits locales hechos; paso §6 pendiente
  de autorización explícita registrado en roadmap.
