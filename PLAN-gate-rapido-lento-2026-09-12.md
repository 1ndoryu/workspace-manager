# Plan: gate en dos niveles — rápido (≤60 s, iterativo) y completo (cierre)

> Estado: propuesto · Autor: Buffy · Fecha: 2026-09-12
> Pedido del usuario (verbatim resumido): sentinel tarda demasiado; propone dos niveles —
> uno rápido para cosas sencillas con límite de 1 minuto máximo, y el actual pesado para
> trabajo grande. Hacer plan de mejora incluyendo actualizar las skills si es necesario,
> aclarar rápido = sencillo / pesado = grande, y actualizar el `agents.md` para que quede
> entendido. **Solo planificar**; el plan vive en workspace-manager.

## 1. Dato real medido (no suposición)

Medición del gate canónico de glory-harness sobre la tarea 129A-1 (2026-09-12,
`sentinel check 129A-1 --stages scripts/quality/stages.json`):

| Etapa | Tiempo aprox. | Qué hace |
|---|---|---|
| coverage | ~9 s | `node scripts/quality/coverage.mjs` |
| sccache | ~5 s | `node scripts/quality/verificar-sccache.mjs` |
| sentinel | ~9–12 s | `node scripts/quality/sentinel-orchestrator.mjs` (239 archivos, 10 warnings reales) |
| **rust** | **144–314 s** | `node scripts/quality/sentinel-rust.mjs`: `cargo clippy -p <4 paquetes> --all-targets --locked -D warnings` y luego `cargo test` completo (449 tests) |

Fuentes: `glory-harness/scripts/quality/stages.json` (rutas, env `CARGO_TARGET_DIR`,
timeouts por etapa 120 000–1 800 000 ms) y `scripts/quality/sentinel-rust.mjs`
(452 líneas: alcance por `git diff --name-only <base>...HEAD` + staged/unstaged,
paquetes por prefijo de ruta, inclusión de `desktop/src-tauri` si el alcance toca
`desktop/` o manifiestos; sccache obligatorio con `SCCACHE_GHA_ENABLED=off`;
fallo si disco libre < 8 GB; reporte schemaVersion 1 + `.detalle.json`).

**Conclusión:** el coste está concentrado en la etapa `rust` (clippy full
`--all-targets` + suite completa). Las otras tres etapas ya están por debajo del
minuto. El plan solo toca la etapa `rust`; el resto se reutiliza tal cual.

## 2. Diseño: dos niveles

### 2.1 Nivel rápido — iteración (límite duro 60 s)

- Comando previsto: `sentinel check <ID> --stages scripts/quality/stages-fast.json`
  (mismo binario, distinto manifiesto; sin flags nuevas que el build no ofrezca).
- Etapas `coverage`, `sccache` y `sentinel` idénticas al gate actual.
- Etapa `rust` en modo rápido: `cargo check -p <paquetes del alcance> --tests
  --locked` (compila todo el alcance incl. tests, sin lint full ni ejecución) +
  `cargo test -p <paquete> <filtro>` solo para los módulos tocados por el alcance
  (heurística ruta → módulo: `core/src/nucleo/runtime/turno/mod.rs` →
  filtro `turno::`; a medir y fijar en implementación).
- Presupuesto: `timeoutMs` 60 000 por etapa rápida; si el modo rápido supera los
  60 s o su alcance no aplica (§2.3), aborta fail-closed pidiendo el completo.
- **Veredicto del rápido: NO autoriza commit, integración ni cierre.** Solo dice
  "compila + tests afectados en verde, puedes seguir iterando".

### 2.2 Nivel completo — cierre (el actual, sin cambios de alcance)

- Es el gate canónico de hoy (`stages.json`): clippy `--all-targets -D warnings`
  + suite completa + resto de etapas. Conserva su timeout largo (1 800 000 ms),
  justificado por la medición del §1.
