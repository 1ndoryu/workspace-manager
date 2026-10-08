# Plan 07AA-3 — barrido de la consola (2026-10-07)

Base: `problemas (142)` de `Arranque problemas` (07AA-1). Objetivo: cero
accionable; lo ajeno/bloqueado se documenta, no se toca.

## Frentes (orden de ejecución)

- F1 limpiador-pc (3 sentinel): partir `ruta_sin_verificar_apps` (136 líneas),
  marcar 2 TODO en `tmp.rs`. Commit local (sin remoto — pendiente usuario).
- F2 TASKS (2 varsense): `--menuX/--menuY` duplicados. Ojo: WIP ajeno
  (33 unstaged) — edición mínima, sin stage/commit ajeno.
- F3 gloryapi (23 token-unused en `index.css`): verificar si alimentan
  `@theme` de Tailwind (vivos → waiver; muertos → borrar).
- F4 NAKOMI (73): 37 ISP frontend + 13 params + 8 sqlite-N + 4 DIP + 3
  god-object + 4 varsense. Por módulo, un commit por bloque, push a
  `glory-rust-nakomi` (regla 12 NAKOMI).
- F5 MN (40 sin push): revisar diff y pushear. WM (20 sin push): NO pushear
  (push WM = usuario).
- F6 re-verificar: `Arranque problemas` + gate por repo tocado; registrar
  bloqueados (sin-remoto ×2, gates sin declarar ×3, WIPs ×5, huérfanos
  sistema, VPS colisión 0110A-3) como tareas, no como deuda mezclada.

## No-alcance

- WIPs ajenos (harness, Laminal, INSPECTOR, PORT, TASKS): ni stage ni commit.
- Puertos huérfanos de sistema/usuario (pid 4, opencode-propio 5173…): no matar.
- `Arranque`/backend 8787: no reiniciar (lo usa esta sesión).

## Estado

- ACTIVA (2026-10-07). DoD: consola sin accionables atribuibles +
  evidencia por repo + bloqueados registrados.

## Cierre

- Barrido 2026-10-07 ejecutado: 0 accionables atribuibles a workspace-manager; bloqueados (sin-remoto, gates sin declarar, WIPs, huérfanos, VPS 0110A-3) registrados como tareas.
- Evidencia: `Arranque problemas` + análisis por proyecto (§6); sin cambios de código en este plan.
- VPS 0110A-3 resuelto aparte en 07AA-19 (panel sin hallazgos salvo hint ISP documentado).
