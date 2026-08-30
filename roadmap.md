# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-2 — Saneamiento seguro de AGENTS.md y auditoría integral.** S0 y S1 completadas; S2 avanzada: S2-01 (auditoría Sentinel 0.7.4), S2-02/S2-03 (estado Git completo con backups), S2-04 (worktree prunable limpiado con `git worktree prune`, rama conservada), S2-09 (detección de cambios sin commitear y worktrees huérfanos implementada en consola: categorías `sin commit` y `huérfanos`) y S2-10 (falsos positivos de config corregidos en el diagnóstico con alternativas del esquema; de 36 a 10 problemas reales). Pendientes: S2-05 (VarSense sin runtime oficial) y consolidación de AGENTS.md (requiere autorización semántica). Ningún JSON/AGENTS.md de proyecto modificado.
Detalle en `PLAN-saneamiento-agents-y-analisis.md` y registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`.

## Bloqueos y decisiones

- Ningún backup se considera válido sin manifest y hash coincidente.
- No se borra contenido si no existe rollback verificable.
- Worktrees, referencias, configuraciones, locks y `AGENTS.md` se procesan individualmente y con evidencia concreta.
- Las carpetas normales no se clasifican como árboles huérfanos.

## Tareas pendientes (orden de dependencia)

1. `308A-2 / S2-05` — resolver VarSense por fuente oficial o documentar limitación (bloqueada sin runtime).
2. `308A-2 / S2-06/S2-07` — reparaciones de config restantes (10 problemas reales documentados) y consolidación de AGENTS.md con autorización.
3. `308A-2 / S2-08` — revisión SOLID, eficiencia y regresiones de la detección nueva.
4. `308A-1` — gate Sentinel/VarSense en cinco proyectos; ver `PLAN-agregar-gate-proyectos.md`.

## Planes activos

- `PLAN-saneamiento-agents-y-analisis.md` — S2 en ejecución controlada.
- `PLAN-agregar-gate-proyectos.md` — gate Sentinel/VarSense en cinco proyectos.
- `PLAN-gate-dinamico.md` — proveedores dinámicos, R1/E1/E2/E3 completadas.
- `PLAN-analisis-sentinel-consola.md` — análisis de Sentinel en consola, A0–A4 + R completadas.
- `PLAN-reglas-completas-tabs.md` — catálogo completo de reglas con tabs.
