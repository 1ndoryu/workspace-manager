# PLAN: corregir hallazgos post-gate (308A-3)

Frente del roadmap 308A-3: aplicar el analizador 0.7.4 a los proyectos que
hoy no tienen gate y corregir lo que reporte con la disciplina del hilo 1408
(refactors reales verificados con `cargo check --tests` / `tsc --noEmit`,
excepciones legítimas documentadas, **sin disables para bajar conteo**; solo
mecanismos canónicos: boundaries, exclusiones de directorio, logger central).

Proyectos objetivo (los que llegaron a 0 no se tocan: WANDORIUS 0, gloryapi 0,
Glory-Laminal 0). Referencia de piso: PT 23 (excepciones doc.), RESTAURANTE 120
(monolitos).

## Estado (conteos autoritativos 0.7.4, 2026-08-31)

| Proyecto   | Stack | Hallazgos | Severidad | Archivos violados |
|------------|-------|-----------|-----------|-------------------|
| GLORYPORT  | Rust  | 14        | 14 warning | 1                 |
| workspace-manager | TS (React+Vite) | 100 | 1 error, 86 warning, 6 info, 7 hint | 28 |
| coolify-manager-rs | Rust + gui React | 145 | 1 error, 121 warning, 23 hint | 73 |

## GLORYPORT (14)

`unwrap-produccion-rs` x13 + `limite-lineas` x1, todos en `src/popup.rs`.
Tractables: reemplazar `.unwrap()` por `?` / `.unwrap_or` / contexto con
`map_err`, conservando comportamiento; popup.rs de 979 líneas con un split de
helpers de UI. Verificación: `cargo check --tests` con target en C:\tmp.

## workspace-manager (100)

Frentes tractables de mi propio código:
- `import-muerto` x4 — remover imports sin usar (verificar tsc, no romper).
- `promise-sin-catch` x2 — añadir catch (fallback tolerante).
- `fetch-sin-timeout` x1 — timeout acotado.
- `unsafe-process-shell` x1 — revisar si es real (spawn sin shell ya lo evita)
  o excepción legítima.
- `usestate-excesivo` x2 — extraer hooks.
- `inline-style-prohibido` x6 / `css-adhoc-button-style` x5 / `css-especificacion`
  x4 / `key-index-lista` x2 — mover estilos a css / claves estables.
- `console-production` x17 — en el manager el console es instrumentación de
  CLI; revisar por entrada (eliminar debug muerto, documentar logueo legítimo
  del CLI/server).
- `html-nativo-en-vez-de-componente` x17 / `componente-sin-hook-glory` x7 —
  revisar por entrada; si no hay componente glory que reemplazarlo, excepción.
- `window-reference` x6 / `dom-access` x2 — boundaries de plataforma (pueden
  ser excepción legítima en el shell del manager).
- `todo-pendiente` x1, `limite-lineas` x6, `large-interface-isp` x3 regeneración.

## coolify-manager-rs (145)

Herramienta de producción autorizada (única vía de operación remota): solo
frentes legibles de bajo riesgo y verificables.
- `css-elemento-html-directo` x25 — reglas CSS sobre `button`/`a` directos;
  verificar por selector, mover a clase si está bien tipado.
- `window-reference` x9 / `dom-access` x4 — boundaries de plataforma; ver si
  el gui define un boundary (puede ser excepción legítima).
- `unwrap-produccion-rs` x27 — reemplazar unwrap que ya tienen `?` disponible;
  por entrada, solo los seguros.
- `button-clase-especifica` x2, `inline-style` x1, `css-adhoc` x1, `css-espec-local` x1.
- Excepciones legítimas documentadas: `funcion-larga-rs` x36 y
  `parametros-excesivos-rs` x22 (dispatchers/commands de CLI son monolitos de
  contrato público; split en gran superficie = riesgo alto en producción),
  `directorio-abarrotado` x4, monolitos `limite-lineas` (deploy_service.rs 2135,
  tools.rs 872, etc.). No fuerzo splits que toquen gran superficie de API.

## Disciplina

- Por repo, lote pequeño verificado + commit con stage explícito, mensaje claro.
- Excepciones legítimas se documentan aquí con su porqué; no se usan disables
  para bajar el conteo.
- No borro contenido sin backup/hash cuando aplique.