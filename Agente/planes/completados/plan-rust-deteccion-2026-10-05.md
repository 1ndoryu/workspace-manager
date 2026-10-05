# 05AA-2 — Detección de Rust mal configurado en el tablero (2026-10-05)

> **ESTADO 2026-10-05: EJECUTADA (F1-F3 hechas y verificadas; commit sin push).**
> Origen: pedido del usuario tras 05AA-1 («que el workspace detecte cuando un
> proyecto Rust esté mal configurado»).

## Objetivo

Que `doctor --all` (y la consola que lo consume) **avise** cuando un proyecto
Rust del área esté mal configurado en lo que 05AA-1 ya midió y arregló.
Solo lectura + aviso: **jamás purga, jamás reescribe manifiestos**.

## No alcance

- Ninguna purga ni escritura fuera de logs (la purga sigue siendo manual con
  `cargo-sweep`, decisión del humano).
- No cambia `Cargo.toml`, wrappers ni entorno global (eso es F4/F5 de 05AA-1).
- No es gate de Sentinel (esto es salud del área, no calidad de código).
- `PROYECTO TASKS` fuera (roto por dependencia ajena E0753).

## Chequeos (los 4, todos fail-open: si algo no se puede medir, se omite)

1. **Tamaño.** `target/` efectivo por proyecto > **2 GB** → aviso. Resolución
   del dir efectivo con la misma regla de 05AA-1 F0: `CARGO_TARGET_DIR` del
   wrapper > variable de usuario global > `target/` in-tree. Proyectos:
   `glory-pulse`, `glory-harness`, `NAKOMI`, `MN-Inmobiliaria`, `WANDORIUS`,
   `coolify-manager-rs`, `limpiador-pc` (los del `registro.json` con Rust).
2. **Perfil.** Manifiesto raíz del proyecto sin sección `[profile.dev]` con
   `debug = "line-tables-only"` → aviso «sin perfil adelgazado (05AA-1)».
   OJO: el manifiesto a leer es el que usa su `dev:back` real (raíz con
   `[package] name="glory-backend"`, NO `glory-rs/backend/Cargo.toml`
   legacy; `glory-harness` es workspace → raíz).
3. **Caché.** `RUSTC_WRAPPER` ausente en el entorno del wrapper/usuario, o
   `sccache --show-stats` con hit rate < 5% teniéndolo → aviso informativo
   (no error: F4 sigue en propuesta).
4. **Colisión.** Dos o más proyectos resolviendo al MISMO `target/` efectivo
   (hoy: MN y WANDORIUS comparten `C:\tmp\glory-target` y el mismo nombre de
   binario `glory-backend`) → aviso informativo (motivo para `target/` por
   proyecto en F5).

Formato del aviso: reutilizar los estados del mando (verde/degradado, exit
`0`/`2`); un aviso Rust **degrada a 2, nunca rompe a 1** (1 = instrumento roto).

## Fases (checklist ejecutable)

1. **F1 diseño (sin código).** Decidir dónde vive el chequeo: sensor nuevo en
   `scripts/dev/doctor.mjs` (lo consume `doctor --all` y la consola) vs
   chequeo en el backend `/api/workspace`. Criterio: lo que ya sepa resolver
   `targetDir` efectivo por proyecto con menos código nuevo. Registrar la
   decisión en este plan antes de programar.
   **Decisión F1 (2026-10-05): sensor `detectarRust(registro)` en
   `doctor.mjs`, misma forma que `detectarCompartidos` (función pura sobre el
   registro + lecturas, campo `informe.rust`, exit 2, fail-open sin tocar
   `errorSensor`/`--assert`).** Motivos: el backend (`vigilancia.ts`) solo
   exige `informe.proyectos` array → campo extra ignorado sin romper nada;
   `trampa.mjs` es caja negra por CLI → no se toca; `tsconfig` solo cubre
   `src` → el sensor es JS plano sin fricción de tipos. El `target/` efectivo
   se resuelve con la regla F0 de 05AA-1 (env entrada > env usuario > in-tree)
   midiendo solo dirs que existen.
   **Corrección DoD con evidencia:** la colisión MN/WANDORIUS es REAL hoy
   (ambos en `main`, `C:\tmp\glory-target` sin subramas) → el sensor
   ENCENDERÁ 1 aviso sobre el área real, no 0. Es el sensor haciendo su
   trabajo (motiva F5 de 05AA-1); F3 verifica: resto de chequeos en silencio +
   exactamente ese aviso esperado.
2. **F2 sensor solo-lectura.** Implementar los 4 chequeos + tests contra
   fixture en `C:\tmp` (proyecto falso con `Cargo.toml` sin perfil y dir
   falso pesado). Prohibido: `rm`, `cargo`, `Start-Process` con escritura,
   tocar repos reales.
3. **F3 verificación.** `npm run type-check` + `node scripts/dev/trampa.mjs`
   + `doctor --all` en vivo: los 6 proyectos cumplen hoy → **cero avisos**
   sobre el área real (cero falsos positivos), y los 4 avisos saltan sobre
   el fixture. Medir que el sensor añade < 5 s al `doctor`.
4. **F4 cierre.** Commit en este repo (sin push), entrada en
   `Agente/completados/tareas-YYYY-MM-DD.md`, y actualizar la skill
   `skills/dev-bootstrap/SKILL.md` solo si el sensor cambia el contrato del
   mando (si no, no tocar docs).
   **Resultado F2+F3 (2026-10-05):** sensor implementado en `doctor.mjs`
   (~150 líneas: `detectarRust` + cableado informe/tabla/exit) + tipos
   `AvisoRust` en `src/shared/dev.ts`. Fixture `C:\tmp\fixture-05AA2.mjs`
   6/6 (4 chequeos + determinismo + cache-low avisa / cache-ok calla). En
   vivo: `doctor --all` exit 2 con exactamente 1 aviso (colisión de los 7
   en `C:\tmp\glory-target`), `type-check` 0, sensor +2,5 s, skill sin
   cambios (contrato intacto).

## Gate y DoD

- Gate: `type-check` + `trampa.mjs` verdes (este repo no tiene gate Rust).
- DoD: 4 avisos verificados sobre fixture + 1 aviso esperado sobre el área
  real (colisión MN/WANDORIUS, resto en silencio) + sensor solo +2,5 s en
  `doctor --all` + commit sin push.
