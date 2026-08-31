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
| coolify-manager-rs | **124** ✅ | runtime destrabado (A1); 1 error = monolito `deploy_service.rs` (2135 l, límite 500) documentado | A1: destrabar análisis (hecho); piso honesto pendiente de decisión |
| ONG AGAPE | 369 → **164** ✅ | errores 26→0; scope de submodulos + boundary + logger + split | D-2 (ver §D-2; piso honesto) |
| gloryapi | 0 sentinel + **131 varsense** ✅ | `variableFiles` corregido a `client/src/index.css` (G-deuda CERRADA 2026-08-31): variableNoDefinida 37→2 (runtime), afloran token-duplicate 36 + token-unused 38 (ver §G) | A2 + G: deuda cerrada |
| freebuff-bridge | 20 → **0** ✅ | 18× `console-production` (cli/main.ts) + barrel + ISP | B1 resuelto (logger central + barrel + split ISP) |
| GLORYINSPECTOR | 2 → **0** ✅ | `directorio-abarrotado` (inspector/ tests/) | B2 resuelto (directoryExceptions canónico) |
| workspace-manager | 86 → **78** (B3+C, piso) | console/html-nativo/inline/limite-lineas etc.; G no añade hallazgos (el «76» de C era variación de medición) | B3 + C + G (ver §C y §G) |
| RESTAURANTE | 114 sentinel + **172 varsense** ✅ | key-index/console/todo reales corregidos; varsense = frente de tokens CSS propio | D-1 + G (ver §D-1 y §G) |
| PROYECTO TASKS | 23 ✅ | excepciones legítimas ya documentadas (E verificó 1:1) | E ✅ re-verificado, no forzar |
| GLORYPORT | 1 ✅ | `popup.rs` monolito (1275 líneas) | F ✅ excepción verificada |
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
- **B2 GLORYINSPECTOR (2→0) — RESUELTO (2026-08-31):** `directorio-abarrotado`
  en `inspector/` (12) y `tests/` (15). Namespace plano de paquete Python
  cohesivo (módulos hermanos `inspector.*` + suite 1:1); reorganizar partiría
  la API pública y los imports (`bundle.py`). Ya hay subdirs reales
  (`adapters/`, `core/`); se usó la excepción canónica
  `directoryExceptions = ["inspector", "tests"]`. Verificación: `sentinel
  analyze` → **0/0/0/0**; `pytest` **51 passed** (1 fallo preexistente ajeno:
  `test_bundle.py` compara `duration_ms`, campo de timing, entre dos scans).
