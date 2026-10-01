# Plan operación `glory-pulse` (309A-1) — 2026-09-30

Decisiones del usuario: D2 **sí** (Bearer permanente, riesgo aceptado por
escrito aquí), D3 **sí** (mantener el agente), D4 **opera el assistant**.
Objetivo: que operar `pulse` dentro de 6 meses sea 2 comandos + 4 URLs,
sin redescubrir nada.

## Estado de partida (no redescubrir)

- Servicio: `pulse` (`r4okw44w84c0ko88g844kosk`), `https://pulse.wandori.us`,
  imagen `ghcr.io/1ndoryu/glory-pulse:sha-804f306`, compose v3 en
  `C:\tmp\pulse-compose-v2.yaml` (temporal — **pasar a repo en este plan**).
- Gotchas duros (F4): sin sidecar `socket-proxy` pulse hace `exit(1)`;
  imagen sin curl → prohibido `healthcheck` de app; todo `deploy-service`
  fallido **restaura el compose anterior** (rollback); `diagnose` no lista
  contenedores Coolify; `container-events` cuelga; `redeploy` rechaza
  rust-image (`REPO_URL`); token 64 hex solo en Coolify (rotación = recreate).
- Convenciones: workspace-manager sin `Agente/` (planes `PLAN-*.md` en raíz);
  glory-pulse sin `AGENTS.md` (docs en `docs/`); skills globales en
  `~/.config/opencode/skills/<nombre>/SKILL.md` (frontmatter `name` +
  `description`, cuerpo con flujo + salida obligatoria).

## Fases

1. **Runbook canónico** `glory-pulse/docs/OPERACION.md`: aceptación D2 por
   escrito; arquitectura (GHCR→pull, proxy, Traefik/LE); rituales con
   comandos exactos —verificación (4 URLs + `logs --target app`), update de
   tag (nuevo sha → render → `set-compose` → `deploy-service --skip-build`
   → verify), rotación `PULSE_TOKEN` (`push --only` + recreate), recovery
   (qué hacer si 200 cae); tabla de gaps del manager con workaround;
   verificado contra el estado vivo antes de cerrar.
2. **Compose canónico en repo** `glory-pulse/deploy/docker-compose.prod.yaml`
   (v3 con placeholders `${PULSE_IMAGE_TAG}`; ritual = render a temporal +
   `set-compose`; **nunca** componer a mano en `/tmp` desde cero). Verificar
   que renderiza byte-equivalente al v3 vivo (salvo tag).
3. **Skill** `glory-pulse-ops` en `~/.config/opencode/skills/`: cuándo cargar
   (operar/verificar pulse), binario dev vs release, rituales resumidos +
   puntero al runbook, gotchas F4, prohibiciones (sin `restart --all`, sin
   `build` en VPS, sin `latest`, secreto jamás en logs). Probar carga con
   `skill` + una verificación de solo lectura.
4. **Referencias**: crear `glory-pulse/AGENTS.md` mínimo (stack, runbook,
   skill, contrato `schema/`, no compilar en VPS); enlazar runbook en
   `glory-pulse/README.md`; cerrar D2–D4 en `PLAN-glory-pulse-2026-09-29.md`.
5. **Cierre**: `git status/diff` en glory-pulse, commit sin push (push del
   usuario); skill global sin repo (avisar que no va en commit); roadmap:
   retirar 309A-1 y registrar completada con evidencia.

## No alcance

- Sin cambios de código (pulse, manager, frontend); sin rotación de token;
  sin update de tag; sin allowlist (D2 acepta no tenerla); sin tocar
  `settings.json` ni secretos; sin push.

## Gate y DoD

Docs → verificación viva de cada comando del runbook (URLs + logs) antes
del commit. DoD: runbook con comandos exactos ya probados en F4/F5
(`set-compose --dry-run` para validar renders sin tocar prod); skill carga y responde; `AGENTS.md` enlaza; commit sin
push; roadmap al día. Riesgo: skill global fuera de git (documentarlo en
el commit y en el plan).

## Ejecución 2026-10-01

- F1 HECHA: `glory-pulse/docs/OPERACION.md` (smoke test, deploy, límites
  manager, lecciones F4, latencias p50 107 ms keep-alive / suelo 100 ms RTT).
- F2 HECHA: `glory-pulse/deploy/docker-compose.prod.yaml` (espejo del v3 vivo
  + cabecera canónica; validación local 5405 bytes ASCII/`services:`/sin
  `build:`; `--dry-run` imposible: GloryTmpSweep purgó el target
  coolify-manager — rebuildear ~3 min si se necesita).
- F3 parcial: skill `glory-pulse-ops` en `~/.config/opencode/skills/` + espejo
  en `~/.agents/skills/`; el cargador solo conoce preinstaladas (no recarga en
  sesión): carga pendiente a próxima sesión.
- F4 HECHA: `glory-pulse/AGENTS.md` + enlace en `README.md` (D2–D4, 309A-2).
- F5 parcial: commit `f84e168` sin push (4 archivos; `M deploy/docker-compose.yaml`
  ajeno de desacentuado NO tocado). Cierre roadmap/completada pendiente.
