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
- [ ] N2 NAKOMI 38× `large-interface-isp` en DTOs de wire (`frontend/src/api/*`,
  `types/*`): misma clase que excepción coolify 229A-1 (formas de API, no
  segregables sin romper contrato). Documentar excepción; NO refactorizar.
- [ ] N3 NAKOMI .rs — BLOQUE PARCIAL HECHO Y PUSHEADO (commit `3ff178f4`,
  `abfb0eb3..3ff178f4`): `funcion-larga` `subscription_routes()` 101ef →
  `subscription_crud_routes` + `subscription_ops_routes` +
  `subscription_email_routes` + padre con governor `[07AA-7]`; `insert_tx`
  9→2 vía `EntradaAlertaChat<'a>` prestada (2 llamadores); `EmailLog::insert`
  8→2 vía `NuevoEmailLog<'a>` prestada (24 llamadores en email_admin ×8,
  email_misc ×9, email_orders ×5, worker ×2). Verificado: gate `07AA-14`
  PASS 0 errores (12 warnings: 3 god + 9 sqlite-N; 51 info: 38 ISP + 13
  params-info de API pública). LÍMITE HONESTO: `cargo check` no ejecutable
  en este turno (shim del guard BLOQUEA cargo directo y `cargo-stage.ps1`
  manual; `stages.json` solo corre sentinel; eludir por path absoluto =
  bypass, prohibido). Compilación pendiente vía flujo con lease
  (`npm run check:back` por el dueño o stage cargo en gate). Transformación
  revisada a mano: mismos expresiones, solo cambia posición (sitios de
  coerción equivalentes).
  RESTA (siguiente turno, con compilación disponible): 14 params-info de API
  pública (6 email_admin `send_*` 9–13p con `#[allow(clippy…)]` vigente,
  3 email_orders, 3 provisioning, 1 checkout, 1 lifecycle — agrupar cambia
  firmas públicas, requiere cargo verde) → 9 sqlite-N (análisis de
  independencia por sitio) → 3 god-object (splits por dominio).
- [ ] W WM 12 en zona VPS: VERIFICADO CALIENTE 2026-10-07 — NO TOCAR.
  `0110A-3` F3 HECHA sin commit ni push + `rutasVpsPiezas.ts` untracked
  ajeno en curso; roadmap `0610A-1` declara resto = zona concurrente
  0110A-3. Se difiere documentado (este plan + roadmap).
- [ ] Cierre: `GET /api/consola/problemas` final, completada, commits con push
  por repo tocado, limpieza `C:\tmp\problemas-07AA-14.json`.

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
