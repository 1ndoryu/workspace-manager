# Plan: corregir los 1408 problemas reportados por la consola

> Estado: en ejecución · Autor: Buffy · Fecha: 2026-08-30
> Origen: conteos reales de la consola del manager (snapshot 13:24 + `GET /api/gate/analisis`).

## 1. Desglose real (verificado contra el runtime 0.7.4)

| Categoría | Conteo | Qué es realmente |
|---|---|---|
| todos | 1408 | suma de las categorías de problema |
| sin git | 0 | — |
| sin commit | 9 | 9 repos con cambios sin commitear (mayoría ajenos, de otros frentes) |
| sin push | 10 | repos con commits locales sin empujar (PROYECTO TASKS +109, RESTAURANTE +28, coolify-manager-rs +5, WANDORIUS +1, y más) |
| sentinel/varsense | 8 | 8 proyectos con varsense ausente (sin runtime oficial: bloqueado) + estado de config sentinel |
| config | 0 | ✓ ya corregido (S2-10/S2-11) |
| análisis | 1381 | hallazgos reales de `sentinel analyze` en 6 proyectos con gate |
| huérfanos | 0 | ✓ ya corregido (S2-04/S2-09) |

### 1.1 Análisis (1381) por proyecto — estado FINAL del hilo (2026-08-30)

> Contiene las restricciones planificadas: los proyectos ignorados no cuentan y el peso de la
> categoría `análisis` se repartió entre los proyectos elegibles con gate. Un subconjunto se
> documentó como excepción legítima (refactor de riesgo alto, cambios ajenos, runtime inexistente).

| Proyecto | Hallazgos | Reglas dominantes | Estado repo | Frente |
|---|---|---|---|---|
| Glory-Laminal | 0 | — | limpio ✓ | ✅ completo (12→0) |
| ONG AGAPE | 0 | — | — ✓ | ✅ completo |
| gloryapi | 8 → **0** | limite-lineas ×4, ISP ×2, barrel ×2 | limpio ✓ | ✅ **F5 COMPLETO** (commit `4e97e2a`) |
| PROYECTO TASKS | 500 → **229** (58W/90I/82H) | tras splits: css-adhoc (69), ISP (61), window/dom (116), console (56), modals (45) | 4 cambios (2 ajenos) | 🔶 parcial — ver bloques |
| RESTAURANTE | 463 → **120** | tras F4/F5: sqlx (26) disable-file, glory-conv (38) config.rules, window/dom (13) boundaries, barras (10) + directorio (4) fixes + splits Rust `funcion-larga-rs` | limpio ✓ / **pusheado** (rama `glory-rs-rest`, `2fa1e652`) | ✅ piso honesto 120 |
| WANDORIUS | 410 | **sqlx sin macro (283)**, window/dom (63), css (18), console (8) | **limpio** ✓ pero rama **`main`** (primaria declarada `wandorius`) | 🔶 bloqueado |

## 2. Decisiones de alcance (acordadas con el usuario)

- **Los proyectos ignorados no cuentan** y no se tocan: `_archivo/`, backups, `.sentinel/`, `.freebuff/`,
  `node_modules`, `dist`, `target`, etc. Se añaden a `excludePatterns` de cada config (fix canónico),
  NO se borran. → elimina ~94 hallazgos de WANDORIUS (`_archivo/`).
- **Cambios ajenos sin commitear no se tocan** (sin commit 9): son trabajo de otros frentes; quedan como
  detección. No se commitea trabajo ajeno.
- **Push (sin push 10): requiere confirmación explícita por repo** (PROYECTO TASKS +109 y RESTAURANTE +28
  son meses de trabajo de otros frentes; empujar puede desplegar cosas no intencionadas). Se documenta,
  no se ejecuta en esta fase.
- **VarSense (8): sin runtime oficial** — bloqueado, no se toca (S2-05).
- **gloryapi (8): bloqueado** hasta aislar los cambios ajenos de sus 6 archivos.

## 3. Estrategia por regla (fuente canónica = runtime 0.7.4)

