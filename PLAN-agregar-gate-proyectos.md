# Plan: agregar gate Sentinel/VarSense a 5 proyectos del área

> Estado: **propuesto** · Autor: Buffy · Fecha: 2026-08-30 · ID tarea: `308A-1`
> Fuentes reales: `PLAN.md`, `AGENTS.md` de cada repo, `PLAN-gate-dinamico.md`,
> roadmaps de `Glory-Laminal` (`188A-5`).

## 1. Objetivo

Integrar el gate Sentinel (con VarSense donde aplica) en 5 proyectos del `area-trabajo`:
`coolify-manager-rs`, `Glory-Laminal`, `gloryapi`, `GLORYPORT` y `workspace-manager`. Que el gestor
los vea con gate declarado y puerta de calidad operativa.

## 2. Estado real actual (verificado el 2026-08-30)

| Proyecto | sentinel.config.json | varsense.config.json | quality-tools.json | AGENTS mención gate | Observación |
|---|---|---|---|---|---|
| coolify-manager-rs | ❌ | ❌ | ❌ | ❌ | setup completo desde cero |
| Glory-Laminal | ✅ | ❌ | ❌ | ✅ | VarSense bloqueado por binario ausente (ídem `188A-5`) |
| gloryapi | ✅ | ⚠️ | ✅ | ✅ | revisar varsense + alineación manifest/lock |
| GLORYPORT | ❌ | ❌ | ❌ | ❌ | setup completo desde cero |
| workspace-manager | ❌ | ❌ | ❌ | ❌ | setup de su propio gate |

## 3. Qué implica "tener gate" (contrato mínimo)

1. `sentinel.config.json` en la raíz con política válida (`policy.status === 'policy'`).
2. Manifest del adaptador (`quality-tools.json`) + lock regenerado (`sentinel.lock.json`),
   alineado al commit/versión del runtime instalado.
3. Setup/install oficial del proyecto (`quality:setup` o equivalente), con doctor
   (`readyForAnalyze`/`readyForGate`, si el binario soporta el contrato).
4. `varsense.config.json` + VarSense provisionado donde el proyecto lo declare.
5. `AGENTS.md` que declara el gate y los comandos de coordinación.
6. Un último gate `PASS` con reporte verificable por proyecto.

## 4. Fases

### F0 — Preflight y diagnóstico (transversal)
- Para cada repo: `sentinel doctor --workspace <repo>`, leer manifests y lock; separar los 3 casos
  reales: setup completo, solo falta varsense, revisar alineación.
- No inventar gate en repos que decidieron no tenerlo; registrar la decisión.

### F1 — coolify-manager-rs (setup completo)
- Generar `sentinel.config.json` + `quality-tools.json`, alinear `sentinel.lock.json`, `quality:setup`,
  doctor, gate. Añadir varsense si aplica al stack (Rust → revisar qué reglas).

### F2 — GLORYPORT (setup completo)
- Mismo procedimiento que F1.

### F3 — workspace-manager (setup completo)
- Su propio `PLAN.md` ya declara gate como patrón del área; materializarlo: config + manifests + lock
  + doctor + gate. Integra con `PLAN-gate-dinamico.md` (el runtime sentinel ya se usa en este repo).

### F4 — gloryapi (revisar alineación)
- Ya tiene `quality-tools.json`, `quality.config.json`, `sentinel.config.json`, `sentinel.lock.json`
  y AGENTS con gate. Verificar alineación manifest↔lock↔runtime, varsense y un gate de cierre.

### F5 — Glory-Laminal (completar VarSense; bloqueado)
- Sentinel ya OK. Falta `varsense.config.json` + provisionar el binario. **Bloqueado por ausencia del
  binario** (ídem `188A-5`); requiere decisión del usuario sobre cómo provisionar.

## 5. Definition of Done de cada repo
- Gate declarado + doctor OK + último gate `PASS` con reporte, o limitación registrada con evidencias
  si un binario (varsense) no está disponible.
- Los `.json` generados quedan commiteados en SU repositorio (no en workspace-manager); los que ya
  existen no deben modificarse por accidente.

## 6. Pendientes / decisiones abiertas
- **VarSense de Glory-Laminal**: cómo provisionarlo (clonar/compilar vs. artefacto aportado).
- **Nivel objetivo** por proyecto: sentinel solamente, o sentinel+varsense.
- Stack de cada repo para elegir reglas sentinel/varsense reales (sin hardcode).

## 7. Seguimiento
- Marcos de seguimiento: ejectuar en orden F0→F5; cada fase cierra con type-check/gate y se registra
  en `Agente/completados/` del repo correspondiente.
- Esta tarea vive en el roadmap de `workspace-manager` (`308A-1`) y coordina con los roadmaps de cada
  proyecto destino.