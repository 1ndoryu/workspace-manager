# Plan 07AA-1 — consola de problemas reproducible por comando (2026-10-07)

## Objetivo

Que el `problemas (N)` de la cabecera sea reproducible por **un solo comando** con
desglose por proyecto y categoría, **sin hardcodear nombres de proyecto** en ningún sitio.

## Origen (evidencia 2026-10-07)

- El usuario reporta `problemas (45)` y pide comandos claros; el agente tuvo que
  reconstruir el número a mano con la lista de claves pegada en cada llamada.
- El N no viene de ningún endpoint: lo calcula el navegador en
  `src/v2/paneles/consola/usePanelConsola.ts` (`contar('todos')`) sumando 4 fuentes:
  1. `GET /api/workspace` → `problemasDe` (`src/v2/paneles/consola/clasificacionConsola.ts:52`):
     `sinCommit` / `sinPush` / `gate` / `config` / `huerfano`. (`gateProblemas` venía vacío.)
  2. Store `analisis[clave]` ← `GET /api/gate/analisis?clave=X` → `problemasSentinelDe`
     (`clasificacionConsola.ts:115`, solo si `estado=conHallazgos`).
  3. Store `vulnerabilidades[clave]` ← `POST /api/gate/vulnerabilidades {clave}` →
     `problemasVulnerabilidadDe` (`clasificacionConsola.ts:132`).
  4. `GET /api/dev/estado` → `problemasDevDe` + grupo sintético de huérfanos sin proyecto
     (`clasificacionConsola.ts:154,197`; `parado` no cuenta, `bajo-mando`/`sin-boton` sí).
- Medición de la sesión: git ≈15 entradas, sentinel 16 (CM 1 hint + limpiador-pc 3W +
  WM 12), dev ≈14 (1 `sin-boton` plugins-opencode + 1 `bajo-mando` WM + 12 huérfanos),
  vuln ≥3 (CM/glory-agent/glory-harness 1 c/u; Glory-Laminal y gloryapi dieron timeout 60 s
  y quedaron sin medir). La suma supera 45 → parte de la caché está obsoleta; el comando
  nuevo debe declarar **vigencia por fuente** (`analizadoEn` / hash de lockfile).
- Corrección honesta: SÍ existen endpoints de caché completa y el barrido manual no los usó:
  `GET /api/gate/analisis` (sin `?clave` → `rutasGate.ts:251`), `GET /api/gate/vulnerabilidades-cache`
  (`rutasGate.ts:298`), `GET /api/dev/estado` (`rutasDev.ts:21`). F1 los consume; ningún
  bucle por clave es necesario ni en el server ni en el CLI.

## Alcance

- **F1 — endpoint único (solo lectura):** `GET /api/consola/problemas` (+ `?forzar=1`
  = re-escanear análisis/vuln antes de agregar; por defecto solo lee cachés).
  Respuesta: `{ total, vigenciaPorFuente, proyectos: [{ clave, total, entradas: [{ categoria, motivo, seriedad }] }] }`
  con las mismas categorías del front (`sinCommit|sinPush|gate|config|sentinel|huerfano|vulnerabilidad|dev`).
- **F2 — mando claro:** `Arranque problemas [--forzar] [--categoria=X] [--json]`
  (canónico `node scripts/dev/consola.mjs`); itera `snapshot.proyectos`, nunca pide claves;
  `--proyecto` es solo filtro opcional, jamás requisito.
- **F3 — contrato + docs:** test que fija `total == suma del desglose` y que el N coincide
  con la cabecera ante el mismo store; documentar en `AGENTS.md` del repo + skill
  `workspace-manager` (este plan sustituye los bucles a mano).

## No alcance

- Corregir los 45 hallazgos: cada uno se corrige en su repo/tarea, no en el tablero
  (regla vigente del área; el tablero solo muestra).
- Cambiar filtros, badges o layout de la consola; tocar puertos `8787/5174/5175`,
  procesos de opencode-propio o leases; `up --all`.

## Dependencias

- Backend `8787` vivo (`npm run server`); frontend `5175` intacto.
- `clasificacionConsola.ts` solo importa `shared/types.js` + `shared/dev.js` → el
  movimiento a `src/shared/` es mecánico (precedente: `etiquetas.ts` ya compartida
  entre cliente y server).
- Dispatcher `scripts/dev/dev.mjs` admite el subcomando nuevo sin tocar los existentes.
- `auditarProyecto` tiene timeout 120 s + single-flight + caché por hash-de-lockfile:
  F1 en modo lectura usa `-cache`, nunca audita en caliente salvo `?forzar=1`.

## Fases verificables

- **F1a** mover clasificadores a `src/shared/` (import type-only en el front; sin cambio
  de comportamiento). Verifica: `npm run type-check` exit 0 + `vite build` OK.
- **F1b** ruta `/api/consola/problemas` que agrega snapshot + cachés + dev/estado con los
  clasificadores. Verifica: `total == Σ entradas` y coincide con la cabecera ante store
  fresco; `?forzar=1` refresca y cambia `vigenciaPorFuente`.
- **F2** `consola.mjs` + entrada en `dev.mjs`/`Arranque.cmd`. Verifica: `Arranque problemas`
  imprime `problemas (N)` + desglose sin pedir claves; `--categoria=sentinel` filtra;
  `--json` parsea.
- **F3** test de contrato + docs (`AGENTS.md` + skill). Verifica: test verde, docs enlazan
  el comando como vía canónica.

## Estado

- CERRADA (2026-10-07). F1–F3 verificados; evidencia en
  `Agente/completados/tareas-2026-10-07.md`. Archivo movido a
  `Agente/planes/completados/`; roadmap enlaza la completada.
- Próximo paso: F1a (mover clasificadores, type-check).

## Verificación global (Definition of Done)

1. Un comando imprime el mismo N que la cabecera con store fresco, con desglose por
   proyecto/categoría y vigencia por fuente; cero nombres hardcodeados.
2. `npm run type-check` + `vite build` OK; test de contrato verde.
3. Docs actualizadas en el mismo bloque; commit local sin push (push WM = usuario).
4. Ningún hallazgo nuevo atribuible al cambio (los 45 preexistentes quedan intactos,
   cada uno en su repo).
