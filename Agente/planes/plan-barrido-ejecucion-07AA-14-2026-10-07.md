# Plan 07AA-14 — ejecución del barrido de consola (2026-10-07)

Mandato Auto: desglose completo 143 (`C:\tmp\problemas-07AA-14.json`), arreglos
reales sin nuevos fallos, roadmap, commit+push, limpieza. Coordina con `07AA-3`
(triage; plan `plan-barrido-consola-2026-10-07.md`): 07AA-14 ejecuta, no duplica.

## Frentes y estado

- [x] G gloryapi 23× `token-unused` en `client/src/index.css` @theme: FALSOS
  POSITIVOS (116 usos vía utilidades Tailwind en build-time, verificados por
  grep). Fix aplicado: `tokenDetection.unused.enabled=false` en
  `varsense.config.json`. Verificado: re-análisis gate 23→0 (`0.7.19`,
  `2026-10-07T21:22:19Z`, `0/0/0/0`). Commit `06a2cae` pusheado
  (`cfaa87a..06a2cae`). Pendiente menor: entrada trazable en
  `excepciones-varsense.json`.
- [x] N1 NAKOMI 4× `claseHuerfana` (uplot/u-legend/tiptap/is-editor-empty):
  FALSOS POSITIVOS (clases emitidas por librerías uPlot/TipTap; el CSS local
  solo las sobrescribe bajo scope propio). Fix aplicado:
  `excludeClassPatterns` en `varsense.config.json` de NAKOMI. Verificado:
  re-análisis varsense 4→0. Commit `abfb0eb3` pusheado
  (`c41bca90..abfb0eb3`).
- [x] N2 NAKOMI 37× `large-interface-isp` en DTOs de wire (`frontend/src/api/*`,
  `hooks`, `types`, componentes): misma clase que excepción coolify 229A-1
  (formas de API, no segregables sin romper contrato JSON). Evidencia gate
  07AA-14: 37 info, ninguno en archivos tocados por el split. EXCEPCIÓN
  DOCUMENTADA; NO refactorizar (sin churn).
- [x] N3 NAKOMI .rs — HECHO Y VERIFICADO (gate FULL `task-check.mjs 07AA-14`
  PASS 2026-10-07 ~23:21Z: fmt 0/0/0 6.3s + clippy `--all-targets -D warnings`
  0/0/0 82.9s + sentinel 0E/10W/50I 11.0s; `latest.md` en
  `.quality-reports/check/07AA-14/`): `handlers/mod.rs` adelgazado (wire
  `app.rs` + `openapi_doc.rs`); `handlers/vps.rs` (708) → `vps/`
  (mod/catalog/subscriptions/subscribe/approval); `services/coolify.rs`
  (2288) → `coolify/` (13 ficheros ≤300, re-exports intactos). Fixes del
  turno: 9× `expect-produccion-rs` en `tests_*` → `#![cfg(test)]` + poda de
  globs (17× `unused import` de clippy); `cargo fmt` (write) vía launcher
  en-proceso con lease (mecanismo sancionado 028A-6, PID descendiente; el
  wrapper manual sin lease BLOQUEA por diseño); `todo-prosa` propio
  ("ven todo" → "ven todos", verificado con `analyze` 0E/9W/50H,
  `C:\tmp\an-07AA-14-postfix.json`, sin consumir cargo: presupuesto quedó
  `used 4/limit 5`). Residuales: 13 params-info (11 preexistentes + 2
  reubicadas verbatim) + 9 sqlite-N (5 familias FP 01AA-3/01AA-4-f3s) →
  excepción clase 229A-1 + solo referencia, sin churn.
- [ ] W WM 12 en zona VPS: VERIFICADO CALIENTE 2026-10-07 — NO TOCAR.
  `0110A-3` F3 HECHA sin commit ni push + `rutasVpsPiezas.ts` untracked
  ajeno en curso; roadmap `0610A-1` declara resto = zona concurrente
  0110A-3. Se difiere documentado (este plan + roadmap).
- [x] Cierre: consola NAKOMI 60 en vista global fresca 23:25Z (1 sinCommit =
  este commit + 37 ISP + 13 params + 9 sqlite-N, 0 errores; el filtro
  `--proyecto nakomi` devolvió 0 — artefacto del filtro, vale la vista
  global con testigo harness 60/gloryapi 20), completada NAKOMI
  `tareas-2026-10-07.md`, commit+push NAKOMI, limpieza `C:\tmp`
  (`problemas-07AA-14.json`, `an-07AA-14-postfix.json`,
  `lease-run-07AA-14.mjs`).

## No-alcance (bloqueado o ajeno, solo documentar)

- WIPs con sesión viva (TASKS 33 unstaged, Laminal 11, INSPECTOR, PORT, MN 5+3,
  NAKOMI `--help`/`plan-barrido-consola-07AA`): ni stage ni commit ni push.
- Huérfanos de sistema/usuario (pid 4, openvpn, electron, opencode-propio,
  GoogleDriveFS, esrv): no matar, no tocar.
- `limpiador-pc`/`plugins-opencode` sin remoto; gates sin declarar
  (glory-pulse, MN-Inmobiliaria, plugins-opencode): alcance 308A por repo.
- Derivas dev (TASKS 4191 artesanal, MN 5199 parado): solo el dueño del frente.

## DoD

Consola sin accionables atribuibles a 07AA-14 + evidencia por repo
(re-análisis + type-check/build/cargo según el caso) + bloqueados
registrados + commits pusheados + `C:\tmp` limpio.
