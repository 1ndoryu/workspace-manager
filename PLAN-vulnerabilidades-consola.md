# Plan: detectar vulnerabilidades de dependencias en la consola

> Estado: **propuesto** · Autor: Buffy · Fecha: 2026-08-30 · ID tarea: `308A-4`
> Origen: notificación de GitHub Dependency Alerts al pushear `workspace-manager`
> (7 vulnerabilidades: 2 high / 5 moderate). El usuario pide que **todos los
> proyectos** del área tengan esta detección y que **aparezca sola en la consola**
> del workspace-manager en el futuro, en vez de depender de la UI de GitHub por repo.

## 1. Objetivo

- Ejecutar la auditoría de dependencias por proyecto del área de forma **local y
  automática**, y reportar los hallazgos en la consola del workspace-manager
  (nueva categoría `vulnerabilidades`), con conteo y badges por severidad
  (critical / high / moderate / low).
- **Sin depender de GitHub Dependabot por repo** (que vive en la UI web de cada
  repo y que además solo existió para `workspace-manager` al hacer push): el
  origen de datos es el CLD de audit del gestor de paquetes de cada proyecto.
- Cubrir **todos los proyectos con lockfile** (npm/pnpm/Cargo), no solo los que
  el usuario pushée. Los que no tienen lockfile se marcan como no-auditables.

## 2. Motivación y contexto (verificado 2026-08-30)

GitHub Dependency Alerts solo notificaron a `workspace-manager` porque fue el repo
que se empujó; el resto tiene la misma opción habilitada por defecto en GitHub,
pero no se ve desde la consola. Auditorías locales ya ejecutadas:

| Proyecto | Gestor | Resultado pnpm/npm audit |
|---|---|---|
| workspace-manager | pnpm | **4** (3 moderate, 1 high) — vite |
| gloryapi | npm | **23** (2 low, 7 moderate, 11 high, 3 critical) |
| Glory-Laminal | npm | 0 |
| freebuff-bridge | npm | 0 |
| PROYECTO TASKS frontend | npm | *(no medido aún)* |
| WANDORIUS frontend | npm | *(no medido aún)* |
| RESTAURANTE | npm | *(no medido aún)* |
| coolify-manager-rs gui | npm | *(no medido aún)* |
| glory-sentinel | npm | *(no medido aún)* |
| Rust (Glory-Laminal no; GLORYPORT/WANDORIUS/PT/coolify Cargo.lock) | cargo | cargo audit **(requiere instalar `cargo-audit`)** |

> Los conteos difieren del de GitHub (7 en workspace-manager): Dependabot cuenta
> con otra base y agrega rangos. El origen canónico para la consola será el CLI
> de audit del gestor (misma base que `npm audit`/`pnpm audit`/`cargo audit`).

## 3. Diseño — reutilizar la infraestructura de análisis existente

El frente de análisis de Sentinel (A0–A4 + R, ya commiteado) dejó una plantilla
reutilizable: `src/server/gate/analizador.ts` con **cola serial + single-flight,
caché por cambio real, ejecución con timeout y manejo de no-elegibles**. Este plan
añade un detector homólogo para vulnerabilidades, **sin duplicar** el patrón.

### 3.1 Fuente de datos (CLI de audit, por gestor y lockfile)

| Lockfile presente | Comando | Shape de salida |
|---|---|---|
| `pnpm-lock.yaml` | `pnpm audit --json` | JSON con `metadata.vulnerabilities` y array de hallazgos con `severity` |
| `package-lock.json` | `npm audit --json` | JSON con `vulnerabilities` (mapa paquete → severidad) |
| `Cargo.lock` | `cargo audit --json` | JSON con `vulnerabilities` (+ `--no-fail-on-error` en CI) |

- El gestor se infiere del lockfile **presente y commiteado** en la raíz del
  proyecto (o subcarpeta de frontend si el paquete raíz está vacío).
- Proyectos **sin lockfile** (GLORYINSPECTOR, FREEUFFPROXY) → no-auditables:
  se reportan como categoría vacía sin problema, no como error.
- `cargo audit` puede no estar instalado: se detecta su disponibilidad y, si falta,
  se reporta `cargo-audit no instalado` como limitación (no se instala sin decide).

### 3.2 Módulo `src/server/gate/vulnerabilidades.ts` (homólogo a `analizador.ts`)

- `auditarProyectoClaves(claves)`: recorre los proyectos elegibles (con lockfile),
  y para cada uno lanza el CLI de audit con `execFileAsync` **y timeout**, en **cola
  serial de máximo 1 spawn a la vez** (reutilizar el mismo mecanismo de
  single-flight / promesa compartida de `analizador.ts`).
