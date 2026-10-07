# Plan: tope físico cross-proyecto a validaciones pesadas (anti-espiral) — 2026-10-07

## Objetivo
Que ningún agente pueda quemar 10 corridas de `cargo check` / `tsc --noEmit` (70–90s
c/u) por microcambio, en NINGÚN proyecto del área. Cumplir la regla 11 por
mecanismo (conteo + negativa + ampliación auditable), no por disciplina.
Además: auditar las vías para saltarse el guard y darle al usuario visibilidad
y control desde este tablero (solo lo controlable se entiende).

Origen: NAKOMI 07AA-7 consumió ~10 checks (fixes sueltos + una corrida por fix,
más un `sqlx prepare` contra DB rota que borró `.sqlx/`). Trasladado desde NAKOMI
(07AA-8) porque el alcance es todo el área.

## Semántica del tope (decidido)
**5 por TAREA, sin caducidad temporal.** El contador vive en el dir de reportes de
la tarea; tarea nueva = contador nuevo. No caduca por días: una tarea larga no
pierde presupuesto por lenta y una tarea nueva no hereda gasto ajeno. Por tiempo
(por día) castigaría tareas paralelas y permitiría espirales interminables.
Ampliación: `lote-extra.md` en el dir de la tarea (+3, con motivo, auditable).

## Alcance / no alcance
- SÍ: conteo y tope en el **orquestador Sentinel** (emite el lease por etapa, conoce
  proyecto + tarea + comando), config `budgets` por proyecto, override auditable.
- SÍ: auditoría de bypasses (F1b, matriz vía→resultado; cerrar o registrar cada una).
- SÍ: panel Guard en este tablero (F6: intentos bloqueados, modo y budgets por
  proyecto, contadores por tarea; lectura + control).
- SÍ: release + propagación a checkouts consumidores (skill `quality-gate-setup`).
- NO: tocar el shim/guard (`cargo.cmd` intacto), partir crates, VPS/producción.

## Dependencias
- Checkout canónico fuente de Sentinel (F0 lo localiza; NO asumir path).
- Skill `quality-gate-setup` (release, lock, propagación) y doc de NAKOMI
  `Agente/documentacion/mantenimiento-herramientas-calidad-2026-10-06.md`.
- Política v2 por proyecto (extender a `budgets`, ver F1).
- Mando `dev` de este repo para operar proyectos durante el piloto.

## Fases verificables
- **F0 Inventario.** Checkout fuente Sentinel, schema política v2, lista de
  consumidores con checkout declarado, emisor de lease (`out/core/lease.js`) y
  runner de etapas. Evidencia: rutas + versiones, sin adivinar.
- **F1 Diseño.** Contador `runs.jsonl` por tarea (incluye fallidos); default
  `check: 5`; comandos contados: `cargo check`, `tsc --noEmit`; override
  `lote-extra.md` (+3); fail open sin tarea; mensaje estilo guard + `Next:`.
  Sin conteo para fmt/prepare/scans.
- **F1b Auditoría de bypasses.** Probar cada vía: binario real directo (`where
  cargo.exe` —el propio shim lo revela—), token legacy `GLORY_QUALITY_GATE_TOKEN`,
  stages custom que omiten etapas, policy observe/pass-through, CLI viejo 0.7.12,
  edición manual de reportes, `npx tsc` directo. Matriz vía→resultado; cada
  hallazgo se cierra en código o queda como riesgo aceptado con detección (log).
  Sin esto, el tope es teatro.
- **F2 Implementación + tests Sentinel.** Unit: conteo, tope exacto, override +3,
  fail open, comandos fuera de lista. E2E en fixture: 6º `check` bloqueado con
  mensaje (sin compilar), override lo desbloquea.
- **F3 Release.** Lock, doctor, tests y gate del propio Sentinel en verde; bump
  versión; nota en doc de mantenimiento-herramientas.
- **F4 Propagación.** Checkouts consumidores (NAKOMI primero como piloto).
- **F5 Piloto NAKOMI.** En tarea real: contador incrementa, mensaje legible,
  override funciona, fail open verificado.
- **F6 Panel Guard en este tablero.** Backend: log de decisiones del guard,
  lectura de política/modo/budgets por proyecto y cambio de modo + budgets (red
  local, sin secretos en respuestas). Frontend: sección Guard (quién, qué, cuándo,
  por qué), estado por proyecto, contadores por tarea, controles.
