# PLAN-opencode-y-caches-appdata-2026-09-28.md

> Estado: **activo (F1d bloqueado por gate — ver §5)** · Fecha: 2026-09-28 · ID tarea: `289A-4`
> Pedido del usuario: «no hay que borrar estados ni login de chrome, planifica esto bien; además, no está tomando en cuenta el navegador de opencode propio, veo que también guarda basura, tampoco hay que borrar estados de login».

## 1. Evidencia previa (medida 2026-09-28, solo lectura, sin borrar nada)

- `Roaming\ai.opencode.desktop.propio` **187 MB**: `Cache` 135.4 + `Code Cache` 39.3 + `Partitions` 9.2 + `GPUCache` 1.6 + `Dawn*` 1.0. Intactos por diseño: `Local Storage`, `Session Storage`, `DIPS`, `Preferences`, `Local State`, `opencode.*.dat`, `drafts.sqlite*`, `blob_storage`, `SharedStorage`, `Crashpad` (~0).
- `Roaming\ai.opencode.desktop` **261 MB**: `Cache` 222.6 + `Crashpad` 34.3 + `GPUCache` 1.6 + `Dawn*` 1.0 + `drafts.sqlite` 1.2 (**ESTADO — no se toca**) + `Local Storage`, `Session Storage`, `Preferences`, `workspace.*.dat`, `window-state*` intactos.
- `Partitions\propio-browser` (9.2 MB) replica un perfil Chromium **plano**: `Cache`, `Code Cache`, `Dawn*`, `GPUCache` (limpiables) junto a `Local Storage`, `Session Storage`, `DIPS`, `Preferences`, `SharedStorage` (protegidos). Hoy existe una sola partición.
- `Local\Mozilla\sccache\cache` **957 MB** (layout idéntico a `Local\sccache\cache`, ya cubierto por el objetivo `sccache`); `Local\npm-cache` **85 MB** (`_cacache/_logs/_npx/_prebuilds`); `Local\Composer` **175 MB** (`files+repo+vcs`, hojas exactas por verificar en F1).
- `chrome.rs` ya es allowlist pura (lista cerrada + patrón de perfiles + rechazo de symlinks + contención + re-resolución byte a byte en clean). Hueco: sus tests cubren patrón de perfiles y objetivo desconocido, pero **ningún test afirma que las hojas de estado/login sean inalcanzables** → F1 lo añade para chrome y opencode.
- ⚠️ `Crashpad` de `ai.opencode.desktop` (34.3 MB): el listado superior salió vacío; contenido **sin verificar** → F1 lo verifica antes de incluirlo; si no es verificable, se excluye con motivo visible (fail-closed).

## 2. Diseño

**Decisiones de implementación (2026-09-28, con evidencia):**

- NADA de fase nueva: los 12 objetivos son rutas fijas y el modelo `Objetivo` de fase 2 (hoja + `contenido_solo` + contención) ya da las mismas garantías que `chrome.rs`; hay precedente (`opencode-dev-cache`, `freebuff-cache`). La lista cerrada ES la allowlist: una partición futura con otro nombre o una hoja de estado simplemente no resuelven (fail-closed).
- `composer` y `npm-cache` YA existen en fase 3 (`extern-scan`, vía comando oficial) — no se duplican.
- `Crashpad` de `ai.opencode.desktop` **verificado**: `reports/`, `attachments/`, `metadata`, `settings.dat` (dumps clásicos, sin logins) → se incluye.
- `Dawn*` (~3 MB entre las 3 raíces) se excluye como ruido documentado; se cubre `GPUCache` por simetría con `chrome-gpu`.
- Tab PC: sin cambios de código (fase `caches` agrupa por fase; los objetivos nuevos caen solos en «caches del perfil»); F2 = solo verificación en vivo.

**F1 — binario limpiador-pc 0.5.0** (12 objetivos en `cache.rs`, sin ficheros nuevos):

- `opencode-propio-cache | -code-cache | -gpu | -crashpad` → `Roaming\ai.opencode.desktop.propio\<Cache|Code Cache|GPUCache|Crashpad>`.
- `opencode-propio-part-cache | -part-code-cache | -part-gpu` → `...propio\Partitions\propio-browser\<Cache|Code Cache|GPUCache>`.
- `opencode-desktop-cache | -code-cache | -gpu | -crashpad` → `Roaming\ai.opencode.desktop\<Cache|Code Cache|GPUCache|Crashpad>`.
- `sccache-mozilla` → `Local\Mozilla\sccache` (hoja `sccache`, `contenido_solo`, misma semántica que `sccache`).
- Tests: señuelos de estado con contenido en el perfil falso (`Local Storage`, `Session Storage`, `Preferences`, `drafts.sqlite`, `opencode.settings`) que el scan JAMÁS reporta + `resolver("Local Storage"|"Session Storage"|"Cookies"|...)` es `Err`; se endurece `chrome.rs` con la misma aserción de prohibidas. `cargo fmt` + `clippy -D warnings` + `cargo test` verdes; ayuda de `caches-clean` actualizada.

