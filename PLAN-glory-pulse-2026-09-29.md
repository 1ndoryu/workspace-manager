# 299A-12 — glory-pulse: agente en la VPS para la tab `vps` en tiempo real (plan, Rev.3)

Origen: duda del usuario (2026-09-29) — la tab `vps` tarda porque cada dato
es un SSH (`/sitios` ≈ 20s en serie, `/detalle` 7 piezas en serie, minutos en
el peor caso). Decisión del usuario: repo nuevo e independiente **`glory-pulse`**
(reutilizable por otras apps), WM solo lo consume. ID reasignado de `299A-11`
a **`299A-12`** (el `299A-11` lo ocupa otro frente activo). **Estado:
D1 aprobado (repo `1ndoryu/glory-pulse` creado por el usuario 2026-09-29),
F0 completo con veredicto SÍ condicionado (ver §F0). F1 HECHA 2026-09-29
(crate `pulse`: clippy/test/fmt limpios, smoke 401/200, compose proxy;
test negativo del proxy pendiente de docker → F4 remoto).
D2 delegada a assistant, D3=SÍ, D4=Yo vía manager (respuestas usuario 2026-09-29).**

Rev.3 (2026-09-29, tras revisión de subagente `supervisor-reviewer`,
veredicto APROBABLE CON PEGAS): añade `Decisiones abiertas`, descarta el SSE
de v1, fija proxy/token/registry, política de recorte determinista, semáforo
condicionado a medición F0, contrato con tabla de campos y F0 ejecutable con
comandos. Cambios Rev.3 marcados `[Rev.3]`; `[Rev.2]` = del reto anterior.

## Idea en una frase

`glory-pulse` es un agente mínimo de solo lectura viviendo en la VPS que
mantiene el estado en memoria (eventos Docker en stream + muestreo barato +
metadatos Coolify en lento) y lo sirve por HTTP; el backend de WM lo consume
por **una sola conexión keep-alive con poll cada 5s** y conserva el camino
actual por subprocess como fallback congelado. El frontend pinta al instante
desde caché caliente y avisa de caídas en segundos.

## Problema y no-goals

- Problema real: latencia interactiva (clics que tardan minutos) + cero
  frescura (nada se entera de una caída hasta recargar). NO es falta de CPU.
- No-goals v1: acciones/exec, multi-host (pero el snapshot ya lleva `hostId`),
  histórico/TSDB, streaming de logs, alertas fuera de la tab, SSE (pasa a v2 —
  el poll de 5s cumple el presupuesto, [Rev.3]).

## Decisiones propuestas (revisar)

1. **Repo nuevo `glory-pulse`** (crate Rust + `Dockerfile` + `README.md` +
   `CHANGELOG.md`). Esquema neutro al producto; el adaptador a tipos WM vive
   en WM. Protocolo = contrato público día 1 (`v`, changelog).
2. **Rust**, deps mínimas (`tokio`, `axum`, `bollard`, `serde`).
3. **Despliegue Coolify-nativo, solo vía `coolify-manager-rs`** (build del
   Dockerfile en la VPS, sin cross-compile ni registry: el pin es **tag git**,
   nunca `main` flotante en producción, [Rev.3]).
4. **Socket SOLO vía proxy filtrante** (Rev.2, concretado en Rev.3):
   referencia `tecnativa/docker-socket-proxy` (tag fijado en F0) con solo GET
   en eventos/contenedores/info/version; pulse jamás monta `docker.sock`.
   Test negativo F1: `POST /containers/create` contra el proxy → denegado.
   Sin proxy no hay F4.
5. **Red: dominio con TLS de Coolify + Bearer** (alternativas evaluadas abajo).
   Token: 32 bytes CSPRNG en hex (64 chars), generado por el usuario,
   guardado en env de Coolify (pulse) y env de WM (backend); rotación en
   runbook (cambiar env + restart, segundos, el fallback cubre). [Rev.3]
6. **Invariante de ruta caliente:** snapshot desde memoria (`RwLock`); ningún
   handler toca Docker ni red. Presupuesto: p99 `/snapshot` < 50 ms;
   evento → banner ≤ 15 s (5s poll backend + tick frontend + margen).