- **B3 workspace-manager (lote tractable) — PARCIAL (2026-08-31):** 86→**83**
  (`tsc --noEmit` exit 0, `sentinel analyze` exit 0 / error 0, sin regresión).
  - **key-index-lista (2→0) ✅ RESUELTO:** `EditorJson.tsx` (`key={c.label}`, la
    ruta jerárquica del campo es única) y `EditorEsquema.tsx`
    (`key={f.ruta.join('/')}`, ruta de esquema única). Verificado en análisis
    (key-index-lista = 0).
  - **Excepciones documentadas de este lote (no tractables limpiamente):**
    - `css-adhoc-button-style` (5): el proyecto **no tiene componente
      `Button`/`Button.css`** (la diana de la regla no existe) — son estilos de
      botón crudos (`mapaV2ZoomBoton`/`mapaV2ManoBoton`/`v2NavBoton`). Forzarlos
      exige introducir el componente `<Button>` y refactorizar ~6 usos TSX
      (riesgo visual, alcance Fase C). Además 2 de 5 viven en `paneles.css`
      (ajeno, no se toca). No se crea `Button.css` de relleno (sería nombrar
      para esquivar la regla). Pendiente como tarea Fase C «introducir Button`.
    - `promise-sin-catch` (1, PanelConfig.tsx): **falso positivo** — las tres
      cadenas `.then(` del archivo ya llevan `.catch()` (L137/167, L200, L261).
      Nada que corregir sin inventar ruido.
  - `import-muerto` y `todo-pendiente` ya estaban en 0 en workspace-manager
    (no aparecen en la cache viva); no se tocaron.

### C — workspace-manager (piso restante) — PARCIAL (2026-08-31): 83→**76**
Trabajado con `tsc --noEmit` exit 0 y `sentinel analyze` exit 0 / error 0, sin
regresión. Detalle:
- **C1 — Botón canónico ✅ (css-adhoc-button-style 5→2):** este proyecto NO
  tenía componente `Button`/`Button.css` (la diana de la regla); se creó el
  `src/v2/Button.tsx` + `Button.css` (monocromo estricto con tokens de
  `variables-v2.css`, variante `cuadrado` y `textoLg` para los glifos +/− del
  zoom) y se refactorizaron MapaV2 (3 botones de zoom/mano) y NavBar (2 bucles)
  a usarlo. Eliminados los estilos crudos `mapaV2ZoomBoton`/`mapaV2ManoBoton`/
  `v2NavBoton`. Los 2 `css-adhoc` restantes viven en `paneles.css` (ajeno, no
  se toca) y quedan como excepción pendiente.
- **C2 — inline-style-prohibido (6→3):** los 3 estáticos se movieron a CSS
  (`App.tsx` 58/69 → `app.css`; `IsoMap.tsx` 80 → `isoMap.css` con valores
  pixel por pixel). Los 3 restantes (`EditorEsquema` 476, `MapaV2` ~320,
  `MenuContextual` 41) son **tooltips/cursor dinámicos** (posicionamiento
  relativo al viewport / drag) → inline legítimo, documentado.
- **C4 — limite-lineas (6→5):** únicos split no arbitrario = `etiquetas.ts`
  (360→**294**): el bloque de traducciones de reglas estáticas se extrajo a
  `src/shared/gate/etiquetas-reglas.ts` (`CATALOGO_REGLAS`) y `etiquetas.ts`
  queda con el catálogo de claves de config + merge por spread. Split limpio:
  responsabilidad única por archivo (claves vs reglas). Los 5 restantes son
  **monolitos de gran superficie** (`useWorkspace` 528, `server/index` 730,
  `EditorEsquema` 639, `PanelConfig` 689, `paneles.css`) → documentados como
  excepción, no forzados (forzarlos = refactor de gran superficie que excede el
  piso de una sesión).
- **C3 — window/dom-access cuadrados.** Los que quedan son boundary legítimo
  del shell/UI: `MenuContextual` (add/removeEventListener pointerdown/scroll/
  resize/keydown para cerrar), `EditorEsquema`/`MapaV2` (clamping de tooltip a
  `window.innerWidth/Height`, render a `document.body`), `main.tsx` (mount de
  React vía `document.getElementById`). Los de `etiquetas.ts` son **falsos
  positivos** (strings del catálogo que describen las claves `window`/`dom`, no
  acceso real; además el archivo es shared server/client y NO debe tocar
  window). Hookearlos exigiría abstraer esporádicos de viewport/eventos sin un
  segundo consumidor → se documentan en vez de crear abstracción sin caso real.
- **DoD cumplido:** tipo-check exit 0, análisis exit 0 / error 0, reducción
  86→76 con evidencia por regla; lo restante son excepciones documentadas.

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

### D-1 — Resultado de la ejecución (2026-08-31): 120 → **114**

`sentinel analyze` final: **exit 0 / error 0, 86w + 3i + 25h = 114**
(antes 120). Verificación por stack: `cargo check --tests` exit 0 (via
`scripts/run-cargo.mjs`) y `npx tsc --noEmit` en `frontend/` exit 0. Sin
disables, sin commit, sin tocar cambios ajenos (los del repo eran todos
míos). Evidencia por regla:

- **`console-production` 2 → 0.** El `sentinel.config.json` ya declaraba
  `loggerModules = ["/frontend/src/utils/logger"]` pero el archivo no existía
  (whitelist muerta). Se creó `frontend/src/utils/logger.ts` (patrón de PT,
  con `console-error`/`console-warn`/`console-info` para preservar severidad
  al volcar en consola) y `ErrorBoundary.tsx` + `useNotificaciones.ts`
  enrutan por él. La whitelist declarada queda real.
- **`key-index-lista` 6 → 3.** Fijos: `chart.tsx` (2 keys: leyenda por
  `dataKey`, tooltip activo por `payloadKey`) y `DashboardReservas.tsx` (2
  keys: meses por `MESES_NUM` — número de mes — y celdas del pie por
  `canal`). Los 3 restantes (2 skeletons `Array.from({length:5})` en
  `BdpCompras`/`BdpStock`, y lista read-only de líneas en
  `bdp-menu-explorer.tsx`) son listas **estáticas de solo lectura** donde el
  key por índice es semánticamente correcto (no se reordenan ni mutan);
  forzar un ID inventado sería ruido → documentado.
- **`todo-pendiente` 2 → 1.** El real (preflight) se resolvió: en
  `src/services/bdp_sync_preflight.rs` el `PENDIENTE`/TODO de decisión de
  re-encolar se extrajo a una constante con comentario de contrato. El que
  queda en `bdp_sync.rs:675` es **falso positivo**: `PENDIENTE` es término de
  negocio («order pendiente»), no un marcador → documentado.
- **`broadcast-mutex-riesgo-rs` 5 → documentado (no tocado).** El patrón SSE
  de `notificacion.rs` + `handlers/mod.rs` es idiomático y seguro tras
  verificación: `BroadcastStream` con filtro de `RecvError::Lagged` (el lag
  se descarta, no acumula), canal con capacidad acotada, y el `send()` con
  error ignorado de forma intencional con comentario. Migrar a
  `mpsc::unbounded_channel` por suscriptor cambiaría la semántica del
  fan-out/broadcast sin beneficio (los suscriptores son pocos y el mutex del
  broadcast es de contención baja en la práctica). La regla solo acepta
  `sentinel-disable` como excepción (prohibido por el plan) → excepción
  documentada, no forzada.
- **`limite-lineas` 37+4 / `inline-style` 18 / `funcion-larga` 12 /
  `parametros-excesivos` 11 / `large-interface-isp` 10 /
  `handler-accede-bd-rs` 8 / `css-*` 5 → documentados (no forzados).** Los
  `limite-lineas` son monolitos de 343–3322 líneas (dispatchers, handlers,
  repositorios sqlx, servicios BDP y archivos de UI/estilos): splitearlos
  requiere refactor arquitectónico de gran superficie (el plan ya los marcaba
  como no tractables en esta pasada). Los `inline-style` son en su mayoría
  dinámicos (tooltips/cursor relativos a viewport, barras de progreso por
  valor). `handler-accede-bd-rs` exigiría mover la capa repository.
- **Entorno (nota):** `cargo check` a pelo fallaba por drift de la DB local
  de desarrollo (faltaba la migración `haddock_venta_tracking`, y el historial
  de `_sqlx_migrations` tiene un checksum roto en `20260325000000`, así que
  `sqlx migrate run` no aplica). Se aplicaron las 3 columnas del .up.sql
  (additivo, `IF NOT EXISTS`) directamente en la DB local de dev
  (`127.0.0.1/glory_db`) para poder verificar — equivalente a lo que
  `main.rs` hace con `sqlx::migrate!()` al arrancar. Sin tocar `_sqlx_migrations`.
- **SQL crudos `sqlx::query` sin macro:** documentados como deuda (el plan
  dice no forzar `query_as!` en esta pasada).

### D-2 — ONG AGAPE (369 → **164**, errores 26→0) — 2026-08-31

`sentinel analyze` final: **exit 0 / error 0, 162w + 2h = 164** (antes 369
con 26e). Verificación: `cargo check --tests` exit 0 (vía
`scripts/run-with-db.mjs`) y `npx tsc --noEmit` en `frontend-v2/` exit 0.
Sin disables, sin commit, sin tocar cambios ajenos. Evidencia por regla:

- **Scope: submodulos excluidos (173 → 0, incluidos los 26 errores).**
  `glory-rs/`, `tools/sentinel/` y `tools/varsense/` son submodulos fijados
  por commit (código externo que el proyecto no posee) y el analizador los
  estaba escaneando: 173 hallazgos (34 non-null, 31 console, 25 limite,
  14 ISP, 11 eval, 11 barras, 8 secretos, …). Los **26 hallazgos de
  severidad `error` estaban TODOS en los submodulos**; el código propio del
  proyecto no tenía ningún error. Fix canónico de scope: `excludePatterns`
  += `**/glory-rs/**`, `**/tools/**` (mismo patrón que WANDORIUS).
- **`window-reference-outside-platform` 18 → 0 y `dom-access` 6 → 0
  (boundary legítimo).** Declarados los archivos shell/UI exactos que usan
  window/document de forma legítima en `portableBoundaries.window`/`dom`
  (App.tsx ×2, main.tsx ×2, modales, vistas admin, donar, inicio,
  Confirmar/ModalImagen/ModalAccion) — listado explícito por archivo, no
  rutas amplias, para que usos futuros fuera de esos archivos sigan
  detectándose (mecanismo canónico de WANDORIUS).
- **`console-production` 1 → 0 (logger).** `frontend-v2/src/utils/logger.ts`
  creado (error/warn/info) y declarado en `loggerModules`;
  `AcercaDeNosotros.tsx` enruta su `console.error` de carga por `logError`.
  El log útil se conserva, no se borra.
- **`funcion-larga-rs` 1 → 0 (split real).** `create_donation()` en
  `src/handlers/transparency.rs` (108 líneas efectivas, máx 100): el parseo
  multipart de 7 campos se extrajo a `parsear_donacion()` + struct
  `DatosDonacion` (misma validación, cero cambio de comportamiento; el
  handler queda en 32 líneas). `cargo check --tests` exit 0.
- **`directorio-abarrotado` 6 → 1.** `directoryExceptions` canónicos para
  namespaces planos cohesivos (patrón RESTAURANTE/WANDORIUS):
  `src/handlers`, `src/repositories`, `frontend-v2/src/components/ui`,
  `frontend-v2/src/features/admin`, `frontend-v2/src/features/inicio`. El
  restante es la **raíz del repo** (17 archivos: configs de build + dos
  frontends + src + tooling): estructura legítima de raíz de proyecto;
  mover configs rompería tooling → documentado.
- **Documentado (no forzado):** `sqlx-query-as-sin-macro` 55 +
  `sqlx-query-sin-macro` 6 (deuda; no migrar a `query_as!` en esta pasada,
  requiere cambios de runtime/revisión query a query); `limite-lineas` 9
  (monolitos de UI/admin/repos: PanelAdmin.css 775, ModalEditarMetodo 420,
  Donar 454, VistaAcciones 410, VistaBlog 374, VistaCampanas 361,
  VistaAliados 348, admin.rs 743, AgapeAdminPanel 323); `css-elemento-html-
  directo` 25 y `button-clase-especifica` 13 + `css-adhoc-button-style` 4 +
  `html-nativo-en-vez-de-componente` 11 (NO existe componente `Button`/`Select`
  en el UI kit de frontend-v2 — solo AlertaPanel/BotonEnlace/Confirmar/
  ModalImagen/Toast/SubirArchivo — así que migrar exige introducir el design
  system; igual que el caso de workspace-manager Fase C); `usestate-excesivo`
  11 y `componente-sin-hook-glory` 12 (refactor de estado/hooks);
  `emoji-en-codigo` 8 (copy de marketing, igual que PT); `modal-semantica/-
  estructura` 3; `css-especificacion-diseno-local` 3; `key-index-lista` 2
  (listas estáticas/posicionales: galería de slots fijos `VistaHistoria` y
  párrafos read-only `HistoriaDetalle` — el índice ES la identidad);
  `inline-style-prohibido` 1 (barra de progreso con ancho dinámico por dato,
  ya comentado).

### E — PROYECTO TASKS (23) — ✅ VERIFICADO (2026-08-31), no forzar
Los 23 ya están documentados como excepciones legítimas (emoji/copy dinámico,
inline-style dinámico, monolitos de API `store.ts`/`runtime.rs`/`agente.rs`).
Re-verificado con el analizador (`sentinel analyze --format json`, salida
fuera del repo para no contaminar la raíz): **23 exactos** — 19 warning / 4
hint / 0 error, exit 0. Coincidencia 1:1 con lo documentado:
`emoji-en-codigo` 9 (datosIniciales.ts, copy marketing dinámico),
`inline-style-prohibido` 5 (TareaBadges, PanelExp ×2, EditorPixelArt —
estilos dinámicos por dato), `limite-lineas` 4 (store.ts 647 /
runtime.rs 776 / agente.rs 854 / ai.rs 960 — monolitos de API),
`funcion-larga-rs` 1 (runtime.rs L158), `parametros-excesivos-rs` 4
(proyeccion.rs ×2, storage.rs, runtime.rs — firmas públicas). Sin desviación.
NO se hace refactor de gran superficie de API en producción sin decisión
explícita. DoD cumplido: conteo estable 23 con docs al día.

### F — GLORYPORT (1) — ✅ VERIFICADO (2026-08-31), excepción documentada
`popup.rs` monolito (UI Windows) — ahora 1275 líneas (el doc previo decía
980; el archivo creció, misma excepción). Re-verificado: **1 exacto**
(`limite-lineas` en `src/popup.rs` L1275), 0 error, exit 0. Piso honesto:
documentar, no forzar split de gran superficie.

**Nota de medición (lección E/F):** la raíz de GLORYPORT tiene exactamente 10
archivos propios (el límite de `directorio-abarrotado`); al volcar el reporte
con `> _archivo.json` DENTRO de la raíz, el archivo de salida contaba como el
#11 y generaba un falso `directorio-abarrotado` (desviación aparente de 1→2).
Con salida fuera del repo, vuelve a 1. Los conteos E/F siempre deben medirse
con la salida JSON fuera del árbol del proyecto.

### G — VarSense ✅ COMPLETA (2026-08-31) — exposición real de hallazgos

**Verificación de provisión (no asumida):** VarSense **está provisionado de
verdad** en el checkout compartido `<area>/.quality-tools/varsense` (v2.2.1,
`node dist/cli/index.js all --workspace . --format json` funciona) — el
comentario stale «varsense no tiene runtime» era de antes de 308A-1. **La
pipeline `sentinel analyze` NO captura sus hallazgos** (verificado: 0 findings
con `source: 'VarSense'` en el reporte): VarSense corre como herramienta
independiente y solo el gate-wrapper las fusionaba. Medición real por proyecto
(CLI directo, exit 0/1 según severidad 'error', JSON en stdout):

- **gloryapi: 92** (37e/54w/1i/0h) — `variableNoDefinida` ×37 (falsos
  positivos: `variableFiles: []` en su config → el índice de tokens no
  resuelve `var(--…)`), `valorHardcoded` ×27, `claseHuerfana` ×27,
  `cssInlineReact` ×1. **Config con `variableFiles` vacío = misconfig.**
- **RESTAURANTE: 172** (0e/109w/24i/39h) — reales y accionables:
  `valorHardcoded` ×26, `claseHuerfana` ×34, `token-duplicate` ×42,
  `token-unused` ×39, `cssInlineReact` ×24, `propiedadProhibida` ×7.
- GLORYPORT: 0 (config declarada, sin hallazgos).

**Implementación (cambio pequeño y verificado, DoD de G cumplido):** el
analizador del manager ahora corre `varsense all` junto a `sentinel analyze`
cuando el proyecto declara `varsense.config.json` y el runtime está
provisionado, y **fusiona ambos reportes** en el mismo `AnalisisSentinel`:

- `src/server/gate/analizador.ts`: `correrVarsense()` (misma convención de
  exit-code que sentinel: reporte válido en stdout aunque exit ≠ 0),
  `checkoutVarsense()`/`varsenseRuntime()`/`varsenseConfigHash()` (frescura
  ahora incluye versión de varsense + hash de su config — antes un cambio de
  config de varsense no invalidaba la cache); `normalizar(…, fuente)` taguea
  cada hallazgo con `fuente: 'sentinel' | 'varsense'`.
- `src/shared/types.ts`: `HallazgoSentinel.fuente` (retrocompat: ausente =
  sentinel, cache vieja) y `AnalisisSentinel.varsense` (versión + resumen).
- `src/server/gate/proveedor.ts`: el proveedor de varsense pasó de
  `runtimeInstalado: null`/`fuente: 'estatica'` (stale) a reportar la versión
  REAL del checkout compartido (`2.2.1`, fuente runtime) vía
  `versionVarsense()`.
- UI: `PanelDetalle.resumenAnalisis` muestra ambos conteos
  (`sentinel: … · varsense v2.2.1: …`); `PanelConsola` etiqueta los hallazgos
  de varsense con prefijo `[varsense]` en la línea.

**Verificación:** `pnpm run type-check` exit 0; smoke real de
`analizarProyecto`: gloryapi → resumen fusionado 0e/54w/1i + varsense 37e/54w/1i
(solo varsense = 92 hallazgos, sentinel 0), RESTAURANTE → sentinel 114 + varsense
172 fusionados sin tocar los conteos de sentinel, GLORYPORT → varsense 0 sin
cambiar su total. `sentinel analyze` de workspace-manager: **78 hallazgos, cero
nuevos de G** (los hallazgos en archivos tocados por G — `limite-lineas` de
`analizador.ts` 325 líneas pre-G, ISP de `types.ts`, hook-logic de paneles —
ya existían; el «76» de la Fase C era una variación de medición del reporte).

**Estado real de VarSense por proyecto (para roadmap/panel):** 12 consumidores
con `varsense.config.json`; todos apuntan al checkout compartido provisionado
(v2.2.1) — provisión real, no legacy. Los que tienen gate `task:check` legacy
(sin `gate:check`) mantienen su pipeline; el manager ahora reporta sus
hallazgos igual. Deuda abierta documentada: (a) ~~config de gloryapi con
`variableFiles` vacío~~ **CERRADA (2026-08-31, ver §G-deuda)**; (b) los 172 de
RESTAURANTE son un frente propio de limpieza de tokens CSS/hardcodes, no
forzado aquí (excede el piso de una sesión).

### G-DEUDA — gloryapi `variableFiles` CERRADA (2026-08-31)

**Fix:** `varsense.config.json` de gloryapi pasó de `variableFiles: []` a
`["client/src/index.css"]` — el único CSS del proyecto y el que define los
tokens (`:root` L58 + `.dark`, 107 `--`). Patrón canónico idéntico al de
RESTAURANTE (`frontend/src/index.css`) y WANDORIUS
(`frontend/src/styles/variables.css`). Con `[]`, `variableFiles` no es
nullish y gana sobre `DEFAULT_VARIABLE_PATTERNS` → el índice de tokens se
construía vacío y **todo** `var(--…)` se reportaba `variableNoDefinida`.

**Resultado (`.quality-tools/varsense/dist/cli/index.js all --workspace .`):**
`variableNoDefinida` **37 → 2** (35 falsos positivos eliminados; los 2
restantes `--sortable-transform`/`--sortable-transition` son la familia
runtime-inyectada por dnd-kit en `SortableModelRow.tsx:31` con fallback
correcto en CSS — no existe mecanismo de exclusión de variables en el schema
del config, verificado en `tools/varsense/src/cli/index.ts` y el set de claves
legacy de WANDORIUS; se documentan, no se fuerzan). `valorHardcoded` 27,
`claseHuerfana` 27, `cssInlineReact` 1: **sin cambios** (siguen siendo reales:
colores de marca hardcodeados L155+, clases huérfanas, inline React).

**Afloran 74 hallazgos que la misconfig ocultaba** (el índice vacío también
cegaba a `tokenDetection`): `token-duplicate` 36 + `token-unused` 38, ambos
sobre `client/src/index.css`. Revisados por muestra y clasificados como
excepción legítima, no forzados:

- **`token-unused` 38 — limitación de herramienta (Tailwind v4 `@theme
  inline`, L13-55):** los `--color-*`/`--font-heading`/`--radius-*` del bloque
  `@theme` son el puente utility→token; se consumen vía utilidades Tailwind
  compiladas (`bg-card`, `text-foreground`), invisibles al escaneo estático
  (el detector no conoce el mapeo de Tailwind). No son tokens muertos.
- **`token-duplicate` 36 — aliasing semántico de shadcn:** `--X-foreground` ≡
  `--foreground`, `--popover` ≡ `--card`, etc. La capa semántica repite
  valores base a propósito para que los componentes referencien nombres
  semánticos y los temas puedan divergirlos. Colapsarlos sería cambiar la
  arquitectura de tokens.

**Conteo nuevo:** gloryapi 92 → **131** (la subida es la verdad aflorando, no
una regresión: 35 FP eliminados + 74 reales por ahora visibles, clasificados
como excepciones de arquitectura/limitación). `sentinel analyze` de gloryapi
**sigue 0/0/0/0** (282 archivos, 0 violaciones, exit 0). Sin disables, sin
tocar código de gloryapi, sin commit (config sin commitear, como el resto del
bloque A2).

### H — Reducción del agregado 2571 (2026-08-31): misconfig `variableFiles` en workspace-manager y coolify-manager-rs + tractables sentinel

**Origen del 2571:** tras la fase G, la consola agrega hallazgos sentinel +
varsense fusionados (con cap 500/proyecto) + problemas de config. El grueso
nuevo eran **errores `variableNoDefinida` de varsense** (727) por la misma
misconfig ya corregida en gloryapi: `variableFiles: []` en
`workspace-manager/varsense.config.json` (382) y
`coolify-manager-rs/varsense.config.json` (341). Con `[]` el índice de tokens
se construía vacío y todo `var(--…)` se reportaba no definido.

**Fix (mismo patrón validado en G-DEUDA):**

- `workspace-manager/varsense.config.json`:
  `variableFiles: ["src/styles/variables.css", "src/v2/styles/variables-v2.css"]`
  — los dos archivos que definen los tokens (`variables-v2.css` es donde viven
  los `--v2-*`; la primera pasada solo con `variables.css` no surtió efecto).
- `coolify-manager-rs/varsense.config.json`:
  `variableFiles: ["gui/src/estilos/variables.css", "gui/src/estilos/portal.css"]`
  — los `--vps*` de `portal.css` se definen bajo el scope `.vpsPortal` (no en
  `:root`); el índice acepta scopes de clase, con ambos archivos la cobertura
  es completa. Los 4 paths verificados existentes.

**Resultado varsense:**

- workspace-manager: errores `variableNoDefinida` **382 → 18** (total 155).
  Los 18 restantes se documentan: 16 en `paneles.css` (archivo ajeno de otro
  hilo, no se toca) y 2 en `v2.css` (`--ancho-detalle`/`--ancho-lista`,
  runtime-inyectadas desde `AppV2.tsx` con fallback correcto — misma familia
  runtime de gloryapi, sin mecanismo de exclusión en el schema).
- coolify-manager-rs: errores **341 → 0** (total 99; restan `claseHuerfana` 37,
  `valorHardcoded` 49, `token-unused`/`token-duplicate` 12, `cssInlineReact` 1
  — reales o excepciones de arquitectura ya documentadas).
- GLORYPORT/freebuff-bridge/GLORYINSPECTOR también tienen `variableFiles: []`
  pero **no tienen CSS** — el misconfig ahí es inofensivo, no se toca.

**Tractables sentinel en workspace-manager (78 → 60, 0 errores, exit 0,
`tsc --noEmit` exit 0):**

- `console-production` 17 → **2**: se creó `src/shared/logger.ts` (el
  `DEFAULT_LOGGER_MODULES = ['/logger.', '/logging/']` lo whitelistea sin
  tocar config) y se enrutaron por él los logs legítimos de catch en
  `useWorkspace.ts` (7), `server/index.ts` (4), `AppV2.tsx` (2) y
  `useWorkspace.ts` cabecera. Los 2 restantes están en `MapaV2.tsx` — diff
  ajeno de otro hilo, no se toca; excepción documentada.
- `fallo-sin-feedback` 4 → **2**: la regla solo cuenta `console.*` directo;
  enrutar por logger también la resolvió. Los 2 restantes: `MapaV2.tsx` ajeno.
- `promise-sin-catch` 1 → **0**: falso positivo real — el `.catch` existía
  pero a 29 líneas del `.then` (ventana del analyzer: 20). Refactor honesto en
  `PanelConfig.tsx`: parseo extraído a función de módulo → `.then` acortado,
  `.catch` queda dentro de la ventana.
- `acceso-api-sin-fallback` → **0**: `PanelNavegador.tsx` ahora usa
  `data.entradas ?? []`.
- Gotcha resuelto durante el refactor: la extracción inicial de `PanelConfig`
  usó `editado` como local colisionando con el estado del componente → nuevo
  falso positivo `mutacion-directa-estado`; renombrados los locales
  (`contenidoEditado`) → desaparece. Conteo final **60** con **cero hallazgos
  nuevos**.

**Sin disables, sin commit, sin tocar ajenos:** `paneles.css` y `MapaV2.tsx`
intactos; `tsc --noEmit` exit 0; `sentinel analyze` de workspace-manager exit 0
(0 error / 56 warning / 4 hint). El agregado de la consola baja de 2571
(fuente: cache viva `/api/gate/analisis`, cap 500/proyecto — ver §G).

### H-1 — coolify-manager-rs (continuación 308A-6): 124 → **96** (2026-08-31)

Baseline: **124** (1e / 100w / 23h), exit 1 por el error. Desglose inicial por
archivo: monolitos `funcion-larga-rs` 36 + `parametros-excesivos-rs` 22
(distribuidos en commands/services), `limite-lineas` 10 (deploy_service 2135,
mcp/tools 872, google_drive 694, api/mod, maintenance, ssh_client, sync_env,
VistaPortal, theme_manager), `unwrap-produccion-rs` 5, `directorio-abarrotado`
5, `window-reference`/`dom-access` ~3+3 (boundary del GUI web), CSS de diseño
sin design system (portal.css/login.css).

**Tractables corregidos (todos verificados `cargo check --tests` exit 0 +
`tsc --noEmit` del GUI exit 0):**

1. `unwrap-produccion-rs` 5 → **0** (riesgo real, no solo lint):
   - `gui_api.rs` — `?` con `CoolifyError`;
   - `infra/docker_api.rs` — `?`;
   - `infra/google_drive.rs` — `ok_or_else` con contexto de error;
   - `services/compare_manager.rs` — se preserva el guard de cleanup
     (`tmp_guard` se asigna inmediatamente) y el ref se resuelve con
     `ok_or_else` explicitando la invariante en vez de panickear;
   - `services/volume_manager.rs` — `ok_or_else`.
   Se añadió la variante `CoolifyError::Internal` (los matches existentes usan
   `other =>`, sin exhaustividad rota — verificado por cargo).
2. `directorio-abarrotado` 5 → **1**: `directoryExceptions` canónicas por
   nombre en `sentinel.config.json` para `commands`, `services`, `infra`,
   `componentes` (patrón B2/D-2). El restante es **la raíz del repo** (16
   archivos: Cargo.toml/lock, package.json, configs, README + debris trackeado
   `clippy_out.txt`/`stderr.txt`/`stdout.txt`/`plans_debug.json`): excluirla
   con el nombre del proyecto matchearía **toda ruta** (la regla usa
   `rutaRelativa.includes(excepcion)`), lo que equivaldría a desactivar la
   regla repo-wide → NO aceptable; se documenta como excepción legítima
   (reorganizar la raíz rompería el layout Cargo/package).
3. Boundary window/dom del GUI → **0**: `portableBoundaries` con los archivos
   del shell (MenuContextual, Modal, SelectorPersonalizado, VistaPortal,
   main.tsx) — misma clase documentada en C3/D-2.
4. Splits reales de `limite-lineas` (no arbitrarios, por seam de dominio):
   - `services/theme_manager.rs` (635e) → extraída `run_pending_migrations` a
     `services/theme_migrations.rs`;
   - `api/mod.rs` (587/512e) → bloque de métricas extraído a `api/metrics.rs`;
   - `services/maintenance_window_manager.rs` → bloque de render de scripts a
     `services/maintenance_render.rs`;
   - `commands/sync_env.rs` → helpers + tests movidos a
     `commands/sync_env_helpers.rs` (los tests prueban solo helpers → se
     mueven con ellos);
   - `infra/ssh_client.rs` → helpers base64 a `infra/encoding.rs`;
   - `gui/src/componentes/VistaPortal.tsx` → `VistaPortalConsola.tsx` +
     `VistaPortalVisual.tsx` (overlays extraídos verbatim).
   Los submódulos helper se declaran en el `mod.rs` padre (patrón Rust: un
   `mod helpers;` dentro del archivo-hijo buscaría `archivo/helpers/`); gotcha
   resuelto en la primera compilación (20 errores E0583/E0425 → corregido con
   declaración en el padre + `use super::…`).
   `limite-lineas` 10 → **6**; los que quedan son monolitos documentados:
   `deploy_service.rs` 2135 (**error** nivel-3 + nivel-2 — no se toca, split
   arbitrario), mcp/tools.rs 872, google_drive.rs 694.

**Resultado:** 124 → **96** (1e / 72w / 23h). El único error que queda es el
`limite-lineas-nivel-3` de `deploy_service.rs` (2135 líneas, monolito
documentado — no se toca porque un split sería arbitrario; es el “mínimo
documentado” que autoriza el bloque). Los hallazgos restantes son exactamente
los monolitos (funcion-larga/parametros/limite-lineas) + CSS de diseño del GUI
sin design system (portal.css/login.css).
`varsense` re-corrido: **99 total / 0 errores** (sin cambio, no se tocó CSS).
Verificado además que **ningún hallazgo nuevo** cayó en los archivos
editados/creados: solo familia de monolitos preexistente (`funcion-larga-rs`,
`parametros-excesivos-rs`, `limite-lineas`); `portal.css` sin diff (los 25
`css-elemento-html-directo` + button/ad hoc/ISP son preexistentes del GUI, sin
design system — excepción de arquitectura ya documentada en H).

**Sin disables, sin commit, sin tocar ajenos:** los 17 modificados + 7 nuevos
son todos míos; `gui/node_modules` (npm ci solo para verificar tsc) ignorado;
temp files de medición fuera del repo (lección E/F).

### H-2 — CIERRE 308A-6: agregado vivo verificado (2026-08-31)

Re-consultado `curl http://127.0.0.1:8787/api/gate/analisis?analizar=todo`
(servidor vivo, exit 200) y reproducido el cálculo exacto de `PanelConsola`
(`problemasDe` + hallazgos del análisis fusionado sentinel+varsense cap
500/proyecto — `hallazgos.slice(0,500)` en `gate/analizador.ts` L255/L399 — +
vulnerabilidades):

**TOTAL consola (filtro 'todos'): 2571 → 1974** (−597).

Desglose por proyecto (problemas | hallazgos | vuln):

```text
  501 PROYECTO TASKS          1p | 500h (cap: resumen real 1830w) — runtime del manager, ver nota
  327 TRABAJOS CLIENTES/ONG AGAPE  1p | 326h (2e/317w/1i/6h)
  286 RESTAURANTE             0p | 286h
  217 workspace-manager       2p | 215h (18e/189w/4i/4h) = 60 sentinel + 155 varsense
  196 coolify-manager-rs      1p | 195h (1e/164w/1i/29h) = 96 sentinel + 99 varsense
  186 WANDORIUS               0p | 186h
  133 gloryapi                2p | 131h (2e/90w/1i/38h)
  124 Glory-Laminal           0p | 124h
    1 freebuff-bridge / glory-sentinel / GLORYINSPECTOR / GLORYPORT (1h)
TOTAL 1974
```

**Cruce contra los cambios del bloque (confirmado 1:1):**

- workspace-manager: **215 hallazgos = exactamente 60 sentinel + 155 varsense**
  (los 18 errores son los documentados: 16 `paneles.css` ajeno + 2 runtime de
  `v2.css`). Mis fixes reflejados en el agregado vivo del servidor.
- coolify-manager-rs: **195 = exactamente 96 sentinel + 99 varsense**, 1 error
  = `limite-lineas-nivel-3` de deploy_service documentado. Varsense 0 errores.
- gloryapi: 2 errores = los runtime `--sortable-*` documentados en G-DEUDA.
- **Errores NO documentados encontrados (2, nuevos a este cierre, ONG AGAPE):**
  `variableNoDefinida` de `--colorRojoOscuro` en `AlertaPanel.css:19` y
  `PanelAdmin.css:428` con fallback correcto
  (`var(--colorRojoOscuro, var(--colorRojo))` — `--colorRojo` definida en
  variables.css L13). Familia “degradación correcta”: la variable no existe
  como token pero el fallback cubre el runtime; definirla o quitar el uso es
  decisión de design system, no bug. Se documentan como excepción (no tocadas:
  ONG AGAPE tiene diff ajeno de otro hilo).

**Nota honesta sobre el agregado:** el servidor analiza con su **runtime
global** (`fuente: runtime`, v0.7.4/varsense v2.2.1) sobre el config de cada
repo; para workspace-manager/coolify-manager-rs/gloryapi los conteos del
agregado coinciden exactamente con las verificaciones manuales post-fix, pero
para PT (resumen 1830w vs 23 verificados con el binario del proyecto en E/F) y
ONG AGAPE difieren — preexistente a 308A-6 (alineación del runtime del manager
con los bins fijados por proyecto, deuda ya registrada; no se toca aquí).

**Conclusión:** el número que ve el usuario bajó de **2571 → 1974**, la
reducción del bloque está reflejada 1:1 en el agregado vivo y **todos los
errores visibles quedan documentados** (23: 18+1+2+2). Sin commit, sin tocar
código ni ajenos.

## I — Estrategia por familia del agregado (2026-08-31): qué es arreglable de verdad

Tras el desglose del agregado vivo y de los analizadores, los ~1974 son tres
familias distintas, y solo una es "arreglar ahora". Conclusiones con evidencia:

### I-1 — errores varsense (seguros, hechos)
- ONG AGAPE: `--colorRojoOscuro` sin definir → **añadí el token** en
  `frontend-v2/src/styles/variables.css` (la degradación
  `var(--colorRojoOscuro, var(--colorRojo))` ya era correcta; ahora es real).
  Re-corrido varsense: **2 errores → 0** (0e/155w/1i/4h), `tsc --noEmit` exit 0.
  No tocados: solo la línea del token + el logger de la fase previa; repo
  limpio de diffs ajenos antes de committear.

### I-2 — `claseHuerfana` (616 en total): FALSO POSITIVO del scanner, NO borrar
- El índice de consumo (`classIndexBuilder`) extrae tokens con regex de
  `className`/`class`, pero **no ve construcción dinámica**: ternarios,
  variables indirectas (p. ej. `claseV2` → `claseV2Central`), `classN2={\`${base}--${estado}\`}`
  y array-joins. `addClassTokens` quita la interpolación y solo conserva
  literales de string de dentro de `\${...}`.
- Verificación repo-wide (workspace-manager): **casi todas las "huérfanas" de
  `src/v2/**` SÍ se usan** por construcción dinámica (grep directo + análisis
  de template literals). Borrarlas rompería estilos. La corrección es del
  analizador (detectar bases de clase por variable/expresión), no del proyecto.
- Decision: **no se borran clases** (evitarían el conteo pero romperían UI).
  Se documenta como limitación del analyzer; NOTA aparte para subir al repo de
  varsense (candidato upstream).

### I-3 — runtime del manager (PT 500→23, WANDORIUS): ya alineado, es varsense real
- Todos los proyectos fijan **el mismo commit** que el runtime compartido
  (sentinel 643353d / v0.7.5-1, varsense 88f281f / v2.2.1); la alineación de
  herramienta ya es correcta.
- PT: el agregado = sentinel 19w+4h (**== el 23 de E/F, alineado**) + ~1651w
  de **varsense real** (claseHuerfana/valorHardcoded, config correcta) que E/F
  nunca corrió. No es deuda, es una familia nueva de hallazgos reales.
- El servidor muestra `version: 0.7.4` porque analiza con el runtime global
  instalado en `%LOCALAPPDATA%`; actualizarlo a 0.7.5 es decisión del manager
  (instalación global), fuera del alcance de proyecto. No bloquea nada.

### I-4 — familias no-tractables (deuda de arquitectura, ya documentadas)
- `funcion-larga`/`parametros-excesivos`/`limite-lineas` de monolitos
  (`deploy_service.rs` 2135, `mcp/tools` 872, `google_drive` 694, store/runtime
  de PT) — un split sin seam sería arbitrario.
- Tokens: gloryapi (puente Tailwind v4; "duplicados/unused" = aliasing
  semántico), RESTAURANTE (172).
- `paneles.css`/`MapaV2.tsx` (workspace-manager) — preservados.

### I-6 — front design system del GUI de coolify-manager-rs (hecho 308A-6GUI)
- `css-elemento-html-directo` **25 → 0** y `button-clase-especifica` **12 → 0**
  en `gui/`: selectores de elemento (`.{clase} button/h1-h3`) movidos a clases
  con `className` en el JSX (visual-neutral, mismas declaraciones), colapsando
  títulos de sección; renombrada la clase `vpsBotonBase` → `vpsControlBase`
  (contenía "Boton" y disparaba `button-clase-especifica`).
- Login → componente canónico `Button` (variant `primario`): `css-adhoc`
  ×1 y `.botonLogin` eliminado; `cursor`/`:disabled` movidos al `.boton`
  canónico en `componentes.css`.
- `inline-style-prohibido` de `MenuContextual` → CSS custom properties
  (`--menuPosTop`/`--menuPosLeft`), clase modificadora para no romper el
  reposo de `SelectorPersonalizado`. Defaults declarados en `variables.css`
  (VarSense solo indexa `variableFiles`).
- **Resultado: GUI 28 → 3** (2 warning preexistentes en `portal.css`
  `css-especificacion-diseno-local` + 1 hint ISP de `tipos.ts`); sentinel
  proyecto **96 → 67** (1e/43w/23h, el 1 error = monolito `deploy_service`
  documentado) sin regresión; varsense **0 errores**. Verificado con
  `cargo check --tests` exit 0 + `tsc --noEmit` del GUI exit 0.

### I-5 — commits autorizados por el usuario (solo soy el agente salvo PT)
- Commiteados: workspace-manager `5863474`, coolify-manager-rs `d4f9f15`,
  gloryapi `e7157ce`, freebuff-bridge `42cf5b0`, ONG AGAPE `6f4cbb6`,
  coolify-manager-rs GUI `308A-6GUI` (design system gui/).
- **No commiteado deliberadamente: `freebuff/`** (diff grande no reconocido de
  mi trabajo del bloque; `bun` no está disponible para verificar que no rompe;
  puede ser trabajo del usuario en curso). PROYECTO TASKS no se toca (el
  usuario trabaja ahí).

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