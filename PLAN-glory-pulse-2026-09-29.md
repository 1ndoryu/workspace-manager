# 299A-11 — glory-pulse: agente en la VPS para la tab `vps` en tiempo real (plan, Rev.2)

Origen: duda del usuario (2026-09-29) — la tab `vps` tarda porque cada dato
es un SSH (`/sitios` ≈ 20s en serie, `/detalle` 7 piezas en serie, minutos en
el peor caso). Decisión del usuario: repo nuevo e independiente **`glory-pulse`**
(reutilizable por otras apps), WM solo lo consume. **Nada aquí está
implementado: requiere aprobación explícita antes de F1.**

Rev.2 (2026-09-29, tras reto adversarial): corrige que `:ro` en el socket NO
limita la API de Docker (exigía proxy); añade invariante de ruta caliente,
circuit breaker, modelo de escala, checklist ejecutable y decisiones abiertas
al final. Lo que cambió respecto a Rev.1 está marcado con `[Rev.2]`.

## Idea en una frase

`glory-pulse` es un agente mínimo de solo lectura viviendo en la VPS que
mantiene el estado en memoria (eventos Docker en stream + muestreo barato +
metadatos Coolify en lento) y lo sirve por HTTP/SSE; el backend de WM lo
consume por **una sola conexión keep-alive** y conserva el camino actual por
subprocess como fallback congelado. El frontend pinta al instante desde caché
caliente y avisa de caídas en segundos.

## Problema y no-goals

- Problema real: latencia interactiva (clics que tardan minutos) + cero
  frescura (nada se entera de una caída hasta recargar). NO es falta de CPU:
  sobra capacidad en ambos lados; falta un plano de datos con estado.
- No-goals v1: acciones/exec, multi-host (pero el snapshot ya lleva `hostId`),
  histórico/TSDB, streaming de logs, SSE directo al frontend (opcional F3b),
  alertas fuera de la tab (email/webhook).

## Decisiones propuestas (revisar)

1. **Repo nuevo `glory-pulse`** (crate Rust + `Dockerfile` + `README.md` +
   `CHANGELOG.md`). Justificación de repo separado (criterio segundo
   consumidor + ciclo independiente): el esquema de pulse es neutro al
   producto (contenedores/host/meta-coolify, nada de tipos WM); el adaptador a
   `VpsSitio/VpsDetalle/VpsRecursos` vive en WM. El protocolo HTTP es
   **contrato público desde el día 1** (`v`, changelog, imagen por tag
   pineado, nunca `latest`).
2. **Lenguaje: Rust**, deps mínimas (`tokio`, `axum`, `bollard`, `serde`).
   Alternativa descartada: Node (imagen 150 MB+, runtime pesado).
3. **Despliegue Coolify-nativo, solo vía `coolify-manager-rs`.** Si el manager
   no soporta el mount del socket, F0 lo detecta y se trae alternativa antes
   de codificar (fallback: compose manual una vez, documentado).
4. **[Rev.2] Acceso al socket SOLO vía proxy filtrante.** Corrección grave a
   Rev.1: `:ro` no limita la API de Docker (cualquier conexión al socket puede
   crear/parar contenedores; `:ro` solo afecta al bind). Arquitectura:
   `pulse → (GET whitelist) → docker-socket-proxy → socket`. El proxy solo
   permite GET a `/events`, `/containers/json`, `/containers/*/stats`,
   `/info`, `/version`, `/df`; pulse nunca ve el socket crudo. Sin proxy no
   hay F4. DoD lo audita (grep del compose + test de endpoint denegado).
5. **[Rev.2] Red: dominio público con TLS de Coolify + token.** Sin dominio no
   hay ruta (el backend corre fuera de la VPS; el túnel SSH permanente es
   carga de vigilancia que nadie quiere). Token largo + `/health` sin auth
   para el healthcheck de Coolify. IP-allowlist si Coolify la soporta (F0).
6. **[Rev.2] Invariante de ruta caliente:** el snapshot se sirve desde memoria
   (`RwLock`, clonado por handler); NINGÚN handler HTTP toca Docker ni red.
   Todo I/O vive en 3 tareas muestreadoras (eventos-stream, stats+`/proc`
   cada 10s, meta-coolify cada 60s). Presupuesto: p99 `/snapshot` < 50 ms;
   evento Docker → banner ≤ 15 s (5s poll backend + 5s tick frontend + margen).
7. **Alcance v1: estado, no texto.** Contenedores, stats, host, eventos. NO:
   logs, `inspect` crudo, `diagnose` (siguen legacy bajo demanda, en paralelo).
8. **Atajos baratos incluidos en WM:** caché TTL corta (segunda capa), SWR con
   insignia, abort al cambiar de selección, refresco al foco, pausa oculta.
   Hover-prefetch **descartado**: inútil con caché caliente.

## Protocolo pulse (v1, contrato público)

- `GET /snapshot` → `{ v: 1, hostId, tomadoEn, contenedores: [...],
  host: {...}, coolify: { tomadoEn, sitios: [...] }, truncado: bool }`
  (tope 256 KiB; si recorta, `truncado: true` — jamás en silencio).
- `GET /events` (SSE) → diffs al ocurrir. `GET /health` → `{ ok, v, uptimeS }`.
- Auth Bearer en todo salvo `/health`; token por env, jamás en logs.
- Cambios incompatibles = `v` nueva + `CHANGELOG.md`.
- [Rev.2] `tomadoEn` solo ordena; la edad la mide el backend con su propio
  reloj a la recepción (nunca se comparan relojes entre hosts).

## Backend WM (`src/server/vps/`)