- **F7 Observe → enforce.** Global primero en observe (solo avisa), luego enforce.

## Estado
F0 CERRADA + F1 CERRADA + F1b CERRADA + F2 CERRADA + F3 CERRADA + **F4-NAKOMI CERRADA** + **F5 CERRADA** + **F6 CERRADA** (2026-10-07, evidencia abajo). **F7 CERRADA** (2026-10-07, evidencia abajo).

## F5 — piloto e2e NAKOMI (cerrada 2026-10-07, Sentinel 0.7.19 `c69d368`)
Matriz completa con `cargo check` real vía CLI directo (`task-check.mjs` ignora `--stages`, siempre `stages.json`; piloto con `stages-check-only.json`):
- **Fase-observe** (NAKOMI `07AA-10`, `budgets observe limit 0`): aviso `[sentinel-budget] cargo-check supera el tope (0/0) en modo observe: la etapa corre igual`, gate PASS exit 0, `runs.jsonl` 1×`started` (used 0/limit 0/observe). Log `C:\tmp\f5-A-observe.log` (35.3s, 0E).
- **Fase-enforce** (NAKOMI `07AA-11`, `budgets enforce limit 2`): 2 ejecuciones PASS (8.1s, 7.6s); 3er intento BLOQUEADO (`check ERROR 0ms tope agotado 2/2`, `quality-budget-exhausted` exit 2 con `Next:`); `runs.jsonl` 2×`started` + 1×`blocked`.
- **Override** (`lote-extra.md +1`): 3ª ejecución PASS 8.1s (`started` used 2/limit 2/extra 1).
- **Cache-hit no consume** (B2 `PASS (cached)`, sin registro): correcto por diseño, el tope cuenta ejecuciones.
- **Hallazgo deInteraction caché↔tope:** el fingerprint incluye `qualityConfig` + archivos del scope, así que cada ejecución real requirió un cambio de árbol (notas de roadmap); documentado como comportamiento correcto, no bug.
- **Hallazgo previo del piloto:** `validateSentinelConfig` rechazaba `budgets` (exit 2) → fix core `0.7.18` (clave conocida, validación estricta paridad `readBudgets`); teardown `removeTmpRoots` → `0.7.19`.
- **Límite honesto:** fail-open solo cubierto por unit (9 tests); sin probe vivo (dirección segura: en fallo permite, nunca bloquea). Temporales revertidos en NAKOMI (`sentinel.config.json` sin `budgets`, `lote-extra.md` eliminado); gate final `quality:check 07AA-11` PASS 0E/13W/53I preexistentes.

## F6 — panel Guard (cerrada 2026-10-07)
Backend `src/server/guard/`: `lector.ts` (lee `sentinel.config.json`→política
con la tolerancia de `readBudgets`, `lote-extra.md`→extra efectivo,
`.quality-reports/<etapa>/<tarea>/runs.jsonl`→diario por tarea; topes
MAX_TAREAS=100, MAX_LINEAS=5000; sin secretos) + `rutasGuard.ts`
(`GET estado?clave`, `GET estado-todo`, `POST modo`, `POST lote-extra` con
motivo obligatorio) + wiring en `index.ts` + `lector.test.ts` 10/10.
Curación: `budgets{mode,l limits}` en ESQUEMA_SENTINEL (`sync:gate` ya no
reporta FALTAN: solo aviso preexistente de versión curación 0.7.15 vs runtime
0.7.19). Frontend: `VistaGuard.tsx` + `useVistaGuard.ts` en VistaProyecto (sin
pestaña nueva; reusa Button/clases gate/config/fj; inputs con `fjInput`).
Evidencia: API viva NAKOMI (07AA-11 3 iniciados/1 bloqueo/límite 2/extra 1;
07AA-10 observe), 4 negativos 400/404, `estado-todo` 18 proyectos (6 no
elegibles), DOM en vivo (toggle modo + form ampliación), re-análisis 0
hallazgos en ficheros F6 (9W preexistentes ajenos intactos).

