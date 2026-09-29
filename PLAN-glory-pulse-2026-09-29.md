# 299A-11 — glory-pulse: agente en la VPS para la tab `vps` en tiempo real (plan)

Origen: duda del usuario (2026-09-29) — la tab `vps` tarda porque cada dato
es un SSH (`/sitios` ≈ 20s en serie, `/detalle` 7 piezas en serie, minutos en
el peor caso). Decisión del usuario: repo nuevo e independiente **`glory-pulse`**
(reutilizable por otras apps), WM solo lo consume. **Nada aquí está
implementado: requiere aprobación explícita antes de F1.**

## Idea en una frase

`glory-pulse` es un agente mínimo de solo lectura viviendo en la VPS que
mantiene el estado en memoria (eventos Docker en stream + muestreo barato +
metadatos Coolify en lento) y lo sirve por HTTP/SSE; el backend de WM lo
consume por **una sola conexión** y conserva el camino actual por subprocess
como fallback. El frontend pinta al instante desde caché caliente y avisa de
caídas en segundos.

## Decisiones propuestas (revisar)

1. **Repo nuevo `glory-pulse`** (crate Rust + `Dockerfile` + `README.md` +
   `CHANGELOG.md`). No vive en WM ni extiende `coolify-manager-rs` (otro
   repo): el manager sigue siendo el plano de control (despliega a pulse) y
   pulse es el plano de datos. El protocolo HTTP es **contrato público desde
   el día 1** (versión `v`, changelog, imagen consumida por tag pineado):
   separado solo funciona si la deriva entre repos se trata en serio.
2. **Lenguaje: Rust** (binario estático ~MB, RAM < 10 MB, experiencia del área;
   alternativa descartada: Node — imagen 150 MB+ y runtime pesado para un
   muestreador). Deps mínimas: `tokio`, `axum`, `bollard` (habla al socket
   Docker sin subprocess), `serde`.
3. **Despliegue Coolify-nativo:** pulse es un servicio Coolify más, con
   `/var/run/docker.sock:/var/run/docker.sock:ro` y sin dominio público salvo
   decisión explícita. Se despliega **solo vía `coolify-manager-rs`**
   (disciplina del área); si el manager no soporta el mount del socket, F0 lo
   detecta y el fallback es compose manual documentado (una vez, no por clic).
4. **Conexión única hacia aquí:** el backend abre HTTPS contra pulse con token
   largo (`VPS_AGENT_URL`, `VPS_AGENT_TOKEN`); 0 handshakes SSH por clic. Sin
   túnel SSH permanente que vigilar.
5. **Alcance v1 de pulse: estado, no texto.** Sirve contenedores (estado,
   salud, uptime), stats (cpu/mem por contenedor), host (carga, mem, disco vía
   `/proc`) y stream de eventos. **NO sirve:** logs, `inspect` crudo ni
   `diagnose` — eso sigue bajo demanda por el camino legacy de WM (son pesados
   y raramente mirados). El detalle pesado al clic combina snapshot instantáneo
   + piezas legacy en paralelo.
6. **Los atajos baratos anteriores se incluyen en WM** (duda previa del
   usuario): caché TTL corta en backend como segunda capa, SWR en frontend
   (pintar caché + insignia "actualizando…"), abort al cambiar de selección,
   refresco al volver a la pestaña, pausa con tab oculta. El hover-prefetch se
   **descarta explícitamente**: con caché caliente no aporta nada.

## Protocolo pulse (v1, versionado, contrato público)

- `GET /snapshot` → `{ v: 1, tomadoEn, contenedores: [{ nombre, estado,
  saludable, uptime, cpuPct, memMb }], host: { carga, memPct, discoPct },
  coolify: { tomadoEn, sitios: [{ nombre, dominio, uuid }] } }` (tope 256 KiB).
- `GET /events` (SSE) → diffs `{ tipo: estado|stats|host|coolify, tomadoEn,
  ... }` al ocurrir, no por sondeo.
- `GET /health` → `{ ok, v, uptimeS }` (sin auth, para Coolify).
- Auth: `Authorization: Bearer <token>` en todo salvo `/health`; token solo
  por env, jamás en logs (patrón fingerprint como el resto del área).
- Muestreos: eventos Docker en stream bloqueante (~0 CPU en reposo); stats
  todos los contenedores en **una** llamada cada 10s; `/proc` cada 10s;
  metadatos Coolify cada 60s (cambian poco).
- Cambios incompatibles = `v` nueva + entrada en `CHANGELOG.md`; WM pineará
  imagen por tag (`pulse:<versión>`, nunca `latest` en producción).

## Backend WM (`src/server/vps/`)

- Nuevo `agente.ts`: cliente HTTP (timeout 10s, chequeo `v: 1`, redactar
  token de cualquier error antes de responder).
- `rutasVps.ts`: cadena **pulse → legacy** por endpoint, con aviso visible
  `pulse-inaccesible (modo lento)` cuando cae al fallback. El fallback legacy
  se conserva permanentemente (si pulse muere, la tab sigue lenta pero viva)
  y queda congelado (solo fixes) tras F4.
