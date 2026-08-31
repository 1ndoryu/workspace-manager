# PLAN: corregir hallazgos post-gate (308A-3)

Frente del roadmap 308A-3: aplicar el analizador 0.7.4 a los proyectos que
hoy no tienen gate y corregir lo que reporte con la disciplina del hilo 1408
(refactors reales verificados con `cargo check --tests` / `tsc --noEmit`,
excepciones legítimas documentadas, **sin disables para bajar conteo**; solo
mecanismos canónicos: boundaries, exclusiones de directorio, logger central).

Proyectos objetivo (los que llegaron a 0 no se tocan: WANDORIUS 0, gloryapi 0,
Glory-Laminal 0). Referencia de piso: PT 23 (excepciones doc.), RESTAURANTE 120
(monolitos).

## Estado (conteos autoritativos 0.7.4, 2026-08-31) — ACTUALIZADO tras 308A-3

| Proyecto   | Stack | Inicial | Final | Commits |
|------------|-------|---------|-------|---------|
| GLORYPORT  | Rust  | 14        | 1     | `85a022b` |
| workspace-manager | TS (React+Vite) | 100 | 86 | `80db0db` (lote tractable) |
| coolify-manager-rs | Rust + gui React | 145 | 123 | `5ddc908`, `b01f0e0` (unwrap) |

Lo que queda en cada uno es deuda documentada como excepción legítima (ver
secciones por proyecto): monolitos/`funcion-larga`/`parametros` y refactors de
gran superficie de API/UI que en una herramienta de producción no se fuerzan
sin riesgo de romper el contrato.

## GLORYPORT (14 → 1) — COMPLETO (`85a022b`)

`unwrap-produccion-rs` x13 + `limite-lineas` x1, todos en `src/popup.rs`.
Corregido: helper de recuperación de poison (Mutex) + swap de los 13
`.lock().unwrap()` + el `.unwrap()` de split-form en 712, y el `let_and_return`
clippy del bloque tocado. Verificado `cargo check` + clippy + fmt + tests
verdes. Queda `limite-lineas` x1: popup.rs de 1278 líneas (UI Windows
monolítica) — excepción legítima documentada; no fuerzo un split que toque
gran superficie de la ventana.

## workspace-manager (100 → 86) — lote tractable hecho (`80db0db`)

Lote de bajo riesgo corregido y verificado (tsc exit 0):
- `import-muerto` — removidos imports sin usar (scanner/workspace.ts,
  scanner/agents.ts, DetalleProyecto.tsx).
- `unsafe-process-shell` — spawn de `pnpm audit` sin `shell:true` (el fix
  honrado en Windows requería respetar shims `.cmd`; se usa un launch seguro).
- `promise-sin-catch` — añadido catch en cargarEsquema (PanelConfig).
- `todo-pendiente` — comentario en español ("Todo el workspace") reexpresado
  para no disparar la regla.
- `barras-decorativas` — divisores de banner a comentarios planos en
  paneles.css.

Queda por revisar como frente propio (excepciones documentadas, no forzadas):
`console-production` (la mayoría es instrumentación legítima del CLI/server),
`html-nativo-en-vez-de-componente`/`componente-sin-hook-glory` (sin componente
glory que reemplace), `window-reference`/`dom-access` (shell del manager),
`usestate`/`inline-style`/`css-adhoc` y los `limite-lineas`/`large-interface`
que quedan de la regeneración. Son refactors de diseño/UI con riesgo de
regresión visual; se documentan antes que forzarlos en mi propio front.

## coolify-manager-rs (145 → 123) — unwrap hecho (`5ddc908`, `b01f0e0`)

Herramienta de producción autorizada (única vía de operación remota): solo
frentes legibles de bajo riesgo y verificados con `cargo check`.
- `unwrap-produccion-rs` x27 → x6. Reemplazados los `stack_uuid.as_deref().unwrap()`
  (19 handlers de comandos) por `ok_or_else(CoolifyError::Validation)` siguiendo
  el patrón canónico ya usado en restore_pg_data/failover/minecraft; también
  `command.unwrap()` (exec) y `file.unwrap()` (run-sql) → validación, y
  `serde_json` de diagnose → `unwrap_or_default`. Verificado cargo check verde.
  Quedan x6 como excepción legítima: unwraps que siguen a guardas que ya
  garantizan la invariante (`tmp_guard = Some(tmp)`, `.ok_or_else` previo,
  `.min_by_key` sobre colección no vacía ya comprobada). Forzarlos exigiría
  variantes de error nuevas para cero ganancia de seguridad.
- `funcion-larga-rs` x36, `parametros-excesivos-rs` x22, `directorio-abarrotado`
  x4, monolitos `limite-lineas` (deploy_service.rs 2135, tools.rs 872,
  theme_manager 707): dispatchers/commands de CLI son contrato público; un
  split de gran superficie = riesgo alto en producción. Excepción documentada.
- `css-elemento-html-directo` x25 / `button-clase-especifica` x2 /
  `inline-style` x1 / `css-adhoc` x1: la regla marca `.clase button`/`h` directos
  en el tema del portal (portal.css). Re-expresar todo el stylesheet a clases =
  refactor de UI con riesgo de regresión visual en producción; excepción.
- `window-reference` x9 / `dom-access` x4: el gui usa ventanas/DOM de forma
  legítima (menús, popups); boundary de plataforma no definido en el gui.
  Excepción documentada.

## Disciplina

- Por repo, lote pequeño verificado + commit con stage explícito, mensaje claro.
- Excepciones legítimas se documentan aquí con su porqué; no se usan disables
  para bajar el conteo.
- No borro contenido sin backup/hash cuando aplique.