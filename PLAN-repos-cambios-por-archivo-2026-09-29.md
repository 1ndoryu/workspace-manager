# 299A-4 — Panel lateral de cambios por archivo (tab repos)

> Revisión del usuario (misma sesión): **una sola lista, sin duplicar**. El
> header `cambios · repo N` y las secciones staged/changes del lateral
> sobran: la lista del acordeón (`DetalleRepo`, que ya enumera los
> archivos) es la clicable, con numeración +N −M por archivo; el lateral
> es solo el visor del diff del archivo elegido. Sin archivo elegido no
> hay lateral ni split.

Origen: pedido del usuario (2026-09-29) — al dar clic a un repositorio, revisar
los cambios individuales por archivo en un panel lateral, copiando la lógica de
glory-harness (su forma de ver los cambios por archivo), sin complicarse.

## Copiado de glory-harness (fuentes)

- `desktop/ui/src/componentes/gitDiff.ts`: `separarEntradas` (reparte
  `diff --cached` / `diff` por archivo vía `indexarPatches`: split en
  `diff --git ` + índice por ruta `+++ b/`), `contarCambios`/`sumarCambios`
  (+/− por línea), `pintarDiff` (hunks `@@`, nº línea vieja/nueva, aviso
  `No newline at end of file`).
- `desktop/ui/src/componentes/panelGit.ts`: secciones Staged/Changes, filas
  (código XY + ruta + stats +N/−N), clic en fila → diff; sin cambios = panel
  limpio, sin mensaje.
- `desktop/ui/src/estilos/git.css`: lista arriba (42%) + diff abajo con scroll;
  línea = grid 4ch 4ch 2ch 1fr.
- `core/src/git.rs` (`estado_en` + `archivos_no_rastreados`): `status
  --porcelain=v1 --untracked-files=all -z` + `diff --no-ext-diff --unified=3`
  (+ `--cached`) + untracked como `diff --no-index -- /dev/null <ruta>`
  (espera código 1 = hay diff), todo acotado en bytes y nº de archivos, rutas
  validadas (solo componentes normales: sin `..`, sin absolutos).

## Alcance

- Backend WM: `detalleArchivos(ruta)` en `src/server/scanner/git.ts` +
  `GET /api/repos/archivos?clave=` en `rutasRepos.ts` (mismo patrón
  anti-traversal que `/detalle`: clave resuelta del snapshot) + tipos en
  `shared/types.ts`. Solo lectura.
- Frontend WM (React, identidad v2 monocroma sin radios/sombras/bold):
  `src/v2/repos/gitDiff.ts` (port puro de la lógica), `apiRepos.ts`
  (`archivosRepo` + caché + invalidación en recargar),
  `src/v2/paneles/PanelCambiosRepo.tsx` (lateral: secciones + visor),
  split en `PanelRepos.tsx` cuando el seleccionado es git con locales, CSS
  `cambios*` en `paneles.css` con tokens `--v2-*`.
- Adiciones sobre harness (baratas, por identidad v2): binarios como aviso
  (`Binary files … differ`), adicion = relleno negro/texto invertido y
  eliminacion = rayado (monocromo estricto, sin verde/rojo).

## No alcance

- Stage/unstage/commit/discard desde el lateral (solo lectura, como el resto
  de la tab). Diffs de commits por subir/traer (el inline de 289A-6 ya los
  resume; el lateral es para sin-commitear).

## Fases verificables

- F1 backend: `detalleArchivos` + ruta + tipos; verificar con fetch directo
  (repo con staged + unstaged + untracked: p. ej. WM mismo).
- F2 frontend: port + lateral + split + CSS; `type-check` exit 0.
- F3 en vivo: tab repos, clic en repo con cambios → lateral con secciones y
  diff por archivo; repo al día → sin lateral; `…` mientras carga; recargar
  invalida.
- F4 cierre: roadmap 299A-4 a HECHO, commit sin push (push = usuario).

## Gate / DoD

- `npm run type-check` exit 0; endpoint 200 con entradas + ambos diffs;
  verificación visual de los 3 grupos (staged/changes/untracked) y del caso
  vacío; commit sin push.