7. **Alcance v1: estado, no texto.** NO: logs, `inspect` crudo, `diagnose`
   (siguen legacy bajo demanda, en paralelo si F0 lo autoriza).
8. **Atajos incluidos en WM:** caché TTL corta, SWR con insignia, abort,
   refresco al foco, pausa oculta. Hover-prefetch descartado.

## Alternativas evaluadas y descartadas (por escrito, [Rev.3])

- **Túnel SSH permanente:** 0 piezas nuevas, pero una conexión que vigilar y
  que se cae en silencio; nadie la quiere operar. Descartado.
- **Tailscale/WireGuard:** red privada real, pero otro demonio + identidad que
  gestionar en ambos lados para una sola app. Descartado salvo que la
  allowlist falle (plan B de D2).
- **Push pulse→WM (webhook):** elimina el endpoint público, pero exige a WM un
  receptor público + cola + reintentos = más superficie que el poll. Descartado
  en v1; reconsiderar si D2 sale sin allowlist.
- **Fix solo-legacy** (paralelizar 7 piezas + TTL + abort, días, sin repo):
  F0 lo mide como base; si basta para el uso real, D3 puede matrar pulse.
  Compite de frente en la decisión de coste.

## Protocolo pulse v1 (borrador de contrato, se congela en F0)

- `GET /snapshot` → `{ v: 1, hostId, tomadoEn, host: { carga, memPct,
  discoPct }, coolify: { tomadoEn, sitios: [{ nombre, dominio, uuid }] },
  contenedores: [{ nombre, estado, saludable, uptimeS, cpuPct, memMb }],
  totalContenedores, truncado }` (tope 256 KiB).
- `GET /health` → `{ ok, v, uptimeS }` (sin auth).
- Auth Bearer salvo `/health`. `tomadoEn` solo ordena; la edad la mide el
  backend a la recepción con su reloj (nunca se comparan relojes).
- `hostId` = hostname de la VPS (string, future-proof multi-host).
- [Rev.3] **Recorte determinista** (si se supera el tope): se conserva
  host + coolify íntegros; contenedores ordenados por nombre hasta llenar;
  `truncado: true` + `totalContenedores` con el total real. Jamás en silencio.
  F0 mide el tamaño real con 8 sitios (estimación actual: decenas de KiB).
- Tabla campo→tipo WM (borrador; `snapshot.schema.json` + ejemplo medido en
  bytes = artefacto de salida obligatorio de F0, [Rev.3]):

| snapshot | tipo WM | notas |
|---|---|---|
| `coolify.sitios[]` | `VpsSitio[]` | `estadoReal` se cruza con contenedores por nombre |
| `contenedores[]` (estado/salud) | `VpsDetalle.piezas.salud/stats` | `inspect` crudo NO viaja (secretos en env) |
| `host` | `VpsRecursos.piezas.resumen` | mismo formato de métricas que el parseo `audit` |
| `tomadoEn`+recepción | `frescura { fuente, edadMs }` | edad = reloj backend, no del agente |

- Si el snapshot trajera env/secretos en el futuro, el adaptador replica
  `sanearJson` + `CLAVE_SECRETA` de `rutasVps.ts` (prohibido mostrar `···`
  sin sanear). Cambios incompatibles = `v` nueva + changelog.

## Backend WM (`src/server/vps/`)

- `agente.ts`: cliente único keep-alive, timeout 10s, chequeo `v: 1`, token
  redactado de errores (misma `redactar()` que `puente.ts`).
- **Circuit breaker:** 3 fallos seguidos (timeout, `v` distinta, 5xx) → solo
  sondeo cada 60s hasta recuperarse. Con test (simular caída). Evita timeout
  por clic + spam cuando pulse está muerto.
- Cadena **pulse → legacy** + aviso `pulse-inaccesible (modo lento)`; legacy
  congelado (solo fixes) tras F4. `events` legacy se jubila (lo cubre el
  stream interno de pulse; en fallback el detalle pierde eventos — degradación
  documentada, no error).
- `/sitios`, `/recursos` desde snapshot; `/detalle` = snapshot + piezas
  pesadas legacy. [Rev.3] El semáforo 2–3 en `puente.ts` (hoy cola 1 con su
  invariante documentado) **solo se toca con medición F0** (p99 con 2–3 en
  paralelo); por defecto se conserva la cola 1.