## F1b — matriz de bypasses (cerrada)
1. Binario real directo (`C:\Users\Owner\.cargo\bin\cargo.exe`, revelado por
   `where.exe cargo`; el shim es `...\GlorySentinel\shims\cargo.cmd` primero en
   PATH): VÍA ABIERTA por diseño (un shim PATH no puede interceptar ruta
   completa). Mitigación: el guard ya bloquea `cargo` por nombre (exit 78 sin
   lease); detección F6: tarea con `.rs` modificados y 0 runs en `runs.jsonl`
   = sospechosa. Riesgo aceptado con detección, no cierre técnico posible.
2. Token legacy `GLORY_QUALITY_GATE_TOKEN`: NO es bypass práctico — se genera
   aleatorio por ejecución (`gateRun.ts:125-126`) y solo vive en el árbol de
   procesos del gate (`toolRunner.ts` allowlist). Robarlo exige acceso al
   proceso. Cerrada por código.
3. Stages custom que omiten pesados (p. ej. nuestro `stages-check-only.json`):
   legítimo por diseño (etapas declarativas por tarea); el reporte lista las
   etapas corridas → detectable. Menos etapas = menos conteo, no evasión.
4. `observe`/`pass-through`: declarados en política, visibles en identidad del
   reporte (`policyHash` + modo). Detección incorporada.
5. CLI viejo (`versions/0.7.12` presente junto a `0.7.13` activo): invocable vía
   `node .../0.7.12/out/cli/index.js`. Mitigación: higiene de release (F3: podar
    versiones viejas) + misma detección que (1). Registrado, cierre en F3.
    Cerrado en F3 (2026-10-07): `versions/0.7.12` podada del runtime de este
    equipo; `doctor` `ready:true`, `issues:[]`, activa `0.7.13` verificada.
6. Edición manual de reportes: son salidas; cualquier re-run reproduce el
   veredicto. Aceptado.
7. `npx tsc` / `cargo.exe` directos: misma clase que (1), misma detección.

## F0 — evidencia
- Fuente canónica: `glory-sentinel/` (área), rama `main` limpia, v`0.7.16`
  (runtime instalado `0.7.13`: va 3 minors por detrás → F3/F4 ya necesarios).
- Orquestador: `src/core/gateRun.ts` `runCheck()` (línea 107): emite lease por
  ejecución (`issueLease`, líneas 132-147) con `projectRoot` + `taskId`; el campo
  `command` va hardcodeado a `'gate'` (línea 138) → el tope NO puede vivir en el
  lease: va en la ejecución de etapa.
- Ejecución de etapa: `runCheckWithToken` (línea 160) → `runBoundedStages` +
  `runStructuredTool(declaration, {projectRoot, reportRoot, logsRoot})`
  (líneas 222-245); `StructuredToolDefinition {name, executable, args[]}`
  (`src/core/structuredTool.ts:23-31`) → el punto de conteo es ANTES de
  `runProcess` (`src/core/toolRunner.ts`), donde executable+args ya se conocen.
- Contador natural: `reportRoot` ya es por tarea
  (`.quality-reports/check/<task-id>`, línea 202) → `runs.jsonl` vive ahí, sin
  plumbing nuevo de task-id.
- Política v2: `sentinel.config.json` (`schemaVersion: 2`, `mode`,
  `gate.taskIdRequired`); lector `readV2GuardPolicy` (`guardCommand.ts`);
  modos en `src/core/policyDecision.ts:6` (`enforce/observe/pass-through`).
- Consumidores con gate declarado (14): GLORYINSPECTOR, limpiador-pc, GLORYPORT,
  workspace-manager, coolify-manager-rs, gloryapi, NAKOMI, Glory-Laminal,
  WANDORIUS, glory-harness, glory-agent, freebuff-bridge, PROYECTO TASKS,
  RESTAURANTE.

## F1 — diseño (cerrado)
Hook en `runStructuredTool` (o wrapper en el loop de `runCheckWithToken`):
antes de ejecutar, clasificar `executable+args` contra lista pesada
(`cargo check`, `tsc --noEmit` inicial); leer `budgets` de la política v2 del
workspace (default `check: 5`); leer/append `<reportRoot>/runs.jsonl` (cuenta
también fallidos); si agotado → NO ejecutar, veredicto de etapa con mensaje
estilo guard + `Next:` (juntar cambios o `lote-extra.md` +3). Override:
`lote-extra.md` en el dir de la tarea suma +3 con motivo (auditable en el propio
reporte). Sin task-id (`taskIdRequired` lo exige; si falta) → fail open con
aviso. fmt/prepare/scans/reporte no cuentan. Modo global observe primero:
durante observe solo se registra (log) sin bloquear.

