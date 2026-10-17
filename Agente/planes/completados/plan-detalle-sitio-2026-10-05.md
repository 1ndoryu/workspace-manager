# 309A-2 — Detalle por sitio en una sola conexión (2026-10-05)

Aprobado por el usuario 2026-10-05 (no volver a preguntar). El drill-down
legacy (`/api/vps/detalle` = 7 piezas SSH en serie, ~120 s medidos) muere;
lo sustituye UNA conexión HTTP al agente.

## Objetivo

`GET /detalle?sitio=<uuid>` en pulse (protegido con Bearer) + proxy en el
manager (`/api/vps/agente-detalle?sitio=`) + frontend lo usa cuando el
agente está disponible (fallback legacy si no).

## No alcance

- Solo memoria: NINGÚN handler toca Docker (principio de la ruta caliente).
  Logs e inspect bajo demanda quedan para 0110A-3.
- Sin cambio de `schema` (1): `imagen` es campo opcional nuevo, compatible
  hacia atrás (el validador del manager ignora lo desconocido).
- Sin rotación de token, sin tocar Coolify a mano. El deploy a la VPS
  (GHA→GHCR + `set-compose` + `deploy-service`) es ESCRITURA REMOTA:
  requiere permiso explícito del usuario cuando el código esté verificado
  en local. No se despliega sin ese sí.

## Fases

1. **Pulse**: campo `imagen` en `Contenedor` (viene del `list`, gratis, a
   memoria) + ruta `GET /detalle?sitio=<uuid>` que filtra en memoria por
   el mismo patrón del manager (`app|postgres|socket-proxy|mariadb|
   wordpress-<uuid>`) o por `sitio_uuid` de la meta cuando exista.
   Respuesta `{schema, hostId, ts, sitio, contenedores}`.
   Contrato en `schema/` (ejemplo) + test en `tests/contrato.rs` +
   entrada CHANGELOG. Gate del repo en verde.
2. **Manager**: `detalleSitio(uuid)` en `agente.ts` (mismo breaker/caché),
   ruta `/api/vps/agente-detalle?sitio=` con la misma pertenencia que
   `/detalle`, frontend la prefiere si `disponible`. Tests en
   `agente.test.ts`. `type-check` 0.
3. **Verificación local**: pulse en local (`cargo run`, token cualquiera
   ≥32) + manager contra él (`PULSE_URL` local): detalle de un sitio en
   <2 s. Sin Docker local también vale respuesta vacía con forma válida.
4. **Deploy (SOLO con sí explícito)**: ritual OPERACION.md (tag fijo +
   `set-compose` + `deploy-service --skip-backup` + smoke). Si el rollback
   salta, se reporta y se para.
5. **Cierre**: roadmap + completadas + `glory-pulse/AGENTS.md` (quitar el
   pendiente) + commits sin push en ambos repos.

## Definition of Done

- Detalle de sitio en 1 conexión <2 s contra prod (medido, no afirmado).
- Legacy `/detalle` intacto como fallback (no se borra en este lote).
- Push/deploy solo por los mecanismos autorizados (usuario).

## Estado 2026-10-05 (F1-F3 hechos, F4 pendiente de sí)

- F1 pulse HECHO: `imagen` en `Contenedor` (se omite si vacía, schema sigue
  1) + `GET /detalle?sitio=<uuid>` solo memoria + uuid fail-closed +
  `schema/ejemplo-detalle.json` + CHANGELOG `0.2.0`. Verde: `cargo fmt` +
  `clippy --all-targets` sin avisos + `cargo test` 5/5.
- F2 manager HECHO: `detalleSitio(uuid)` en `agente.ts` (breaker compartido,
  caché por sitio 5 s, `imagen` propagada) + `/api/vps/agente-detalle?uuid=`
  (uuid fail-closed, enriquece con mapa, legacy intacto) +
  `detalleAgenteVps(uuid)` en `apiVps.ts`. Hallazgo: el front NO llama a
  `detalleVps` (sin drill-down cableado); la UI que lo use es 0110A-3.
  Verde: `type-check` 0 + `agente.test.ts` 10/10 (3 nuevos).
- F3 local HECHO (binario real + token 64 de prueba, sin Docker):
  `sitio=r4ok...` → 200 forma válida vacía en 0,03 s (vs 120 s legacy);
  `sitio=../x` → 400; sin Bearer → 401. Procesos matados (restos 0).
- F4 deploy PENDIENTE de sí explícito del usuario (escritura remota).
