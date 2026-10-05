# 039A-5 — Rust: limpieza automática + arranque sin ventanas (2026-10-04)

> **ARCHIVADO 2026-10-05 (04AA-1 REPLANTEADA).** Veredicto REPLANTEAR del
> subagente supervisor-thinking + investigación profunda: Fase 1 ya existía,
> Fases 2-3 inseguras (borrado por `mtime`), Fase 4 no autorizable sin el
> usuario, Fase 5 contradictoria, solape con `GloryTmpSweep`/`cargo-sweep`.
> Replanteo vivo: **05AA-1** =
> `Agente/planes/plan-rust-perfil-y-purga-2026-10-05.md`. Este archivo se
> conserva íntegro como evidencia; no ejecutar sus fases.

Pedido del usuario: la basura de compilación Rust se acumula porque con la app en marcha
no se deja borrar, y cada arranque abre una ventana de consola indistinguible.

## Objetivo

- Tras `stop`, cada proyecto Rust queda en sus pocos MB (solo el ejecutable).
- En marcha, lo viejo se borra solo por antigüedad sin parar nada.
- `up` no abre ventanas de consola; cada app se identifica por puerto en `status`.
- Automático para proyectos presentes y futuros, sin pedir limpieza a mano.

## No alcance

- No se tocan `Cargo.toml` de proyectos (nada de `panic="abort"`, LTO agresivo ni UPX).
- No se cambia la config global de Cargo del usuario sin su visto (se propone, no se impone).
- `PROYECTO TASKS` (dependencia rota ajena) queda fuera hasta arreglarse allí.

## Fases

1. **Ventanas ocultas.** `windowsHide: true` en el spawn de `scripts/dev/doctor.mjs`
   (`lanzar`). Verificar: `up` no abre ventana, `status` sigue verde, log sigue escribiéndose.
2. **Borrado por antigüedad en marcha.** Nuevo `scripts/dev/limpieza-rust.mjs`: por proyecto
   Rust, borra en su `target/` lo no tocado en >60 min sin tocar el ejecutable en uso
   (reintento tolerante a bloqueo Windows: lo bloqueado se salta, no aborta).
   Se ejecuta al final de `up` y en la tarea por hora existente.
3. **Borrado total en `stop`.** Tras detener listeners propios, limpia el `target/` del
   proyecto (queda el ejecutable si vive fuera de `target/`, si no queda todo limpio
   y el próximo `up` recompila desde caché).
4. **Caché compartida global (propuesta al usuario antes de aplicar).**
   `CARGO_TARGET_DIR=C:\tmp\glory-target\<rama>` (ya en wrappers) + `sccache` como
   wrapper global vía `%CARGO_HOME%\config.toml`: vale para futuros sin tocar nada.
5. **`strip = true` en release de glory-pulse** (único cambio de perfil, seguro).
   Verificar binario menor, servicio igual.
6. **Cierre:** `doctor --all --assert` + trampa + type-check en verde, commit, roadmap
   y docs (`AGENTS.md` del mando) actualizados.

## Definition of Done

- `up`/`stop` no abren ventanas; `status` identifica por puerto.
- Tras `stop <rust>`, su `target/` ≤ unos MB; en marcha, sin crecimiento sin cota
  (techo `C:\tmp` 7 GB respetado).
- Recompilar tras limpiar: rápido por `sccache` (no full lento).
- Commit + push con evidencia de cada fase.

## Riesgos

- `cargo watch` + limpieza agresiva = recompilaciones lentas en sesión dev:
  mitigado con umbral 60 min y exclusión del ejecutable en uso.
- Config global de Cargo afecta a otros agentes/proyectos: por eso va como propuesta
  explícita, no silenciosa.
