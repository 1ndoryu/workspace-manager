# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-2 — Saneamiento seguro de AGENTS.md y auditoría integral.** S0 y S1 están completadas; S2 se ejecuta de forma controlada. Antes de cualquier acción peligrosa se crea backup externo, se verifica por SHA-256 y se prueba restauración. Los backups de `data/inventarios/` se excluyen del diagnóstico como problemas, pero permanecen en el inventario de seguridad.
Detalle en `PLAN-saneamiento-agents-y-analisis.md` y registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`. S2-01 ejecutada con Sentinel 0.7.4 y S2-02/S2-03 respaldadas/auditadas; sin mutaciones externas.

## Bloqueos y decisiones

- Ningún backup se considera válido sin manifest y hash coincidente.
- No se borra contenido si no existe rollback verificable.
- Worktrees, referencias, configuraciones, locks y `AGENTS.md` se procesan individualmente y con evidencia concreta.
- Las carpetas normales no se clasifican como árboles huérfanos.

## Tareas pendientes (orden de dependencia)

1. `308A-2 / S2-01` — auditoría fresca acotada de Sentinel y comparación con cache.
2. `308A-2 / S2-02/S2-03` — detector completo de Git y repos anidados, excluyendo backups/artefactos.
3. `308A-2 / S2-05` — resolver VarSense por fuente oficial o documentar limitación.
4. `308A-2 / S2-04` — inspeccionar worktree prunable y decidir recuperación/prune con rollback; metadata perdida documentada, sin prune ejecutado.
5. `308A-2 / S2-06/S2-07` — reparaciones y configuraciones por proyecto, con backup y diff.
6. `308A-2 / S2-08` — revisión SOLID, eficiencia y regresiones.
7. `308A-1` — gate Sentinel/VarSense en cinco proyectos; ver `PLAN-agregar-gate-proyectos.md`.

## Planes activos

- `PLAN-saneamiento-agents-y-analisis.md` — S2 en ejecución controlada.
- `PLAN-agregar-gate-proyectos.md` — gate Sentinel/VarSense en cinco proyectos.
- `PLAN-gate-dinamico.md` — proveedores dinámicos, R1/E1/E2/E3 completadas.
- `PLAN-analisis-sentinel-consola.md` — análisis de Sentinel en consola, A0–A4 + R completadas.
- `PLAN-reglas-completas-tabs.md` — catálogo completo de reglas con tabs.