**F2 — tab PC (workspace-manager):** sin cambios de código (verificado: fase `caches` agrupa por fase en `PanelPc.tsx:69-106`); solo verificación en vivo de que las filas nuevas aparecen en «caches del perfil» + `type-check` limpio.

**F3 — verificación real:** scan seco en vivo (cifras esperadas ≈ 445 MB opencode + ≈ 1.2 GB caches nuevas), clean solo en fixture; SSE multi-cliente como en 289A-3. Borrado real lo hace el usuario con su confirmación (regla 289A-2).

**F4 — cierre:** esta entrada → HECHO con evidencia, completada fechada, commits sin push (push = usuario).

## 3. Riesgos

- opencode propio en ejecución durante la limpieza → ficheros bloqueados → fallo visible por hoja (modelo chrome); **nunca matar procesos** (AGENTS.md §4).
- Particiones futuras con otro nombre → rechazo visible hasta allowlist explícita (fail-closed).
- `Local Storage` vive bajo una raíz limpiable (`Partitions\propio-browser`) → la contención es por hoja exacta (`<raíz>\<hoja-allowlist>` byte a byte con `normalizar_ruta` + comparación exacta de `cmd_clean`), no por prefijo; el test de prohibidas lo blinda.

## 4. DoD

Tests que afirman inalcanzabilidad de estado/login en chrome+opencode; fmt/clippy/test verdes; scan seco ≈ cifras medidas; tab muestra los grupos nuevos; roadmap actualizado; commits sin push.

## 5. Bloqueo F1d (2026-09-28): verificación cargo sin vía sancionada

- F1 implementado (12 objetivos + tests + ayuda + `Cargo.toml` 0.5.0) pero **sin compilar ni testear**.
- `cargo` está interceptado por el shim `GlorySentinel/shims/cargo.cmd`: todo subcargo exige gate.
- `sentinel lease issue` emite leases, pero el guard los rechaza con `pid-no-descendiente`: cada tool-call corre en un proceso nuevo fuera del árbol del lease. Verificado en `C:\tmp\glory-quality-guard\leases\audit.ndjson`.
- `sentinel check 289A-4 --stages …` no llega a etapas: preflight rojo (`lock-missing`, `node_modules` sin provisionar en el checkout compartido, sin evidencia de release, sin `sentinel.lock.json`). `coolify-manager-rs` (proyecto de referencia) también da `readyForGate: false`: el gate está caído a nivel compartido, no es solo limpiador-pc.
- Creados como bootstrap reutilizable: `limpiador-pc/scripts/quality/cargo-stage.ps1` + `stages-rust.json` (modelo `coolify-manager-rs`, con `test` sin `--lib` porque es crate binario). Pendiente decidir vía (§6 o lease en terminal del usuario) antes de F2/F3.

## 6. Cierre (2026-09-28, 289A-4 HECHO)

- **F1d resuelto por onboarding, no por lease.** Re-provisión del staging compartido (`npm install` en `.quality-tools/sentinel` y `/varsense` + `quality:setup`: sentinel reutilizada, varsense compilada con suite `smoke:lsp` OK) + registro de limpiador-pc como consumidor #13 del gate (`quality-sync.mjs`, routers vía `bump --shims --only limpiador-pc --write`, `sentinel.lock.json` generado, evidencia local). Doctor limpiador-pc: `ready/readyForAnalyze/readyForGate: true`, 0 issues. Cierre del lote: `sync:quality` 13/13 ok, `verificar-alineacion.mjs` 18/18 ALINEADO.
- **Gate `sentinel check 289A-4` PASS** (fmt/clippy/test, 0/0/0). El primer run dio 4 fallos reales: formato en `cache.rs`/`scan.rs` (rustfmt directo `--edition 2024`, el gate verifica después), `needless_borrow` preexistente en `salida.rs:76` (`&self.estado` → `self.estado`), `HOJAS_VALIDAS` sin `"ShaderCache"` (el escáner usa `GrShaderCache` + `SHADERS_EXTRA="ShaderCache"`: el test estaba mal, el código bien) y test de rechazo que pasaba ruta sin canonicalizar (contrato de `verificar_borrado`: entrada ya canónica, como las del reporte).
- **F2/F3 en vivo.** Binario 0.5.0 reconstruido vía `POST /api/pc/reconstruir` (`actualizado:true`); `type-check` WM exit 0. `caches-scan` real: sccache-mozilla 956.8MB, opencode-desktop-cache 222.6MB, opencode-propio-cache 135.4MB, opencode-propio-code-cache 39.3MB, opencode-desktop-crashpad 34.3MB, opencode-propio-part-cache 6.8MB, resto <2MB: cuadra al MB con lo medido. Borrado real no ejecutado (lo hace el usuario con `BORRAR`, regla 289A-2).