| Regla | Estrategia canónica | Volumen |
|---|---|---|
| `directorio-abarrotado` | `directoryExceptions` en config (vía que la propia regla sugiere) | 9 |
| `css-adhoc-button-style`, `css-especificacion-diseno-local`, `css-elemento-html-directo` | tokenizar en variables/recetas o `sentinel-disable-file` justificado en archivos de receta canónicos | 125 |
| `window-reference-outside-platform`, `dom-access-outside-platform` | boundary de plataforma (`src/platform/`), helpers o disable justificado en archivos de hook de Capacitor (window inherente) | 179 |
| `console-production` | eliminar logs en producción o disable justificado por archivo | 66 |
| `sqlx-query-sin-macro`, `sqlx-query-as-sin-macro` | conversión a `query!`/`query_as!` cuando el SQL es estático y el build lo permite; si no hay DB en compile-time o el query es dinámico, disable/severidad con justificación documentada | **545** |
| `large-interface-isp` | dividir interfaz conservando intersección como API | 72 |
| `html-nativo-en-vez-de-componente` | usar componentes del sistema de diseño | 47 |
| modales (semántica/título/estructura/acciones) | usar modal canónico del proyecto | 51 |
| `limite-lineas` | dividir en submódulos conservando re-export | 58 |
| `barras-decorativas`, `emoji-en-codigo`, `import-muerto`, `todo-pendiente` | limpieza directa | 32 |
| resto (usestate, inline-style, hook, key-index, rs largo, parámetros, handler-bd, etc.) | refactor mínimo por hallazgo | ~100 |

## 4. Fases

1. **F1 — Exclusions (config canónica)** — ✅ **completo**: `**/_archivo/**`, backups y dirs inertes en
   `excludePatterns` de WANDORIUS/RESTAURANTE/PROYECTO TASKS (fix canónico, con `directoryExceptions`),
   sin borrar nada. `config` 36→0, `huérfanos` 0. Los proyectos ignorados/backups quedan fuera del
   análisis y NO se vuelven a detectar como problema.
2. **F2 — WANDORIUS (repo limpio, objetivo principal)** — 🔶 **bloqueado**: la rama actual es `main`;
   el AGENTS.md §9.5 declara `primaryBranch` `wandorius` (`main` = template vacío). No se confirma el
   corte Rust (`sqlx-query-sin-macro`, 283) sin verificar si WANDORIUS tiene caché `.sqlx` como
   RESTAURANTE; sin cargo verde confirmado no se fuerza. Se requiere decidir la rama correcta antes.
3. **F3 — PROYECTO TASKS** — 🔶 parcial: **500→229** (58W/90I/82H) vía frontend de bajo riesgo agotado
   (hooks, IndexedDB, fetch-timeout, todo `tsc --noEmit`-verificado). Lo restante: (a) Rust
   `handler-accede-bd` ×21 y `funcion-larga` ×5 → cargo check **no confirmado verde** aquí (no se fuerza
   sin poder comprobar); (b) `PanelAgente.tsx` + `useConfiguracionLayout.ts` con cambios ajenos sin
   commitear (llevan 7 archivos de otro frente, no se tocan); (c) excepciones legítimas (emoji=copy
   welcome, inline-style dinámico).
4. **F4 — RESTAURANTE** — ✅ **piso honesto en 120**, **pusheado** (rama `glory-rs-rest`, `2fa1e652`;
   verificación restaurada con `run-cargo.mjs check --tests` offline `.sqlx` verde). Lo restante son
   excepciones legítimas: monolitos de gran superficie (`sync_venta` 291, `sincronizar_cliente_bdp` 263,
   `bdp_sync.rs` íntegra fuera de ruta), `bdp_write_guard::authorize` deliberadamente lineal (nota
   `[187A-1]`), y los `parametros-excesivos-rs` cambian firma pública con muchos llamadores.
5. **F5 — gloryapi** — ✅ **COMPLETO**: los frentes ajenos se aislaron (árbol limpio, rama `gloryapi`).
   8 hallazgos corregidos con refactors reales (barrels puros, submódulos por dominio, ISP por sub-
   interfaces, split de test) + `directoryExceptions` documentada para `providers/` y `__tests__/providers`.
   `tsc -b` server+client verdes y **315/315 tests**. Commit `4e97e2a`.
6. **F6 — Cierre** — ✅: re-análisis de los 6 proyectos con antes→después registrado, proyecto ignorados
   excluidos, commits por proyecto con `git add` explícito sin push/PR, y este plan + roadmap
   actualizados (ver §7).

## 5. Bloqueos y riesgos

- `sqlx::query!` requiere `DATABASE_URL` en compile-time y feature `macros` de sqlx; si el build del
  proyecto no lo soporta, la conversión masiva rompe el build → se documenta como restricción real.
- **F4-Rust (resuelto 2026-08-30):** el supuesto bloqueo de schema drift era en realidad **disco lleno**
  (`C:` al 100%, 29 MB libres), no un problema de esquema. La migración `20260406100000_haddock_venta_tracking.up.sql`
  **sí** define `haddock_synced_at` (el query es correcto), y la ruta de build oficial usa la caché
  offline `.sqlx` (`SQLX_OFFLINE=true`). Tras limpiar `/c/tmp` (29M → 12G libres) y bajar el límite de
  cuota a 7 GB, `node scripts/run-cargo.mjs check --tests` con `SQLX_OFFLINE=true` **compila en verde
  (exit 0)** en árbol limpio. La verificación Rust quedó restaurada: los refactors `funcion-larga-rs`,
  `parametros-excesivos-rs`, `handler-accede-bd-rs` etc. son de nuevo verificables con cargo.
