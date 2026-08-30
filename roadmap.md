# Roadmap — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico, gestión de AGENTS.md y skills. Rama primaria: `main`.
>
> Fuentes canónicas: `PLAN.md`, `AGENTS.md`, planes en `PLAN-*.md` y `roadmap.md` de cada proyecto.

## Siguiente bloque ejecutable

**308A-1 — Agregar gate Sentinel/VarSense a 5 proyectos.** Configurar el gate (sentinel + varsense)
en `coolify-manager-rs`, `Glory-Laminal`, `gloryapi`, `GLORYPORT` y el propio `workspace-manager`.
Detalle en `PLAN-agregar-gate-proyectos.md`. VarSense en Glory-Laminal está bloqueado por binario
ausente (igual que su roadmap `188A-5`).

## Bloqueos y decisiones que requiere del usuario

- **VarSense de Glory-Laminal**: igual bloqueo que su `188A-5` — el binario `varsense` no está en
  este entorno; decidir si se provisiona (clonar/compilar el commit público) o se aporta artefacto.
- **Alcance de cada proyecto**: algunos ya tienen parte del gate; confirmar el nivel objetivo (¿solo
  `sentinel.config.json`, o también `varsense.config.json` + `AGENTS.md` gate + lock?).

## Tareas pendientes (orden de dependencia)

1. **308A-1 — Gate completo en los 5 proyectos**: ver `PLAN-agregar-gate-proyectos.md`. Sub-bloques
   por proyecto en orden: `coolify-manager-rs` → `GLORYPORT` → `workspace-manager` → `gloryapi`
   (revisar) → `Glory-Laminal` (VarSense bloqueado).

## Planes activos

- `PLAN-agregar-gate-proyectos.md` — gate Sentinel/VarSense en 5 proyectos (nuevo, estado: propuesto).
- `PLAN-gate-dinamico.md` — proveedores de reglas/esquema vivos (R1/E1/E2/E3 commiteado).
- `PLAN-analisis-sentinel-consola.md` — análisis de sentinel en la consola (A0–A4 + R commiteado).
- `PLAN-reglas-completas-tabs.md` — catálogo de 105 reglas con tabs (commiteado).