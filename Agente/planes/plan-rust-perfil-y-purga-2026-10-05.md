# 05AA-1 — Rust: perfil dev adelgazado + purga con cuota (2026-10-05)

> **ESTADO 2026-10-05: F0–F3 HECHOS + PROPAGACIÓN COMPLETA, F4/F5 PROPUESTA.**
> Hallazgo clave: `CARGO_TARGET_DIR=C:\tmp\glory-target` ya es variable de
> usuario global (todo compila ahí, no in-tree). Piloto glory-pulse +
> propagación a los 6 manifiestos (receta 124A-OPT1): 5 builds OK,
> `.pdb` 22–38 MB, `glory-target` 7,06→3,73 GB tras
> `cargo-sweep sweep --maxsize 4GB` (commits por repo, sin push).
> Ventanas: las abren los nietos (`rustc`/linker) al compilar en frío, no el
> mando; el arreglo es compilar en frío menos veces (cuota, no purga por
> tiempo). `sccache` SÍ instalado (0.15.0) pero con hit 0,89% → F4 propuesta.
> NAKOMI exento (código roto, 77 errores). Evidencia completa:
> `Agente/completados/tareas-2026-10-05.md`.

Replanteo de `04AA-1` (veredicto REPLANTEAR del subagente supervisor-thinking +
investigación profunda del 2026-10-05). Plan anterior archivado en
`Agente/planes/completados/plan-rust-limpieza-auto-2026-10-04.md` (se conserva
como evidencia; no ejecutar sus fases 2-4 automáticas).

Pedido original del usuario: la basura de compilación Rust se acumula y cada
arranque abría una ventana de consola indistinguible.

## Objetivo

- Generar menos basura por compilación (perfil dev adelgazado por proyecto).
- Purgar lo obsoleto con herramienta que entiende Cargo (fingerprints/cuota),
  nunca borrado ciego por fecha ni `rm -rf` en `up`/`stop`.
- Que `sccache` sirva de verdad tras cada purga (hoy apenas aporta).
- `up` sin ventanas de consola; `status` identifica por puerto (verificar).

## No alcance

- No se toca config global de Cargo del usuario (`%CARGO_HOME%\config.toml`)
  sin su visto explícito: queda como propuesta F5, no se ejecuta.
- No se borra `target/` en `up`/`stop` (convierte cada arranque en frío).
- No `panic="abort"`, LTO agresivo ni UPX. Se descarta el `strip` del plan
  anterior (solo afecta a release, no al `target/debug` que es lo que crece).
- `PROYECTO TASKS` fuera hasta arreglarse allí su dependencia rota.

## Fases (checklist ejecutable)

1. **F0 inventario (solo lectura).** Por cada proyecto Rust con mando
   (`glory-pulse`, `glory-harness`, backends glory-template): resolver
   `targetDir` efectivo (respeta `CARGO_TARGET_DIR` del wrapper, no asumir
   `./target`), medir tamaño y anotar tiempo de `up` en frío conocido.
   SIGUIENTE ACCIÓN: tabla `id → targetDir → GB` en la evidencia de cierre.
2. **F1 verificar ventanas ocultas.** Confirmar `windowsHide:true` ya en
   `scripts/dev/doctor.mjs` (`lanzar`): `up` no abre ventana, `status` verde,
   log se escribe. Si ya está, se documenta y se cierra (no-op).
3. **F2 perfil dev adelgazado (por proyecto, con medición).** En el
   `Cargo.toml` de cada proyecto Rust, solo sección `[profile.dev]`:
   `debug = "line-tables-only"` + `[profile.dev.package."*"] debug = false`.
   Medir `target/` antes/después y tiempo de rebuild. Nota: `incremental`
   se deja activado en dev (apagarlo ahorra ~30% pero relentiza ediciones;
   solo se apaga si F4 lo exige y con visto). Commits por repo, sin push.
4. **F3 purga con cuota (evaluar y adoptar UNA).** Comparar
   `cargo-clean-targets` vs `cargo-hold` con `--dry-run` sobre los
   `targetDir` de F0: elegir la que conserve binarios, respete Windows y
   tenga mantenimiento activo. Definir cadencia (manual vía
   `dev limpiar <id>` o gancho a tarea existente; jamás dentro de
   `up`/`stop`). Primera purga real solo con dry-run previo revisado.
5. **F4 sccache que sí aporta (wrappers, no global).** Solo si F3 deja fríos
   frecuentes: `CARGO_INCREMENTAL=0` + `SCCACHE_BASEDIRS` (raíces de repos
   y temporales) en los wrappers `run-with-db.mjs`/equivalentes, nunca en
   config global. Medir rebuild frío tras purga con/sin caché (debe pasar
   de minutos a segundos en dependencias). Si no aporta, se revierte.
6. **F5 PROPUESTA al humano (no ejecutar).** Config global
   `%CARGO_HOME%\config.toml` + volumen Dev Drive (ReFS, Win11): se redacta
   la propuesta con pros/contras y la ejecuta el usuario si la acepta.
7. **F6 cierre.** `doctor --all --assert` + trampa + `type-check` en verde,
   commit por bloque, roadmap y docs actualizados.

## Definition of Done

- Tabla F0 + mediciones frío/caliente antes/después registradas.
- `target/` por proyecto acotado con cuota o purga revisada; `C:\tmp` <7 GB.
- Recompilar tras purga: rápido por sccache (medido, no afirmado) o
  documentado por qué no.
- Sin ventanas en `up`; `status` por puerto; F5 queda como propuesta
  pendiente, no como deuda silenciosa.

## Riesgos

- Perfil dev distinto por proyecto invalida cachés sccache entre ramas hasta
  el primer rebuild (coste único, medido en F4).
- Herramienta de purga nueva: solo tras dry-run; primera ejecución con
  el usuario avisado (borrado real aunque selectivo).
- `cargo watch`/rust-analyzer activos durante F3: purga manual solo con
  proyectos detenidos (`stop` primero).

## Gate / evidencia

- `doctor --all --assert`, trampa 7/7, `type-check` exit 0.
- Evidencia: `Agente/completados/tareas-2026-10-05.md` (tabla F0,
  mediciones, herramienta elegida, commits por repo).
