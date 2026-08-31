# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-2 — Saneamiento seguro de AGENTS.md y auditoría integral.** S0/S1 completadas; S2 avanzada: S2-01 a S2-04, S2-09 (categorías `sin commit` y `huérfanos`), S2-10/S2-11 (config de 36 a 0 problemas) y **S2-13 (consolidación de AGENTS.md completada)**: instrucciones de los 8 proyectos consolidadas en la sección §9 del `AGENTS.md` raíz; los `AGENTS.md` secundarios se eliminaron con `git rm` por repo tras backup S0 verificado (58/58 + `disk-v2` de WANDORIUS). **Frente de 1408 corregido (hilo 308A-2/1408):** RESTAURANTE llegó a su piso honesto **120** (`2fa1e652`, pusheado a `glory-rs-rest`), gloryapi cerró por completo **8→0** (`4e97e2a`, `tsc -b` + 315/315 tests) — F5 completo — y PROYECTO TASKS bajó de 500 a **23** (`ac5d4c4`: console-production 86→0 con logger central + `portableBoundaries.loggerModules` corregido). WANDORIUS COMPLETO 410→0 en `c1af8af6` (analizador 0.7.4 = 0 hallazgos en 481 archivos sobre rama `main` limpia; exclusiones canónicas, logger boundary, disables justificados de sqlx/handler-bd en fixtures, boundaries de plataforma, splits reales de limite-lineas; `main` sincronizada con `legacy-wandorius/main` 0/0). Pendientes: S2-05 (VarSense sin runtime oficial), los 23 restantes de PT son excepciones legítimas documentadas (emoji/copy dinámico, estilos inline dinámicos y monolitos de API: `store.ts`, `runtime.rs`/`agente.rs`/`ai.rs`, params/funcion-larga con firma pública) y el único matiz documental de WANDORIUS (primaria declarada `wandorius` vs rama activa real `main`).
Detalle en `PLAN-saneamiento-agents-y-analisis.md`, `PLAN-corregir-1408.md` y registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`.

## Bloqueos y decisiones

- Ningún backup se considera válido sin manifest y hash coincidente.
- No se borra contenido si no existe rollback verificable.
- Worktrees, referencias, configuraciones, locks y `AGENTS.md` se procesan individualmente y con evidencia concreta.
- Las carpetas normales no se clasifican como árboles huérfanos.

## Tareas pendientes (orden de dependencia)

1. `308A-2 / S2-05` — resolver VarSense por fuente oficial o documentar limitación (bloqueada sin runtime).
2. `308A-2 / S2-12` — refactors de código: Glory-Laminal 12→0 (eebe026); **gloryapi COMPLETO 8→0** (F5, `4e97e2a`, 315/315 tests OK); RESTAURANTE piso honesto **120** pusheado; **PROYECTO TASKS 500→23** (console-production 86→0 con logger central `ac5d4c4`; restante = excepciones legítimas: emoji 9, inline-style 5, monolitos de API 9); **WANDORIUS COMPLETO 410→0** (`c1af8af6`, analizador 0.7.4 = 0/481; único matiz: primaria `wandorius` vs rama real `main`). Los pendientes restantes tienen porqué verifiable en `PLAN-corregir-1408.md` §7.
3. ~~`308A-2 / S2-08` — revisión SOLID, eficiencia y regresiones de la detección nueva.~~ **COMPLETO** — auditoría del frente completo (analizador/proveedor/endpoints/timer/consola): corregido el único defecto real (caché sin evicción de claves obsoletas; `analizarTodo` poda por snapshot, verificado con área aislada). Sin otras regresiones; detalle en `PLAN-analisis-sentinel-consola.md` §9.
4. `308A-1` — **centralizar runtime del gate** (checkout compartido `.quality-tools/` + `sourcePathEnv` + `quality:sync`); `glory-sentinel` queda exento de gate (excepción en el panel). **HECHO (2026-08-30):** F0/F1 ✅ checkout compartido (`sentinel@643353d` v0.7.5 + `varsense@88f281f` en `area-trabajo/.quality-tools/`, **compilados/provisionados**, detached/limpios, ignorado por el scanner — S2-05 era stale y quedó resuelto); F5 ✅ `quality-sync.mjs`/`sync:quality` (commit `64c4ee5`, validación fail-closed del commit común; exit 1 DESYNC 2: WANDORIUS/RESTAURANTE 0.7.4 vs compartido 0.7.5, el paso pendiente de F2); F6 ✅ excepción `sinGate` en workspace-manager (v3 + endpoint `/api/config/singate` + subsección «sin gate»; `glory-sentinel` visible sin problema). Derivación de env en el server hecha (commit `2ae5f10`: `entornoGate()` en `analizador.ts` deriva `GLORY_*` al invocar sentinel, sin pisar overrides). **F2–F4 = BLOQUEADO por decisión de entorno del host** (no técnico): sentinel/varsense verificados y reproducibles, piloto gloryapi a `sourcePathEnv` probado y reutilizable (con env: `task:check GLORY-BASELINE` PASS), pero sin la env global definida a nivel de máquina migrar rompería el gate manual del desarrollador. Pendiente elegir entre **Opción A** (env de sistema del host → checkout compartido) o **Opción B** (consumidores corren su gate siempre vía el manager). Quedan **F2–F4 → decisión de usuario**, **F7** (verificación final). Ver `PLAN-centralizar-gate.md` (reorienta `PLAN-agregar-gate-proyectos.md`).
4. `308A-3` — **corregir los hallazgos de Sentinel en los proyectos que hoy no tienen gate** (depende de 308A-1): una vez centralizado el runtime, aplicar el analizador 0.7.4 a los 5 proyectos sin gate — `coolify-manager-rs`, Glory-Laminal, `gloryapi`, GLORYPORT y `workspace-manager` — y corregir lo que reporte con la disciplina del hilo 1408: refactors reales verificados con `cargo check --tests`/`tsc --noEmit`, excepciones legítimas documentadas con su porqué, **sin disables para bajar conteo** (solo mecanismos canónicos: boundaries, exclusiones, logger central). Objetivo: cada proyecto a su piso honesto con evidencia antes→después. Al arrancarlo, crear `PLAN-corregir-hallazgos-post-gate.md` con el mapa por proyecto (los que ya tienen gate — WANDORIUS 0, gloryapi 0, PT 23, RESTAURANTE 120, Glory-Laminal 0 — sirven de referencia de piso, no de objetivo forzado).

## Planes activos

- `PLAN-saneamiento-agents-y-analisis.md` — S2 en ejecución controlada.
- `PLAN-centralizar-gate.md` — runtime del gate compartido y único; `glory-sentinel` exento. (Sustituye la dirección de `PLAN-agregar-gate-proyectos.md`.)
- `PLAN-gate-dinamico.md` — proveedores dinámicos, R1/E1/E2/E3 completadas.
- `PLAN-analisis-sentinel-consola.md` — análisis de Sentinel en consola, A0–A4 + R completadas.
- `PLAN-reglas-completas-tabs.md` — catálogo completo de reglas con tabs.
