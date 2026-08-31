# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-2 — Saneamiento seguro de AGENTS.md y auditoría integral.** S0/S1 completadas; S2 avanzada: S2-01 a S2-04, S2-09 (categorías `sin commit` y `huérfanos`), S2-10/S2-11 (config de 36 a 0 problemas) y **S2-13 (consolidación de AGENTS.md completada)**: instrucciones de los 8 proyectos consolidadas en la sección §9 del `AGENTS.md` raíz; los `AGENTS.md` secundarios se eliminaron con `git rm` por repo tras backup S0 verificado (58/58 + `disk-v2` de WANDORIUS). **Frente de 1408 corregido (hilo 308A-2/1408):** RESTAURANTE llegó a su piso honesto **120** (`2fa1e652`, pusheado a `glory-rs-rest`), gloryapi cerró por completo **8→0** (`4e97e2a`, `tsc -b` + 315/315 tests) — F5 completo — y PROYECTO TASKS bajó de 500 a **23** (`ac5d4c4`: console-production 86→0 con logger central + `portableBoundaries.loggerModules` corregido). Pendientes: S2-05 (VarSense sin runtime oficial), WANDORIUS bloqueado en rama `main` (primaria `wandorius`) y los 23 restantes de PT son excepciones legítimas documentadas (emoji/copy dinámico, estilos inline dinámicos y monolitos de API: `store.ts`, `runtime.rs`/`agente.rs`/`ai.rs`, params/funcion-larga con firma pública).
Detalle en `PLAN-saneamiento-agents-y-analisis.md`, `PLAN-corregir-1408.md` y registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`.

## Bloqueos y decisiones

- Ningún backup se considera válido sin manifest y hash coincidente.
- No se borra contenido si no existe rollback verificable.
- Worktrees, referencias, configuraciones, locks y `AGENTS.md` se procesan individualmente y con evidencia concreta.
- Las carpetas normales no se clasifican como árboles huérfanos.

## Tareas pendientes (orden de dependencia)

1. `308A-2 / S2-05` — resolver VarSense por fuente oficial o documentar limitación (bloqueada sin runtime).
2. `308A-2 / S2-12` — refactors de código: Glory-Laminal 12→0 (eebe026); **gloryapi COMPLETO 8→0** (F5, `4e97e2a`, 315/315 tests OK); RESTAURANTE piso honesto **120** pusheado; **PROYECTO TASKS 500→23** (console-production 86→0 con logger central `ac5d4c4`; restante = excepciones legítimas: emoji 9, inline-style 5, monolitos de API 9); WANDORIUS bloqueado en `main` (primaria `wandorius`). Los pendientes restantes tienen porqué verifiable en `PLAN-corregir-1408.md` §7.
3. `308A-2 / S2-08` — revisión SOLID, eficiencia y regresiones de la detección nueva.
3. `308A-1` — **centralizar runtime del gate** (checkout compartido `.quality-tools/` + `sourcePathEnv` + `quality:sync`); `glory-sentinel` queda exento de gate (excepción en el panel). Ver `PLAN-centralizar-gate.md` (reorienta el antiguo `PLAN-agregar-gate-proyectos.md`).

## Planes activos

- `PLAN-saneamiento-agents-y-analisis.md` — S2 en ejecución controlada.
- `PLAN-centralizar-gate.md` — runtime del gate compartido y único; `glory-sentinel` exento. (Sustituye la dirección de `PLAN-agregar-gate-proyectos.md`.)
- `PLAN-gate-dinamico.md` — proveedores dinámicos, R1/E1/E2/E3 completadas.
- `PLAN-analisis-sentinel-consola.md` — análisis de Sentinel en consola, A0–A4 + R completadas.
- `PLAN-reglas-completas-tabs.md` — catálogo completo de reglas con tabs.