- Poll backend→pulse cada 5s con un solo cliente (720 req/h, no se multiplica
  por visores). Test de contrato contra fixture + drill de fallback en runbook
  (matar pulse 5 min, criterio: la tab sigue lenta-viva y el aviso visible).

## Frontend (`src/v2/`)

- Reutilización: insignia en `meta` de `Caja`, alertas en `vpsAviso`, tokens.
- `apiVps.ts`: caché + `frescura`; `detalleVps` con `signal` + lector SWR.
- `PanelVps.tsx`: pintar caché + revalidar con insignia (`hace Ns` desde
  `edadMs`); abort anterior; refresco al foco; tick solo visible
  (`VPS_REFRESH_MS`, manual por defecto). `invalidarVps()` sigue siendo el
  recargar manual.

## Modelo de escala

- Hoy: 8 sitios, 1 visor. Backend→pulse 720 req/h triviales; 3 visores solo
  multiplican frontend→backend (respuestas de ms).
- Techo v1: 50 contenedores / 3 visores (recorte determinista como red).
  `stats` es O(n)/10s — coste real del muestreo, no "1 llamada".
- Objetivo pulse (a medir en F1): RSS < 20 MB (tokio+axum ya pesan; el "<10"
  de Rev.1 era optimista sin medir, [Rev.3]).

## Seguridad (innegociable)

1. Proxy obligatorio + pulse sin `exec`/`Command` (grep en DoD).
2. F0 decide por labels: si `coolify.*` dan nombre/dominio/uuid, v1 **sin
   token de API Coolify**; si no, token mínimo + rotación documentada.
3. Token pulse: spec en decisión 5; fuera de logs/respuestas/fixtures.
4. `NOMBRE_OK` + pertenencia en adaptador; `v` distinta = fail-closed.
5. Límites al servicio (propuesta F4: 0.5 CPU / 128 MB, a confirmar);
   base por digest + `Cargo.lock`.
6. [Rev.3] DoD exige: allowlist documentada **o** riesgo aceptado por escrito
   por el usuario (D2) — "si se puede" no es un criterio.

## F0 spike (puerta, comandos concretos, [Rev.3])

1. `& $BIN --help` y `new --help`: ¿flags de mount/volume/compose? (sí/no;
   no → alternativa compose manual con autorización explícita).
2. `container-inspect -n glory-rest --json` (vía puente existente, lectura):
   ¿labels `coolify.*` con nombre/dominio/uuid? (sí → sin token API; no →
   camino token).
3. Baseline en vivo: tiempo `/sitios` + `/detalle` serial (ya ≈20s + minutos)
   y tamaño estimado del snapshot (vía `list --detailed` + `container-stats`).
4. Allowlist IP en Coolify (sí/no → alimenta D2). Tag del proxy existente.
5. Salida F0 (obligatoria antes de F1): nota sí/no por ítem +
   `snapshot.schema.json` + ejemplo medido en bytes + decisión semáforo
   (medición 2–3 en paralelo o se conserva cola 1).

## Fases restantes

- **F1 pulse:** crate + 3 muestreadores + snapshot/health + proxy en compose +
  tests (esquema, negativo del proxy, sampler local) + CHANGELOG. Clippy/test.
- **F2 backend:** `agente.ts` + breaker + adaptador + `frescura` + contrato +
  breaker-test. `type-check` 0. Semáforo solo si F0 dijo sí.
- **F3 frontend:** SWR + abort + insignia + foco/visibilidad + banner.
- **F4 deploy:** tag git vía manager, token del usuario, runbook (desplegar,
  rotar, diagnosticar, rollback=parar, drill), verificación avisada.
- **F5 cierre:** `type-check` 0, build OK, p99 antes/después, tag registrado,
  commit sin push (push = usuario, en cada repo).

## Costes honestos

Frente medio (grueso F1–F2). Runtime despreciable. Mantenimiento: repo
(releases, token, `/health`) + doble camino en WM. Con 8 sitios solo compensa
por alertas en segundos, escala o reuso (motivo declarado).

## Riesgos residuales y respuesta

- Proxy mal configurado → test negativo F1 + grep F5.
- Deriva entre repos → `v` + contrato + changelog (guardián: test).
- Legacy pudriéndose → drill + fixtures en CI WM.
- Token filtrado → solo estado de lectura, sin secretos ni exec; rotación en
  segundos con fallback cubriendo.