- Adaptador snapshot → tipos existentes (`VpsSitios/VpsDetalle/VpsRecursos`):
  el frontend casi no cambia de formas.
- Matriz v1: `/sitios` y `/recursos` desde snapshot (ms); `/detalle` =
  piezas rápidas del snapshot + `logs/inspect/diagnose` legacy en paralelo
  (requiere semáforo 2–3 en `puente.ts`, hoy cola 1); `events` legacy se jubila
  (lo cubre el stream de pulse).
- Cada respuesta lleva `frescura: { tomadoEn, fuente: 'pulse'|'legacy' }`.
- Test de contrato en WM contra fixture de snapshot pineado (guardián de la
  deriva entre repos): si pulse publica `v: 2`, este test falla antes que la tab.

## Frontend (`src/v2/`)

- `apiVps.ts`: conserva caché + añade `frescura`; `detalleVps` con `signal`
  (abort) y lector de caché para SWR.
- `PanelVps.tsx`: al elegir, pinta caché al instante + revalida en fondo con
  insignia; aborta el detalle anterior; refresco al recuperar foco; tick solo
  con tab visible (nada de sondeo oculto).
- Alertas (el "tiempo real" visible): si el snapshot trae transición a no
  saludable vs lo pintado, banner `vpsAviso` con el nombre (sin sonido, sin
  toast). SSE directo al frontend: **fase opcional F4** (el backend ya sondea
  barato; el push ahorra poco y añade reconexión en el cliente).

## Seguridad (innegociable)

1. Pulse 100% lectura: ni `exec`, ni `Command`, ni escritura al socket en el
   código (auditable por grep); el mount es `:ro` aunque el socket sea
   root-equivalente — se documenta como riesgo aceptado con mitigaciones.
2. Token largo por env a ambos lados; nunca en logs/respuestas/fixtures.
3. Sin dominio público por defecto; si se publica (TLS de Coolify), con token
   + revisión explícita del usuario.
4. Validación de entrada igual que hoy (`NOMBRE_OK` + pertenencia) en el
   adaptador; snapshot con `v` distinto = rechazo fail-closed.

## Fases

- **F0 spike (puerta, en WM):** verificar que el manager puede desplegar un
  servicio con mount del socket; `docker events` accesible; latencia
  backend→VPS. Si F0 falla, se trae alternativa al usuario antes de escribir
  código.
- **F1 pulse (repo `glory-pulse`):** crate + snapshot + SSE + `/health` +
  `Dockerfile` multistage (build en la VPS, sin cross-compile) + tests
  unitarios de esquema + `CHANGELOG.md`.
- **F2 backend (WM):** `agente.ts` + cadena fallback + adaptador + `frescura` +
  semáforo en puente + test de contrato con fixture.
- **F3 frontend (WM):** SWR + abort + insignia + foco/visibilidad + banner de
  alertas. Sin cambios visuales salvo insignia y banner.
- **F4 deploy real:** imagen por tag vía manager, token generado, runbook en
  `glory-pulse/README.md` (desplegar, rotar token, diagnosticar, volver a
  legacy), verificación en vivo con el usuario avisado (solo lectura).
- **F5 cierre:** `type-check` 0, build OK, verificación de tiempos
  antes/después, tag de imagen pineado registrado como evidencia, commit sin
  push (en cada repo, push = usuario).

## Costes honestos (de la duda original)

- Construir: F0–F5, un frente medio (el grueso es F1–F2).
- Runtime VPS: despreciable (binario MB, RAM < 10 MB, CPU ~0 en reposo + un
  `stats` cada 10s).
- Mantenimiento: un repo más (releases de pulse, rotar token, vigilar
  `/health`) + **dos caminos en WM que conservar** (pulse + legacy). No
  compensa con 8 sitios salvo que quieras alertas en segundos o preveas
  escala (docenas de sitios, varias personas mirando, reuso en otras apps —
  el motivo declarado del repo separado).

## Riesgos y no-objetivos

- Socket Docker = superficie sensible aunque sea `:ro`; mitigado pero no nulo.
- Deriva de esquema pulse↔WM entre repos → `v` + fail-closed + test de
  contrato + changelog (el guardián es el test, no la disciplina).
- Dos caminos en WM = doble superficie de bugs; el legacy queda congelado
  (solo fixes) tras F4.
- **No-objetivos v1:** acciones/exec, multi-VPS, histórico/TSDB, streaming de
  logs, SSE directo al frontend (opcional F4), alertas fuera de la tab
  (email/webhook).

## DoD global

`type-check` 0 · build OK · `/sitios` y apertura de detalle en ms contra
pulse (medido antes/después) · fallback a legacy verificado matando pulse ·
0 exec en `glory-pulse/src` (grep) · token fuera de logs (revisión) · runbook
escrito · tag de imagen pineado registrado · commit sin push (push = usuario).
