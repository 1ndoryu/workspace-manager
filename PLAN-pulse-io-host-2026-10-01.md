# PLAN — IO de disco del host en glory-pulse (0110A-1, 2026-10-01)

## Objetivo

Que la fila «disco IO» de la tab vps muestre datos reales. Hoy dice
«sin datos del agente» y está verificado que no es bug de mapeo: pulse
lee `blkio_stats` de Docker (`pulse/src/samplers.rs:112-120`), el
backend lo propaga (`agente.ts:138-139`, test con 4096/8192 en verde) y
aun así llegan ceros — el host (cgroup v2) no reporta blkio por
contenedor. La salida es medir a nivel de **host**, no por contenedor.

## Alcance

- Fuente: `/proc/diskstats` del host (sectores leídos/escritos
  acumulados, todos los dispositivos físicos agregados, excluyendo
  `loop*`/`ram*`).
- Contrato: campo nuevo top-level en el snapshot, p. ej.
  `discoHost: { sectoresLeidos, sectoresEscritos }` (acumulados, como
  `netRX/netTX`); las velocidades las calcula quien consume
  (delta/dt, mismo patrón que red). Actualizar
  `schema/snapshot.schema.json` + `schema/ejemplo.json` + test de
  contrato (`pulse/tests/contrato.rs`).
- Backend workspace-manager: extender `VpsAgenteSnapshot` + propagar
  (sin lógica, solo pasar el campo).
- Frontend: la fila «disco IO · contenedores» pasa a «disco IO · host»
  con velocidad R/W + minigráfico doble (reutiliza `Chispa` y `ritmos`);
  entra al historial persistente (2 números más por tupla).
- Deploy por el ritual de `glory-pulse/docs/OPERACION.md` (rebuild
  imagen → push GHCR → update tag). Los contadores son del host y
  sobreviven al reinicio de contenedores; si pulse reinicia, el delta
  sujeta a cero (mismo clamp que red).

## No alcance

- IO por contenedor (no existe a nivel Docker en este host; no se
  inventa ni se estima).
- % de uso de disco (ya vive del audit, `0110A` no lo toca).
- El endpoint de detalle por sitio propuesto (`309A-2`): es otro
  frente, solo se enlaza si comparte despliegue.

## Fases verificables

1. **F1 — sampler + contrato.** `samplers.rs` lee `/proc/diskstats`
   (test con fixture del formato real); schema + ejemplo + contrato
   en verde. Verifica: `cargo test` y `clippy -D warnings`.
2. **F2 — propagación.** Backend extiende tipo y lo expone; frontend
   pinta velocidad + chispa. Verifica: `type-check` 0,
   `/api/vps/agente` trae `discoHost` no-cero en vivo.
3. **F3 — deploy + cierre.** Ritual OPERACION.md, verificación en
   página (gráfico con datos, sin «sin datos»), commit en ambos repos
   sin push. Registra evidencia en `Agente/completados/` de cada repo
   según su convención.

## Definition of Done

- `/snapshot` incluye `discoHost` con valores que crecen.
- La tab muestra velocidad R/W del host con historial y rangos.
- `sentinel check` (glory-pulse) y `type-check` + `vite build`
  (workspace-manager) verdes.
- Commits sin push en ambos repos (push = usuario).

## Riesgos y decisiones

- Si `/proc/diskstats` no es montable igual en el contenedor de pulse
  (solo lee socket Docker hoy), F1 puede exigir montar `/proc` de solo
  lectura en el compose — cambio menor del compose prod, registrado en
  el plan al verificar.
- Decisión del usuario si F1 se complica: aparcar y quitar la fila IO
  (opción (b) ya registrada 2026-10-01).
