# PLAN: corregir hallazgos de Sentinel y VarSense restantes (308A-5)

Frente: llevar TODOS los proyectos del área a su **piso honesto** (0 o
excepciones legítimas documentadas) con wins rápidos primero, siguiendo la
disciplina de 308A-2/308A-3: refactors reales verificados (`cargo check
--tests` / `tsc --noEmit`), **sin disables para bajar conteo**, usando solo
mecanismos canónicos (boundaries, exclusiones de directorio, `loggerModules`,
logger central, refactors verdes). Los monolitos de gran superficie de API/UI
no se fuerzan: se documentan como excepción.

Conteos autoritativos: `sentinel analyze 0.7.4` vía la cache viva del server
(`/api/gate/analisis`, 2026-08-31).

## Estado / inventario por proyecto

| Proyecto | Conteo | Qué es | Acción prevista |
|---|---|---|---|
| coolify-manager-rs | **error** | runtime no disponible / análisis falló | A1: diagnosticar y destrabar análisis |
| ONG AGAPE | **error** | runtime no disponible / análisis falló | A1: diagnosticar y destrabar análisis |
| gloryapi | 0 (varsense **ausente**) | sentinel ok; no declara varsense | A2: alinear varsense |
| freebuff-bridge | 20 → **0** ✅ | 18× `console-production` (cli/main.ts) + barrel + ISP | B1 resuelto (logger central + barrel + split ISP) |
| GLORYINSPECTOR | 2 | `directorio-abarrotado` (inspector/ tests/) | B2: reorganizar o excepción de directorio |
| workspace-manager | 86 | console/html-nativo/inline/limite-lineas etc. | B3 + C |
| RESTAURANTE | 120 | grandes categorías (ver §D) | D (frente más profundo) |
| PROYECTO TASKS | 23 | excepciones legítimas ya documentadas | E: re-verificar, no forzar |
| GLORYPORT | 1 | `popup.rs` monolito (980 líneas) | F: excepción documentada |
| Glory-Laminal / WANDORIUS | 0 | limpios | mantener |

## Fases (en orden de ejecución)

### A — Tooling / gate (destraba el resto)

- **A1 (errores runtime) — RESUELTO (2026-08-31):** causa raíz = `correrSentinel`
  (analizador.ts) usaba `execFileAsync` y su promesa RECHAZA ante exit != 0;
  `sentinel analyze` sale con exit != 0 cuando existe al menos un hallazgo de
  severidad 'error' (contrato del CLI, como `grep`), así que el stdout con el
  reporte válido se descartaba y el proyecto se marcaba 'error'
  'runtime no disponible'. Fix: parsear el stdout también en el catch
  (`err.stdout`), validando que sea JSON parseable; solo null si no hay stdout
  (fallo real de herramienta). Verificado con type-check exit 0 y smoke test
  real del CLI: **coolify-manager-rs 1e/100w/23h (124)** y **ONG AGAPE
  26e/278w/11i/54h (369)** ahora se clasifican `conHallazgos` y entran al
  frente de corrección (coolify se une a la deuda ya documentada; AGAPE es
  nuevo y grande, requiere iteración propia).
- **A2 (varsense gloryapi) — RESUELTO (2026-08-31):** `gate.varsense` del
  scanner = existencia de `varsense.config.json`. Creado ese archivo en
  gloryapi (preset node de freebuff-bridge ajustado al layout
  client/server/shared/integrations). Verificado: doctor legacy exit 0 y
  `sentinel analyze` sigue 0/0/0/0 (sin regresión). NO se amplió
  `quality-tools.json` ni el lock: gloryapi es consumidor legacy (`task:check`,
  sin lock-generator) y ampliarlos sin poder regenerar el lock marcaría desync;
  queda pendiente la provisión completa de varsense (lock + quality-sync) como
  parte de la  migración del gate legacy de gloryapi, no forzada aquí.

### B — Wins rápidos (bajo riesgo, verificados verdes)
- **B1 freebuff-bridge (20→0) — RESUELTO (2026-08-31):**
  - **console-production ×18** → nuevo logger central `src/logger.ts`
    (log/logWarn/logError/debug) y `cli/main.ts` enrutado todo por él;
    `sentinel.config.json` añade
    `portableBoundaries.loggerModules = ["/src/logger.ts"]` (mecanismo canónico,
    mismo patrón que PT). Salida del CLI intacta (ambito vacío no altera el
    texto).
  - **mixed-barrel-logic** → `cargarConfig` extraído de `index.ts` a
    `src/config.ts`; `index.ts` queda como barrel puro (solo re-exports).
  - **large-interface-isp (ResultadoTarea, 12 campos)** → split por
    intersección `ResultadoTarea` (8: outcome) & `ResultadoTareaMeta` (4:
    llamadasGestor/receipts/iniciadaEn/terminadaEn) = `ResultadoEjecucion`.
    No cambia la shape runtime (CLI imprime el mismo JSON plano) ni rompe
    consumidores; solo la declaración de tipos queda bajo umbral.
  - **Verificación:** `sentinel analyze` → **0/0/0/0** (exit 0), `tsc --noEmit`
    exit 0, `cli --help` con salida intacta. Tests: api-local 7/7, gestor 7/7,
    http-server 5/5, bridge 11/12.
  - **Fallo preexistente (ajeno a este cambio):** `tests/bridge.test.ts`
    (H2/H3 SSE-abort) cuelga ~40s al correr el archivo completo (en aislamiento
    pasa); deja `npm test` sin terminar. Es un flakiness de prueba de SSE con
    mock que nunca resuelve, independiente de B1 (cambio type-only en bridge).
    Se documenta como deuda de test-infra, fuera del lote de hallazgos de
    sentinel; no se forzó aquí.
