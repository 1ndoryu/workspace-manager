# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-2 — Saneamiento seguro de AGENTS.md y auditoría integral.** S0/S1 completadas; S2 avanzada: S2-01 (auditoría Sentinel 0.7.4), S2-02/S2-03 (estado Git con backups), S2-04 (worktree prunable limpiado, rama conservada), S2-09 (categorías `sin commit` y `huérfanos` en consola) y **S2-11 (config corregida: de 36 a 0 problemas de config)**: 10 opciones ausentes añadidas con default canónico y backup por hash en Glory-Laminal, ONG AGAPE y PROYECTO TASKS. Los 35 hallazgos de `analyze` (Glory-Laminal 12, gloryapi 23) quedaron clasificados como refactors de arquitectura sin corrección canónica mínima, documentados como pendientes por proyecto. Pendientes: S2-05 (VarSense sin runtime oficial), refactors de código por proyecto y consolidación de AGENTS.md.
Detalle en `PLAN-saneamiento-agents-y-analisis.md` y registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`.

## Bloqueos y decisiones

- Ningún backup se considera válido sin manifest y hash coincidente.
- No se borra contenido si no existe rollback verificable.
- Worktrees, referencias, configuraciones, locks y `AGENTS.md` se procesan individualmente y con evidencia concreta.
- Las carpetas normales no se clasifican como árboles huérfanos.

## Tareas pendientes (orden de dependencia)

1. `308A-2 / S2-05` — resolver VarSense por fuente oficial o documentar limitación (bloqueada sin runtime).
2. `308A-2 / S2-12` — refactors de código de Glory-Laminal (12) y gloryapi (23) por proyecto, con type-check y tests propios (no automatizados desde el manager).
3. `308A-2 / S2-08` — revisión SOLID, eficiencia y regresiones de la detección nueva.
4. `308A-2 / S2-13` — consolidación de AGENTS.md con autorización.
5. `308A-1` — gate Sentinel/VarSense en cinco proyectos; ver `PLAN-agregar-gate-proyectos.md`.

## Planes activos

- `PLAN-saneamiento-agents-y-analisis.md` — S2 en ejecución controlada.
- `PLAN-agregar-gate-proyectos.md` — gate Sentinel/VarSense en cinco proyectos.
- `PLAN-gate-dinamico.md` — proveedores dinámicos, R1/E1/E2/E3 completadas.
- `PLAN-analisis-sentinel-consola.md` — análisis de Sentinel en consola, A0–A4 + R completadas.
- `PLAN-reglas-completas-tabs.md` — catálogo completo de reglas con tabs.
