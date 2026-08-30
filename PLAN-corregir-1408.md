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

### 1.1 Análisis (1381) por proyecto

| Proyecto | Hallazgos | Reglas dominantes | Estado repo |
|---|---|---|---|
| Glory-Laminal | 0 | — | limpio ✓ |
| ONG AGAPE | 0 | — | — ✓ |
| gloryapi | 8 | limite-lineas ×4, ISP ×2, barrel ×2 | 6 archivos con cambios ajenos → **bloqueado** |
| PROYECTO TASKS | 500 | css-adhoc (69), ISP (61), window/dom (116), console (56), css-espec (46), modals (45) | 4 cambios (2 ajenos) |
| RESTAURANTE | 463 → **136** | tras F5: sqlx (26) disable-file, glory-conv (38) config.rules, window/dom (13) boundaries, barras (10) + directorio (4) fixes | limpio ✓ (commit `ac72429`) |
| WANDORIUS | 410 | **sqlx sin macro (283)**, window/dom (63), css (18), console (8) | **limpio** ✓ |

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

1. **F1 — Exclusions (config canónica)**: añadir `**/_archivo/**`, backups y dirs inertes a
   `excludePatterns` de WANDORIUS/RESTAURANTE/PROYECTO TASKS, con backup previo. Re-analizar → medir corte.
2. **F2 — WANDORIUS (repo limpio, objetivo principal)**: sqlx pilot (convertir queries estáticos a
   macros si el build lo permite; si no, documentar la restricción), boundary window/dom, CSS, console,
   resto. Type-check + tests + re-analizar antes→después.
3. **F3 — PROYECTO TASKS**: batches de limpieza (console, barras, emoji), CSS tokenizado/disable,
   modales canónicos, ISP donde sea mínimo. Re-analizar.
4. **F4 — RESTAURANTE**: solo fixes en archivos limpios y configs con backup (111 cambios ajenos).
5. **F5 — gloryapi**: revisar si los frentes ajenos se aislaron; si no, queda bloqueado documentado.
6. **F6 — Cierre**: re-analizar los 6 proyectos, actualizar informe S2 + roadmap (incluye la nota de
   proyectos ignorados excluidos), commits por proyecto con `git add` explícito, sin push/PR.

## 5. Bloqueos y riesgos

- `sqlx::query!` requiere `DATABASE_URL` en compile-time y feature `macros` de sqlx; si el build del
  proyecto no lo soporta, la conversión masiva rompe el build → se documenta como restricción real.
- RESTAURANTE con 111 cambios ajenos: tocar archivos sucios está prohibido por la disciplina del hilo.
- Push queda fuera salvo confirmación explícita por repo.

## 6. Definition of Done

- Análisis de cada proyecto elegible re-ejecutado con antes→después registrado.
- Proyectos ignorados/backups fuera del análisis (excludePatterns), sin borrar nada.
- Sin regresión: type-check/tests del manager y de los proyectos tocados.
- Informe S2 y roadmap actualizados; commits locales por proyecto; sin push/PR.
