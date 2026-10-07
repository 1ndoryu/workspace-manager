# Plan 07AA-5 — pestaña `tareas`: kanban por proyecto con TASKS como dependencia (2026-10-07)

Decisión del usuario: integración al 100% con PROYECTO TASKS (no modelo propio
mínimo). TASKS funciona como **dependencia** del tablero; se escala por ambos
lados. Cada repo cambia en su casa con su roadmap/IDs; aquí solo vive el lado WM.

## Base verificada (solo lectura, 2026-10-07)

- TASKS expone tareas vía `src/handlers/productivity.rs:162-166` (`PUT+DELETE
  /tasks/:legacy_id`, `upsert_task` + soft-delete) y `dashboard.rs:24`
  (`GET /dashboard` agregado por `user_id`, rutas en `:57-58`); registro en
  `handlers/mod.rs:481` (dashboard) y `:484` (productivity); OpenAPI en
  `:103-104,108-109`. HUECO F1 (revisión 2026-10-07): NO existen
  listar-por-proyecto, mover/reordenar atómico (ni bulk), ni orden de
  columnas — hay que CREARLOS, no estabilizarlos. `sort_order` existe como
  columna (migración `:20,38,54`) y `orden:i32` en request
  (`models/productivity.rs:41,82`), pero solo vía upsert completo.
- Tablas `dashboard_tasks|dashboard_projects` (migración `20260814000000`, con
  `sort_order`, `payload JSONB`, `deleted_at`); tarea enlaza por
  `project_legacy_id`; request en `models/productivity.rs:29-88`.
- Auth SOLO cookie sesión (`middleware/auth.rs:12,30-33`) + CSRF en mutaciones
  (`:54-76`); **sin Bearer/API-key** (grep negativo calibrado en `src/**/*.rs`).
  `POST /api/security/mcp/token` exige usuario logueado: no sirve servicio-a-servicio.
- Arranque TASKS: `dev:back=node scripts/run-with-db.mjs` (DB por rama) + front;
  puertos 4190/4191, entrada `PROYECTO TASKS` ya en `scripts/dev/registro.json`.
  **Hoy no compila** (E0753 `glory-harness-core`, `Cargo.toml:57` path a
  `../glory-harness/core`): su `up` falla.
- Sin slug de proyecto (solo `legacy_id` + `nombre` ≤120): el mapeo columna↔proyecto
  TASKS hay que diseñarlo (fase F1).

## Objetivo

Pestaña `tareas` en el tablero: un solo panel con kanban; cada columna = un
proyecto del área (los del snapshot, como la consola); mover tareas entre
columnas y reordenar columnas; todo persiste en TASKS (fuente única); acceso
documentado para agentes en `AGENTS.md` + skill.

## Alcance / no alcance

- Sí: contrato dependencia lado TASKS (auth servicio-a-servicio + endpoints
  kanban estables), cliente WM con breaker, UI kanban, orden columnas persistido,
  docs (`AGENTS.md` + skill), mando/`up` integrado, tests y gate en ambos tocados.
- No: replicar la app TASKS en el tablero (solo kanban por proyecto); tocar
  `glory-harness-core` (si F0 root-causa allí → tarea separada en ese repo);
  push (lo sube el usuario); matar/puertos de opencode-propio (5174) ni 8787/5175.

## Dependencias

1. F0 desbloquea todo (TASKS debe compilar y levantar por `up`).
2. F1 (contrato lado TASKS) bloquea F2/F3. Cambios TASKS en SU repo y SU roadmap
   (su AGENTS.md exige bloque con roadmap→validar→commit; sin push).
3. Sesión D1 custodiada solo en el backend WM (sin token; ver F1); jamás al
   front ni a git.

## Fases

- **F0 Desbloquear TASKS (en su repo).** `cargo check` verde; `up PROYECTO TASKS`
  con health 4190 OK. Si la raíz es `glory-harness-core` → tarea separada allí,
  aquí solo se registra el bloqueo. Verificación: `up` + `/api/health` 200.
