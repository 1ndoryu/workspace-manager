# 299A-5 — Tab `vps`: despliegues Coolify en solo lectura (plan)

Origen: pedido del usuario (2026-09-29) — nueva tab que usa coolify-manager-rs
para mostrar despliegues, estado y uso de recursos, con panel de la VPS y
detalle al clic. Interfaz limpia/minimalista con el patrón v2. Botones de
acción: **más adelante** (v1 = 100% lectura).

## Respuestas del usuario (2026-09-29, vinculantes)

1. **Alcance:** conciliar settings ↔ real ("no debería haber diferencia"): la
   tab debe evidenciar desajustes entre lo configurado y lo real, no solo
   listar.
2. **Refresco:** configurable (manual / auto / mixto). Propuesta: env
   `VPS_REFRESH_MS` (`0` = manual con botón ⟳, defecto; `>0` = auto cada N
   ms; el detalle siempre bajo demanda al clic). Validar al aprobar.
3. **Puente:** el más eficiente, escalable y seguro (decisión técnica mía,
   abajo).
4. **Acciones:** v1 solo lectura, nada cableado que mute.

## Superficie verificada (2026-09-29, solo `--help`, cero toques remotos)

- Binario duradero: `C:\Users\Owner\bin\coolify-manager.exe` (copia de 23 MB fuera
  de `C:\tmp`, que se purga cada hora) + `coolify-manager.version` con el commit
  fuente. Actualización: `scripts/actualizar-coolify-manager.ps1` (compila en
  `C:\tmp\glory-target\coolify-manager`, publica y verifica). `--version` =
  `coolify-manager 1.0.0` (18/09/2026, commit `bf672b2`). `config/settings.json`
  del repo existe. Fallback legacy solo si falta el duradero: `C:\tmp\bin\`.
- Con `--json`: `container-stats`, `container-inspect`, `container-events`,
  `diagnose`, `db-stats`. SIN json (texto humano): `list` (+`--detailed` trae
  estado real `ESTADO`), `health` (`-n/--all`), `audit` (`--target`), `logs`
  (`-l/--target/--since/--until/--filter/--pattern`).
- `gui-api` existe pero **se descarta**: escucha por defecto en `127.0.0.1:8787`
  (= puerto de WM, choque), expone `POST /api/command` genérico (puede ejecutar
  CUALQUIER comando, incluido mutante) y exige otro demonio + auth. Más piezas,
  más riesgo, cero beneficio para lectura.

## Decisión puente: proceso por consulta (execFile, sin demonio)

El server de WM invoca el binario por consulta con `execFile` (sin shell, sin
interpolación): eficiente (sin proceso persistente), escalable (stateless, una
consulta = un proceso acotado) y seguro (la allowlist vive en el argv
construido, no hay endpoint genérico que abusar). Ruta del binario por env
`COOLIFY_MANAGER_BIN` (defecto `C:\Users\Owner\bin\coolify-manager.exe`,
fallback `C:\tmp\bin\coolify-manager.exe`); config por
env `COOLIFY_MANAGER_CONFIG` (defecto: la que resuelva el binario); al arrancar
se verifica `--version` y si falta el binario la tab falla cerrado con mensaje
visible (nunca datos inventados).

## Contrato de seguridad (innegociable, v1 y siguientes)

1. **Allowlist cerrada de argv** en `src/server/vps/puente.ts`: solo
   `list [--detailed]`, `health [-n/--all]` (JAMÁS `--alert` = manda email,
   JAMÁS `--repair` = muta), `logs -n -l --target [--since/--until/--filter]`,
   `container-stats/inspect/events -n [--json] [--since]`, `diagnose -n --json`,
   `db-stats -n --json`, `audit [--target]` (texto). Cualquier otro argv =
   rechazo antes de ejecutar. Esta lista es el único lugar que construye
   comandos: ni la UI ni otros endpoints pueden pedir ejecuciones.
2. **Nombre validado**: `^[A-Za-z0-9][A-Za-z0-9._-]*$` + debe existir en la
   lista de sitios recién leída (no se acepta un nombre "a ciegas").
3. **Secretos server-side**: settings.json (API keys, URLs) nunca sale del
   server; al frontend solo resúmenes parseados. Sanitizar URLs con credenciales
   si aparecen en textos.
4. **Recursos acotados**: timeout 90 s por consulta, concurrencia máxima 1
   (cola: no apilar SSH/API contra la VPS), `MAX_LINEAS_LOG 200`,
   `MAX_JSON_BYTES 512 KiB`. Error/timeout = estado `desconocido` visible, nunca
   verde por defecto.
5. **Sin código mutante**: en v1 no existe en WM ninguna ruta que invoque un
   comando de escritura; la ausencia es estructural, no un flag.

## Endpoints WM nuevos (prefijo `/api/vps/`)

- `GET /api/vps/sitios` → `{ sitios: [{ nombre, dominio, target, uuid,
  estadoReal }], conciliacion: [{ nombre, problema }] }` desde `list` +
  `list --detailed`. `estadoReal` = `running/exited/unknown/...` o
  `sin-asignar` (sin UUID). Conciliación v1: sitio sin UUID, sitio con estado
  desconocido, sitio que no responde en `--detailed`. (Lo real-fuera-de-settings
  no es visible desde `list`: se documenta como límite, no se inventa.)
- `GET /api/vps/detalle?sitio=` → `{ health, stats, inspect, events, db,
  logs, diagnose }` (cada pieza con `{ ok, datos?, error? }`: degradación
  parcial, no todo-o-nada). `health` y `logs` son texto → parseo con regex
  estrictas + fallback `desconocido`.
- `GET /api/vps/recursos` → panel VPS del target principal: `audit` es texto
  → parseo mínimo CPU/RAM/disco con fallback `no disponible`; si el parseo no
  es fiable se muestra el bloque de texto tal cual en `<pre>` antes que un
  número dudoso. Mejora futura (no bloqueante): pedir `--json` upstream.
- Antipatrón prohibido: interpolar el nombre en shell (siempre `execFile` con
  argv), y cachear errores como si fueran datos.

## UI v2 (patrón repos: lista + lateral, monocromo estricto)

- `PanelCentral` += `'vps'` (`tipos.ts`, `persistencia.ts` guard, `NavBar.tsx`
  tab, `AppV2.tsx` render). Nuevo `PanelVps.tsx` (+ `src/v2/vps/apiVps.ts`
  con caché por clave como `apiRepos.ts`).
- Tres zonas: (1) lista de despliegues (nombre, dominio, punto de estado,
  mini `+stats`, atenuado si `unknown`); (2) panel VPS (target principal:
  estado, CPU/RAM/disco, banda de conciliación si hay desajustes); (3) al clic,
  detalle del despliegue (health, stats, events, logs acotados, db si aplica).
  Reutilizar `docsVacio`, `Button` canónico, tokens `--v2-*`; sin radios,
  sombras ni bold; adición/eliminación solo si se muestra diff (no previsto).
- Refresco: botón ⟳ global (como repos) + por-zona; si `VPS_REFRESH_MS>0`,
  intervalo con cleanup al desmontar y sin solapes (si hay consulta en vuelo,
  se salta el tick).

## Fases

- **F0** contrato: tipos `VpsSitio/VpsDetalle/VpsRecursos` en `shared/types.ts`.
- **F1** backend `puente.ts` (allowlist+validación+timeout+cola1) +
  `rutasVps.ts` (`/sitios` con conciliación). Test: `list` real solo-lectura,
  nombre inválido rechazado sin ejecutar, timeout simulado.
- **F2** backend `/detalle` + `/recursos` (parseos estrictos con fallback).
  Test: degradación parcial (una pieza falla, resto visible).
- **F3** UI lista + panel VPS + conciliación. **F4** UI detalle al clic.
- **F5** cierre: `type-check` 0, verificación en vivo contra la VPS real
  (solo lectura, con el usuario avisado), plan a completados, commit sin push.
  Nada de F5 toca producción más allá de leer.

## Riesgos y límites honestos

- `list/health/audit/logs` en texto: el parseo es frágil ante cambios del
  manager → regex estrictas + `unknown` antes que mentir; se propone `--json`
  upstream como mejora separada (requiere compilar a `C:\tmp`, no en el árbol).
- `health --all` sobre muchos sitios puede tardar minutos → la lista NO pide
  health; solo `/detalle` bajo demanda, con timeout y aviso de lentitud.
- Binario del 18/09 puede ir detrás del repo `main`: F1 registra el
  `--version` efectivo en el log del server para trazabilidad.
- DoD: type-check 0, lectura real verificada en vivo, 0 argv fuera de la
  allowlist (grep), 0 secretos en respuestas (revisión), commit sin push.