- `elegibleAudit(proyecto)` → `{ ok, gestor, lockfile, ruta }` o `{ ok:false, motivo }`.
- **Caché por cambio real**: key = `{ clave, gestor, hash(lockfile) }`; si el
  lockfile no cambió, no re-audita y sirve el resultado cacheado. Caché acotada y
  podada por snapshot (misma convención que el analizador).
- **Contador por severidad separado** del resto: `{ critical, high, moderate, low }`,
  análogo a como la consola separa error/warning/information/hint del análisis.
- Manejo de errores: si el CLI falla (falta, red, timeout) → hallazgo `error` en esa
  categoría con motivo, sin romper el resto; no lanza sin catch.

### 3.3 Endpoint(s)

- `GET /api/gate/vulnerabilidades` → resultado por proyecto del workspace, igual
  shape que `/api/gate/analisis`.
- `POST /api/gate/vulnerabilidades/{clave}` → auditar un proyecto puntual
  (el botón «Auditar ahora»), respetando la caché real.

### 3.4 Integración en la consola (`PanelConsola` / `PanelDetalle` / `PanelConfig`)

- **Nueva categoría `vulnerabilidades`** en la consola, agrupada por proyecto, con
  badges por severidad (critical/high/moderate/low) y **conteo separado del resto** —
  exactamente como la regla que ya se aplicó a sentinel/análisis (cada filtro
  conserva su conquista; no se mezcla con sin-git/push/gate/config).
- Badge global por proyecto en `PanelDetalle` si hay critical/high.
- `src/hooks/useWorkspace.ts`: **timer de auto-auditoría periódica** en el cliente,
  respetando la config `scan.automatico`/`scan.intervaloMin` ya existente; cero
  recursos si la app está cerrada; no triggea si ningún lockfile cambió.
- `PanelConfig`: sección «Vulnerabilidades» con botón **«Auditar todo»** y per-proyecto,
  y nota de qué proyectos no tienen lockfile (no-auditables).

### 3.5 Config

- Reusar `scan.automatico`/`scan.intervaloMin` (ya persistida en
  `data/workspace.config.json` como parte de A2). No se añade configuración nueva;
  si se quiere, un `scan.auditAuto` opcional que herede el switch principal.

## 4. Fases

### V1 — Núcleo detectado (valor máximo, como A0/A1/A2 de análisis)
- Módulo `vulnerabilidades.ts` (cola+single-flight+caché por hash de lockfile+timeout).
- Endpoints `/api/gate/vulnerabilidades` (+ por proyecto).
- Botón «Auditar todo» y per-proyecto en `PanelConfig`/`PanelDetalle`.

### V2 — Categoría en la consola + auto-timer
- Nueva categoría `vulnerabilidades` en `PanelConsola` agrupada por proyecto con
  badges de severidad y conteo separado (misma regla que análisis/sentinel).
- Timer de auto-auditoría en el cliente (respeta `scan.automatico`/`intervaloMin`,
  no satura por caché).

### V3 — Rust + no-auditables + R
- `cargo audit --json` para los `Cargo.lock` (documentar si falta `cargo-audit`).
- Proyectos sin lockfile → no-auditables visibles pero sin problema.
- Revisión SOLID/efiencia (fase R) sobre todo el frente.

## 5. Definition of Done

- [ ] Consola muestra categoría `vulnerabilidades` por proyecto con badges de severidad.
- [ ] Conteo separado del resto de la consola (no mezcla con otras categorías).
- [ ] Auto-auditoría periódica reutiliza `scan` + caché por hash de lockfile; cero
      recursos con la app cerrada.
- [ ] Proyectos Rust cubiertos via `cargo audit` si hay binario; si no, limitación documentada.
- [ ] Proyectos sin lockfile visibles como no-auditables sin problema.
- [ ] Type-check exit 0; verificación real contra la instancia (auditar workspace-manager
      y gloryapi → 4 y 23, y que Glory-Laminal/freebuff-bridge den 0).

## 6. Pendientes / decisiones abiertas

1. **instalar `cargo-audit`** (cubrir Rust) — **RESUELTO (2026-08-31):** `cargo-audit` instalado
   global vía `cargo install cargo-audit` (build con `CARGO_TARGET_DIR` en `C:/tmp`, limpiado
   después; `cargo audit --version` OK, nada del entorno roto). El detector ya invocaba
   `cargo audit --json` automáticamente, así que los repos Rust dejaron de ser no-auditables
   sin cambio de código (ver V3 HECHO en §7).
2. **Origen del conteo**: usar el CLI de audit del gestor (recomendado, es la misma
   base que Dependabot pero local y por proyecto) vs replicar GHSA. Se adoptará el CLI.
3. **Lockfile en subcarpeta (frontend/)**: detectar el lockfile real por proyecto
   (PT/WANDORIUS/RESTAURANTE/coolify tienen frontend con lock propio) y auditarlo.
4. **Frecuencia vs coste**: el auto-timer debe respetar `scan.intervaloMin` y la caché
   por hash; en proyectos grandes `npm audit` puede tardar ~5–15 s → single-flight evita
   saturar.