- **B2 GLORYINSPECTOR (2→0):** `inspector/` (12 archivos) y `tests/` (15) sobre
  el máx. 10. Reorganizar en subdirectorios por dominio o añadir a
  `directoryExceptions` del `settings.json` (mecanismo canónico), lo que sea
  honesto para ese repo (Python `bundle.py`). DoD: re-análisis 0 con evidencia.
- **B3 workspace-manager (lote tractable):** `import-muerto`,
  `promise-sin-catch`, `todo-pendiente`, `css-adhoc-button-style` (5), la parte
  trivial de `console-production` que no es instrumentación legítima del
  CLI/server, y `key-index-lista` (2). DoD: `tsc` exit 0 y conteo bajando hacia
  el piso factual (~los html-nativo/console de instrumentación quedan como
  excepción o se resuelven con whitelist).

### C — workspace-manager (piso restante)
- Split real de `limite-lineas` (6) y `limite-lineas-nivel-2` (1) donde el
  archivo sea un componente/utility divisible; documentar monolitos del server
  (scanner/analizador) como excepción. `inline-style-prohibido` (6) y
  `css-especificacion-diseno-local` (4) → mover a `*.css`/tokens. Las
  `window`/`dom-access` del shell son boundary no definido → documentar (igual
  que en coolify). DoD: verificación `tsc`+build del front sin regresión visual.

### D — RESTAURANTE (120, frente más profundo)
Desglose autoritativo: `limite-lineas` 37 + `nivel-2` 4, `inline-style` 18,
`funcion-larga-rs` 12, `parametros-excesivos-rs` 11, `large-interface-isp` 10,
`handler-accede-bd-rs` 8, `key-index-lista` 6, `broadcast-mutex-riesgo-rs` 5,
`css-especificacion` 3, `console-production` 2, `todo-pendiente` 2,
`usestate`/`css-elemento` 2.
- **Correctivos reales (víctimas claras):** `key-index-lista` (6, añadir key
  estable), `broadcast-mutex-riesgo-rs` (5, riesgo real de bloqueo →
  verificar/boundary), `console-production`/`todo-pendiente` (4), splits
  tractables de `limite-lineas` y `funcion-larga`.
- **Documentar como excepción (contrato/gran superficie):** dispatchers y
  handlers con firma pública (`parametros-excesivos`, `funcion-larga` restante,
  `large-interface-isp` de modelos de red), y los `handler-accede-bd-rs` que
  exigirían moverl la capa repository (refactor arquitectónico amplio, se agenda
  aparte). No forzar sin contrato.
- DoD: RESTAURANTE baja de 120 a un piso honesto ~≤30 con evidencia por regla;
  las excepciones se documentan aquí.

### E — PROYECTO TASKS (23) — no forzar
Los 23 ya están documentados como excepciones legítimas (emoji/copy dinámico,
inline-style dinámico, monolitos de API `store.ts`/`runtime.rs`/`agente.rs`).
Re-verificar con el analizador y confirmar que siguen siendo legítimas; NO
hacer refactor de gran superficie de API en producción sin decisión explícita.
DoD: conteo estable 23 con docs al día.

### F — GLORYPORT (1) — excepción documentada
`popup.rs` monolito de 980 líneas (UI Windows). Piso honesto: documentar, no
forzar split de gran superficie.

### G — VarSense
Tras A2, ejecutar el análisis/varsense de verdad sobre los proyectos con
varsense declarado para detectar problemas reales de VarSense (no solo
`sentinel analyze`). Corregir lo chelado/bajo riesgo; reportar el resto como
deuda con fase propia si excede cierto umbral. DoD: consola reporta también los
hallazgos de VarSense o documenta que no aplica por config.

## Verificación y cierre (por repo)

1. Editar por módulo, validar al cerrar el bloque (una sola ronda).
2. Re-análisis real `sentinel analyze` por proyecto → registrar conteo nuevo.
3. `cargo check --tests` / `tsc --noEmit` (+ tests) verdes según stack.
4. Commit por bloque con stage explícito y mensaje con ID; en repos con gate,
   gate canónico antes de integrar (ff-only).
5. Excepciones documentadas en este plan; nada de disables para bajar conteo.
6. Actualizar `roadmap.md` (quitar bloque completado, registrar evidencia en
   `Agente/completados/` del repo correspondiente y en `data/inventarios/`).

## Gotchas / riesgos

- RESTAURANTE es el frente más profundo; conviene su propio plan o iteración
  dedicada si el lote D supera una sesión.
- `console-production`: la regla marca instrumentación legítima de
  CLI/server; usar `loggerModules` (whitelist) en vez de borrar logs
  útiles o deshabilitar la regla.
- coolify-manager-rs y ONG AGAPE hay que destrabar su análisis ANTES de medir
  su piso; no asumir conteos de `_analisis.json` (volcado viejo).
- No mutar estado ajeno; stage explícito por archivo/hunk; preservar cambios
  de otros threads en el checkout compartido.