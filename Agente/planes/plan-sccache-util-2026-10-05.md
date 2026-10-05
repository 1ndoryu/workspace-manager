# 05AA-3 — sccache útil para arranques siempre desde cero (2026-10-05)

> **ESTADO 2026-10-05: ACTIVA (aprobada por el usuario «para hacerlo»).**
> Ejecuta el F4 propuesto de 05AA-1. La tarea `GloryTmpSweep` NO se toca.

## Por qué (perfil de uso del usuario, 2026-10-05)

- El usuario borra `C:\tmp` para ahorrar espacio y arranca varios Rust siempre
  desde cero; nada necesita quedar encendido.
- Con ese perfil, el «precio» de sccache (día a día más lento sin incremental)
  no existe: nunca hay recompilación en caliente.
- Verificado: caché en `AppData\Local\sccache` (fuera de `C:\tmp`, sobrevive a
  borrados), tope 5 GB ideal (no tocar), hit hoy 0,89% (inútil por incremental
  activo + sin `SCCACHE_BASEDIRS`).

## Objetivo

Rebuild frío tras borrado (el caso diario del usuario) claramente más rápido
y con menos CPU, tirando de caché en vez de recompilar todo.

## No alcance

- No se toca `scripts/mantenimiento/limpiar-tmp.ps1` ni la tarea `GloryTmpSweep`
  (la purga horaria ayuda a este perfil; sccache abarata su consecuencia).
- No se toca config global `%CARGO_HOME%\config.toml` (eso era F5, sigue fuera).
- NAKOMI exento (código roto, 77 errores, ajeno). Sin push en ningún repo.

## Fases (checklist ejecutable)

1. **F1 inventario de lanzamientos (solo lectura).** Por proyecto, de dónde
   sale cada `cargo`: wrappers `run-with-db.mjs` (MN/WANDORIUS), `dev:back`
   (NAKOMI), mando (`-p glory-harness`, `pulse`), builds manuales
   (coolify/limpiador). Decidir el punto mínimo de inyección de entorno y
   verificar que `RUSTC_WRAPPER=sccache` (ya en usuario) llega a esos spawns.
   Registrarlo aquí antes de programar.
2. **F2 aplicar entorno.** `CARGO_INCREMENTAL=0` + `SCCACHE_BASEDIRS` (raíz del
   área) en los puntos de F1. Solo entorno, sin tocar flags ni perfiles.
3. **F3 validación con medida.** Borrar `C:\tmp\glory-target` (hábito del
   usuario, sin valor que conservar), rebuild piloto (uno pequeño + uno
   grande), medir tiempo vs baseline (pulse frío 246 s) +
   `sccache --show-stats` (hit rate vs 0,89% de hoy).
4. **F4 extensión + cierre.** Resto de proyectos, commits por repo (solo lo
   tocado, sin push), evidencia en `Agente/completados/tareas-YYYY-MM-DD.md`.

## Gate y DoD

- Gate: builds OK + humo por binario (como 05AA-1 F2).
- DoD: frío post-borrado medido más rápido que baseline + hit rate >20% (vs
  0,89%) + commits sin push. Si no mejora, se revierte F2 y se registra.
