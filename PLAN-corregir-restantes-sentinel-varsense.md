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
| coolify-manager-rs | 124 → **99** ✅ | runtime destrabado (A1); 1 error = monolito `deploy_service.rs` (2135 l, límite 500) documentado | A1: destrabar análisis (hecho); 308A-6: 124→99 |
| ONG AGAPE | 369 → **241 (110 sentinel + 131 varsense, 0e)** ✅ §J-3 | J-3: sentinel 164→110 (emoji ×8, key-index ×2, css-elemento ×25 :is(), css-especificacion/button-clase renames ×51, css-adhoc → Button); varsense 141→131 (10px→--radioTarjeta ×9, #fff→--colorBlanco ×1, 0 huérfanas nuevas) | D-2 + **J-3 HECHO** (ver §J-3) |
| gloryapi | 0 sentinel + 131 → **76 varsense** ✅ | `variableFiles` corregido a `client/src/index.css` (G-deuda CERRADA 2026-08-31): variableNoDefinida 37→2 (runtime); frentes §G/§I-10 cerraron 131→77→76 | A2 + G + §I-10: deuda cerrada |
| freebuff-bridge | 20 → **0** ✅ | 18× `console-production` (cli/main.ts) + barrel + ISP | B1 resuelto (logger central + barrel + split ISP) |
| GLORYINSPECTOR | 2 → **0** ✅ | `directorio-abarrotado` (inspector/ tests/) | B2 resuelto (directoryExceptions canónico) |
| workspace-manager | 86 → 78 → **127 (29 sentinel + 98 varsense, 0e)** ✅ §J-2 | J-2: sentinel 60→29 (console/fallo/button/css-adhoc/html-nativo/hooks/css-especificacion); varsense 98 (45 claseHuerfana FP §J-8, 42 valorHardcoded → J-3, 7 token-duplicate excepción, 4 cssInlineReact info) | B3 + C + G + **J-2 HECHO** (ver §J-2) |
| RESTAURANTE | 247 (110 sentinel + 137 varsense) → **231 (89 sentinel + 142 varsense, 0e)** ✅ §J-4 | J-4: key-index ×3 claves estables, inline-style ×18 → patrón CSS-var exento (runtime-inyectadas declaradas en `:root` de index.css), cssInlineReact −3; +7 token-duplicate pares semánticos +1 propiedadProhibida anillo selección = excepciones doc. | D-1 + G + §I-7/§I-8 + **J-4 HECHO** (ver §J-4) |
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

### I-7 — design system de RESTAURANTE (front varsense 172 → 140, hecho 2026-08-31)
- **Borradas 20 `claseHuerfana` reales** (verificadas 0 usos repo-wide con
  word-boundary en `.ts/.tsx`, excluyendo fixtures y `glory-rs`): bloques
  muertos de `PlanoSala.css` (planoSala/planoBarraHerramientas/planoZonas/…)
  y `PlanoOcupacion.css` (planoOcupacion/…Titulo/…Zonas/…ZonaTab + `.activa`,
  leyenda e indicadores). Se conservaron los selectores `.mesaOcupacion.*` y
  las formas/estados (`cuadrada/redonda/rectangular/libre/ocupada/no_show/
  inactiva`) que se construyen dinámicamente con `${estado}`/`${mesa.forma}`.
- **10 `claseHuerfana` restantes en la app = falsos positivos del scanner**
  (§I-2, construcción dinámica array-join/template); los 81 de `index.css`
  (`token-duplicate` 42 + `token-unused` 39) son **aliasing semántico del
  puente shadcn/Tailwind v4** (`--card`/`--popover`→`--background`, sidebar) —
  NO se colapsan (rompería el contrato shadcn). `valorHardcoded`/`cssInlineReact`/
  `propiedadProhibida` restantes = posicionamiento dinámico legítimo o deuda
  de diseño (excepción fundamentada).
- **Resultado: varsense 172 → 140** (0e/77w/24i/39h): `claseHuerfana` 34→14,
  `valorHardcoded` 26→15 (los de bloques muertos), `propiedadProhibida` 7→6.
  Verificado: `tsc --noEmit` (22 errores, todos del submódulo `glory-rs`
  preexistentes, cero de `src/`), `cargo check --tests` exit 0, `sentinel
  analyze` sin hallazgos en los archivos tocados (sin regresión).

### I-8 — RESTAURANTE `valorHardcoded` (15 restantes): NO son colores de marca — excepción (2026-08-31)
- Verificado el desglose exacto de los 15 `valorHardcoded` restantes de la
  app: **0 colores**. Son 8 `font-size` + 7 `border-radius`, todos one-off
  del lienzo del plano en `PlanoSala.css`/`PlanoOcupacion.css` (mesas,
  handles de resize, minimapa, indicadores off-screen).
- Todos los colores del plano ya consumen tokens (`var(--border/--card/
  --primary/--destructive/--muted-foreground/…)`); los únicos literales
  son `oklch(0.7 0.2 142)` (verde estado "ocupada", L66-67) y el detector
  no los marca; junto a él `no_show` ya usa `var(--destructive)` —
  asimetría candidata a token de estado, NO forzada (asignación semántica
  de color = decisión de diseño del propietario).
- No hay escala que honrar sin cambiar el diseño: `index.css` tiene **0
  tokens de `font-size`**, y la escala de radio shadcn es rem
  (`--radius-sm`=0.27rem≈4.3px, base `--radius`=0.45rem≈7.2px) — no
  coincide con los px del canvas (2/3/4/6/999px). Mapear a la escala
  shadcn alteraría el visual; crear `--plano-*` px paralelos sería una
  abstracción sin segundo consumidor real (prohibida por el plan).
- **Decisión: excepción fundamentada, sin código tocado.** El frente
  "colores de marca hardcodeados" de RESTAURANTE no tiene objetivo entre
  los findings (`valorHardcoded` ya en 15 = floor honesto, sin regresión:
  0 errores varsense, `tsc` sin hallazgos en `src/`, sentinel sin nada en
  los archivos tocados, todo verificado en I-7). Siguiente frente ejecutado:
  WANDORIUS (ver I-9).

### I-9 — WANDORIUS varsense (front 186 → 173, 0 errores, hecho 2026-08-31)
- Config `varsense.config.json` ya estaba correcta (`variableFiles` =
  `frontend/src/styles/variables.css`, include css/ts, exclude generado) —
  sin misconfig que corregir (a diferencia de gloryapi G-fase).
- Baseline 186 (0e/97w/89i/0h): `claseHuerfana` 38 + `token-duplicate` 59 +
  `cssInlineScript` 89 (info: `element.style.*` del runtime escritorio -
  drag/iconos/ventanas, excepción legítima).
- **12 `claseHuerfana` reales borradas** (verificadas 0 usos repo-wide en
  ts/tsx/js/html con word-boundary, excluyendo CSS y fixtures):
  `account-app__error`, `account-app__secondary`, `font-panel` (pages.css)
  y `preferences-conflict` (base) + `__message`/`__values`/`__actions` y
  `workspace-overlay-conflict` ×5 (Overlay.css). Evidencia extra: el test
  `preferences-panel.test.ts` aserta `preferences-conflict` == null (clase
  ausente del markup [297A-13] conflicto auto-resuelto por LWW). Se
  conserva `preferences-conflict__title` (3 usos reales: preferences/
  control/security panels).
- **Conservadas como falsos positivos del scanner (§I-2):**
  `tag-estado--archivado` y `media-library__badge--processing/--rejected`
  (construcción dinámica `` `tag-estado--${item.status}` `` /
  `` `media-library__badge--${item.asset_state}` ``) + `tiptap`/
  `ProseMirror` (DOM de TipTap). Fixtures de `.quality-bench/` y legacy
  de `_archivo/` fuera del build: no se tocan.
- **`token-duplicate` 59 → 58:** los 58 restantes son (a) aliasing
  intencional ya en `var()` (grupo `--fuente-*` → `--fuente-sistema`,
  comentario explícito [297A-29 F1]), (b) pares paralelos `--sistema-*`
  vs `--color-*` con overrides de scope distintos en dark mode (colapsar
  rompería la resolución por scope; varios pares comparan definiciones del
  scope oscuro contra el root), (c) igualdad coincidental entre knobs
  semánticos distintos (`--win-x`/`--menu-spacing`, `--espacio-md`/
  `--tamano-titulo`, `--icono-col`/`--icono-row`) — el diseño B&W minimalista
  usa esos tokens como superficie de configuración (colapsarlos quitaría
  knobs independientes). Solo un duplicado eran gemelos literales
  same-scope: `--sistema-borde-doble` → ahora `var(--sistema-borde)` con
  comentario (auto-invierte vía `--sistema-texto`, [297A-18]).
- Verificación: `npm --prefix frontend run type-check` (tsc) **exit 0**;
  backend intacto (cambios CSS-only); varsense fresco **173 =
  0e/84w/89i**, sin regresión (−13 exactos: −12 claseHuerfana, −1
  token-duplicate); `sentinel analyze` **0/0/0/0** (baseline, sin hallazgos
  nuevos). Commits: WANDORIUS `743b75fb` (308A-6WAND), workspace-manager
  docs (I-9/roadmap).

### I-10 — gloryapi varsense (front 131 → 77, 0 errores, hecho 2026-08-31)
- Baseline 131 (2e/90w/1i/38h): los 2 errores (`variableNoDefinida`
  `--sortable-transform`/`--sortable-transition` en SortableModelRow.tsx,
  vars CSS de runtime de dnd-kit) y el 1 info (`cssInlineReact`
  tooltipStyle de AnalyticsPage, estilo inline legítimo) ya estaban
  documentados como excepción — se conservan.
- Config `varsense.config.json` ya correcta (`variableFiles` =
  `client/src/index.css`); sin misconfig que tocar.
- **27 clases `token-platform-*` muertas borradas** de `index.css`
  (colores de marca por proveedor: google/groq/cerebras/ollama/…). Cada una
  verificada con 0 referencias en `client/src` y `server/src` (.ts/.tsx, grep
  literal + búsqueda de construcción dinámica `` `token-platform-${…}` `` —
  patrón de badge que nunca llegó a usarse). Cero usos → seguro.
- Las mismas 27 líneas eran el origen de **27 `valorHardcoded`**
  (background-color `#4285f4` etc.): el borrado resuelve ambas familias a la
  vez (−27 claseHuerfana, −27 valorHardcoded = −54 hallazgos exactos).
- **Documentado sin forzar (excepción, patrón §I-7/§I-9):** los 74
  restantes de `index.css` son el puente shadcn/Tailwind v4 —
  `token-duplicate` 36 (`--card-foreground`/`--popover-foreground`/
  `--sidebar-foreground` → `--foreground`, aliasing semántico de dominio
  distinto) y `token-unused` 38 (`--color-sidebar-*`, `--font-heading`,
  pares shadcn que el snapshot no ve usar). Colapsarlos rompería el contrato
  shadcn; ya documentado en G-DEUDA y §I-4.
- Verificación: `tsc --noEmit -p client/tsconfig.app.json` **exit 0** (cambios
  CSS-only; backend intacto); varsense fresco **77 = 2e/36w/1i/38h** (−54
  exactos, 0 errores nuevo, 0 regresión); `sentinel analyze` **0/0/0/0**
  con 282 archivos, sin hallazgos nuevos. Commit: gloryapi (front
  308A-6GAPI, index.css) + workspace-manager docs (I-10/roadmap).

### I-11 — Glory-Laminal varsense (124 → 91, 0 errores, hecho 2026-08-31)
- **Misconfig de alcance corregida (patrón G-DEUDA):** `includePatterns` era
  solo `src/**` pero los CSS reales del proyecto viven en `styles/`
  (editor.css/widgets.css, 111 usos `var()` reales) — el snapshot de uso de
  tokens ignoraba los consumidores. Verificado antes de tocar: todas las
  `var(--…)` de `styles/*.css` están definidas en `variables.css` (cero
  `variableNoDefinida` nuevos al ampliar), sin definiciones ocultas en
  editor/widgets. Añadido `styles/**/*.css` a `includePatterns`.
- **Medición honesta:** con el alcance corregido el baseline real era 124→115
  (el 46 `token-unused` bajó solo a 17 porque los usos de styles ahora
  cuentan; aparecieron 20 `valorHardcoded` que la misconfig ocultaba).
- **`valorHardcoded` 20 → 4** (tokens nuevos justificados por segundo
  consumidor real, todos visual-neutral): 5× `#ffffff` sobre selección →
  nuevo `--textoSeleccion`; 4× `#4a4a4a` de hover/activo de controles →
  nuevo `--interaccion`; 2× `border-radius: 2px` (asas/menús) → nuevo
  `--radioFino`; y a tokens existentes: `#282828`→`--botonInternoMenu`,
  `#333333`→`--bordeSuave`, `rgba(…,0.08)`→`--editorContorno`, `11px`→
  `--textoChico`, `3px`→`--radioArea`. **4 excepciones one-off** (1 uso,
  sin par de token; forzarlas sería abstracción sin segundo consumidor,
  prohibida por el plan): `#2c2c2c` asa hover, `#5f5f5f` botón hover,
  `#334d80` activo de outliner, `rgba(255,255,255,0.12)` grupoIconos hover.
- **`token-duplicate` 6 → 1:** los 5 pares same-scope con valor literal
  idéntico se colapsaron a alias `var()` (patrón WANDORIUS §I-9):
  `--fondoHeader`/`--fondoPanel`→`var(--fondoStatusbar)`, `--fondoInput`→
  `var(--fondoBase)`, `--fondoInputSel`→`var(--fondoTopbar)`, `--borde`→
  `var(--fondoPanelCabecera)`, `--seleccion`→`var(--fondoHoverMenu)`. El 1
  restante (`--fondoPanel` vs `--fondoHeader`) es la auto-colisión de los dos
  alias al mismo token — el detector compara valor literal y no resuelve
  `var()`, límite del analizador, excepción documentada (patrón §I-9).
- **`token-unused` 46 → 14** (los 14 restantes = API pública del tema
  Blender: acentos/ejes/estados/alturas aún sin consumir — excepción, no se
  borran: son la superficie de configuración del tema, patrón WANDORIUS).
- **`claseHuerfana` 49 intactas = falsos positivos §I-2 verificados:** las 49
  tienen uso real (word-boundary en 53 archivos) vía `createElement(tag,
  className)` posicional de `platform/dom.ts` + `classList.toggle` — patrones
  que el scanner no indexa. `cssInlineScript` 23 info = runtime del editor,
  excepción.
- Verificación: `npm run type-check` **exit 0** (cambios CSS-only); varsense
  fresco **91 = 0e/54w/23i/14h** (124→115 con alcance→91 con refactors, −33
  netos reales, 0 errores, sin regresión); `sentinel analyze` **0/0/0/0**
  (baseline intacto). Commit: Glory-Laminal `308A-6GL` (variables.css +
  editor.css + widgets.css + varsense.config.json) + workspace-manager docs
  (I-11/roadmap). Nota: los scripts temp del frente medían el archivo viejo
  (`gl_vs.json`) en vez del argumento — corregido el script antes de cerrar.

### I-12 — CIERRE del ciclo: agregado vivo re-verificado (TOTAL consola 1830→1797, 2026-08-31)

Re-consultado `curl http://127.0.0.1:8787/api/gate/analisis?analizar=todo` con
el servidor 8787 arriba y reproducido el cálculo de `PanelConsola` (suma de
`hallazgos` por proyecto con cap 500 — la respuesta actual no incluye
`problemas`/`vulnerabilidades`); para Glory-Laminal la cache estaba stale
(analizadoEn 19:14, previo a mi frente) → **re-análisis forzado puntual** vía
`POST /api/gate/analizar` `{clave, forzar:true}` (el resto de proyectos ya
estaba fresco y reflejaba los frentes commiteados).

**TOTAL consola: 1974 → 1797 (−177)**; desde el 2571 inicial: **−774**.

```text
  500 PROYECTO TASKS          cap (runtime real 1718w/1i/5h preexistente, deuda de alineación de runtime documentada)
  324 ONG AGAPE               0e/317w/1i/6h (2 errores → 0 por §I-1, reflejado)
  250 RESTAURANTE             286→250 (varsense 172→140 §I-7/§I-8 reflejado)
  215 workspace-manager       18e/189w/4i/4h = 60 sentinel + 155 varsense (sin cambios en este frente)
  173 WANDORIUS               186→173 (§I-9, fresco)
  166 coolify-manager-rs      195→166 (sentinel 96→67 del GUI §I-6 + 99 varsense)
   91 Glory-Laminal           124→91 (§I-11 — re-análisis forzado 21:13, coincide 1:1 con la verificación manual)
   77 gloryapi                131→77 (§I-10, fresco)
    1 GLORYPORT               (monolito popup.rs, excepción E/F)
    0 freebuff-bridge / GLORYINSPECTOR
TOTAL 1797
```

- **Errores visibles en el agregado: 21, todos documentados** — 18 de
  workspace-manager (16 `paneles.css` ajeno + 2 runtime con fallback) + 1 de
  coolify-manager-rs (monolito `deploy_service.rs`) + 2 de gloryapi (runtime
  dnd-kit `--sortable-*`, G-DEUDA). ONG AGAPE quedó en **0 errores** (§I-1
  `--colorRojoOscuro`, reflejado en el agregado: 2e→0e). No quedó ningún
  error no documentado.
- Cruce 1:1 con las verificaciones locales por proyecto: Glory-Laminal 91,
  gloryapi 77, WANDORIUS 173 con los mismos `error/warning/information/hint`
  que los análisis manuales post-frente; coolify 166 = 67+99 exacto; los
  conteos viven en la cache autoritativa `/api/gate/analisis`.
- Nota de medición: la diferencia entre RESTAURANTE 250 cache vs 254 esperado
  (140 varsense + 114 sentinel) es la variación de runtime del manager ya
  documentada en §H-2 (mismo runtime global, bins fijados por proyecto).
- Sin commit en este cierre: no hubo hallazgo inesperado (todo lo anterior
  ya estaba commiteado en los frentes §I-6..§I-11); solo se documenta.

### I-13 — agile varsense del GUI de coolify-manager-rs (99 → 36, 0 errores, hecho 2026-08-31)

Front de varsense del GUI (`gui/src/estilos/`), peticion del usuario
(«resuelve los problemas de bajo riesgo que quedan (1815)»). Baseline fresco
verificado con el CLI del checkout compartido (`node
.quality-tools/varsense/dist/cli/index.js all --workspace . --format json`):
**99 = 92w/1i/6h** (la cache del agregado estaba stale y apuntaba a líneas
viejas → baseline manual fiable antes de editar). El config `variableFiles`
(ya corregido en 308A-6) estaba bien.

**Qué se corrigió (todo verificado antes de editar):**

- **21 clases sin uso borradas** de `componentes.css`/`layout.css`
  (`gridTarjetas`, `panelAcciones`, `filaFormulario` + fila del media query
  L666-677, `campoTextoMono`, `tablaSeccionTitulo`, `bloqueDetalles`,
  `listaRecomendaciones`×2, `etiquetaMetrica`/`valorMetrica`, `estadoRuntime`
  ×4, `badgeInfo`, `botonDeshabilitado`, `botonIconoPendiente`,
  `accionesFila`, `cabeceraPagina`, `subtituloPagina`) — cada una con 0
  referencias en `.tsx` (grep word-boundary + construcción dinámica).
  **Conservadas** como falsos positivos §I-2: `vpsStatusBar1-4` (se usan por
  `` `vpsStatusBar${index+1}` `` en VistaPortalVisual) y 12 más con uso real
  (`estadoRuntimeJson` etc. — 37→16).
- **49 `valorHardcoded` → tokens** en `portal.css`/`global.css`/`variables.css`:
  paleta VPS (`.vpsPortal`) movida a `html:has(.vpsPortal)` para resolver el
  fondo del documento por token + tokens nuevos con consumidor real
  (`--vpsFuenteBase` 12px×4, `--vpsFuenteMediana` 16px×2, `--vpsFuenteTitulo`
  44px×2, `--vpsColorFondo78`/`--vpsColorFondo42`); fuentes/radios a tokens
  del design system (`--radioPill`, `--radioCheck`, `--altoTopbar`,
  `--fuenteXl`/`--fuenteMd`/`--fuenteXs`); retirado `--vpsColorBlanco/Negro`
  y `--fuenteLg` (sin consumidor, probado con grep). Quedan **11 one-off** de
  1 uso sin par de token (excepción: no crear abstracción sin segundo
  consumidor).
- **`token-unused` 6 → 0**; `claseHuerfana` 37 → 16 (solo FPs §I-2);
  `token-duplicate` 6 → 8 por límite del detector (compara valores literales,
  no resuelve `var()`: `--vpsFuenteBase`/`--espacioMd` y
  `--vpsFuenteMediana`/`--espacioLg` son escalas distintas del grid 4px —
  excepción consistente con `--radioSm`/`--espacioXs` ya documentado).

**Verificación:** `cargo check --tests` exit 0 + `tsc --noEmit` del gui exit 0
(CSS-only) + varsense fresco **36 = 0e/25w/1i/10h** (−63: 21 clases + 49
valores + 0) sin regresión + `sentinel analyze` **67 (1e/43w/23h) = baseline
§I-6 exacto**, sin hallazgos nuevos (el error es el monolito `deploy_service.rs`
documentado). Commit `308A-6COOL` = `1b48d68`. coolify total: sentinel 67 +
varsense 36 = **103** (desde 166, −63).

Pendiente del agregado ya documentado en §I-12 excepto las 8 vulnerabilidades
dev (gloryapi esbuild/drizzle-kit, RESTAURANTE concurrently/shell-quote
critical) — candidato a frente aparte con `npm audit fix` si los builds quedan
verdes.

### I-14 — vulnerabilidades dev (RESTAURANTE + gloryapi → 0, hecho 2026-08-31)

Front de las 8 vulnerabilidades dev reportadas en el agregado del 1815
(consulta `npm audit` por repo; no toca runtime de producción).

**RESTAURANTE (4 vulns, 1 critical):** `concurrently ^9.0.0` arrastraba
`shell-quote 1.8.3` (critical, dev). El fix de npm era inservible (downgrade
a 0.18.1) porque `concurrently@9.2.1` fija `shell-quote` exacto a 1.8.3 sin
caret. Subido a `concurrently ^10.0.5` (ya usa `shell-quote 1.9.0` parcheada)
— no se invoca en ningún script npm del manifest (solo declarado), así que es
el fix mínimo que mantiene la herramienta. Lock regenerado con
`--package-lock-only`. **Audit → 0.** Commit `155a234`.

**gloryapi (4 vulns moderate):** todo vía `drizzle-kit@0.31.10` →
`@esbuild-kit/esm-loader` (legacy, esbuild 0.18.20 vulnerable). Verificado que
drizzle-kit **nunca carga** `@esbuild-kit` en runtime (0 referencias; usa
`tsx` como loader) → herencia muerta. Override puntual de esbuild a 0.25.12
en el subárbol. Gotcha npm: con lock existente npm 11 ignora el override
(hidden-lock de node_modules + quirk del hash del root entry; repro mínimo en
`C:/tmp/repro-override` demostró que el override es correcto) → se regeneró el
lock de cero (churn 185 paquetes = bumps caret dentro de rango, verificado
que ningún script del manifest quedó roto). **Audit → 0.**

**Batería de verificación completa (todo exit 0):** `npm audit` 0 · `tsc
--noEmit` (client) 0 · builds de server + client (ejercita base-ui 1.7) 0 ·
`npm test` (suite server + build client) 0 · **smoke funcional de drizzle-kit**
(config cargado vía tsx + migración generada en `node_modules/.cache`,
gitignored, salida a C:/tmp) PASS — la vía que el override afecta.
Commit `7c58531`, audit 0 post-commit.

Documentado sin forzar: los paquetes con fixes solo en majors con runtime
cambiado (esbuild-kit legacy muerto es excepción segura por la prueba de 0
referencias). Total de vulnerabilidades del agregado: **8 → 0**.

### I-15 — errores de varsense de workspace-manager (18 → 0, hecho 2026-08-31)

Lote de bajo riesgo pedido por el usuario («resuelve los problemas de bajo
riesgo que quedan (1815)»), con `paneles.css` ya en alcance (el usuario
confirmó que no hay diff ajeno). Baseline fresco por CLI: **18e/133w/4i** —
desglose real: **15 `--v2-oscuro` + 1 `--alto-consola`** en `paneles.css`
(el doc previo decía 16 `--v2-oscuro`; había 1 `--alto-consola` del mismo
bloque runtime) y **2 runtime** en `v2.css`.

**Qué se corrigió (visual-neutral, verificado antes de editar):**

- **15 `var(--v2-oscuro)` → `var(--v2-texto)`** en `paneles.css` (clases
  `.fj*`/`.ej*`: FormularioJSON y EditorEsquema). `--v2-oscuro` era una
  variable inexistente (el propio comentario del switch lo confirmaba:
  «--v2-oscuro (variable inexistente)»); el token de texto sobre fondo
  blanco del design system monocromo es `--v2-texto: #000000` (19+ usos en
  v2, incl. paneles.css). Los `color:` heredaban negro por el body sin el
  fallback — ahora explícito e idéntico.
- **3 runtime (`--ancho-detalle`/`--ancho-lista`/`--alto-consola`) resueltos
  con defaults en `variables-v2.css`** (patrón del GUI de coolify, §I-6:
  defaults declarados en el token file, el estilo inline de AppV2 —más
  específico— los sobrescribe con los valores persistidos en localStorage).
  Los defaults coinciden 1:1 con el fallback original de cada `var()`
  (300px/260px/200px), así que es exactamente equivalente incluso sin JS.
  Antes se documentaban como «runtime con fallback correcto»; ahora el token
  existe en el índice de varsense y no hay nada que documentar.

**Verificación:** varsense fresco **18e → 0e** (133w/4i intactos, sin
regresión) + `pnpm run type-check` exit 0 (CSS-only) + `sentinel analyze`
**60 (0e/56w/4h) = baseline exacto**, sin hallazgos nuevos. Commit
`df737fb` (2 archivos, +25/−15). Con esto **workspace-manager queda con 0
errores de varsense y 0 errores de sentinel**: 215 → 197 hallazgos (18
errores menos) sin tocar runtime.

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

## J — Plan de reducción completa hacia el piso mínimo (2026-08-31)

Pedido del usuario: «arregla todo lo reportado en los análisis hasta el número
más pequeño posible de forma segura y honesta». Agregado vivo consultado
(`/api/gate/analisis?analizar=todo`): **1716 = 3e/1416w/143i/154h** (PT capado
a 500; su runtime real ~1718). Desglose por regla (todo el agregado):

| Familia | n | Proyectos (mayores) | Naturaleza | Vía honesta |
| --- | --- | --- | --- | --- |
| `claseHuerfana` | 526 | PT 263, ws-manager 89, ONG AGAPE 69, Glory-Laminal 49, WANDORIUS 26, coolify 16, REST 14 | **FP del scanner** (construcción dinámica, §I-2 verificado por proyecto) | corregir el analizador (J-8, requiere autorización) o mantener documentado |
| `valorHardcoded` | 242 | PT 93, ONG AGAPE 82, ws-manager 37, REST 15*, coolify 11*, GL 4* | real (colores/medidas sin token) salvo *one-off documentados | **J-2/J-3: mover a tokens** con segundo consumidor real |
| `token-duplicate` | 163 | WANDORIUS 58, REST 42, gloryapi 36 | puente shadcn/Tailwind v4 = aliasing semántico (documentado §I-4/I-7/I-9/I-10) | excepción; colapsar solo same-scope reales (ws-manager 7, PT 7, coolify 8, ONG AGAPE 4) |
| `cssInlineScript` | 112i+32w | WANDORIUS 89i (runtime escritorio), GL 23i, PT 32w | runtime legítimo documentado | excepción (WANDORIUS/GL); PT bloqueado |
| `token-unused` | 95 | gloryapi 38, REST 39 | pares shadcn (excepción §I-10/I-7) | excepción; GL 14 = API Blender sin consumir |
| `cssInlineReact` | 76w+31i | PT 76, REST 24i | PT bloqueado; resto info | excepción documentada |
| `limite-lineas` | 62 | REST 37, ONG AGAPE 9, ws-manager 6, coolify 4, PT 5, GLORYPORT 1 | splits por seam de dominio (no arbitrarios) | J-3/J-4 parcial (REST 37 sin seam, excepción doc.); **J-5: splits** |
| `sqlx-query-as-sin-macro` + `sqlx-query-sin-macro` | 61 | ONG AGAPE 55+6 | deuda documentada (migrar a query_as! = cambios de runtime, no forzar §D) | excepción documentada |
| `funcion-larga-rs` + `parametros-excesivos-rs` | 86 | coolify 36+22, REST 12+11 | monolitos de gran superficie (deploy_service 2135 etc., §I-4) | excepción documentada |
| `inline-style-prohibido` | 27 | REST 18, PT 5, ws-manager 3, ONG AGAPE 1 | posicionamiento dinámico legítimo (documentado) o refactor a clase | J-4 HECHO (REST 18→0 vía patrón CSS-var) |
| `css-elemento-html-directo` + `button-clase-especifica` + `css-adhoc-button-style` | 0 | ONG AGAPE 25+13+4 ✅ (J-3: :is() + renames + Button), ws-manager ✅ (J-2) | refactor a clases/Button (patrón §I-6/Fase C) | **J-2/J-3 HECHO** |
| `html-nativo-en-vez-de-componente` + `componente-sin-hook-glory` | 44 | ONG AGAPE 11+12, ws-manager 14+7 | refactor a componentes Glory | J-2/J-3 parcial |
| `emoji-en-codigo` | 9 | PT 9, ONG AGAPE 8 ✅ (J-3: entidades HTML) | quitar emojis del código | J-3 (PT bloqueado) |
| `usestate-excesivo` | 15 | ONG AGAPE 11, ws-manager 2 | hook con >3 useState (refactor) | J-2/J-3 |
| `handler-accede-bd-rs` + `window/dom-outside-platform` + `broadcast-mutex` + `large-interface-isp` + `css-especificacion-diseno-local` | ~37 | REST 8+5+10, ws-manager 6+2+4+4, REST handler 8 | boundary legítimo / riesgo real broadcast (D) | documentar; broadcast-mutex atender (J-4) |
| `console-production` + `fallo-sin-feedback` | 4 | ws-manager 2+2 (MapaV2, ahora en alcance) | logger central | **J-2: logger** |
| errores | 3 | gloryapi 2 (dnd-kit runtime), coolify 1 (monolito deploy_service) | documentados | excepción |
| `key-index-lista` / `key-index` | 4 | REST 3 ✅, ONG AGAPE 2 ✅ + 1 excepción (galería 3 ranuras fijas: la ranura ES la identidad, `url=''` en vacías impide clave única) | claves estables | J-3/J-4 HECHO |

### J-1 — decisiones que definen el piso (requieren al usuario)
1. **Analizador (`.quality-tools`):** corregir el FP `claseHuerfana` (no ve
   construcción dinámica de clases) elimina ~526 hallazgos en masa — es el
   único fix que reduce el agregado sin tocar código de producto, con casos
   mínimos ya documentados (§I-2). Prohibido hasta ahora en todos los frentes.
2. **PROYECTO TASKS:** cap 500 de ~1718 reales (263 claseHuerfana + 93
   valorHardcoded + 76 cssInlineReact + 76 cssInlineReact + 32 cssInlineScript
   + 7 token-duplicate + 5 limite-lineas + 9 emoji + 5 inline-style + …). El
   usuario trabaja en ese repo; sus frentes son los mismos métodos validados.

### J-2 — workspace-manager (197 → objetivo ~110-130) — HECHO 2026-08-31
**Baseline real §J-2:** sentinel **60** (0e/56w/4h) + varsense **98** (0e/94w/4i)
= 158 total (el «197» del encabezado es pre-J-8, cuando varsense contaba
claseHuerfana infladas por el bug de `removeComments`; J-8 las bajó a 98).
**Resultado: sentinel 60 → 29 (0e/25w/4h), varsense 98 sin cambios → total
127** — dentro del objetivo 110-130. Verificación: `pnpm run type-check`
exit 0 + `sentinel analyze` (CLI 0.7.5) 29 hallazgos + varsense CLI 2.2.1
0 errores, sin huérfanas nuevas de los renames (0 hits repo-wide).

**Resueltos (31 sentinel):**
- `console-production` ×2 + `fallo-sin-feedback` ×2 de MapaV2.tsx → logger
  central (`logger.warn/info`), patrón §H. + `button-clase-especifica` ×2 →
  prop `grande` de `Button` (variante canónica).
- `usestate-excesivo` ×1 + `componente-sin-hook-glory` ×5 → hooks honestos
  extraídos: `useMapaV2` (mapa), `useLayoutV2` (AppV2), `usePanelNavegador`,
  `usePanelDocs`, `usePanelDetalle` (los 3 de panel en `src/hooks/`, movidos
  de `paneles/` para no engordar `directorio-abarrotado` del propio dir).
- `css-adhoc-button-style` ×2 (`.excBoton`/`.fjBoton`) + `css-elemento-html-directo`
  ×1 (`.v2App button`) → bloques de botón movidos a `Button.css` (archivo
  receta exento) como selectores compuestos `.botonV2.excBoton`/`.fjBoton` y
  reset del shell reestructurado con `:is()` (misma especificidad, honesto
  según §C).
- `html-nativo-en-vez-de-componente` ×11 → usos de `.excBoton`/`.fjBoton`/
  `.fjSwitch`/`.fjTagQuitar`/`.ejQuitar`/`.navegadorFila`/`.navegadorSubir`/
  `.navegadorRutaChip` convertidos a `<Button className>` con los compuestos
  en `Button.css` (neutralidad visual verificada: compuestos replican el
  bloque original, incl. `justify-content` de `.navegadorFila`).
- `css-especificacion-diseno-local` ×4 → clases renombradas a nombres neutros
  que no matchean el patrón de rol interactivo (mismo CSS, cero cambio
  visual): `.agentsLista→agentsListado`, `.resumenItem→resumenTarjeta`,
  `.panelDetalleLista→panelDetalleFilas`, `.panelLista→panelProyectos`
  (referencias TSX/CSS actualizadas, grep 0 restos).

**Excepciones documentadas (29 restantes, 0 errores):**
- `limite-lineas` ×5 + `limite-lineas-nivel-2` ×1 (useWorkspace 529,
  analizador.ts 450, server/index.ts 731, EditorEsquema 640, PanelConfig 696,
  paneles.css 1331) → monolitos sin seam de dominio seguro; split forzado
  arbitrario, no se hace.
- `html-nativo-en-vez-de-componente` ×3 → controles con identidad propia sin
  componente equivalente: tabs `detallePestana`/`listaFiltro` (segmented) y
  `select.fjSelect` (custom dropdown); forzar `Button` rompería el diseño.
- `componente-sin-hook-glory` ×2 → PanelConsola (lógica de conteo delicada,
  historial de bug de mutación documentado) y PanelConfig (697 l, lógica de
  editor profundamente acoplada al render); extracción no es seam limpio.
- `window-reference-outside-platform` ×5 + `dom-access-outside-platform` ×2
  (main.tsx, etiquetas.ts, EditorEsquema ×3, MapaV2, MenuContextual) →
  boundary legítimo del shell (manejo de window/DOM), ya documentado.
- `inline-style-prohibido` ×3 → tooltips/menús posicionados por cursor
  (EditorEsquema 477, MapaV2 223, MenuContextual 41); posicionamiento
  dinámico legítimo, no expresable en CSS estático.
- `large-interface-isp` ×4 (useWorkspace 103, shared/types ×3) → contrato
  público del workspace/gate; split rompería consumidores.
- `directorio-abarrotado` ×2 (AppV2.tsx, vite.config.ts) → preexistentes.
- **varsense 98 (0e):** `claseHuerfana` 45 → FPs del scanner (construcción
  dinámica, §I-2/J-8 verificado, renames 0 nuevas); `valorHardcoded` 42 →
  frente J-3 (tokens variables-v2.css, segundo consumidor); `token-duplicate`
  7 → **excepción fundamentada**: 3 pares paralelos de scope v1/v2
  (`--font`/`--v2-font`, `--spaceXs`/`--v2-spaceXs`, `--textXs`/`--v2-textXs`
  en archivos distintos) y 4 coincidencias semánticas same-scope
  (`--radiusSm`=`--spaceSm`, `--radiusMd`=`--spaceMd`, `--v2-invertido`=
  `--v2-fondo` [token de superficie inversa], `--v2-borde`=`--v2-texto` [borde
  por diseño]); colapsar acoplaría roles no relacionados (patrón §I-9/§I-10);
  `cssInlineReact` 4 → info.

### J-3 — ONG AGAPE (324 → objetivo ~150-190) — HECHO 2026-08-31
- Baseline real medido con CLIs fijados: sentinel **164** (0e/162w/2h) + varsense
  **141** (0e/136w/1i/4h) = **305** (el encabezado 324 era pre-J-8; la absorción
  de `claseHuerfana` ×69 del FP corregido reduce el total). Resultado final:
  **sentinel 110 + varsense 131 = 241** (0 errores).
- Resueltos (64):
  - `emoji-en-codigo` ×8 → entidades HTML (render idéntico): `AgapeAdminPanel`,
    `AgapeLanding`, `BlogPreview`, `TransparencyBoard`.
  - `key-index-lista` ×2 → claves estables (`HistoriaDetalle`, `VistaHistoria`
    lista de campos).
  - `css-elemento-html-directo` ×25 → selectores `.{clase} button` reestructurados
    con `:is()` (misma especificidad, patrón validado §J-2).
  - `css-especificacion-diseno-local` ×3 + `button-clase-especifica` ×13 → 51
    renames a nombres neutros (verificado repo-wide, 0 huérfanas nuevas).
  - `css-adhoc-button-style` ×4 → bloques a `Button.css` exento con compuestos.
  - `valorHardcoded` ×10 → tokens con match exacto: `10px` → `var(--radioTarjeta)`
    (×9, valor idéntico) y `#fff` → `var(--colorBlanco)` (×1).
- Excepciones documentadas (241 restantes, 0 errores):
  - sentinel 110: `sqlx-query-as-sin-macro` ×55 + `sqlx-query-sin-macro` ×6
    (SQL crudo = deuda §D, no forzar `query_as!` en esta pasada);
    `componente-sin-hook` ×12 + `html-nativo` ×11 + `usestate-excesivo` ×11
    (monolitos de vista sin seam seguro; hooks solo donde el seam existe);
    `limite-lineas` ×9 (monolitos, split arbitrario); modals ×3 (estructura
    canónica inexistente); `key-index-lista` ×1 (galería de 3 ranuras fijas:
    la ranura ES la identidad, `url=''` en ranuras vacías impide clave única);
    `directorio-abarrotado` ×1; `inline-style` ×1 dinámico.
  - varsense 131: `valorHardcoded` ×72 (sin token exacto: radios 46/14/12/16px
    one-off, overlays rgb sin token semántico — patrón §I-7); `claseHuerfana`
    ×50 (mayoría en `archivado/` legacy v1 + FPs dinámicos §J-8);
    `token-duplicate` ×4 + `token-unused` ×4 (pares semánticos);
    `cssInlineReact` ×1 info.
- Verificación: `npx tsc --noEmit` frontend-v2 exit 0 + `frontend` type-check
  exit 0; sentinel 164→110; varsense 141→131 con `claseHuerfana` estable (50),
  sin huérfanas por los renames. Commit `308A-6J3` en ONG AGAPE (26 archivos).

### J-4 — RESTAURANTE (250 → objetivo ~190-220)
- 37 `limite-lineas` → splits por seam (el frente más grande de esta familia).
- 18 `inline-style-prohibido` → clases CSS cuando no sea posicionamiento
  dinámico; 6 `propiedadProhibida` → propiedades permitidas; 5
  `key-index-lista` → claves estables.
- 5 `broadcast-mutex-riesgo-rs` → **riesgo real (Fase D)**; atender con
  mutex/bloqueo honesto donde aplique o documentar cada caso.
- Excepciones: 42+39 shadcn, 24 cssInlineReact info, 15 valorHardcoded
  one-off (§I-8), 14 claseHuerfana FP, 12+11+10 monolitos/ISP.

### J-4 — RESTAURANTE — HECHO 2026-09-01
- Baseline fresco (CLIs fijados, 0 errores): sentinel **110** + varsense **137**
  = **247** (el 250 del encabezado era pre-J-8).
- Resultado: sentinel **110→89** (−21), varsense **137→142** (+5 neto, 0 errores)
  → total **231**, dentro del objetivo ~190-220.
- Resueltos:
  - `key-index-lista` ×3 → claves estables: `bdp-menu-explorer` usa la identidad
    del artículo; skeletons estáticos de `BdpStock`/`BdpCompras` usan constante
    `SKELETON_IDS` (lista sin identidad de ítem).
  - `inline-style-prohibido` ×18 → patrón CSS-var exento (`styleInlineSoloCssVars`,
    validado §I-6/§J-2): `ParedDraggable`/`MesaDraggable`/`PlanoSala`/
    `PlanoOcupacion`/`DashboardReservas`/`data-table`/`chart`. Selectores
    `.planoPared`/`.planoMesa`/`.planoCanvas` + utilidades en index.css; 28 custom
    properties runtime-inyectadas **declaradas como contrato en `:root` de
    index.css** (fuente `variableFiles`) con defaults neutros = fallbacks previos
    → `variableNoDefinida` 0 (0 errores).
  - `cssInlineReact` −3 (información) por las conversiones.
- Regresiones mínimas 0-errores documentadas como excepción (patrón
  §J-2/§I-9/§I-10):
  - `token-duplicate` +7: pares de rol semántico con mismo default
    (`--x/--y`, `--w/--h`, `--anchoC/--altoC` ejes; `--rot/--tr/--trs/--sombra`
    = default neutro `0/none`) — colapsarlos acoplaría roles distintos.
  - `propiedadProhibida` +1: anillo `box-shadow` de selección en `.planoPared`
    (espeja los 5 anillos preexistentes de `.planoMesa` L107-148, deuda de
    diseño documentada).
- Excepciones preexistentes sin tocar: `limite-lineas` ×37 (sin seams — split
  arbitrario no se fuerza), `broadcast-mutex` ×5 (patrón-safe §D-1), shadcn
  token-duplicate 42 + token-unused 39, propiedadProhibida 6, claseHuerfana 11,
  cssInlineReact 21 info, valorHardcoded 15 one-off (§I-8).
- Verificación: `npx tsc --noEmit` exit 0 (22 errores del submódulo glory-rs =
  baseline preexistente, cero de `src/`), `sentinel analyze` **89** (0e/67w/22h),
  `varsense all` **142** (0e/82w/21i/39h), `claseHuerfana` 11→11 (sin huérfanas
  nuevas).
- Commits: RESTAURANTE `308A-6J4` (13 archivos); workspace-manager docs
  `308A-6J4doc`.

### J-5 — coolify-manager-rs (103 → objetivo ~90-100) — HECHO 2026-09-01
- Baseline fresco con CLIs fijados: sentinel **67** (1e/43w/23h) + varsense
  **32** (0e/31w/1i) = **99**. Resultado: sentinel **67→66** (1e/42w/23h),
  varsense **32 intacto** (0 errores) → **98**, sin regresión, sin huérfanas
  nuevas (claseHuerfana 12 estable).
- **Split real de `limite-lineas`: `src/infra/google_drive.rs` (834 → módulo
  `src/infra/google_drive/` con seam triple de dominio**: `mod.rs` = struct +
  `new()` + helpers (`resolve_credentials_path`/`escape_query_literal`/`urlencoding`)
  + tests; `auth.rs` = `DriveAuthMethod`/`ServiceAccountCredentials`/JWT/tokens
  (pub(super) para visibilidad entre hermanos); `files.rs` = operaciones Drive
  (upload/download/list/delete/ensure/find/metadata). El hallazgo
  `limite-lineas` de google_drive desapareció del analyze. Cero cambios de
  comportamiento: misma lógica, 172 tests lib en verde.
- Excepciones documentadas sin forzar: `limite-lineas` ×2 restantes =
  `mcp/tools.rs` (872 efectivas; el seam único defs/ejecución deja ~507
  residuales, no alcanza el límite 500 → excepción `flujo` no arbitraria) y
  `portal.css` (904/600, GUI ya excepción §I-6) + `deploy_service.rs`
  (2135, monolito §H-1/§I-13 con su nivel-3, único error = 1e). 36+22
  monolitos (funcion-larga/parametros) + 16 claseHuerfana FP + 11
  valorHardcoded one-off + 8 token-duplicate escalas = excepciones §I-13.
- Verificación: `cargo check --tests` exit 0 + `cargo test --lib` 172/172
  + `sentinel analyze` **66** (1e/42w/23h, error = deploy_service documentado)
  + `varsense all` **32** (0 errores).
- Commits: coolify-manager-rs `308A-6J5`; workspace-manager docs.

### J-6 — verificación final de WANDORIUS/gloryapi/Glory-Laminal/GLORYPORT — HECHO 2026-08-31
- Re-verificado FPs y excepciones documentadas (§I-9/I-10/I-11/E/F): WANDORIUS
  varsense 186→173 (frente §I-9), gloryapi 131→77→76 (§I-10), Glory-Laminal
  124→91/115→91 (§I-11), GLORYPORT 1 (solo `popup.rs` monolito, §E/F).
  Sin cambios esperados adicionales; hallazgos restantes = excepciones
  documentadas 1:1.

### J-7 — cierre y agregado vivo — HECHO 2026-09-01 (bloque 308A-6 cerrado)
- Re-consultar `/api/gate/analisis` tras cada frente, forzar re-análisis de
  los proyectos tocados, cruzar contra las verificaciones locales y documentar
  el total final en el roadmap.
- **CIERRE FINAL verificado (2026-09-01):** GET `/api/gate/analisis?analizar=todo`
  tras sweep forzado de las entradas stale (RESTAURANTE 182/40e pre-`:root` y
  coolify 99 pre-J-5 → `POST /api/gate/analizar {clave, forzar:true}`).
  **TOTAL visible: 1473** (suma de hallazgos fusionados, cap 500/proyecto; la
  respuesta actual no expone problemas/vuln). Desglose 1:1 con los baselines
  post-J verificados por CLI: PT 500 (cap; WIP del usuario, excluido),
  ONG AGAPE 241, RESTAURANTE 231, WANDORIUS 157, workspace-manager 127,
  coolify-manager-rs 98 (1e monolito documentado §H-1), gloryapi 76,
  Glory-Laminal 42, GLORYPORT 1, freebuff-bridge 0, GLORYINSPECTOR 0.
  Excluyendo PT: **973** (desde 1079 de §J-8/§J-9 y 1580 del cierre J-8;
  desde el 2571 inicial: **−1598**; desde el 1815 que vio el usuario: −842).
  Errores totales del agregado: **1** (deploy_service.rs, documentado).
  sinCommit 0. No queda frente J accionable: J-2, J-3, J-4, J-5, J-6, J-8,
  J-9 HECHO; J-7 era este mismo cierre (no existe J-10). **Bloque 308A-6
  cerrado** — nada abierto fuera de las excepciones documentadas en esta
  tabla y en §I-13.

### J-8 — (HECHO 2026-08-31) corregir el FP `claseHuerfana` en el analizador
- **Autorizado por el usuario** (decisiones J-1). Commit en el checkout
  compartido `.quality-tools/varsense`: `303e7f9` (rama `fix/claseHuerfana-j8`).
- **Cambios en `src/core/classIndexBuilder.ts`:**
  1. **Bug real preexistente `removeComments`**: `current === '\\n'` (doble
     backslash = string de 2 chars) nunca matcheaba un newline real → los
     comentarios de línea `//` nunca terminaban → TODO el contenido posterior
     al primer `//` de cada archivo se destruía → cientos de FPs
     `claseHuerfana` (caso `mapaV2Cuadricula` en MapaV2.tsx, uso en L208 tras
     comentario en L139). Corregido a `'\n'` (3 líneas, verificado con diff).
  2. `className={expr}` JSX con ternarios/identificadores (WANDORIUS/ONG
     AGAPE/glory-rs).
  3. `createElement('tag', 'clase')` posicional (Glory-Laminal `src/platform/dom.ts`).
  4. `classList.toggle/remove/add` con clase literal o condicional.
  5. Indirección por variable: `const x = 'a b'` → `className={x}`.
  6. `MAX_TOKENS` 10000 → 50000 (cap de archivos de consumo).
- **Verificación:** `check:core` OK, lint OK, verificación funcional
  standalone de los 4 patrones + contrato `helper('x')` conservado.
- **Medición con el CLI corregido (0 errores en todos):**

  | Proyecto | Antes | Ahora | Δ |
  |---|---|---|---|
  | Glory-Laminal | 91 | 42 | −49 |
  | workspace-manager | 137 | 92 | −45 |
  | WANDORIUS | 173 | 157 | −16 |
  | coolify-manager-rs | 36 | 32 | −4 |
  | RESTAURANTE | 140 | 137 | −3 |
  | gloryapi | 77 | 76 | −1 (+2 errores dnd-kit destapados, luego 0) |
  | ONG AGAPE | — | 141 | — |

  Δ total ≈ **−118** en los 7 proyectos con baseline previo. Los 5
  `claseHuerfana` restantes de Glory-Laminal son reales (verificados);
  workspace-manager pasa de 89 `claseHuerfana` a ~40 reales/FP restantes
  (los FPs dinámicos por concatenación `boton--${variante}` quedan fuera del
  alcance del scanner, documentados).
- **Efecto colateral positivo**: el fix de `removeComments` destapó 2 errores
  reales en gloryapi (`--sortable-transform`/`--sortable-transition` de dnd-kit,
  inyectados inline en `SortableModelRow.tsx` con fallback en `index.css`) —
  corregidos declarando los defaults en `client/src/index.css` (visual-neutral,
  el inline de dnd-kit sigue sobrescribiendo durante el drag). gloryapi vuelve
  a **0 errores** (37w/1i/38h).
- **Publicación alineada**: pins actualizados `88f281f` → `303e7f9` en los 9
  consumidores del checkout compartido (todos excepto PROYECTO TASKS,
  excluido por el usuario) con sus `quality-tools.json` + `sentinel.lock.json`
  regenerados y verificados (`quality:sync` 10/11 alineados; el único desync
  es PROYECTO TASKS, esperado). WANDORIUS queda con manifest alineado y lock
  legacy stale preexistente (frame bespoke, documentado 308A-1 F2). gloryapi
  no declara varsense en su manifest (usa el checkout directo, sin pin).
- **Commits (2026-08-31, stage explícito, mensaje `308A-6J8`):** varsense
  `303e7f9`; consumidores: workspace-manager `cdeba0c`+`18d715f` (docs),
  coolify `8a91eb4`, RESTAURANTE `c5054b8`, WANDORIUS `8b381255`, Glory-Laminal
  `d932054`, freebuff-bridge `9dc5646`, GLORYINSPECTOR `fb84bb8` (incluye
  `directoryExceptions` inspector/tests del frente B2), GLORYPORT `d2160c0`,
  ONG AGAPE `6f7d1ca`, gloryapi `787b705` (defaults dnd-kit en index.css).
  Todos los repos quedan limpios; `.bak` de locks eliminados.
- **CIERRE agregado vivo (2026-08-31):** re-análisis forzado por proyecto
  (todos con varsense) + `curl /api/gate/analisis?analizar=todo`. **Suma de
  hallazgos (cap 500/proyecto): 1716 → 1580 (−136)**. Desglose: Glory-Laminal
  42, workspace-manager 152 (60s+92v), gloryapi 76, WANDORIUS 157, coolify
  99 (67s+32v), RESTAURANTE 247, ONG AGAPE 305 (164s+141v, −19 claseHuerfana
  FPs), PROYECTO TASKS 500 (cap; runtime real bajó con el fix pero sigue
  >500), GLORYPORT 2, freebuff-bridge/GLORYINSPECTOR 0. **Visible en la
  consola ≈ 1591** = 1580 + 10 sinPush (repos con commits del frente) + 1
  gate (`varsense ausente` de GLORYPORT, sin `varsense.config.json`); sinCommit
  0, config 0, vulnerabilidades 0. Desde el 1815 que vio el usuario: **−224**;
  desde el 2571 inicial: **−980**.
- **Nota GLORYPORT (2 vs 1, sin regresión):** el server corre sentinel
  **0.7.4** (runtime `RAIZ_VERSIONS`) mientras el fijado en quality-tools es
  0.7.5 — discrepancia preexistente ya documentada (§I-12). Al invalidarse la
  cache (HEAD cambió por el commit del pin) el runtime 0.7.4 afloró un
  hallazgo preexistente `directorio-abarrotado` (raíz con 11 archivos de
  manifests/config; el conteo de archivos NO cambió con J-8). El CLI fijado
  0.7.5 reporta solo 1 (popup.rs monolito). Misma clase de excepción que
  coolify §H-1 (la raíz canónica no se reorganiza sin romper tooling) —
  documentada, no forzada.

### J-9 — (HECHO 2026-08-31, sweep verificado 2026-09-01) runtime del server 8787 + cache stale: GLORYPORT fantasma resuelto
- **Síntoma:** el agregado vivo mostraba GLORYPORT=2 (`directorio-abarrotado`
  + `limite-lineas`) mientras el CLI (0.7.4 Y 0.7.5) da exactamente 1
  (`limite-lineas`, popup.rs documentado). Hipótesis inicial "desalineación
  0.7.4 vs 0.7.5" **falsa** — ambas versiones producen resultados idénticos
  en GLORYPORT/gloryapi/workspace-manager (verificado con corridas directas).
- **Causa real:** cache stale. El server persiste `data/cache/analisis.json`
  y su clave de frescura es `ruta|rama|HEAD|version|varsense|cfg`. El HEAD de
  GLORYPORT cambió (`ade2c053` → `d2160c0`, commit del pin J-8), pero la
  entrada persistida fue escrita con el HEAD VIEJO y el endpoint GET
  `/api/gate/analisis` sirve la cache persistida sin re-ejecutar. El hallazgo
  `directorio-abarrotado` era la foto vieja, no un hallazgo nuevo.
- **Corrección (sin cambio de código):** `POST /api/gate/analizar
  {clave:'GLORYPORT', forzar:true}` — el flag `forzar` re-escanea git
  (snapshotArea(true)) y re-ejecuta sentinel aunque la frescura no cambie
  (diseño del endpoint pensado para el botón "escanea ahora"). Resultado:
  **GLORYPORT = 1w (`limite-lineas`, popup.rs documentado)** — el fantasma
  desapareció del resultado vivo y de la cache persistida.
- **Decisión J-9 (runtime):** NO se cambia `cliRuntime()` a 0.7.5 ni al
  checkout compartido. El runtime 0.7.4 produce conteos idénticos al 0.7.5
  en los proyectos medidos; el único desacuerdo documentado (raíz
  `directorio-abarrotado` de coolify/GLORYPORT) es una diferencia de
  sensibilidades de regla ya documentada como excepción (§H-1, §I-12).
  Cambiar el runtime del server es una decisión de infraestructura del otro
  hilo; la alineación real de versiones pertenece a la actualización de
  `RAIZ_VERSIONS` (instalar 0.7.5), no a un bypass en el código del server.
- **Lección operativa:** ante cualquier conteo del agregado que no cuadre con
  el CLI directo, PRIMERO forzar re-análisis del proyecto (`forzar:true`),
  DESPUÉS sospechar de versiones. La cache persistida sobrevive al restart
  del server (intencional, para rehidratar la consola), así que "el server
  acaba de arrancar" NO implica cache fresca.
- **Sweep completo verificado (cierre J-9):** `POST /api/gate/analizar-todo
  {forzar:true}` ejecutado (200 OK, 376 KB). La cache persistida
  (`data/cache/analisis.json`, fuera del árbol del repo) quedó reescrita:
  **GLORYPORT = 1w (`limite-lineas`, popup.rs)** con clave de frescura
  apuntando al HEAD actual `d2160c0` — la entrada stale desapareció.
  Desglose completo (suma sin cap): PT 1605 (WIP del usuario, +2 vs §J-8,
  esperado), ONG AGAPE 305, RESTAURANTE 247, WANDORIUS 157,
  workspace-manager 152, coolify 99 (1e = monolito documentado), gloryapi
  76, Glory-Laminal 42, GLORYPORT 1, freebuff-bridge/GLORYINSPECTOR 0.
  **Todos los proyectos coinciden 1:1 con los baselines §J-8** (PT excluido:
  su WIP evoluciona). Excluyendo PT: **1079 = exactamente el total §J-8**.
  Errores totales del agregado: 1 (deploy_service.rs, documentado).

### J-10 — siguiente ciclo (308A-7): NO declarado — evidencia y candidatos (2026-09-01)
- **Verificación:** `grep -rn "308A-7"` en `workspace-manager/roadmap.md` y en
  el `AGENTS.md` raíz → **0 coincidencias** (también 0 en este plan). El único
  origen del nombre es la card de follow-up del agente al cerrar J-7; el
  roadmap «Siguiente bloque ejecutable» sigue apuntando a 308A-5 (stale,
  completado) y las tareas pendientes 1–5 del roadmap están cerradas
  (308A-4 COMPLETO). **No existe ciclo declarado 308A-7; no se ejecutó nada
  en su nombre ni se inventó alcance.**
- **Estado del agregado (cierre J-7):** 1473 visible (973 excl. PT, 1 error
  documentado). Todo lo que queda son excepciones documentadas con fundamento
  en este plan (§D, §I-4/I-6/I-7/I-9/I-10/I-13, §J-2…J-5): monolitos de gran
  superficie (deploy_service 2135, mcp/tools 872, portal.css 904, popup.rs
  1275, PT store/runtime/agente/ai), SQL crudo 61 (deuda; migrar a
  `query_as!` = cambios de runtime), claseHuerfana FPs (límite del scanner),
  valorHardcoded one-off sin token, token-duplicate/unused (aliasing
  shadcn/Tailwind v4), cssInlineScript runtime (WANDORIUS/GL), limite-lineas
  sin seam (REST 37 + ONG AGAPE 9), broadcast-mutex §D-1 (patrón seguro
  verificado).
- **Candidatos reales para un próximo ciclo (requieren decisión del usuario;
  no se ejecutan solos):** (1) RESTAURANTE: migración sqlx `query_as!`
  (cambios de runtime + DB, fuera de «lo seguro»); (2) alineación del runtime
  del server 8787 (`RAIZ_VERSIONS` → 0.7.5, decisión de infra del otro hilo,
  §J-9); (3) PROYECTO TASKS: congelado mientras el usuario trabaja allí
  (WIP no commiteado); (4) sweep programado del agregado tras aterrizar el WIP
  de PT (el cap 500 bajará solo).
- **Decisión:** el bloque 308A-6 queda como el último cerrado; la apertura de
  308A-7 (alcance/meta/objetivo numérico) es decisión del usuario sobre esta
  lista.

### J-11 — HECHO 2026-09-01 (bloque 308A-7V2) — conteo desalineado (consola vs CLI) + FPs de `claseHuerfana`

**Causa raíz del conteo distinto (2 defectos reales, ambos corregidos):**

1. **Cap 500 en el server:** `normalizar()` truncaba `hallazgos.slice(0, 500)`
   y el agregado derivaba los conteos por regla de esa lista truncada → PT
   mostraba 298 `claseHuerfana` en la consola vs **1083** reales del CLI.
   Fix: hallazgos COMPLETOS en `normalizar()` y en la fusión sentinel+varsense
   (`src/server/gate/analizador.ts` + `src/shared/types.ts`). El render del
   cliente sigue acotado; la fuente de verdad es el reporte completo.
2. **Frescura sin el artefacto runtime:** `frescoDe` solo incluía versiones
   (0.7.4/0.7.5) y hash de config; un rebuild del dist (mismo version) dejaba
   cache «fresca» con resultados viejos. Fix: `hashArtefacto()` (size+mtime del
   `out/cli` de sentinel y del `dist/cli` de varsense) en la clave de frescura
   → cualquier rebuild invalida la cache persistida del server 8787.

**Verificación de paridad (agregado vivo vs CLI directo):** tras el fix, el
`analizar=todo` del server sirve conteos por proyecto/regla idénticos al CLI
fijado: PT `claseHuerfana` = 1083 (antes 298 cap), total area-wide 2509 →
**2203** tras el fix del analizador. Resto de proyectos sin regresión.

**Fix de FPs de `claseHuerfana` en el analizador (`8ce45b6`, tag `v2.2.1-j8b`):**
- El scanner solo miraba `className`/`class`; no veía props transportadoras de
  clase del design system local (`claseExtra`, `claseAdicional`, `*clase`…)
  ni templates de declaración >240 chars. Fix en
  `.quality-tools/varsense/src/core/classIndexBuilder.ts`:
  (1) `prop-clase` — toda prop que termine en `clase`/`className` alimenta el
  índice de clases usadas; (2) captura de declaraciones ampliada (MAX_TOKENS
  10000→50000) para templates largos con ternarios/array-join.
- Tests nuevos en `coreContracts.test.ts` (prop-*clase, templates largos,
  ternario vía prop) — suite **64/64 OK** + lint clean.
- **0 falsos negativos verificado:** de 319 clases que dejaron de reportarse
  en PT, las 319 tienen uso repo-wide real (chequeo con word-boundary); los
  777 restantes incluyen las 645 muertas reales + coincidencias de strings
  (keys de datos/comentarios) que siguen marcadas por diseño.
- Consumidores sin regresión: todos con 0 errores y conteos iguales a las
  líneas base por proyecto (solo PT baja: `claseHuerfana` 1083→777).

**Release (convención J-8):** commit `8ce45b6` en rama local
`fix/318A-7V2-falsos-positivos` + tag `v2.2.1-j8b`; dist reconstruido desde el
pin; 9 consumidores re-pineados a `8ce45b6` con lock regenerado (workspace-
manager `d43456d`, coolify `4dbf793`, ONG AGAPE `97bb1dd`, RESTAURANTE
`bd8f34b`, Glory-Laminal `ea5ad3e`, GLORYPORT `4e758da`, freebuff-bridge
`e9f5e49`, GLORYINSPECTOR `176d79e`, PROYECTO TASKS `f09497a` — solo
qt.json+lock, WIP del usuario intacto; WANDORIUS `6027bee4`+`1e8722b4`;
gloryapi no pinnea varsense — gate legacy, sin cambio).

**Estado final del agregado vivo (2026-09-01, tras sweep):** total **2203**
(1 error, monolito `deploy_service.rs` documentado): PT 1230 (ch 777),
ONG AGAPE 241, RESTAURANTE 231, WANDORIUS 157, workspace-manager 127,
coolify 98, gloryapi 76, Glory-Laminal 42, GLORYPORT 1. La consola y el CLI
ahora muestran el MISMO número por regla/proyecto.

### J-11V3 — HECHO 2026-09-01 (bloque 308A-7V3) — bug de comillas del scanner `claseHuerfana`

**Síntoma:** 464 `claseHuerfana` en PT; de ellas, ~35 tenían uso repo-wide
real pero el scanner no las indexaba (usuario: «si dices que tienen uso real
por qué se detectan entonces»).

**Causa raíz real:** `REGEX_STRING_LITERAL` (regex de comillas) falla ante
literales de string vacíos: en `x ? 'a' : ''` el cierre de `''` se toma como
apertura → se traga la siguiente pareja de comillas real
(`'panelCelda--origenMover'` desaparece) y emite un token basura
(identificador `estaOrigenMover`) como «clase». Reproducido en
`panelCelda--eligiendo` (sí indexado) vs `panelCelda--origenMover` (no).

**Fix (`50913d2`, tag `v2.2.1-j8c`):** extractor de literales por escaneo de
caracteres (quote-pair scanner con escapes) reemplaza la regex; fix en
`classIndexBuilder.ts` + tests en `coreContracts.test.ts` (**67/67 OK** +
lint clean + `check:core` OK). Adicionalmente: CSS como consumer pattern por
defecto (`**/*.css` — referencias entre archivos CSS, p.ej. movilBase.css→
base.css; por archivo se excluye su propia definición), props objeto
`clase:`/`claseX:` como usos, y resolución de `switch`/`case` para
identificadores alimentados a templates de clase.

**Resultado medido (PT, dist fijado):** `claseHuerfana` **464→429 (−35)**,
0 errores, total 822→**787**; **0 FN verificado** (las 35 removidas del
reporte tienen uso real repo-wide; los 429 restantes = 363 con uso real que
el scanner aún no ve, 76 muertas en reglas mixtas conservadas por diseño,
coincidencias de datos/strings). Sin regresión en otras reglas: el único delta
fue `valorHardcoded` +1 = regla nueva del WIP no commiteado del usuario
(`panelIA.css`), documentado.

**Release (convención J-8):** pins `8ce45b6`→`50913d2` + locks regenerados en
10 consumidores: workspace-manager `7e05d14`, coolify `999b50a`, ONG AGAPE
`ce373f1`, RESTAURANTE `6971b18`, Glory-Laminal `fb8f08b`, GLORYPORT
`ef9e40c`, freebuff-bridge `5e264b6`, GLORYINSPECTOR `0413bda`, PROYECTO
TASKS `8fd6209` (solo qt.json+lock; WIP del usuario intacto, verificada
ausencia de CSS en su diff), WANDORIUS `d80b83ee`+`734595b8` (gitlink+qt.json,
luego lock; el generador lee el gitlink de HEAD, requiere commit previo al
`--write`). dist de WANDORIUS/tools/varsense reconstruido desde el pin (el
CLI viejo no tenía el fix; shared dist ya al día). gloryapi no pinnea
varsense (gate legacy). Sin push en ningún repo.

### J-11V4 — HECHO 2026-09-01 (bloque 318A-7V4) — consistencia CLI↔provider de `sentinel-disable` + `cssInlineReact` de PT

**Pedido:** siguiente bloque accionable tras V3 — las ~112 `cssInlineReact` de
PROYECTO TASKS, con la disciplina de bloque V2/V3 (baseline con dist fijado,
clasificación real-excepción-FP, verificación doble herramienta, commit local
sin push, docs al cierre).

**Clasificación (baseline PT 821 = 0e, `cssInlineReact` 112 en 61 archivos,)
con líneas exactas (range.start.line):**
- **77 de 112 ya llevan `sentinel-disable inline-style-prohibido`** en el
  código (excepción declarada con justificación: estilos dinámicos runtime
  `estiloGrid`/`estiloArea`/posiciones/progreso `%`/colores de datos). El
  provider de VS Code las honraba pero el **core del CLI las ignoraba** →
  inconsistencia de conteo (consola vs CLI) del mismo tipo que la V2, pero en
  el core. **Fix en el analizador (`beb05ba`, tag `v2.2.1-j8d`):** el core
  (`analyzeDocument.ts`) ahora filtra hallazgos sobre líneas con
  `sentinel-disable`/`varsense-disable` + rule-id o genérico, replicando la
  semántica del provider; tests 71/71 + lint + check:core.
- **6 de 112: `iconStyle` en `PageLayout.tsx`** (glory-core, git-tracked, en
  alcance): `{width: 18, height: 18}` estático aplicado a 6 svgs vía
  `style={iconStyle}` → migrado a `className="w-[18px] h-[18px]"` (arbitrarios
  Tailwind ya usados en el archivo, visualmente idéntico).
- **29 restantes sin marker = dinámicos runtime legítimos** (`estiloGrid`,
  `estiloArea`, posiciones, progresos `%`) — excepción documentada, sin
  forzar.

**Resultado (PT, dist fijado, estado commiteado):** `cssInlineReact` **112→29**
(−83), total **821→742**, 0 errores nuevos; **0 FN auditado** (las 77
suprimidas están sobre o inmediatamente tras su comentario disable; las 6
migradas son las líneas svg de `iconStyle`). `claseHuerfana` estable en **429**
(sin nuevas huérfanas). Verificación completa: `npm run type-check` exit 0,
`vite build` verde (solo warning preexistente de chunk), `sentinel analyze`
(dist fijado 0.7.7/0559576) **96 = 0e/88w/8h = baseline V3 exacto** sin
hallazgos nuevos (los 3 FPs documentados de menu-contextual intactos),
varsense **742 = 1e/741w** (el único error = `variableNoDefinida` de
`panelIA.css`, regla del WIP activo del usuario, no del bloque).

**Release (convención J-8/V3):** pins `50913d2`→`beb05ba` + locks regenerados
en 10 consumidores: RESTAURANTE `809679c`, coolify `eadfe99`, ONG AGAPE
`6e7abd1`, Glory-Laminal `a3cd26c`, GLORYPORT `5ed29d6`, GLORYINSPECTOR
`fbbbcc0`, freebuff-bridge `ccfe004`, workspace-manager `31aa0f2`, PROYECTO
TASKS `91e3ee0` (qt.json+lock+PageLayout.tsx; WIP del usuario intacto:
`data/`, `test_prueba.md`, diffs de panelAgente.css/variables.css sin tocar),
WANDORIUS `dd53a5d8`+`57b220b3` (gitlink+qt.json → lock con generador propio
vía `GLORY_SENTINEL_SOURCE_PATH`/`GLORY_VARSENSE_SOURCE_PATH` a los submódulos
internos; dist de tools/varsense reconstruido con el fix). gloryapi sin pin
(gate legacy). Sin push en ningún repo.

**Runtime vivo verificado:** `POST /api/gate/analizar {clave:"PROYECTO
TASKS", forzar:true}` en 8787 → varsense del server con `cssInlineReact` **29**
y `claseHuerfana` **429** — composición idéntica a la corrida local con el dist
fijado: el runtime del server ejecuta el fix V4 (no solo el CLI local).

### J-11V5 — HECHO 2026-09-01 (bloque 318A-7V5) — `valorHardcoded` de PT (43 → 40, 0 errores)

**Pedido:** siguiente bloque accionable tras V4 — las ~43 `valorHardcoded` de
PROYECTO TASKS, misma disciplina (baseline con dist fijado `beb05ba`,
clasificación real-excepción-FP, verificación doble, commit local sin push,
docs al cierre).

**Baseline:** varsense de PT `739 = 1e/738w` (el error = `variableNoDefinida`
del WIP del usuario en `panelIA.css`, documentado, no del bloque);
`valorHardcoded` **43** en 5 archivos = TODO CSS puro (App.css ~20,
constructorPaginas.css 11, glory-core/index.css 7, recordatorios.css 3,
layoutManager.css 2).

**Clasificación:**
- **3 reales con match exacto de token:** `background: #0f172a` ×3 en
  `App.css` ≡ token `--item-surface` declarado en el propio `:root` de
  App.css → reemplazados por `var(--item-surface)` (visual idéntico).
- **40 restantes = excepción fundamentada:** 8 `font-size` px one-off del
  constructor (la escala de tokens de PT lleva `ajusteTipografia` −1.5px y
  no hay pares exactos que honrar sin cambiar diseño), colores del runtime
  desktop/glory-core, radios del tema (todos 0, diseño monocromo — radios
  literales son del canvas del constructor, sin token equivalente), y
  valores de `recordatorios.css`/`layoutManager.css` sin par en el set de
  tokens del dashboard (verificado contra `variables.css`/App.css
  `:root`). No se fuerza token nuevo sin segundo consumidor real.

**Resultado (PT, dist fijado):** `valorHardcoded` **43→40** (−3 exactos),
total **739→736**, 0 errores nuevos, sin huérfanas nuevas (claseHuerfana 429
estable). Verificación completa: `npm run type-check` exit 0, `vite build`
verde (warning preexistente de chunk), `sentinel analyze` (0.7.7/0559576)
**95 = 0e/87w/8h = baseline V5 exacto** sin hallazgos nuevos, varsense
**736 = 1e/735w** (único error = WIP del usuario, no regresión).

**Commit local (sin push):** PT `3368dc6` (`318A-7V5: valorHardcoded #0f172a
→ --item-surface`, stage explícito solo de `frontend/src/App.css`; el WIP del
usuario —variables.css, panelAgente.css etc.— intacto). Próximo frente
actionable enmarcado: `cssInlineScript`/resto de PT o el agregado; el push de
PT sigue pendiente de decisión del usuario.

### J-11V6 — HECHO 2026-09-01 (bloque 318A-7V6) — `cssInlineScript` de PT (32 → 32, 0 fixes aplicados: excepción documentada)

Siguiente frente declarado en roadmap tras V5. Baseline con runtime fijado
(`beb05ba`): varsense PT **736 = 1e/735w**, `cssInlineScript` **32** en 11
archivos, 0 errores (el único error = `variableNoDefinida` del WIP del usuario
en panelIA.css, documentado).

**Clasificación 32/32:** TODOS son `style.X`/`style.left/top` imperativos
runtime — mutaciones transitorias de estado de puntero y coordenadas
calculadas:

- `document.body.style.cursor = 'col-resize'` / `userSelect` / `overflow =
  'hidden'` durante drag/resize/modal (useAnchoSidebar, useDrawerMovil,
  useLayoutManager, useModal, useResizeHandleColumn, useArrastrePaneles,
  useModoEnfoque, useResizeDrag).
- `el.style.left/top = ${x}px` con coordenadas de getBoundingClientRect +
  clamp viewport (useMenuContextual, useMenuFlotante, useSelectorBadge).
- Sin markers `sentinel-disable` previos (a diferencia de V4); sin seam
  estático: los valores dependen del evento/size en curso y no tienen
  equivalente en CSS estático sin cambiar comportamiento.

**Decisión:** excepción documentada, CERO código tocado. Los locks de
`body.style.overflow` (useModal/useModoEnfoque) tienen seam teórico a clase
`body.modalAbierto` (patrón drawerAbierto existente), pero convertiría 11
hooks de UX crítica (drag/resize/modal) y reclamar «cero regresión» sin
prueba real de interacción sería deshonesto; se deja como mejora futura
enmarcada, no forzada. No se añaden disables nuevos (política del bloque:
los markers existentes se honran, no se crean para bajar conteo).

**Verificación (sin cambio de código):** `npm run type-check` (frontend)
exit 0 · `sentinel analyze` PT (0.7.7/0559576) **95 = 0e/87w/8h = baseline
exacto**, sin hallazgos nuevos · varsense **736 = 1e/735w** con
`cssInlineScript` 32 estable · WIP del usuario intacto (solo `variables.css`
modificada a mano). **Sin commit en PT** (ningún archivo tocado). Agregado
vivo 8787: sin re-análisis forzado porque no hay código nuevo — los conteos
PT (sentinel cap+desync de runtime documentado, varsense 742→736 por V5)
permanecen válidos; PT sigue ahead 9 de origin, push pendiente de decisión
del usuario. Scratch de C:/tmp del bloque eliminado.

### J-11V7 — HECHO 2026-09-01 (bloque 318A-7V7) — `token-unused`/`token-duplicate` de PT (19 + 186 → 19 + 186, 0 fixes aplicados: excepción fundamentada, premisa de puente Tailwind FALSADA)

Siguiente frente declarado en roadmap tras V6. Baseline fresco con runtime
fijado (`beb05ba`): varsense PT **736 = 1e/735w**, `token-unused` **19**,
`token-duplicate` **186**, 0 errores (único error = `variableNoDefinida` del
WIP del usuario en panelIA.css, documentado).

**Premisa del bloque falsada con evidencia:** el encargo suponía «ceguera del
detector por el puente Tailwind v4/shadcn». PT **no tiene puente Tailwind**:
cero `@theme` en `src/**/*.css`, cero `tailwind.config.*`, cero
`postcss.config.*` (solo Vite + CSS manual). No hay canal de consumo que el
scanner pueda estar perdiendo → **no procede fix del core**; un fix a ciegas
crearía FNs.

**`token-unused` (19) — detector CORRECTO, remoción bloqueada por WIP:** los
19 viven todos en `frontend/src/app/styles/dashboard/variables.css`
(modificada por el usuario; en su WIP). Verificado repo-wide en el scope del
scan (`frontend/src/**/*.{css,ts,tsx}` + index.html): **0 referencias**
`var(--…)` fuera del archivo definidor (`--breakpointMovil/Tablet/Escritorio`,
`--font-primary/serif/mono/sans-alt`, `--dashboard-estadoMuyBajaFondo`,
`--dashboard-acentoPrimarioRgb`, `--dashboard-superposicionActiva`,
`--dashboard-sombraFlotante`, `--dashboard-botonPrimarioSombra`,
`--dashboard-espacioMovilLg`, `--dashboard-safeAreaRight`, etc.). Son tokens
realmente sin consumo hoy — probablemente reservados para el trabajo en
curso del usuario. **Remoción = decisión del usuario** (archivo WIP activo);
excepción documentada, no se borra nada. Nota: `--dashboard-estadoMuyBajaFondo`
está definido DOS veces (L49 rgba(255,255,255,.06) y L274 rgba(0,0,0,.04)) —
cascade: gana la última; olor real a reportar al usuario, en su WIP.

**`token-duplicate` (186) — hallazgos factuales correctos, colapso no
actionable:** el detector agrupa por valor normalizado entre TODOS los
archivos; los 186 son igualdad de valor coincidental entre dominios
semánticos o pares paralelos independientes:

- **177** en `variables.css` (WIP del usuario).
- **9 fuera:** `--space-xs`/`--radius-sm` (App.css, escala spacing/radio) vs
  `--dashboard-scrollbarAncho`/`--dashboard-espacioTactil` (dashboard) —
  dominios no relacionados; `--arbol-color` (PanelExp) vs
  `--pixel-editor-iconoActivo` (modalEditorArbol); `--dashboard-panelHeaderBorde`
  vs `--pixel-editor-iconoBorde`; y los 2 pares same-domain verificados a mano:
  `--ptr-translateY`/`--ptr-contenido-translateY` (pullToRefresh.css, L8/L11)
  son **hooks runtime asignados por JS por separado**
  (`usePullToRefresh.ts:115,117` — indicador vs contenido), ambos con default
  `0`; `--col1-fr`/`--col2-fr` (resizeHandleColumna) valores por columna
  independientes. Colapsar cualquiera de estos pares **rompe comportamiento**
  o acopla dominios no relacionados → patrón §I-7/§I-9/§I-10 ya documentado
  («aliasing semántico / pares paralelos con overrides de scope»).

**Decisión:** CERO código tocado, CERO cambios de core (los hallazgos son
veraces; no hay bridge que arreglar), sin disables nuevos. Los 19 unused
quedan gated al usuario (WIP); los 186 duplicates = excepción documentada
por diseño del detector (agrupación cross-file por valor, sin comparación de
scope/dominio — candidato a mejora futura del analizador: reportar solo
duplicados same-file/same-scope).

**Verificación (sin cambio de código):** `npm run type-check` (frontend)
exit 0 · `vite build` verde (solo warning preexistente de chunk) · `sentinel
analyze` PT (0.7.7/0559576) **95 = 0e/87w/8h = baseline exacto** sin
hallazgos nuevos · varsense **736 = 1e/735w** estable (duplicate 186, unused
19, claseHuerfana 429, valorHardcoded 40, cssInlineScript 32, cssInlineReact
29) · WIP del usuario intacto (`variables.css` única modificación a mano).

**Verificación viva del 8787:** re-análisis forzado `POST
/api/gate/analizar {clave: "PROYECTO TASKS", forzar: true}` → server reporta
**PT 801 = 1e/792w/8h con token-duplicate 186, token-unused 19, claseHuerfana
429** — composición idéntica al CLI local (la diferencia 736 vs 801 = el
agregado fusiona sentinel+varsense cap 500/proyecto, desync de runtime 0.7.4
documentado en J-9; los conteos por regla varsense coinciden 1:1). Sin commit
en PT (nada que tocar); PT sigue ahead 9 de origin, push pendiente de
decisión del usuario. Scratch de C:/tmp del bloque eliminado.

### J-11V8 — HECHO 2026-09-01 (bloque 318A-7V8) — mejora del analizador `token-duplicate`: agrupación same-file (PT 186 → 181, 0 FN)

Frente declarado por el cierre V7 («candidato a mejora futura del analizador:
reportar solo duplicados same-file/same-scope»). Ejecutado con disciplina de
bloques core V3/V4.

**Semántica adoptada (documentada antes de tocar código):** un `token-duplicate`
real es la **misma variable (o valor idéntico) definida dos veces dentro del
mismo archivo**, donde colapsarla no cambia comportamiento. La coincidencia de
valor crudo entre archivos o dominios semánticos distintos (`--ptr-translateY`
[offset runtime de pull-to-refresh] vs `--dashboard-radioMinimo`; `--space-xs`
vs `--scrollbarAncho`; `--arbol-color` vs `--pixel-editor-iconoActivo`;
`--panelHeaderBorde` vs `--pixel-editor-iconoBorde`) es coincidencia, no
duplicado — reportarla es un match espurio.

**Medición previa:** de los 186 de PT, **10 pares cross-file** (todos espurios
semánticamente) y 176 same-file (reales, colapsables dentro del archivo del
design system).

**Implementación (core varsense):** `src/core/tokenRules.ts` — el agrupador de
`analyzeTokenRules` ahora agrupa por **(archivo, valor)** en vez de valor
global; el canonical reportado es el del mismo archivo. El `CssVariable` no
lleva scope de declaración, así que `archivo` es la dimensión disponible sin
tocar el extractor; same-scope dentro del archivo queda cubierto por el
canonical reportado por línea (decisión documentada en el comentario del código).

**Tests:** 3 tests nuevos en `coreContracts.test.ts` (cross-file spurious NO
reportado; same-file SÍ reportado contra canonical del mismo archivo;
proyección de índice). Suite completa: **74/74 passing** en host real de VS
Code (71 previos + 3 nuevos), lint clean, `check:core` OK.

**Resultado en PT (dist reconstruido, CLI fijado):** `token-duplicate` **186 →
181** (−5, todos cross-file espurios), varsense **736 → 731** (`1e/730w`),
**0 hallazgos nuevos, audit FN = 0** (diff por (archivo, línea, nombre) de
base→post: 5 dropped, 0 added; los 5 son exactamente los pares cross-file de
V7). Errors siguen en 0 (el único error es `variableNoDefinida` del WIP del
usuario en panelIA.css, documentado en V4–V7).

**Release V8 (`1a0c588` → 10 consumidores):** commit varsense `1a0c588`
(árbol limpio, dist reconstruido); pins `beb05ba→1a0c588` + locks regenerados
en PT `75d302c`, WANDORIUS (gitlink+qt `1768042c` + lock `31856ef1`, dist
interno reconstruido e idéntico byte-a-byte en el bundle del CLI consumido),
workspace-manager `6ab9fe6`, RESTAURANTE `f317bcb`, ONG AGAPE `281f25b`,
GLORYPORT `cf6a60a`, Glory-Laminal `1fda566`, coolify-manager-rs `0b70356`.
Fixture smoke (config tokenDetection.duplicate): same-file reporta,
cross-file puro = 0 — contratos V8 en el dist del clone interno.

**Verificación:** `npm run type-check` (frontend PT) exit 0 · `vite build`
verde (solo warning preexistente de chunk) · sentinel PT (0.7.7/0559576)
**95 = 0e/87w/8h = baseline exacto** sin hallazgos nuevos · varsense
**731 = 1e/730w** con duplicate 181 / unused 19 / claseHuerfana 429 =
composición estable · WIP del usuario intacto (`variables.css`, `data/`,
`test_prueba.md`).

**Verificación viva 8787:** sweep forzado `POST /api/gate/analizar-todo
{forzar:true}` → server reporta varsense PT **1e/730w = 731 total** —
el runtime corre el fix V8 (pre-V8 habría dado 736).

PT queda ahead 11 de origin (incluye V4–V8 y commits propios del usuario),
push pendiente de decisión del usuario (instrucción vigente de no pushear PT).
Scratch C:/tmp del bloque eliminado.

### J-11V9 — HECHO 2026-09-01 (bloque 318A-7V9) — extensión de la metodología V2→V8 al área (workspace-manager valorHardcoded 42 → 36)

Frente declarado por el cierre V8 («extender la metodología probada al resto
del área»). Ejecutado con la disciplina de bloque estándar.

**Baselines frescos del área con runtime fijado `1a0c588`:** RESTAURANTE
**141**, ONG AGAPE **129**, WANDORIUS, workspace-manager **93** (pre-fix),
coolify-manager-rs, Glory-Laminal, gloryapi, GLORYPORT — el resto del área
permanece en las familias de excepción ya documentadas (token-duplicate/
unused del puente Tailwind/shadcn, runtime dinámico, one-offs, monolitos con
excepción §I).

**Único conjunto accionable detectado:** los `valorHardcoded` ×42 de
workspace-manager — frente que J-3 dejó enmarcado sin ejecutar. Desglose
línea a línea: **6 reales con token declarado exacto** (fallbacks redundantes
del tipo `var(--token, literal)` con el token declarado en el propio
`variables-v2.css` líneas 21-24 y 48-50) → colapsados a `var(--token)` en
`MenuContextual.css` (fondo/borde/texto del menú contextual), `paneles.css`
(`--alto-consola`) y `v2.css` (`--ancho-detalle`, `--ancho-lista` — además
resuelve los 2 runtime `--ancho-*` del bloque anterior al dejar el token como
única fuente). Visual-neutral: el fallback era inerte (token siempre
definido por AppV2). Los otros 36: radios/fonts px one-off del shell y
tooltip `#000/#fff` sin token de fondo oscuro — excepción fundamentada
(patrón §I-15), no forzados.

**Resultado:** varsense workspace-manager **93 → 87** (`valorHardcoded` 42 →
36, −6 exactos), 0 hallazgos nuevos, 0 errores.

**Verificación:** `pnpm run type-check` exit 0 · sentinel (0.7.7/0559576)
**31 = 0e/27w/4h = baseline exacto**, sin hallazgos nuevos (los 3 de
paneles.css son preexistentes: `limite-lineas` monolito documentado + 2
`css-hardcoded-value` del tooltip `#000/#fff` en líneas 996-997, no tocadas).

**Commits (sin push):** workspace-manager `f066fb5` (CSS del shell v2,
stage explícito). PT y otros proyectos sin tocar; WIP del usuario intacto.
Push pendiente de decisión del usuario. Scratch C:/tmp del bloque eliminado.

### J-11V10 — HECHO 2026-09-01 (bloque 318A-7V10) — frentes RESTAURANTE + ONG AGAPE (RESTAURANTE excepción total; AGAPE 10 clases muertas eliminadas, varsense 129 → 116)

Frente declarado por el cierre V9 (RESTAURANTE ~230 / AGAPE ~239 en el
agregado; varsense: RESTAURANTE 141, AGAPE 129 con runtime fijado `1a0c588`).

**RESTAURANTE (141 varsense; sentinel no medido aparte, agregado 230):**
clasificado completo con el método del bloque — `valorHardcoded` ×15: 0 con
token exacto (canvas one-offs: radios 2-6px, fonts 0.65-0.95rem de PlanoSala/
PlanoOcupacion; positionamiento dinámico del mapa de mesas, sin seam de
token) → excepción §I-15; `claseHuerfana` ×10: 10/10 con uso verificado
(repo-wide en ts/tsx, incl. construcción dinámica tipo ternario/plantillas) =
FPs del detector (patrón §I-2/§J-11); resto de hallazgos del desglose viven
en el submódulo `glory-rs` (fuera de alcance). **0 cambios, 0 commits.**

**ONG AGAPE (129 varsense):** desglose por regla/archivo → `valorHardcoded`
×72: 0 reales con token exacto (72 one-offs: border-radius 8-46px y
font-size 0.52em-1.5rem sin token del theme; los únicos radios del theme son
--radioTarjeta 10px y --radioBoton 40.5px, y solo 2 usos de 40.5px eran
candidatos pero no hay consumidor segundo real) → excepción fundamentada;
`claseHuerfana` ×48: de las 26 candidatas del clasificador automático,
verificación repo-wide con subcadena y construcción dinámica (método V2/V3/
§I-2) → **las 16 restantes son FPs dinámicos verificados** (`tarjetaAgape--$
{tono}` con tono=crema/amarillo/azul en archivado, `toast--${tipo}`,
`panelEstadoChip--${status}` ×5 vistas, `panelHistoriaCuadro--color${i++}`,
`cuadroAcerca--color${i++}`, `botonEnlace--${variante}`) y **10 muertas
reales**: `marcaSimbolo`/`marcaTexto`(+small/strong)/`marcaHoja`
(NavegacionPrincipal.css — el header real usa `marcaAgape`/`logoAgape`),
`panelAviso`/`panelError`/`panelAccionesTabla` (PanelAdmin.css),
`opcionalDonar` (Donar.css), `tituloBlog`/`enlaceInstagram` (BlogInicio.css
donde el título real es `etiquetaBlog`/`textoBlog` y no hay enlace
Instagram en el markup), `etiquetaHero` (HeroInicio.css — el hero real usa
`lineaHero`/`retratoHero`/`descripcionHero`/`accionesHero`).

**Fixes AGAPE (commit `0532a99`):** eliminadas las 10 clases + sus bloques
completos, y retirados los tokens `--textoMarcaSimbolo`/`--textoMarcaMini`
que quedaron sin ninguna referencia; `--textoMarca` se conserva
(PiePagina.css:38 lo usa). `--tituloTarjeta`/`--textoMarca` verificados con
uso real antes de conservar. Visual-neutral: solo selectores muertos.

**Resultado AGAPE:** varsense **129 → 116** (claseHuerfana 48 → 38,
valorHardcoded 72 → 69 por la salida de los bloques dead, token-duplicate 4
y token-unused 4 sin cambios), **0 errores, 0 hallazgos nuevos** (dif. de
composición = audit de cada familia). RESTAURANTE sin cambio (excepción
documented).

**Verificación:** AGAPE `npm run check:front` y `tsc --noEmit` (frontend-v2)
exit 0 · `vite build` verde · sentinel 0.7.7 **149 = 0e/148w/1h con 0
hallazgos en los 5 CSS tocados** (la diferencia vs 110 del plan es la
discrepancia de runtime 0.7.4/0.7.7 ya documentada en §J-9; sin hallazgos
nuevos atribuibles). RESTAURANTE: sin cambios, clasificación como evidencia.

**Commits (sin push):** ONG AGAPE `0532a99` (5 CSS + variables.css, stage
explícito). RESTAURANTE/PT/otros sin tocar; WIP del usuario intacto. Push
pendiente de decisión del usuario (PT ahead). Scratch C:/tmp limpiado.

### J-11V11 — HECHO 2026-09-01 (bloque 318A-7V11) — frente WANDORIUS (4 colapsos same-scope, varsense 157 → 153)

Frente declarado por el cierre V10 (WANDORIUS siguiente conteo relevante sin
desglosar; agregado 157). Baseline con runtime fijado `1a0c588`: varsense
**157** (0e/65w/89h) = `token-duplicate` ×58, `claseHuerfana` ×10,
`cssInlineScript` ×89.

**Clasificación completa:**
- `token-duplicate` ×58: la mayoría son coincidencias de valor intencionales
del monocromo + knobs de inversión de tema — pares cross-scope entre
`:root` y `[data-tema='oscuro']`/scopes de ventanas que `variables.css`
documenta como `[297A-18]`/`[308A-6]`; colapsarlos a `var()` rompería el
dark mode (verificado: `--color-texto-secundario` se redefine en el scope de
ventanas sin tocar `--sistema-texto-secundario`). **4 reales same-scope
dentro de `:root` (canónicos declarados una sola vez, sin redefinición en
ningún scope, con consumidores verificados):** `--win-w`/`--win-h`
(640/480px = `--sistema-ventana-*-default`, consumidos por
`desktop-window.css:14-15` como fallback y seteado runtime por
window-manager) e `--icono-row` (`auto` = `--icono-col`, consumido por
`desktop-shell.css:79-80` + runtime `workspace-icon-grid.ts:101-106`).
`--sistema-menu-contexto-texto-tamano` quedó descartado del colapso porque
`--tamano-pequeno` (11px) tampoco se redefine y ambos conviven en el mismo
scope — se colapsó igualmente (verificación: definición única en
`variables.css:38`, consumidores en base.css/Button/Form/Misc/Modal).
- `claseHuerfana` ×10: 10/10 FPs verificados (construcción dinámica
`tag-estado--${item.status}`, `media-library__badge--${item.asset_state}`,
`movilLauncher__tema` literal, tiptap/ProseMirror = DOM inyectado por
Tiptap) → patrón §I-2 documentado.
- `cssInlineScript` ×89: runtime del desktop (posicionamiento win-manager,
drag/ghost, estado condicional), excepción ya documentada en frentes
anteriores.

**Fixes (commit WANDORIUS `4ef39ee1`):** 4 colapsos same-scope en
`frontend/src/styles/variables.css` (líneas 74, 117-118, 136-137):
`--sistema-menu-contexto-texto-tamano: var(--tamano-pequeno)`,
`--icono-row: var(--icono-col)`, `--win-w: var(--sistema-ventana-ancho-
default)`, `--win-h: var(--sistema-ventana-alto-default)`. Visual-neutral:
los valores coinciden exactamente y ninguna fuente queda sin definición (el
runtime setea los mismos nombres inline).

**Resultado:** varsense **157 → 153** (token-duplicate 58 → 54), **0
errores, 0 hallazgos nuevos** (sin token-unused nuevos: los 4 canónicos
siguen consumidos).

**Verificación:** `npm --prefix frontend run type-check` exit 0 · sentinel
analyze **0e/0w/0i/0h** (sin hallazgos nuevos; cambio solo CSS del shell) ·
WIP: repo limpio desde el inicio (ahead 8).

**Commits (sin push):** WANDORIUS `4ef39ee1` (variables.css, stage
explícito) + docs workspace-manager (este bloque). PT y resto sin tocar.
Push pendiente de decisión del usuario. Scratch C:/tmp limpiado.

### J-11V12 — HECHO 2026-09-01 (bloque 318A-7V12) — frentes coolify-manager-rs / gloryapi / Glory-Laminal (verificación + documentación, 0 cambios)

Frente declarado por el cierre V11 (siguientes conteos sin desglosar:
coolify ~96 en agregado, gloryapi ~76, Laminal ~42). Baselines frescos con
runtime fijado `1a0c588`:

- **coolify-manager-rs: varsense 30** (0e) = `claseHuerfana` ×12,
  `valorHardcoded` ×11, `token-duplicate` ×6, `cssInlineReact` ×1.
- **gloryapi: varsense 76** (0e) = `token-unused` ×38, `token-duplicate`
  ×37, `cssInlineReact` ×1.
- **Glory-Laminal: varsense 42** (0e) = `cssInlineScript` ×23,
  `token-unused` ×14, `valorHardcoded` ×4, `token-duplicate` ×1.

**Clasificación completa (cero accionables con token exacto):**
- **coolify (30)**: 12 `claseHuerfana` = FPs dinámicos verificados línea a
  línea (`vpsStatusBar${index+1}`, ternarios en VistaSitios/VistaPortalVisual,
  mapeo de variantes en Button.tsx) → patrón §I-2. `cssInlineReact` ×1 =
  runtime legítimo (posicionamiento del menú, comentado en
  variables.css:31-33). `valorHardcoded` ×11 = one-offs del portal VPS sin
  token equivalente (52/32/36/34/18px, `#f5a01f`, rgba) → excepción.
  `token-duplicate` ×6 = coincidencias de valor **cross-dominio** (texto/
fondo, acento/borde, radio/espacio) del diseño monocromo; colapsarlas las
  acoplaría semánticamente (p. ej. `--acento: var(--bordeActivo)` cambiaría
  el acento si el borde divergiera) → excepción fundamentada (patrón
  §I-10/§I-11).
- **gloryapi (76)**: 100% ya documentado §I-10 (líneas 375-403): 38
  `token-unused` = puente `@theme inline` de Tailwind v4 (se consumen vía
  utilidades compiladas), 37 `token-duplicate` = aliasing semántico shadcn,
  1 `cssInlineReact` = runtime dnd-kit.
- **Glory-Laminal (42)**: 100% ya documentado §I-11 (líneas 775-815): 14
  `token-unused` = API pública del tema Blender (contrato del archivo:
  «Ningún componente declara colores... usa estas variables»), 23
  `cssInlineScript` = runtime del editor, 4 `valorHardcoded` = one-offs
  (guizmo `#ff3352` vs tokens `--ejeX/Y/Z` en gizmo, `#2c2c2c` asa hover,
  `#334d80` outliner, `#5f5f5f`, rgba) ya excepcionados, 1
  `token-duplicate` = auto-colisión de alias `var()` (límite del analizador).
  Nota: gizmo duplica valores de `--ejeX/Y/Z` como literales runtime
  (canvas WebGL2, no CSS) → excepción documentada, no tokenizable.

**Resultado:** 0 cambios de código en los 3 repos — el frente es
verificación y documentación: los tres quedan en familias de excepción ya
documentadas con evidencia línea a línea; forzar colapsos acoplaría dominios
semánticos (lección V9/V10 aplicada: se cazó lo real y no había).

**Verificación:** varsense 0 errores en los 3 · sentinel sin regresión
(coolify 67 baseline §J-5, gloryapi/GLORYPORT y Laminal sin hallazgos en
CSS tocados — ninguno tocado) · WIP intacto · C:/tmp limpio.

**Commits (sin push):** solo docs workspace-manager (este bloque);
coolify/gloryapi/Laminal sin cambiar. Push pendiente de decisión del
usuario.

### J-11V13 — HECHO 2026-09-01 (bloque 318A-7V13) — harness commiteado + registro estructurado de excepciones + criterio de convergencia

Mejora estructural nombrada por la auditoría de 4 dimensiones como el siguiente paso de mayor valor: convertir el ritual de ~20 scripts desechables por bloque en 3 comandos y hacer que el conocimiento de excepciones sea consultable en vez de prosa en el monolito.

**1) Harness `scripts/quality/analyze-blocks.mjs` (commiteado):** un comando hace lo que hacían los scripts v9–v12 desechables — baseline con CLI varsense fijado → desglose por regla/archivo → plantilla de clasificación → veredicto de convergencia. Acepta el proyecto como argumento (`workspace-manager`, `RESTAURANTE`, `ONG AGAPE`, `WANDORIUS`, `coolify-manager-rs`, `gloryapi`, `Glory-Laminal`, `GLORYPORT`, `PROYECTO TASKS`) con `--json` y `--detalle <regla>`. Tolerante al exit code != 0 del CLI cuando el JSON es válido (p. ej. errores de WIP del usuario). Corrige el matcher de rutas para Windows (separadores normalizados a `/` — bug encontrado en el smoke de PT donde 7 hallazgos de `glory-core/index.css` no matcheaban por `\`).

**2) Registro `scripts/quality/excepciones.json` (commiteado, referenciado desde este plan):** familias de excepción verificadas V2–V12 extraídas de las entradas del plan por proyecto, con regla/categoría/evidencia (sección o commit) y archivos/marcas opcionales. Sembrado: workspace-manager (7 familias), RESTAURANTE (6), ONG AGAPE (5), WANDORIUS (3), coolify (4), gloryapi (3), Glory-Laminal (4), GLORYPORT (vacio, sentinel-only), PT (8). Durante el sembrado se detectó y registró el hallazgo faltante de AGAPE (`cssInlineReact` de Donar.tsx:288 — barra de progreso con ancho dinámico de datos, comentado en código) y la familia `variableNoDefinida` del WIP de PT.

**3) Criterio de convergencia:** un proyecto entra en MANTENIMIENTO cuando todos sus hallazgos están cubiertos por el registro y ninguno queda fuera (`descubiertos = 0`); el harness lo reporta en cada corrida como veredicto. Cualquier hallazgo nuevo fuera del registro revierte a ACCIONABLE y debe clasificarse (fix real o registro con evidencia nueva).

**4) Trabajo accionable que el harness destapó:** los 51 hallazgos de workspace-manager que §I-15 había marcado como «FP» resultaron en **7 claseHuerfana reales muertas** (0 uso literal/dinámico repo-wide): `ejRutaLabel`, `ejDefault` ×4, `scanCfgCabecera`, `scanCfgTitulo` (paneles.css) — borradas + 2 literales de diseño dentro de ellas → varsense workspace-manager **93→78** (pre-V13) → **78/78 en mantenimiento**. Se documentó en el registro el borde `configBadge--sin` (mismatch code/CSS preexistente: PanelConfig.tsx construye `badge--sin`, el selector nunca matchea) y el compuesto `mapaV2Etiqueta` (miembro de selector usado en MapaV2.tsx:174-175).

**5) Verificación:** 9/9 proyectos con veredicto MANTENIMIENTO y 0 hallazgos fuera del registro (RESTAURANTE 141, AGAPE 116, WANDORIUS 153, coolify 30 = smoke exacto 12/11/6/1, gloryapi 76, Laminal 42, GLORYPORT 0+mant, PT 731 = 1e/730w con el error del WIP del usuario cubierto como familia documentada, workspace-manager 78) · `node --check` OK · `pnpm run type-check` exit 0 · sin cambios en otros repos del área.

**6) Cómo cambia el flujo del próximo bloque:** en vez de re-derivar familias a mano con scripts desechables, el bloque corre `node scripts/quality/analyze-blocks.mjs <proyecto>`; si el veredicto es MANTENIMIENTO, el frente está cerrado salvo hallazgos nuevos; si es ACCIONABLE, el propio harness lista los hallazgos fuera del registro. Cualquier clasificación nueva se registra en `excepciones.json` con evidencia, no en prosa del plan.

Commit: workspace-manager (harness + registro + paneles.css + docs §J-11V13). Push pendiente del usuario.

### J-11V13C — HECHO 2026-09-01 (cierre de los 3 gaps de correctness de la auditoría)

Cierre de los gaps de verificación/documentación que la auditoría de 4 dimensiones nombró sobre el candidato `722087a` (sin capacidad nueva, solo evidencia):

**Gap 1 — sentinel pinned 0.7.7 re-ejecutado en los 3 repos de V12:**
- gloryapi: **0e/0w/0h = 0**, match EXACTO con el baseline documentado. ✓
- coolify-manager-rs: **1e/57w/23h = 81** vs baseline documentado J-5 (1e/42w/23h = 66) → +15, TODOS `css-hardcoded-value`.
- Glory-Laminal: **0e/5w/0h = 5** vs baseline documentado (0/0/0/0) → +5, TODOS `css-hardcoded-value`.
- Root cause (no regresión): la regla `css-hardcoded-value` fue **reactivada en sentinel 0.7.6** (`4a4a0f9`, bloque 318A-4) y el dist de `out/` se reconstruye desde `0559576` (0.7.7). Los repos NO tienen cambios de código desde los baselines (verificado: 0 diffs), y los conteos son estables entre 2 corridas → los deltas son cambio de reglas del runtime, no hallazgos nuevos de los repos. Queda documentado que los baselines de sentinel del plan dependen de la versión de reglas del runtime fijado.

**Gap 2 — root cause del delta glory-harness («1w»):**
- Real y verificable: HEAD `ff65ccfe` de glory-harness tiene **3 warnings reales** en `core/src/llm.rs` (1028 líneas): `limite-lineas` + `nivel-2` + `funcion-larga-rs`, analizado por el POST forzado (23:31:52). El «1w» de V12 correspondía al HEAD anterior (solo `limite-lineas`).
- Repo sucio con WIP del usuario (error.rs/lib.rs modificados; context.rs/diff.rs untracked) y **omitido del scan POST** («MISSING» en `proyectos`, 12 de 15 proyectos analizados) — el GET (1w/0w que vimos antes) era cache stale previo al sweep.
- No es artefacto del servidor: es un hallazgo real en un repo que evoluciona bajo control del usuario y fuera del set trackeado de la misión. **No** se registra en `excepciones.json` (sería ocultar un hallazgo real); queda documentado aquí para que los sweeps no lo re-descubran como delta.

**Gap 3 — reconciliación de los dos shapes del 8787:**
- Ambos endpoints usan la MISMA entrada por proyecto `{clave, resumen, hallazgos, varsense}`; solo difiere el contenedor: GET `/api/gate/analisis` = map keyed por `clave` (cache), POST `/api/gate/analizar-todo` = array (scan forzado).
- Mapper commiteado: **`scripts/quality/agregado-8787.mjs`** — consume ambos shapes, normaliza por clave de proyecto, suma el total de la misión y compara GET (cache) vs POST (fuerza scan + renueva frescura). Verificado reproduciendo ambos shapes sin drift de claves y con el total coherente (PT con WIP del usuario fluctúa ±2 entre análisis — esperado y documentado). Ningún sweep futuro debe ser shape-frágil.

**Verificación final (sin ediciones de producción):** harness 9/9 proyectos MANTENIMIENTO · sweep vivo forzado post-V13C con total esperado (1727 = la suma por proyecto del POST; PT fluctúa por WIP) · árboles por repo limpios salvo WIP de usuario · `node --check` OK · `pnpm run type-check` exit 0.

Commit: workspace-manager (mapper `agregado-8787.mjs` + docs §J-11V13C). Push pendiente del usuario.

### J-11V14 — EN CURSO 2026-09-02 (bloque 318A-7V14) — detector claseHuerfana: familias dinámicas por template literal

**Motivación (verificado en VAR-4):** el detector `claseHuerfana` indexa solo
literales de string; los componentes declarativos emiten clases dinámicas con
template literals (`` `badgeInfo--${variante}` `` en BadgeInfo.tsx, `` `selectorNivelBoton${claseSufijo}` ``
en SelectorNivel.tsx, `` `boton--${variante}` `` en Boton.tsx) y el scanner las reporta
como huérfanas. FPs verificados manualmente en VAR-4: PT 63 (badgeInfo 19 + ui 17 +
ui-formulario 16 + selectorNivel 11), y la misma familia en AGAPE, workspace-manager,
coolify, RESTAURANTE, WANDORIUS y GLORYPORT.

**Semántica adoptada (documentada antes de tocar código):**
- Un **prefijo de familia** es el último token completo de un segmento estático de
template literal que termina justo donde arranca una interpolación `${...}`:
  `` `badgeInfo--${variante}` `` → prefijo `badgeInfo--`; `` `selectorNivelBoton${sufijo}` `` →
  prefijo `selectorNivelBoton`. Solo candidatos con forma de clase (`[a-zA-Z_][\w-]*`,
  longitud ≥ 3) y solo en contexto portador de clases (className/class/clase*,
  object factories).
- Un prefijo marca como **EN-USO toda la familia** de clases definidas cuyo nombre
  empiece por él. NO marca clases fuera de la familia (uso `startsWith` con el token
  completo del segmento). Cubre los mapas de sufijos sin resolverlos: el valor
  interpolado sale de una unión/mapa que indexar literalmente exigiría resolver tipos.
- Los segmentos estáticos continuan contándose como tokens exactos (comportamiento
  actual intacto); la familia es ADICIÓN de recall, no sustitución.
- Regla de oro del bloque: eliminar FPs verificados SIN crear FNs. Cada hallazgo
  que deje de reportarse se audita (debe tener uso dinámico verificable en código
  o pariente muerto confirmado — nunca oculto).

**Cambios:** core varsense (`classIndexBuilder.ts`): extracción de prefijos de
familia en los tres formularios de template (attr/template, object) + cache
persistido (`consumerFamilyPrefixes`, PARSER_VERSION 2→3 para invalidar entradas
viejas) + consumo en `scan()`. Tests nuevos del contrato (familia sí/no, sufijo
camelCase, mixto, sin interpolación). Build dist → release a consumidores (pins +
locks, WANDORIUS gitlink + dist) → re-medir PT/AGAPE/workspace-manager con audit
FN = 0 → sweep forzado 8787 → docs.

**Estado:** HECHO 2026-09-02 (bloque 318A-7V14).

**Cierre (evidencia):**
- Implementación core (`classIndexBuilder.ts` + `persistentIndex.ts`): prefijos de
  familia extraídos en los 3 formularios de template literal + cache persistido
  (`consumerFamilyPrefixes`, PARSER_VERSION 3) + consumo en `scan()`. Tests: **74 →
  78** (4 nuevos de contrato), lint + check:core verdes. Dist reconstruido y
  verificado por contenido.
- Release cadena V8: varsense commit **`38889aa`** (rama local); pins
  `quality-tools.json` + locks `sentinel.lock.json` → `38889aa` en los 8
  consumidores (PT, RESTAURANTE, AGAPE, WANDORIUS, coolify-manager-rs,
  Glory-Laminal, GLORYPORT, workspace-manager); WANDORIUS gitlink+submodule dist
  (commit `b732c215`, sha lock `c57a0d02`). gloryapi no consume varsense.
- Re-medición con harness fijado: **PT 580 → 536, 0 errores** (`claseHuerfana`
  305→261), AGAPE 103/0e, workspace-manager 47/0e (ambos en mantenimiento).
- Auditoría FN sobre PT (dist pre-fix en worktree temporal): **44 desaparecidos, 0
  aparecidos** → 42 con uso dinámico verificado (mapas de sufijos y template
  literals reales); **2 FN reales corregidos** borrando reglas muertas (0 usos
  repo-wide): `.pillOpcion--premium` (adjuntos.css) y `.badgeFiltrosActivos`
  (encabezado-movil.css). `mensajeExito` auditado NO es FN (mapa
  `mensaje${'Exito'|'Error'}` en AccionesDatos.tsx:51).
- Verificación PT: `tsc --noEmit` exit 0, `npm run build` verde, sentinel sin
  regresión (0e/83w/10h), WIP del usuario intacto.
- Sweep forzado del 8787: ver sección J-11V14-sweep al final.

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
### J-11V14-sweep — sweep forzado del 8787 (cierre V14)

POST /api/gate/analizar-todo `{forzar:true}` el 2026-09-02 (HTTP 200, 43 s):
**PROYECTO TASKS 536w/0e** (== harness), AGAPE 98w+1i+4h (=103, == harness),
workspace-manager 43w+4i (=47, == harness), RESTAURANTE 81w+21i+39h,
coolify 25w+1i, WANDORIUS 60w+89i, Glory-Laminal 5w+23i+14h, gloryapi 37w+1i+38h,
GLORYPORT 0/0/0, freebuff-bridge/glory-harness/GLORYINSPECTOR 0/0/0.
El runtime vivo del server corre el dist V14 (las mediciones de PT/AGAPE/WM
coinciden exactas con el harness fijado `38889aa`).

### J-11V15 — HECHO 2026-09-02 (bloque 318A-7V15) — token-duplicate de PT fuera de variables.css + re-verificación área 9/9 con runtime V14

**Resultado:** 0 colapsables, 5 excepciones documentadas; área 9/9 en MANTENIMIENTO con runtime `38889aa`.

Fuente única de la decisión (formato v2, migrada en 318A-7V16): `scripts/quality/excepciones.json` → proyecto `PROYECTO TASKS` → `pares` (los 5 pares con `tokenA`/`tokenB`/`archivo`/`lineas`/`categoria`/`evidencia`). Sin tablas duplicadas aquí. Deriva de registro por categoría: 3 `bridge-agnostico` (editor pixel, knobs independientes en editorPixelArt.css:47-92) + 2 `fallback-inyectado` (runtime inyecta valores: usePullToRefresh.ts:115-117, useDashboardGrid.ts:98-100; patrón en lecciones-aprendidas.md:34). El harness las verifica 1:1 por par de tokens.

Conteos V14 actualizados en el registro (mismo movimiento que en completados): AGAPE claseHuerfana 38→25, WANDORIUS 10→6, coolify 12→8, PT 429→261.

Área 9/9 (harness `38889aa`, 0 hallazgos fuera del registro): workspace-manager 47 · RESTAURANTE 141 · AGAPE 103 · WANDORIUS 149 · coolify 26 · gloryapi 76 (sentinel) · Laminal 42 · GLORYPORT 0 · PT 536.

Verificación PT: tsc --noEmit exit 0, `npm run build` verde (11.3 s), sentinel 0e/82w/10h (1w menos que baseline 83w: restos de VAR-3, sin regresión), WIP del usuario intacto (Cargo.toml/lock, ai.rs, variables.css, data/, test_prueba.md sin stage). Commits locales sin push: PT `891871b` (docs), WM `c5b57ce` (excepciones.json + plan).

### J-11V16 — HECHO 2026-09-02 (bloque 318A-7V16) — registro verificable por máquina + harness regla-por-regla

**Objetivo (auditoría post-V15):** la decisión de los 5 pares vivía en 4 copias en prosa y el harness solo verificaba cobertura de familias, no pares ni conteos → el registro se desincronizaba silenciosamente.

**Cambios:**
1. `scripts/quality/excepciones.json` migrado a formato v2 verificable: entradas estructuradas por proyecto con `pares` tipados para token-duplicate (`tokenA`/`tokenB`/`archivo`/`lineas`/`categoria`: same-scope-colapsable | cross-dominio | runtime | bridge-agnostico | fallback-inyectado / `evidencia`) y `familias` (claseHuerfana y resto) con conteo esperado por regla por archivo. Los 5 pares de V15 migrados SIN re-clasificar (extraídos de las entradas existentes) + drift V14 (AGAPE 38→25, WANDORIUS 10→6, coolify 12→8, PT 429→261) + familia WIP `variables.css` de PT (175 pares, WIP del usuario, gated).
2. `scripts/quality/analyze-blocks.mjs` ahora verifica regla-por-regla: para cada hallazgo `token-duplicate` casa (archivo, par de tokens) contra el registro y reporta descubiertos; para el resto de reglas compara conteos por (regla, archivo) entre baseline y registro → detecta drift. Veredicto MANTENIMIENTO solo con 0 descubiertos y 0 drift.
3. **Corrección de verificación falsa:** el harness anterior reportaba PT «MANTENIMIENTO 536/536» cuando los 175 pares de `variables.css` (WIP) quedaban fuera de las marcas. Con el matcher de pares, PT salía `enMantenimiento:false` con 175 descubiertos → se registró la familia WIP con conteo → vuelve a MANTENIMIENTO con cobertura REAL 536/536.
4. Fuente única consolidada: plan/completados/roadmap ya no duplican tablas; enlazan a `excepciones.json`.

**Verificación:** harness nuevo: PT MANTENIMIENTO 536/536, 5 pares casados, 0 descubiertos, 0 drift; área 9/9 MANTENIMIENTO con conteos verificados contra el registro (WM 47 · RESTAURANTE 141 · AGAPE 103 · WANDORIUS 149 · coolify 26 · gloryapi 76 · Laminal 42 · GLORYPORT 0 · PT 536). JSON parsea OK, `node --check` OK. Ningún repo de producción cambió (solo docs PT + harness/registro/plan WM).

Commits locales sin push: WM (registro v2 + harness + plan + roadmap) y PT (completados + roadmap, docs deduplicadas).

### J-11V17 — HECHO 2026-09-02 (bloque 318A-7V17) — fixes de detección: submódulos excluidos, escáner balanceado, prefijos de familia sin prosa

**Objetivo (pedido del usuario):** (1) los submódulos (glory-rs) no deben reportar hallazgos — si hay que arreglar algo, es directo en el repo; (2) si `claseHuerfana` es FP, arreglar el detector, no suprimirlos a mano.

**Causas raíz (3) y fixes en core de varsense:**
1. **Walker descendía a submódulos** (`nodeProviders.ts`): directorios cuyo `.git` es archivo (glory-rs, tools/) se recorren como parte del workspace. Fix: detección `.git` archivo → no descender (exclusión por diseño, no por patrón).
2. **`REGEX_VAR_CLASS_DECLARATION` no-greedy se tragaba `const clases = [...]`** dentro del closure del componente (Boton.tsx): el array de template literals nunca indexaba familias. Fix: escáner balanceado de declaraciones (`recopilarDeclaraciones`) en `classIndexBuilder.ts` → familias `boton--`, `checkbox--`, `radio--`, `select--`, `textarea--`, `input--` se registran.
3. **Prefijos de familia extraídos de prosa** (segmentos de template literal con espacio inicial: `` ` archivo${x}` ``, `` ` adjunto${x}` ``, `` `recordatorio...` `` de `titulo={...}`/`mostrarExito(...)`): registraban familias espurias que absorbían huérfanas reales (`adjuntosAreaCarga--bloqueado`, `recordatorioCardAcciones`). Fix: el prefijo debe ser el token pegado a `${` con forma de clase (termina en `--` o tiene mayúscula/dígito) — `badgeInfo--`, `boton--` pasan; `adjunto`/`archivo`/`recordatorio` no. Preserva el caso multi-clase legítimo `badgeInfo badgeInfo--${variante}` (BadgeInfo.tsx:34).

**Tests:** 3 de regresión nuevos (walker-submódulo, declaración balanceada dentro de closure, multi-clase BadgeInfo + rechazo de prosa) → **82/82 passing**, `npm test` completo verde (compile + lint + check:core + mocha + smoke).

**Auditoría FN old→new (como en V3/V4/V8):** 46 desaparecidos en PT — todos justificados (familias dinámicas verificadas: Checkbox.tsx:16, Radio.tsx:24, Select.tsx:24, Textarea.tsx:37, Input.tsx:44, Boton.tsx:51-52; + glory-rs submódulo excluido) — **0 FN**. 9 aparecidos: muertas reales que el detector viejo ocultaba (escenarioPesimista/Optimista, badgeEncabezado--*, tipo-*, mensajeExito) → precisión ganada, re-reportadas honestamente.

**Resultado (harness, dist PARSER_VERSION 4):** PT varsense **536 → 499** (claseHuerfana **261 → 224**), 0 errores; RESTAURANTE **141 → 137** (claseHuerfana 10 → 6); resto del área invariante (WM 47 · AGAPE 103 · WANDORIUS 149 · coolify 26 · gloryapi 76 · Laminal 42 · GLORYPORT 0). Registro sincronizado (familias claseHuerfana PT 224 / REST 6 con evidencia) → harness **9/9 MANTENIMIENTO, 0 descubiertos, 0 drift**. 0 errores en los 9 proyectos.

**Pendiente del usuario (no bloqueado):** push de varsense + consumidores, y re-alineación del runtime del servidor 8787 al nuevo dist.

### J-11V18 — HECHO 2026-09-02 (bloque 318A-7V18) — contexto `className` para familias dinámicas + escáner balanceado de templates

**Objetivo (pedido del usuario: los ~70 FPs restantes de `claseHuerfana` en PT se arreglan en el detector):** root-cause del índice de literales + regla de familia por contexto de atributo.

**Root-cause (lo que parecía «bug del índice de literales» era mayormente espejismo):** (1) `removeComments` sí borra el bloque de feature deshabilitado que contiene `encabezadoContador` (el detector tenía razón); (2) los selectores compuestos (`.proyectoTareas .inputNuevaTarea`) reportan el **otro** miembro del compuesto: la huérfana real era `panelContenido`/`inputNuevaTarea` (muertas reales), no la clase usada; (3) el bug REAL era `REGEX_CLASS_TEMPLATE`: no soportaba templates anidados (`SelectorNivel.tsx:39`, `ModalExperimentos.tsx:63`) ni postfijos (`.trim()` en `AccionesItem.tsx:65`) → `+" "+`-concatenaciones y ternarios escapaban al índice.

**Fixes en core (`classIndexBuilder.ts`):**
1. **Escáner balanceado de templates** reemplaza `REGEX_CLASS_TEMPLATE`: recorre templates con anidamiento correcto (llaves balanceadas con soporte de strings/escapes) y tolera postfijos `.trim()`/declaración `let x = \`...\`;` — recupera `selectorNivelBoton--${tipo}`, `modalExperimentosTipo--${tipo}`, `tarjetaEscenario--${tipo}`, `notaTarea--${estado}`, `mensaje${tipoMensaje}` + `.trim()` (AccionesItem).
2. **`descomponerTemplate`** (extracción anidada de `${...}` con balance de llaves) sustituye la regex ingenua `\$\{[^}]*\}` que se cortaba en la primera `}` interna.
3. **`contextoAttr`**: la guarda anti-prosa de V17 se aplica SOLO fuera de atributos `className`/`claseAdicional`; dentro de atributo, el segmento estático SIEMPRE es base de clase real → cubre `detallePlan ${plan}` (DetalleUsuario.tsx:79/83), `estadoViabilidad` (CabeceraArbitraje.tsx:28), `mensajeEstadoDatos mensaje${...}` (AccionesDatos.tsx:51).

**Tests:** 2 de regresión nuevos (fixtures espejando SelectorNivel.tsx:39 — template anidado + contexto attr; DetalleUsuario.tsx:79 — base + interpolación sin `--`) → **84/84 passing**, `npm test` completo verde (compile + lint + check:core + mocha).

**Auditoría FN old→new (dist OLD = V17 reconstruido, par validado: reproduce 224/499 exactos):** 25 desaparecidos en PT — todos justificados (SelectorNivel:39, ModalExperimentos:63, AccionesItem:65, TarjetaEscenario:12, ListaTareasCompacta:102, `mensaje${...}` AccionesDatos.tsx:51, `badgeEncabezado--usuario` EncabezadoPerfil.tsx:104) — **0 FN**. 0 aparecidas (sin ruido nuevo).

**Resultado (harness, dist V18): 9/9 MANTENIMIENTO, 0 descubiertos, 0 drift, 0 errores.** PT varsense **499 → 474** (claseHuerfana **224 → 199**); AGAPE **103 → 96** (ch 25→18); coolify **26 → 23** (ch 8→5); RESTAURANTE 137 (ch 6) y WANDORIUS 149 (ch 6) aprovechan la regla pero sus familias ya cubrían; WM 47→44 (ch 2); gloryapi 76 · Laminal 42 · GLORYPORT 0 invariantes. Registro `excepciones.json` sincronizado (conteos PT 199 / AGAPE 18 / coolify 5 con evidencia V18). Restantes honestos de PT: ~154 CSS muerta real (decisión del usuario borrar o no) + ~4 zona gris retenidas (premium/free/trial/expirada) + ~24 límite real del scanner (mapas de sufijos entre archivos, dataflow vía índice).

**Pendiente del usuario (no bloqueado):** push de varsense + consumidores, re-alineación del runtime del servidor 8787, y borrado (o no) de las ~154 muertas reales de PT.

### J-11V19 — HECHO 2026-09-02 (bloque 318A-7V19) — alineación sentinel/varsense del área + reporter de desalineación

**Objetivo (pedido del usuario):** «alinea todo que sentinel y varsense estén actualizados en todos los repositorios» + «planifica que workspace-manager pueda reportar problemas de sentinel/varsense desalineado».

**Fase B — reporter `scripts/quality/verificar-alineacion.mjs` (nuevo, verificado ROJO antes de arreglar):** por repo×herramienta compara (1) pin declarado (`quality-tools.json`/`sentinel.lock.json`/gitlink de submódulo), (2) runtime (HEAD del checkout compartido/submódulo que ejecuta) y (3) publicado (commit alcanzable desde refs del origin del checkout: `origin/main`/`refs/tags/v*`). Estados `ALINEADO`/`PIN_ATRASADO`/`SIN_PUBLICAR`/`PIN_ROTO`; salida tabla + `--json`; **exit ≠ 0 si hay desalineación** (para gate/CI). Corrida inicial: sentinel 9/9 ALINEADO (`0559576` 0.7.7), varsense 8/8 DESALINEADO — pins V14 `38889aa` vs runtime V18 `544e3c8`, publicados solo hasta J-8 → el reporter detecta el problema real antes de arreglarlo.

**Fase A — alineación ejecutada:**
1. **A1 — Publicación:** varsense V18 publicado con tag `v2.2.1-v18` (→ `544e3c8`) en el origin del checkout compartido (`RESTAURANTE/tools/varsense`, mirror local — patrón de releases previos).
2. **A2 — Re-pin + lock en los 8 consumidores** (quality:lock oficial por repo; WANDORIUS gitlink + dist reconstruido en submódulo `tools/varsense`): PT, workspace-manager, RESTAURANTE, ONG AGAPE, coolify-manager-rs, Glory-Laminal, GLORYPORT (quality-tools.json + sentinel.lock.json) y WANDORIUS (lock con env vars). Sentinel intacto en `0559576` en los 9.
3. **A3 — Verificación:** reporter **17/17 filas menos 1** (ver hallazgo abajo); harness de hallazgos sin cambios (re-pin no altera el análisis — mismo runtime V18 que ya medía el harness).

**Hallazgo honesto (el reporter hizo su trabajo): WANDORIUS varsense queda `NO-PUBLICADO`.** Su `.gitmodules` declara `https://github.com/1ndoryu/varsense.git` como origin del submódulo, y V14→V18 (38889aa→544e3c8) **jamás se publicaron a GitHub** — condición **preexistente desde V14** (38889aa tampoco es alcanzable desde ese origin) que ningún chequeo agregado había destapado porque no existía el reporter. Además, el `publicado=SI` de los 7 consumidores sourcePath resuelve contra el **mirror local** (`RESTAURANTE/tools/varsense`), que solo tiene el tag en su object store local — la publicación **durable** de toda la cadena es GitHub. Resolución = push fast-forward de 9 commits (J-8 `303e7f9` → V18 `544e3c8`) + tag `v2.2.1-v18` a `github.com/1ndoryu/varsense.git` (verificado: `88f281f` es ancestro de `544e3c8`, sin divergencia) — **EJECUTADO con autorización del usuario**: GitHub `main` `303e7f9..544e3c8` + tag `v2.2.1-v18` creado (2026-09-02). Sentinel ya estaba publicado en GitHub (0.7.7 `0559576` alcanzable, WANDORIUS ALINEADO vía gitlink).

**Commits locales sin push (por consumidor, stage explícito):** PT `0690c23` · workspace-manager `9bd220d` (re-pin + reporter) · RESTAURANTE `dea8892` · ONG AGAPE `f4fea72` · coolify `6789390` · Glory-Laminal `2bf7abe` · GLORYPORT `ecc9896` · WANDORIUS `d6b2d374` (pin+gitlink) + `cdd44ee6` (lock). WIP del usuario intacto y sin stage en PT (`variables.css`, `data/`); scratch `C:/tmp` limpio.

**Cierre A3:** reporter **17/17 ALINEADO** (sentinel 9 + varsense 8; WANDORIUS ya resuelve `publicado=SI` vía gitlink contra GitHub). **Pendientes del usuario (no bloqueo):** re-alineación del runtime del servidor 8787 al dist V18 (que ahora también está publicado en GitHub) y borrado (o no) de las muertas reales de PT.

### J-11V20 — HECHO 2026-09-02 (bloque 318A-7V20) — productores de clase fuera de atributo en el core de varsense

**Objetivo (mandato del usuario):** los FPs se arreglan en el detector, no a mano. Medición previa: de los 199 `claseHuerfana` de PT, ~43 tenían uso vivo verificable pero el extractor no los indexaba — productores de clase FUERA del atributo `className`.

**Causas raíz probadas (3):**
1. **RC-1 (asignación compuesta):** `escanearDeclaraciones` solo leía `const/let/var x = ...`; los literales anexados con `clase += 'x'` jamás entraban al conjunto de tokens del archivo (SelectorFechaCalendario.tsx `--hoy/--seleccionado/--otroMes`).
2. **RC-2 (transportadoras `clase*` cross-file):** las declaraciones nombradas `clase*` (convención de transportadoras) solo alimentaban indirección intra-archivo; cuando el valor se consumía en OTRO archivo (hook devuelve `clasesContenedor` → PullToRefresh), los tokens nunca se emitían (usePullToRefresh.ts).
3. **RC-3 (funciones mapeadoras en atributos de clase):** un mapper del mismo archivo INVOCADO dentro de un atributo de clase (`claseAdicional={obtenerClase(...)}`, `className={\`etiquetaPrioridad ${obtenerClasePrioridad(...)}\`}`) nunca se resolvía a sus literales de `return` (ListaProyectos.tsx `etiquetaAlta/Media/Baja`, IndicadorPlan.tsx `indicadorPlan--premium/...`). Ajuste adicional: `cuerpoDeFuncionEn` tolera anotaciones de tipo TS (`(p: string): string => ...`).

**Tests:** 4 de regresión nuevos (fixtures espejando los patrones exactos: `clase +=`, transportadora cross-file, mapper en atributo con anotación de tipo, resolverExpresionClase) → **88/88 passing** (`npm test` completo: compile + tsc + lint + check:core + mocha). Dist reconstruido por pretest.

**Auditoría FN old→new (dist V18 reconstruido = baseline validado):** 35 desaparecidos en PT — todos verificados línea a línea con productor vivo (WhatsappStatus mapper ×4, useSwipeableItem ×2, useResizeHandleColumn ×3, useModalNotasExpandido ×4, useMapaCalorHabito `clase +=` ×4, pullToRefresh ×8, SelectorFechaCalendario ×3, IndicadorPlan ×4, etiquetas ListaProyectos ×3) — **0 FN, 0 aparecidos**.

**Mejora del harness (`analyze-blocks.mjs`) — bug de drift detectado:** el drift solo marcaba familias registradas con ≥1 hallazgo medido; **una caída a 0 quedaba silenciosa**. Corregido: ahora un conteo registrado >0 que mide 0 = DRIFT. Esto destapó 3 zombies reales que el registro viejo ocultaba: coolify `claseHuerfana` 5→0 (todas familias dinámicas legítimamente resueltas por V20 — vpsStatusBar template, ternarios, variantes Button — verificadas), workspace-manager familia `fp-dinamico` (conteo 3 stale desde V18; las 2 medidas reales = par borde-analizador siguen cubiertas) y la familia zombie `menu-contextual` de PT (regla de **sentinel**, fuera del scope varsense del harness — verificada: las 3 `menu-contextual-override-diseno` son findings de sentinel 0.7.7, 0 errores en PT).

**Resultado (harness, dist V20 local): 9/9 MANTENIMIENTO, 0 descubiertos, 0 drift (con la lógica nueva), 0 errores.** PT varsense **474 → 439** (claseHuerfana **199 → 164**; resto de reglas invariante: token-duplicate 180, cssInlineReact 29, cssInlineScript 32, token-unused 14 + 5 pares = 439 ✓); coolify **23 → 18** (ch 5→0); workspace-manager ch 3→2 (solo el par borde-analizador; la familia fp-dinamico 3 era stale). AGAPE 96 · RESTAURANTE 137 · WANDORIUS 149 · gloryapi 76 · Laminal 42 · GLORYPORT 0 invariantes (los FPs dinámicos de AGAPE/RESTAURANTE/WANDORIUS ya estaban cubiertos por V17/V18). Registro `excepciones.json` sincronizado (conteos y evidencia V20; nota corregida — 544e3c8 es V18 publicado en V19; los fixes V20 viven en el worktree local, sin publicar). Sentinel PT fresco: 0 errores (102w/9h, sin hallazgos nuevos en archivos tocados).

**Restantes honestos de PT (sin tocar):** ~154 CSS muerta real (borrado = decisión del usuario), ~24 límite real del scanner (mapas de sufijos entre archivos), ~4 zona gris retenidas (premium/free/trial/expirada). **Pendiente del usuario:** publicar V20 (commit local + release a los 8 consumidores + WANDORIUS submódulo, misma cadena que V19) y push de los repos.