- Pulse caído → breaker + aviso + modo lento + restart por `/health`.

## DoD global (medible, [Rev.3])

`type-check` 0 · build OK · clippy/test pulse verdes · `/sitios` p99 < 500 ms
(vs ~20s) y detalle tibio < 500 ms (medidos antes/después) · fallback matando
pulse (drill superado) · 0 exec en pulse (grep) · proxy deniega POST (test) ·
compose sin `docker.sock` directo en pulse (grep) · token fuera de logs ·
allowlist documentada o aceptación escrita (D2) · tag git pineado registrado ·
commit sin push.

## Decisiones abiertas (requieren al usuario, [Rev.3])

- **D1 ¿Crear `glory-pulse` como repo independiente? RESUELTO 2026-09-29:**
  sí — `github.com/1ndoryu/glory-pulse` público, creado por el usuario.
- **D2 ¿Aceptar endpoint público con Bearer permanente?** Opciones: sí con
  allowlist (ideal) / sí sin allowlist (riesgo aceptado por escrito) / no →
  plan B Tailscale (re-estima F1–F2). No delegable a F0. Dato F0: sin
  allowlist por app en la UI de Coolify (solo IP allowlist para la API
  propia); Tailscale viable vía comando `tailscale` del manager.
- **D3 ¿Aceptar el coste permanente (repo + releases + token + doble camino)
  frente al fix barato solo-legacy?** Decisión de producto con la medición F0
  en mano (`detalle` 119.5 s es el coste real; `sitios` warm solo 1.3 s).
- **D4 ¿Quién publica/mantiene imagen-tags, ejecuta deploy/rotación/rollback?**
  Propuesta: todo remoto lo ejecuta el usuario vía manager; confirmar.

## F0 — resultado (2026-09-29, ejecutado, veredicto: SÍ condicionado)

Evidencia completa en `glory-pulse/docs/F0-spike.md` (+
`schema/snapshot.schema.json` + `schema/ejemplo.json`). Resumen:

- **Monts: sí condicionado.** Sin flags de mounts en el manager; el alta es
  compose sincronizado (`deploy-service`); el socket lo monta el proxy, no
  pulse. Prueba final = el propio deploy (F4).
- **Labels: no vía manager** (`diagnose.containers` es tabla de texto;
  `container-inspect` falla validación en el manager). Meta-coolify vía
  token Coolify `read` (secretos redactados), cache 60 s. Sin fix manager.
- **Baseline:** `sitios` 1.3 s warm (`n=8`, ~20 s en frío — varianza sin
  caracterizar); `detalle` **119.5 s** (`inspeccion=FALLO eventos=FALLO`);
  `list` directo 0.1 s; `diagnose --json` 10848 bytes.
- **Proxy:** `linuxserver/socket-proxy:version-3.4.4-r0` pineado (allowlist
  por endpoint); alternativa tecnativa `≥0.5.1` por **CVE-2026-78122**
  (CVSS 7.4, `<0.5.1` con `CONTAINERS=1` expone archive/export/logs/top).
- **Semáforo: verde medido** (`list` ×3 paralelo en 0.1 s, sin degradación
  del enlace). F2: semáforo por familia (`list`-class paralelo,
  `inspect`-class serie por sitio) con medición en ruta.

## SIGUIENTE ACCIÓN

F1 HECHA 2026-09-29. F2 HECHA 2026-09-29 (`agente.ts` + breaker 3/60s +
adaptador + `frescura` + contrato estricto + breaker-test 5/5 vía
`tsx --test`, `type-check` 0, ruta `/api/vps/agente` verificada en vivo
→ `sin-configurar` sin env; semáforo por familia: `list` carril paralelo ×3,
`inspect` sigue en turno único). F3 HECHA 2026-09-29 (poll 5 s con SWR
manual + abort sin solapes + pausa en tab oculta + repedido al volver +
insignia `agente` en meta + banner `pulse-inaccesible (modo lento)` /
vista parcial; lista en vivo con estado/cpu/mem; sin agente la UI es la
de antes; `type-check` 0, `vite build` OK). Siguiente: F4 deploy.
