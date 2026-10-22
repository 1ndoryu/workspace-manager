# Rendimiento del escaneo del workspace (medido 2026-10-19)

## Método

- Máquina: VPS del taller (alias y ruta de su config privada), workspace `<raiz-taller>`, 19 proyectos.
- Script de medición de solo lectura (no escribe en la réplica): llama a
  `escanearWorkspace` dos veces seguidas en el mismo proceso y luego a `refrescarGit`
  sobre el snapshot ya obtenido, cronometrando cada llamada con `performance.now()`.
- Ejecución: `npx tsx <script> <raiz-taller> <repo-workspace-manager>` desde la VPS.
- Una sola medición por caso; los números son orden de magnitud, no una media.

## Resultados

| Operación | Tiempo |
|---|---|
| Escaneo completo, frío (sin caché en memoria) | 151 ms |
| Escaneo completo, segunda vez (mismo proceso) | 54 ms |
| Refresco git sin re-escanear | 44 ms |

## Qué significa

- El escaneo completo cuesta poco en la 89 con 19 proyectos. La caché en memoria
  (`src/server/cache.ts`) evita pagarlo en cada petición.
- El refresco git (44 ms) es lo que se paga cuando el estado git caduca
  (`VIGENCIA_GIT_MS`, 30 s). Es el camino barato que usa el gate para no re-escanear
  el área entera.

## Cifras antiguas no reproducidas

- Comentarios antiguos hablaban de «~14 s» (escaneo con git de todos los proyectos)
  y de «8 s en frío con 21 repos en serie». **No se han reproducido en la 89**; es muy
  probable que vengan de un workspace distinto (el portátil) o de la época en serie.
  Hasta medirlos en el mismo entorno no se citan como hecho.

## Sincronización del gate (medido 2026-10-22, portátil)

Método: llamadas HTTP reales al backend recién reiniciado (`curl`/`Invoke-WebRequest` con el
token), sin caché caliente; el informe de sincronización además se cronometró como script suelto.
Máquina: portátil (donde corre el manager), área con 23 proyectos.

| Operación | Antes | Después | Por qué |
|---|---|---|---|
| `GET /api/gate/sincronizacion`, primera llamada | 11,95 s | 4,77 s | los dos scripts van en paralelo y los `ls-remote` de cada checkout también |
| `GET /api/gate/sincronizacion`, en caché (60 s) | 0,04 s | 0,04 s | igual: la caché no cambia |
| `verificar-alineacion.mjs --json` (script suelto) | 6,97 s | 4,26 s | 8 `ls-remote` en paralelo en vez de en serie |
| `GET /api/workspace?forzar=1` | 4,49 s | 2,54 s | escaneo con 4 git en paralelo (ya existía; medido de nuevo) |

Lo que queda: `ls-remote` es red, no CPU; con el remoto lento el suelo son ~2 s. La caché de
60 s y el botón «verificar alineación» (`forzar`) siguen mandando: nunca se sirve un informe
más viejo que ese minuto.

## Dónde se referencia

- `src/server/rutas/rutasGate.ts` (`proyectoParaGate`): por qué el gate usa el snapshot.
- `src/server/cache.ts` (comentario de `snapshotMemoria`): cifra antigua pendiente de
  medir; ver este documento.