- **Único veredicto válido para commit, `integrate`, `cleanup`/`release` y
  cierre de tarea.** El plan no relaja `-D warnings`, severidades ni umbrales.

### 2.3 Regla de decisión (cuándo cuál) — irá a `agents.md`

- **Rápido:** cambio sencillo — pocos archivos, un solo paquete/crate, sin cambio
  de contrato público (`contrato/`, puertos, eventos, schemaagen), sin
  `Cargo.toml`/`Cargo.lock`, sin migraciones, sin tocar `desktop/src-tauri` ni
  manifiestos. Iteración durante el desarrollo.
- **Completo:** trabajo grande — todo lo anterior en negativo, más siempre antes
  de commit/integrar/cerrar, y tras cualquier cambio en tests compartidos,
  fixtures o tooling del gate.
- Duda → completo. El rápido nunca es atajo de cierre.

## 3. Implementación prevista (futura, fuera de este plan)

1. **Medir antes de fijar:** cronometrar `cargo check --tests` por paquete y
   `cargo test` filtrado por módulo con sccache caliente y frío; confirmar que el
   rápido cabe en 60 s o recortar su alcance (p. ej. sin `--tests`, solo `--lib`).
2. `scripts/quality/stages-fast.json` (piloto: glory-harness) + modo rápido de
   `sentinel-rust.mjs` (flag por env/arg, p. ej. `SENTINEL_RUST_FAST=1`: check +
   tests filtrados, sin clippy; conserva disco-mínimo, sccache obligatorio,
   reporte con `mode: fast` y veredicto explícito "no válido para cierre").
3. Heurística alcance → filtros de test + regla fail-closed "rápido no aplica →
   pide completo" (cambios de contrato, lockfiles, migraciones, alcance vacío).
4. El rápido corre **dentro del token del gate** (`sentinel check` con otro
   `--stages`); no se abre backdoor de `cargo` directo en el guard
   (`guard.directCommands` sigue bloqueando clippy/check/test sueltos).
5. Piloto en glory-harness, gate rápido + completo en una tarea real pequeña, y
   luego propagación a los demás consumidores por el mecanismo único de
   propagación (`quality:bump` o equivalente, §6 del `AGENTS.md` raíz) — nunca
   edición manual manifiesto a manifiesto.

## 4. Documentación y skills a actualizar (parte del plan)

- **`AGENTS.md` raíz (§5/§6):** tabla rápido vs completo, límites (60 s vs largo
  justificado), regla de decisión §2.3, "último gate antes de integrar = completo".
- **Skill `quality-gate-setup`** (copia global
  `C:\Users\Owner\.agents\skills\quality-gate-setup\SKILL.md`): documentar
  `stages-fast.json`, cuándo usar cada manifiesto y que el rápido no cierra.
- **Skill `sentinel`** (orquestación): verificar si menciona `sentinel check` y,
  solo si lo hace, añadir la distinción de niveles.
- Roadmap del proyecto piloto al implementar (registrar la tarea con su ID).

## 5. Fases verificables y Definition of Done

- F1 Medición: tiempos check/tests filtrados por paquete publicados en el plan.
- F2 Manifiesto rápido + modo `sentinel-rust.mjs` con reporte `mode: fast`.
- F3 Regla fail-closed "no aplica → pide completo" probada con 3 casos
  (contrato, lockfile, >N archivos).
- F4 Docs: `AGENTS.md` + skills actualizados; revisión de que no contradicen §6.
- F5 Piloto real: tarea pequeña con rápido iterativo + completo de cierre PASS.
- DoD: rápido ≤60 s medido, completo intacto (449 tests, `-D warnings`), sin
  backdoor en el guard, cierre solo con completo, propagación vía `quality:bump`.

## 6. No alcance

- No tocar el core de Sentinel ni VarSense; no cambiar severidades, reglas ni
  umbrales; no relajar `-D warnings`; no nuevos binarios ni puertos; no deploys.
