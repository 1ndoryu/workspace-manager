# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-2 — Saneamiento seguro de AGENTS.md y auditoría integral.** S0/S1 completadas; S2 avanzada: S2-01 a S2-04, S2-09 (categorías `sin commit` y `huérfanos`), S2-10/S2-11 (config de 36 a 0 problemas) y **S2-13 (consolidación de AGENTS.md completada)**: instrucciones de los 8 proyectos consolidadas en la sección §9 del `AGENTS.md` raíz; los `AGENTS.md` secundarios se eliminaron con `git rm` por repo tras backup S0 verificado (58/58 + `disk-v2` de WANDORIUS). S2-12 parcialmente completada: Glory-Laminal 12→0 (ISP en store, boundary window en tooltip, disable-file justificado en `widgets.css` por ser receta canónica) y gloryapi 23→18 (5 hallazgos React corregidos: inline-style, 2 selects, hook de estado, hook de panel). Pendientes: S2-05 (VarSense sin runtime oficial) y los 18 hallazgos estructurales de gloryapi (limite-lineas/directorio-abarrotado/ISP/barrel; requieren refactor no mínimo o archivos con cambios ajenos).
Detalle en `PLAN-saneamiento-agents-y-analisis.md` y registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`.

## Bloqueos y decisiones

- Ningún backup se considera válido sin manifest y hash coincidente.
- No se borra contenido si no existe rollback verificable.
- Worktrees, referencias, configuraciones, locks y `AGENTS.md` se procesan individualmente y con evidencia concreta.
- Las carpetas normales no se clasifican como árboles huérfanos.

## Tareas pendientes (orden de dependencia)

1. `308A-2 / S2-05` — resolver VarSense por fuente oficial o documentar limitación (bloqueada sin runtime).
2. `308A-2 / S2-12` — refactors de código: Glory-Laminal 12→0 (commit eebe026); gloryapi 23→8 (10 corregidos en archivos limpios: 6 limite-lineas vía submódulos, 3 directorio-abarrotado vía `directoryExceptions`, 1 ISP; 315/315 tests OK). Quedan 8 hallazgos en 6 archivos con cambios ajenos sin commitear (bloqueados hasta aislar).
3. `308A-2 / S2-08` — revisión SOLID, eficiencia y regresiones de la detección nueva.
4. `308A-1` — gate Sentinel/VarSense en cinco proyectos; ver `PLAN-agregar-gate-proyectos.md`.

## Planes activos

- `PLAN-saneamiento-agents-y-analisis.md` — S2 en ejecución controlada.
- `PLAN-agregar-gate-proyectos.md` — gate Sentinel/VarSense en cinco proyectos.
- `PLAN-gate-dinamico.md` — proveedores dinámicos, R1/E1/E2/E3 completadas.
- `PLAN-analisis-sentinel-consola.md` — análisis de Sentinel en consola, A0–A4 + R completadas.
- `PLAN-reglas-completas-tabs.md` — catálogo completo de reglas con tabs.