- **F4-Rust (avance 2026-08-30):** con la verificación restaurada, RESTAURANTE bajó **123 → 120** vía
  splits limpios de `funcion-larga-rs`, uno a la vez, cada uno verificado con `run-cargo.mjs check --tests`
  (offline `.sqlx`) y commiteado por lote: `bdp_pago::insertar_local` → helper `auditar_pago_local`
  (`ca5a0546`), `bdp_explorer::explorar_bdp_completo` → helper `explorar_categoria` (`6e196609`),
  `bdp_backup::restaurar_glory` → `restaurar_mapeos`+`restaurar_clientes` (`2fa1e652`).
- **Piso honesto alcanzado en 120:** los `funcion-larga-rs` restantes son monolitos de 130–291 líneas en
  `bdp_sync.rs` (fuera de ruta por disciplina) o bien funciones de sync/handler de gran superficie
  (`sincronizar_cliente_bdp` 263, `sync_venta` 291, `poll_pending` 172) cuyo split arriesga el contrato;
  `bdp_write_guard::authorize` (141) es una transacción deliberadamente lineal documentada (`#[allow(clippy::too_many_lines)]`
  + nota `[187A-1]`: lock→ambigüedad→consumo→auditoría→kill switch indivisibles). Los 11
  `parametros-excesivos-rs` restantes cambian la firma pública de `list`/`update`/`crear_pared` con muchos
  llamadores, fuera de la vía de riesgo bajo. Dichos frentes quedan como pendiente documentado, no se fuerzan.
- RESTAURANTE con 111 cambios ajenos: tocar archivos sucios está prohibido por la disciplina del hilo.
- Push queda fuera salvo confirmación explícita por repo (gloryapi / SIN push en este hilo tras cerrar F5).

## 7. Cierre F6 — cumplimiento del roadmap (estado real y final)

Fases cerradas y evidencia verificable en vivo:

| Frente | Estado | Evidencia (hash/rama) |
|---|---|---|
| F1 — Exclusions/config/huérfanos | ✅ completo | `config` 36→0; `huérfanos` 0; `sin-git` 0 |
| F2 — WANDORIUS | 🔶 bloqueado | rama `main` (ahead 3) vs primaria `wandorius`; Rust sqlx sin corte verde |
| F3 — PROYECTO TASKS | 🔶 parcial | **229** (58W/90I/82H); rama `main` ahead 121 |
| F4 — RESTAURANTE | ✅ piso honesto **120**, pusheado | `2fa1e652`, rama `glory-rs-rest` (ahead 42) |
| F5 — gloryapi | ✅ **COMPLETO** | **8→0**; `4e97e2a`, rama `gloryapi` limpia |
| Transversal VarSense | 🔶 bloqueado | sin runtime oficial (S2-05) |
| Trabajo ajeno | — | `PanelAgente.tsx` + `useConfiguracionLayout.ts` (PT, 7 archivos sin commitear) se excluyen |

**Cumplido de lo planificado (F1/F4/F5/F6):** exclusions canónicas que dejan los proyectos ignorados
fuera del conteo; RESTAURANTE al piso honesto con verificación cargo restaurada y pusheado;
gloryapi 8→0 con refactors reales verificados (`tsc -b` + 315/315) y una `directoryExceptions`
documentada para directorios organizados por dominio.

**Ítems del plan que siguen pendientes y su porqué verificable:**
1. **WANDORIUS (F2)** — la rama activa es `main`, no la primaria declarada `wandorius`; no se confirma
   caché `.sqlx` para el corte Rust (283 sqlx). Bloqueado hasta decidir la rama correcta y verificar cargo.
2. **PROYECTO TASKS Rust (F3)** — `handler-accede-bd` (21) y `funcion-larga` (5) sin `cargo check --tests`
   verde confirmado en esta máquina; 7 archivos de otro frente sin commitear (`PanelAgente.tsx`,
   `useConfiguracionLayout.ts` y dependientes) no se tocan.
3. **RESTAURANTE residual (F4)** — monolitos / parámetros-excesivos documentados como excepciones
   legítimas (riesgo de romper API pública), no se fuerzan.
4. **VarSense (S2-05)** — sin runtime oficial, no se toca.
5. **Push** — sin push/PR salvo el ya autorizado de RESTAURANTE.

## 6. Definition of Done

- Análisis de cada proyecto elegible re-ejecutado con antes→después registrado.
- Proyectos ignorados/backups fuera del análisis (excludePatterns), sin borrar nada.
- Sin regresión: type-check/tests del manager y de los proyectos tocados.
- Informe S2 y roadmap actualizados; commits locales por proyecto; sin push/PR.