## F2 — implementación (cerrada 2026-10-07, glory-sentinel `main`)
- Nuevo `src/core/heavyBudget.ts` (~160 líneas): `classifyHeavy` (cargo
  check/clippy/test directo + wrapper `cargo-stage.ps1 <report> <stage>` + `tsc
  --noEmit`; fmt/fmt-write/bench/node/vitest → null, fail open),
  `readBudgets` (clave `budgets` opcional en `sentinel.config.json`, ignorada por
  `readV2GuardPolicy` → añadirla no cambia el guard; default observe 5/clase),
  `checkAndRecordHeavyRun` (cuenta `started` por clase en
  `<reportRoot>/runs.jsonl`, incluye fallidos y bloqueados; override
  `<projectRoot>/lote-extra.md` primer entero; líneas corruptas se ignoran;
  cualquier fallo de E/S → allow, fail open).
- Hook en `runStructuredTool` (`src/core/structuredTool.ts`): tras containment,
  antes de `runProcess`. Agotado en enforce → NO ejecuta, outcome `status
  error / state 'budget-exhausted' / ruleId 'quality-budget-exhausted'` (exit 2
  SETUP ERROR vía `finalDecision`, `Next:` accionable). Cache-hit no cuenta
  (retorna antes del hook). Modo observe por defecto: comportamiento idéntico a
  hoy + aviso y registro (cero cambios para los 14 consumidores hasta F7).
- Tests `src/test/suite/heavyBudget.test.ts`: 9/9 verdes (clasificación,
  defaults/fail-open, budgets custom, cupo exacto 5+bloqueo 6º, clases
  independientes, observe avisa-permite, `lote-extra.md +3` → 8+bloqueo 9º,
  línea corrupta).
- Regresión: suite completa 733 passing + 1 pending; 1 failing SOLO en hook
  `after all` de `shellMatrix` (EPERM al borrar su Temp; 8/8 tests pasan;
  suite sin imports compartidos con el cambio → ambiental preexistente, no
  atribuible). `tsc` limpio, `eslint` 0 errores, `check:core` OK.
- Límite honesto: e2e contra compilador real no ejecutado (quemaría presupuesto
  de verdad); el bloqueo 6º se verifica a nivel `checkAndRecordHeavyRun` + hook.
  E2E real en F5 piloto (NAKOMI).

## F3 — release (cerrada 2026-10-07, glory-sentinel `0.7.17`)
- Baseline certificada en el commit: `tsc` limpio, `check:core` OK,
  `smoke:lsp` OK, suite completa 733 passing + 1 pending (EXIT 0, cero fallos
  nuevos; el EPERM de `shellMatrix` del run F2 no repitió — flake ambiental
  confirmado), `eslint` 0 errores (12 warnings preexistentes, ninguno en
  archivos F2/F3), `doctor --json` `ready:true`, `issues:[]`
  (`readyForGate:false` esperado: el repo herramienta no declara gate).
- Independencia calibrada del fallo F2: `shellMatrix` solo importa
  `guardMatrixCommon` → `interceptorShims` → `atomicFile`; ningún import
  compartido con `structuredTool`/`heavyBudget`.
- Bump `package.json` 0.7.16→0.7.17 + entrada `CHANGELOG.md`; nota de
  mantenimiento en `area-trabajo/Agente/documentacion/mantenimiento-herramientas-calidad-2026-10-06.md`.
- Poda runtime local: `versions/0.7.12` eliminada (cierra bypass F1b-5 en este
  equipo); activa `0.7.13` verificada. Consumidores siguen pineados hasta F4.

## F4 — propagación NAKOMI (cerrada 2026-10-07, NAKOMI `50eb62b8`)
- Checkout compartido `.quality-tools/sentinel` → tag `v0.7.17` (`bcbfd53`),
  recompilado (`tsc` limpio, CLI 0.7.17). Nota: `fetch` avisó `v0.7.6 would
  clobber existing tag` (tag local divergente preexistente, no tocado).