- `agente.ts`: cliente único con keep-alive (la "sola conexión"), timeout 10s,
  chequeo `v: 1`, token redactado de cualquier error.
- [Rev.2] **Circuit breaker:** tras 3 fallos seguidos deja de intentar por
  petición y sondea cada 60s; al recuperarse, cierra solo. Sin esto, con pulse
  caído cada clic pagaría timeout + spam de logs. Con test (simular caída).
- Cadena **pulse → legacy** por endpoint + aviso `pulse-inaccesible (modo
  lento)`; legacy congelado (solo fixes) tras F4.
- Matriz v1: `/sitios`, `/recursos` desde snapshot (ms); `/detalle` = snapshot
  + `logs/inspect/diagnose` legacy en paralelo (semáforo 2–3 en `puente.ts`,
  hoy cola 1); `events` legacy se jubila.
- Respuestas con `frescura: { fuente: 'pulse'|'legacy', edadMs }`.
- Test de contrato contra fixture pineado (guardián entre repos) + drill de
  fallback en el runbook (matar pulse 5 min, la tab debe seguir lenta-viva).

## Frontend (`src/v2/`)

- Reutilización (sin componentes nuevos): insignia en `meta` de `Caja`,
  alertas en el `vpsAviso` existente, tokens `--v2-*`.
- `apiVps.ts`: caché + `frescura`, `detalleVps` con `signal` + lector SWR.
- `PanelVps.tsx`: pintar caché + revalidar con insignia; abort anterior;
  foco/visibilidad. F3b opcional: SSE directo (solo si el poll de 5s se queda
  corto en la verificación).

## Modelo de escala (objetivos, no eslóganes)

- Hoy: 8 sitios, 1 visor. Snapshot estimado < 64 KiB; poll backend 5s =
  720 req/h triviales; 1 stream SSE; RAM pulse < 10 MB.
- Techo v1: 50 contenedores / 3 visores sin cambiar nada (el snapshot sigue
  < 256 KiB; si lo supera, `truncado` + endpoint por sitio en v2).
- Cuello real: el muestreo `stats` (1 llamada/10s, O(contenedores)); si pica,
  se lee cgroup directo (anotado, no implementado).

## Seguridad (innegociable, endurecida en Rev.2)

1. Proxy filtrante obligatorio (decisión 4); pulse sin `exec`/`Command` (grep).
2. [Rev.2] F0 verifica si los labels de Coolify (`coolify.*` en contenedores)
   dan nombre/dominio/uuid: si sí, **v1 no necesita token de la API de
   Coolify** (una clase entera de secreto eliminada); si no, token mínimo +
   rotación en runbook.
3. Token pulse por env, nunca en logs/respuestas/fixtures.
4. `NOMBRE_OK` + pertenencia en el adaptador; `v` distinto = fail-closed.
5. Límites de CPU/mem al servicio pulse en Coolify (un bug del muestreador no
   come la VPS). Base del Dockerfile pineada por digest + `Cargo.lock`.

## Fases (checklist ejecutable)

- **F0 spike (puerta):** manager monta socket (sí/no) · labels coolify
  suficientes (sí/no → decide token API) · proxy disponible · latencia
  backend→VPS · IP-allowlist (sí/no). Evidencia: nota de 10 líneas. Si falla
  lo estructural, alternativa al usuario, cero código.
- **F1 pulse:** crate + 3 muestreadores + snapshot/SSE/health + proxy en
  compose + tests (esquema, endpoint denegado por proxy, sampler contra Docker
  local) + CHANGELOG. `cargo clippy -D warnings` + test verdes.
- **F2 backend WM:** `agente.ts` + breaker + adaptador + `frescura` +
  semáforo puente + test contrato + test breaker. `type-check` 0.
- **F3 frontend WM:** SWR + abort + insignia + foco/visibilidad + banner.
  Sin cambios visuales salvo insignia/banner. (F3b opcional: SSE directo.)
- **F4 deploy:** imagen por tag vía manager, token, runbook en pulse
  (`desplegar, rotar token, diagnosticar, rollback = parar → fallback
  automático, drill`), verificación en vivo avisada (solo lectura).
- **F5 cierre:** `type-check` 0, build OK, tiempos antes/después, tag pineado
  registrado, commit sin push (cada repo, push = usuario).

## Costes honestos

- Frente medio (grueso F1–F2). Runtime despreciable. Mantenimiento: repo más
  (releases, token, `/health`) + dos caminos en WM. Con 8 sitios solo compensa
  por alertas en segundos, escala prevista o reuso (motivo declarado).

## Riesgos residuales y respuesta

- Proxy mal configurado deja pasar POST → test de denegado en F1 + grep en F5.
- Deriva entre repos → `v` + contrato + changelog (guardián: test, no
  disciplina). `v: 2` rompe el test antes que la tab.
- Legacy se pudre como fallback → drill en runbook + parsers con fixtures en
  CI de WM.
- Token filtrado → solo lectura de estado (nombres/stats, no secretos ni
  exec); rotación = cambiar env + restart (segundos, fallback cubre).
- Caída de pulse → breaker + aviso + modo lento; Coolify lo reinicia por
  `/health`.

## DoD global

`type-check` 0 · build OK · clippy/test pulse verdes · `/sitios` y detalle en
ms (medido antes/después) · fallback verificado matando pulse · 0 exec en
pulse (grep) · proxy deniega POST (test) · token fuera de logs · runbook +
drill · tag pineado registrado · commit sin push.

## SIGUIENTE ACCIÓN

El usuario aprueba o corrige este plan (decisiones abiertas abajo). Tras
aprobación: crear repo `glory-pulse` (el usuario) y ejecutar F0. Cero código
antes.