- **F1 Contrato dependencia (lado TASKS, su repo; CREA lo que falta).**
  Según D1 (NO token dedicado): sesión backend-a-backend con tu admin local
  (login programático, cookie+CSRF custodiados solo en el servidor WM,
  re-login al caducar; credenciales en env local gitignored). Verificar valor
  efectivo de `COOKIE_SECURE` en loopback (por defecto `false` en
  `127.0.0.1` — `config/mod.rs:238-258`; si el `.env` lo fuerza a `true`,
  la sesión no sobrevive por http). Endpoints NUEVOS: listar-por-proyecto,
  mover/reordenar atómico (preferir bulk transaccional antes que N PUTs:
  evita fallo parcial + 429 del `api_escritura_limiter`
  `handlers/mod.rs:310-330`), orden de columnas (persistir en
  `dashboard_settings.config` vía `PUT /dashboard/settings` existente
  `dashboard.rs:46-53` (acepta JSON arbitrario `preferencias: Option<Value>`
  con merge — `models/dashboard.rs:41-47` — sin migración; CLAVE CON NAMESPACE
  `preferencias.kanban.v1:{ordenColumnas,ordenTareas}` para no pisar el blob
  que ya usa el front). Clave estable columna↔proyecto = `legacy_id`
  (asignado por TASKS al crear; el nombre cambia y colisiona). Regla de
  datos: NUNCA probar contra la permanente (`glory_backend_local`, datos
  reales) — BD de rama o usuario de pruebas + snapshot de conteos pre/post.
  SEED (ronda 2): `branch-db.mjs` solo crea BD vacía y no hay seeds en el
  repo — F1 incluye script seed mínimo (2 proyectos × 3 tareas) o el bulk no
  se puede probar.
  DoD: contrato probado sin front (sesión + CSRF + CRUD + bulk) +
  pin/commit registrado aquí. Todo cambio TASKS en SU repo y SU roadmap.
- **F1b Núcleo compartido (D4, casa = TASKS resuelta).** Extraer tipos,
  cliente API, validaciones y operaciones a capa agnóstica dentro del repo
  TASKS (cero React, cero CSS); su editor migra sobre ella (su repo); WM la
  consume en F2/F3 por pin git tag/commit + disciplina de tags (PROHIBIDO
  `file:` en OneDrive: EPERM visto en F0; documentar formato de tags y dueño
  del versionado en lado TASKS). Declarar matriz de versiones
  (Vite 5.4.0 vs 6.4.3 hoy) o alinear locks; test de contrato versionado +
  changelog (cambio rompedor = major + aviso). Criterio "agnóstico"
  verificable (ronda 2): el paquete compila y testea SIN react/zustand/axios
  (test import-ban); alcance real: desacoplar de `navigationStore`,
  `exp/store`, `agente/store` (zustand), `apiClient`/`useDashboardApi`
  (fetch acoplado) y `jerarquiaTareas` (orden atado a tipo `Tarea`).
  YAGNI justificado: segundo consumidor real (WM) existe desde el día uno.
  GOBERNANZA (ronda 2, pendiente): `PROYECTO TASKS/AGENTS.md:18` manda la
  lógica reutilizable al submódulo glory-rs — la capa en TASKS necesita
  excepción firmada o vivir en glory-rs; ver decisión pendiente.
- **F2 Cliente WM (`src/server/tareas/puente-tareas.ts` + `rutasTareas.ts`).**
  Patrón pulse: base URL por env, timeout, breaker con `disponible:true/false` +
  motivo (degradado visible, nunca verde ambiguo); proxy `/api/tareas/*`
  (sesión D1 solo en servidor, validación `NOMBRE_OK`-estilo, límites,
  backoff con jitter + re-login con lock ante 429 (límite de reintentos: el
  re-login pega en otro limiter; sin tormenta); si TASKS caído → 503
  honesto + botón arrancar (vía endpoints dev existentes, como PanelDetalle).
  Eficiencia: nunca duplicar procesos (health primero; si ya corre, adjuntar).
  DoD: tests sin red (fábrica con fetch inyectado) + en vivo contra 4190.
  DUEÑO ARRANQUE (ronda 2): el botón = `status` → health 4190 → solo si libre
  `up PROYECTO TASKS`; si ocupado, adjuntar y mostrar deriva (jamás
  `Start-Process` artesanal: invisible al mando). Con la permanente abierta
  por acceso directo, el botón solo informa (pid files en `.runtime/` mandan).
- **F3 UI kanban (tab `tareas`, sobre el núcleo F1b, componentes propios).**
  Alta en `PanelCentral` (`tipos.ts` + whitelist `persistencia.ts` +
  `NavBar.tsx` + `AppV2.tsx`); `PanelTareas` con `Caja`/`FilaCajas`/`Button` canónicos, tokens `variables-v2.css`, cero CSS
  inline y cero clases huérfanas; columnas = `snapshot.proyectos` con orden
  reordenable persistido (ver D2); arrastrar o botones para mover tareas
  (teclado+contraste por diseño). DoD: `type-check` 0 + `vite build` OK +
  round-trip de persistencia (mover+reordenar sobreviven recarga) verificado.
- **F4 Acceso para agentes.** `AGENTS.md` (sección tareas: endpoints, sesión
  D1, `up PROYECTO TASKS`, mapeo columnas, paquete núcleo + versión) +
  `skills/dev-bootstrap/SKILL.md`
  (comando de tareas si se crea, mismo patrón que `consola.mjs`+test contrato).
- **F5 Cierre.** Gate forzado WM (cero nuevos en tocados) + lado TASKS
  (`cargo check` + clippy + tests en sus tocados); usuario de pruebas y
  conteos pre/post si se tocó BD de rama; roadmap/completada aquí y en
  TASKS; commits sin push (uno por repo).

## Estado

Activa (2026-10-07): plan escrito + decisiones del usuario fijadas:
- **D1 (auth): tu usuario admin local con auto-login.** El backend WM guarda tus
  credenciales en env local (gitignored, jamás al front ni a git), hace login
  programático contra TASKS, custodia cookie+CSRF solo en el servidor y
  re-entra solo al caducar.
- **D2 (mapeo y orden): todo en TASKS** (fuente única; ambos lados ven lo mismo).
- **D4 (2026-10-07, contra iframe): componentes propios con lógica
  compartida.** Nada de iframe/webview: se extrae la lógica de tareas a un
  núcleo agnóstico (sin React ni CSS: tipos, cliente API, validaciones,
  operaciones crear/mover/ordenar) consumido por ambos; cada proyecto
  conserva sus componentes y su diseño. Los estilos pueden compartir base
  con temas distintos por lado. Consecuencia: TASKS refactoriza su editor
  sobre el núcleo (en su repo); WM construye kanban+editor propios.
- **D3 (E0753): resuelto sin tocar al vecino.** F0 con mando `up` (2026-10-07):
  el backend compila OK (`Finished dev in 5m 03s`, log `logs/dev-up-PROYECTO
  TASKS.log:631`) — el WIP de `glory-harness/core` que bloqueaba el 25-09 ya
  no está. D3 queda cerrada sin acción.
- **F0 CERRADA sin borrar nada (2026-10-07).** Causa: BD de rama
  `glory_backend` reciclada con sellos fantasma (`20260915000001…`,
  sin fichero en `migrations/`) → `VersionMissing` al arrancar.
  Fix: `pg_dump -Fc` de ambas BDs (`.runtime/backup-F0-*.dump`),
  `glory_backend` renombrada a `glory_backend_previa_f0` (respaldo vivo,
  borrar cuando el usuario lo diga), `up` recreó BD fresca y dio verde
  (`health 4190:200`), luego `stop` liberó puertos para la permanente.
  Permanente reconstruida: `cargo build --bin glory-backend` con
  `CARGO_TARGET_DIR=.runtime/target` (6 min, documentado en
  `.freebuff/run.md:113-114`) + `npm install` en frontend (node_modules
  incompleto: `Cannot find package 'vite'`; el 1.er intento falló con
  `EPERM/ENOTEMPTY` por locks de OneDrive, el 2.º OK: 240 paquetes) +
  `start-permanente.ps1`. Verificación: `4190:200` (PID 22700) +
  `4191:200` (vite PID 17404) + conteos intactos en
   `glory_backend_local`: `users 512, dashboard_tasks 196,
   dashboard_habits 100, dashboard_projects 0, notes 3,
   agente_tareas_programadas 34` (= valores pre-fix). Ningún fichero con
   seguimiento tocado (`package-lock`, `package.json`, `.env` limpios).

- **F1 CERRADA 2026-10-07 (pin TASKS `14bbe8a`, sin push).** Endpoints kanban
  NUEVOS en `src/{models,services,repositories,handlers}/productivity.rs`:
  `GET /api/projects/:legacy_id/tasks` (tareas propias no borradas, orden
  `sort_order`; 404 proyecto inexistente) + `POST /api/tasks/reordenar`
  (bulk transaccional ≤200 movs, todo-o-nada con rollback; 404 tarea/proyecto
  desconocido, 422 duplicado en lote; cuota `api_escritura` 300/min) +
  orden columnas vía `PUT /api/dashboard/settings`
  (`preferencias.kanban.v1` con envelope `{valor,ts}`, sin migración).
  Contrato camelCase (`legacyId/proyectoId`); seed `scripts/seed-kanban-f1.mjs`
  (2 proyectos × 3 tareas vía API). Verificación viva contra BD rama:
  seed OK, GET 200 con 3 ordenadas, 404 honesto, bulk mueve 9103→9002,
  atomicidad del lote malo confirmada, `Secure` ausente en cookie
  (`HOST=127.0.0.1`), CSRF por header `x-csrf-token`; usuario de prueba
  borrado tras verificar. Gates: `check` verde, tests `productivity::` 5/5,
  `quality:check 07AA-1` PASS (0e/0w), clippy sin nuevos, fmt en líneas
  propias. Commit canónico `14bbe8a` (8 ficheros, 487+/6-).

## Decisión NÚCLEO (resuelta 2026-10-07: casa = TASKS, sin repo nuevo)

El paquete agnóstico vive **dentro del repo TASKS** como su capa agnóstica
(tipos, cliente, validaciones, operaciones; cero React, cero CSS). TASKS
escala a genuinamente agnóstico en backend+lógica; su editor migra sobre el
núcleo y el tablero lo consume fijando versión por tag/commit de TASKS.
Consecuencia aceptada: WM depende del ciclo de release de TASKS (pin
explícito; cambio rompedor = major + aviso).

## Decisión GOBERNANZA (resuelta 2026-10-07: opción 1)

Excepción firmada en TASKS: la capa agnóstica vive en TASKS porque es lógica
de producto-tareas, no framework (glory-rs es agnóstico de producto; el kanban
   no pinta nada allí). **F1 CERRADA 2026-10-07** (pin `14bbe8a`, ver Estado).

`PROYECTO TASKS/AGENTS.md:18` dice que la lógica reutilizable va al
submódulo glory-rs. Opciones:
1. **Excepción firmada en TASKS**: la capa agnóstica vive en TASKS porque
   es lógica de producto-tareas, no framework (recomendado: glory-rs es
   agnóstico de producto; el kanban no pinta nada allí).
2. Moverla a glory-rs: cumple la regla pero mete producto en el framework.
Falta tu palabra; F1 (endpoints) puede avanzar sin esto, F1b no.

## Checklist (SIGUIENTE ACCIÓN primero)

- [x] NÚCLEO: casa = capa agnóstica dentro de TASKS (2026-10-07).
- [ ] GOBERNANZA: excepción TASKS o glory-rs (puede ir en paralelo a F1).
- [x] F1 (repo TASKS): endpoints kanban NUEVOS + seed + tests — CERRADA
  2026-10-07, pin `14bbe8a` (quedó pendiente la sesión D1 programática:
  verificada a mano con cookie+CSRF; el puente F2 la automatiza).
- [ ] F1b: núcleo extraído (import-ban verde, pin git tag/commit, sin
  `file:`); editor TASKS migrado. Arranque parcial en paralelo a F1:
  tipos/validaciones de lo que YA existe (`UpsertTaskRequest`,
  `DashboardReadResponse`); solo bulk/reorden esperan a F1.
- [ ] F2: puente + proxy + breaker + backoff con jitter; 503 honesto + botón
  con dueño (status→health→`up` solo si libre). Esqueleto con fetch inyectado
  en paralelo a F1/F1b.
- [ ] F3: tab kanban propio sobre el núcleo; `type-check` 0 + build OK +
  round-trip persistencia.
- [ ] F4/F5: docs agentes + gates en tocados + completadas + commits sin push.

**SIGUIENTE ACCIÓN:** F1b (núcleo extraído con pin) + F2 (puente WM, incluye
sesión D1 programática). **AUTORIZADO PARA EJECUTAR** todo el
ciclo local (editar, probar contra BD de rama — jamás la permanente —, gate,
commit sin push); deploy/producción nunca implícitos.

## Próximo paso (histórico F0)

F0 cerrada (ver Estado). Mientras la permanente corra, PROHIBIDO
`up PROYECTO TASKS` (colisión en 4190/4191).

## Lecciones F0-2 (2026-10-07, permanente)

- `start-permanente.ps1` es idempotente y auto-repara (backend `YA corre`,
  `npm install` si falta el shim): ante fallo, reejecutar antes de
  improvisar; mi `Start-Process` manual de Vite sobraba y dejó un pid
  huérfano (lo adoptó el script al reejecutarse).
- `psql` no está en PATH (`C:\Program Files\PostgreSQL\18\bin\psql.exe`) y
  `$env:PGPASSWORD` no persiste entre comandos: todo en el mismo comando.
- Tablas reales sin `tareas/usuarios`: `dashboard_tasks/dashboard_habits/
  users/notes/agente_tareas_programadas`; contar contra esas.
- `backend.pid` reparado a mano una vez (pid del listener real por
  `Get-NetTCPConnection`); si el script dice "proceso ajeno" siendo nuestro,
  ese es el fix.

## Lección F0 (2026-10-07)

Arranqué `node scripts/run-with-db.mjs check` a mano en vez de usar el mando
(`up`/`status`): mal. El mando existe para no duplicar procesos ni saltarse
guards. Y el mando NO estaba roto: `doctor/status` sin `--snapshot-file`
muestran `snapshotEn=null` por diseño (solo leen fichero con ese flag);
con `--snapshot-file` del `/api/workspace` clasifica bien
(`parado PROYECTO TASKS puerto 4190 libre`). Regla: ciclo de vida solo por
mando y siempre con snapshot fresco vía `--snapshot-file`.

## Decisiones pendientes (D1–D3, ver cierre del turno)