## 7. Seguimiento

- Añadir tarea `308A-4` al roadmap (depende de infraestructura ya existente de análisis).
- Arranquear por V1 (núcleo) para ver el valor antes que la UI; luego V2 (consola+auto),
  V3 (Rust+no-auditables+R).
- **V1 HECHO (2026-08-30, commit workspace-manager):** módulo
  `src/server/gate/vulnerabilidades.ts` (detector homologo a `analizador.ts`: cola
  serial + single-flight por proyecto + cache por hash-del-lockfile + timeout 120 s),
  endpoints `/api/gate/vulnerabilidades` (POST single) y `/api/gate/vulnerabilidades-todo`
  + `/api/gate/vulnerabilidades-cache` (GET rehidratar), acciones de store
  (`auditarUno`/`auditarTodo`/`cargarVulnerabilidades`) cargadas en `AppV2`, subseccion
  «vulnerabilidades» con boton «auditá toda la consola» y badges por severidad en el
  PanelConfig (vista scan), y categoria `vulnerabilidades` en la consola (PanelConsola)
  con badges y severidad por linea, sumando al total 'todos'. Verificado en vivo:
  workspace-manager 4 (1 high+3 mod), gloryapi 23 (3 crit+11 high+7 mod+2 low),
  RESTAURANTE 2 critical (npm package-lock), glory-sentinel 2, Glory-Laminal 0.
  **Detalle tecnico:** `npm/pnpm/cargo audit` salen con exit 1 cuando hay
  vulnerabilidades; `correrConOutput` (spawn) recolecta stdout sin rechazar por exit
  code y decide por JSON parseable.
  **Pendiente de V1:** Rust (cargo) queda `noAuditable` hasta instalar `cargo-audit`
  (decision abierta). V2 (auto-timer periodo) y V3 (Rust+no-auditables+R) pendientes.
- **V3 HECHO (2026-08-31, sin cambio de código)** — `cargo-audit` instalado global (vía
  `cargo install cargo-audit`, build en `C:/tmp` respetando la política del área, limpiado
  después; `cargo audit --version` OK y sin efectos colaterales en el entorno). El detector
  `vulnerabilidades.ts` ya invocaba `cargo audit --json` automáticamente y decidía `ok`/
  `conHallazgos` cuando el parseo funcionaba; la única razón por la que los Rust quedaban
  `noAuditable` era la ausencia del binario, así que **no hizo falta tocar código**. Cobertura:
  GLORYPORT, WANDORIUS, PROYECTO TASKS, coolify-manager-rs (y cualquier repo con `Cargo.lock`).
  Conteo real de validación: **GLORYPORT cargo audit = 0 hallazgos** (1226 advisory database,
  24 deps, exit 0). Quedan pendientes: la fase R (revisión SOLID/eficiencia del frente completo)
  y los conteos cargo audit del resto de repos Rust para el cuadro completo.
- **R HECHO (2026-08-31, commit workspace-manager)** — revisión SOLID/eficiencia del frente
  completo (`vulnerabilidades.ts`, endpoints en `index.ts`, store `useWorkspace.ts`, UI
  PanelConfig/PanelConsola/PanelDetalle):
  - **Revisado (sin defectos):** cola serial de `auditarTodo` (1 auditor a la vez con await),
    single-flight por proyecto (`enVuelo` con cleanup en `finally`), caché por hash-del-lockfile
    (clave de frescura correcta: el audit depende del lockfile, no de HEAD), evicción de claves
    muertas, timeout 120 s por auditoría con cleanup, `correrConOutput` con `cmd /d /s /c`
    (`shell:false`, comando interno estático sin superficie de inyección), `cargarVulnerabilidades`
    best-effort con catch, timer único `temporizadorAuto` con single-flight propio (`auditando`)
    y `.catch` (sin unhandled rejection), botón «auditá toda la consola» con try/catch/finally,
    conteos por entrada y badges por severidad separados del resto en la consola.
  - **Corregido (1 defecto real):** el plan V1 pedía botón **por proyecto** («Auditar ahora» en
    PanelConfig/PanelDetalle) y la acción de store `auditarUno` + endpoint POST existían pero
    NINGÚN componente los llamaba (código muerto: el único botón cableado era el global). Se
    agregó el botón «auditá ahora» en `PanelDetalle.tsx` (homólogo a «escaneá ahora», mismo
    patrón con `finally`) + resumen por severidad de la auditoría del proyecto seleccionado.
  - **Verificado:** `pnpm type-check` exit 0; corrida real contra la instancia local
    `POST /api/gate/vulnerabilidades {clave:'workspace-manager'}` → shape esperado
    (`gestor:'pnpm'`, `estado:'conHallazgos'`, resumen 1 high + 3 moderate).