- `bump.mjs --tool sentinel --only NAKOMI --write`: pin cambiado
  dfc2947/0.7.16 → bcbfd53/0.7.17 (`quality-tools.json` + `sentinel.lock.json`
  con sha nuevo), lock ok. Setup re-ejecutó la suite del staging (fail-closed,
  sin certificación válida): 1 fallo ambiental calibrado (`shellMatrix`
  after-all EPERM) → reintento verde 733+1, certificación registrada.
- `quality:doctor` NAKOMI `ready:true`, `readyForGate:true`, `issues:[]`;
  `quality:check 07AA-9` PASS (0E/13W/53I en archivos no tocados).
- Límite honesto: el gate no ejercitó el hook (scope sin compilables, 16 s →
  sin `runs.jsonl`, correcto); hook verificado presente en el build
  provisionado (`structuredTool.js` → `heavyBudget`/`budget-exhausted`).
  E2E real en F5.

## F7 — observe→enforce global (cerrada 2026-10-07)
- Mecanismo: `budgets {"mode":"enforce"}` explícito por repo (sin `limits` = default 5/clase). Descartado flip del default en core: exigiría release+propagación con riesgo; lo explícito es auditable y reversible vía panel/API Guard.
- Activados 10/12 elegibles (todos ya `mode:enforce` pero sin `budgets`): coolify-manager-rs `c1631b3`, glory-agent `5c502fd`, Glory-Laminal `b33e6ca`, gloryapi `cfaa87a`, GLORYINSPECTOR `97b88b5`, GLORYPORT `9a3061d`, limpiador-pc `7ef3595` (commit local, sin remoto configurado), NAKOMI `c41bca90`, PROYECTO TASKS `886ae4b`, workspace-manager (este bloque). Push con standing 2026-10-06 (diff revisado: solo hunk budgets, 3 líneas).
- Excluidos con motivo: `glory-harness` (runtime propio `../.quality-tools-harness/sentinel` 0.7.12) y `WANDORIUS` (`tools/sentinel` 0.7.16 `dfc2947`); su validador no conoce `budgets` → quedan `observe config=ok` (tarea aparte `07AA-12`, CERRADA 2026-10-07:
  ambos propagados a 0.7.19/`c69d368` con `budgets enforce`; estado-todo 12/12).
- Seguro para familia-A: ejecutan el compartido `c69d368` 0.7.19 con soporte `budgets` (confirma `/api/gate/sincronizacion`: `RUNTIME-DESFASADO` pin viejo pero ejecuta c69d368); pins viejos preexistentes intactos.
- Curación realineada: `VERSION_CURACION_SENTINEL` 0.7.15→0.7.19 (`src/server/gate/proveedor.ts:232`); `npm run sync:gate` OK (runtime 0.7.19 / curación 0.7.19, EXIT 0).
- Prueba forma exacta en runtime 0.7.19: 5×`started` allowed (used 0–4/limit 5/observe) + 6º blocked (used 5/limit 5); script temporal eliminado.
- Estado vivo: `GET /api/guard/estado-todo` 10×`enforce config=ok` + 2×`observe`; re-análisis WM forzado 0E/9W/1I/2H, cero en ficheros F7 (hint `large-interface-isp ColumnaTareas` ajeno desapareció por edición de otro frente).
- `npm run type-check` EXIT 0; `npm run build:server` EXIT 0 (dist-server reconstruido).

## Verificación
Tests Sentinel verdes + gate propio; en piloto: 6º intento bloqueado sin gastar
compilación, override +3 efectivo, runs baratos sin conteo; panel muestra eventos
reales.

## Definition of Done
Release publicado y propagado, piloto OK en NAKOMI, doc actualizada, ningún gate
de consumidor con hallazgos nuevos, matriz de bypasses sin vías abiertas no
registradas, panel Guard visible y operable.

## Decisiones (tomadas, recomendación aplicada)
- **D1 Tope default: 5 por tarea.**
- **D2 Rollout: observe-primero global.**
- **D3 Comandos contados: `cargo check` + `tsc --noEmit` inicial.**
- **D4 Panel Guard: lectura + control desde el inicio.**

## Referencia
NAKOMI roadmap §Barrido consola 07AA (07AA-8 trasladada aquí); lección 07AA-7.
