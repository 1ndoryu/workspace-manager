# workspace-manager — AGENTS.md

Tablero del área: frontend React+Vite + backend Node que muestra estado, consola y gate por proyecto.

- Puertos: backend `8787` (`npm run server`), frontend `5175` (`npm run dev -- --port 5175 --strictPort`). `5174` es opencode-propio: no tocar.
- Comandos: `npm run type-check`, `npm run build`, `npm run check`. API `http://127.0.0.1:8787`.

## Mando `dev` (arrancar/parar/ver cualquier proyecto del área)

Fuente: `scripts/dev/` (`dev.mjs` dispatcher, `doctor.mjs` sensores, `acciones.mjs`, `consola.mjs`, `registro.json`, `trampa.mjs`). Skill: `skills/dev-bootstrap/SKILL.md`.

```text
Arranque doctor --all            # estado honesto de todo (exit 0 verde / 2 degradado / 1 sensor roto)
Arranque up "<id>"               # arrancar un proyecto (ya-arriba / arrancado / rehusado, nunca mata a ciegas)
Arranque status ["<id>"]         # estado + salud sin tocar nada
Arranque stop "<id>"             # detiene solo listeners propios verificados (PID revalidado <500 ms antes)
Arranque logs "<id>" [--cola N]  # últimas líneas (defecto 50, tope 200)
Arranque open "<id>"             # imprime URLs con nombre (http://<slug>.localhost:<puerto>), sin abrir nada
Arranque problemas [--forzar] [--categoria <cat>] [--proyecto <clave>] [--json]  # consola agregada: mismo N + desglose (07AA-1)
```

`Arranque` = atajo global (`C:\Users\Owner\bin\Arranque.cmd` en el PATH de usuario, terminal nueva para verlo). Canónico sin atajo: `node scripts/dev/dev.mjs ...` desde este repo.

Reglas:

- Requisito: `status/up/stop/logs/problemas` hablan con el backend (`http://127.0.0.1:8787`, `npm run server`); sin backend, `--snapshot-file` con snapshot fresco (`GET /api/workspace?forzar=1`). Sin ninguno, el mando rehúsa a ciegas. `problemas` consume `GET /api/consola/problemas` (clasificadores compartidos `src/shared/clasificacionConsola.ts`, contrato en `scripts/dev/consola.test.mjs`): itera `proyectos`, nunca hardcodea claves; `--forzar` re-escanea.
- Los id son los de `scripts/dev/registro.json` (10 entradas + 7 `noAplica` = 17/17). Cada entrada tiene `dominio` (`<slug>.localhost`: pulse, inmobiliaria, nakomi, tareas, wandorius, gloryapi, laminal, coolify, harness, workspace). El navegador lo resuelve solo a tu PC, sin tocar `hosts` ni pedir administrador; el probe verifica el servicio con cabecera `Host` = dominio (Node/SO no resuelven `*.localhost`, solo el navegador). Si en el navegador ves `127.0.0.1`, fue arranque artesanal; si ves el nombre, pasó por el mando. Sin entrada no hay mando: `status`/`up` lo dicen, no inventan.
- Exit codes: `0` verde, `2` degradado/deriva (visible en consola, nunca verde ambiguo), `1` instrumento roto o uso rehusado. `parado` = detenido normal (todo libre), exit `0`, sin línea en problemas (05AA-4).
- Protegidos: `8787/5174/5175` y procesos de opencode-propio — jamás matarlos ni tocar sus puertos.
- Sin `up --all`: N `cargo build` en paralelo saturan la máquina. Uno por vez.
- Disciplina de arranque (2026-10-06, lección: un arranque artesanal deja
  la app fuera del mapa aunque responda 200): los 10 proyectos del registro
  se arrancan **solo** con `up <id>`. Prohibido `Start-Process`, `vite`,
  `cargo run` o `node` a mano para ellos; lo artesanal no es visible para el
  mando (`deriva ... ocupado por desconocido`) y otro agente no puede
  distinguirlo de un proceso ajeno.
- Si `status`/`up` rehúsan con `registro inválido`: no rodear el mando,
  arreglar el registro primero. Desde 06AA-1 el doctor ya no bloquea global:
  una entrada podrida queda marcada (`_avisoRegistro`, sale deriva con motivo)
  y el resto sigue; si falta el exe y la entrada declara `reconstruir`, `up`
  recompila solo (`cargo build` + `CARGO_TARGET_DIR`) antes de arrancar.
  Error global solo si es estructural sin id atribuible. Causa típica: el exe
  ya no existe (`glory-pulse` vive en target por rama
  `C:\tmp\glory-target\pulse-<rama>` y el sweep purga targets sin uso).
- `deriva ... ocupado por desconocido` = un artesanal ocupa el puerto:
  detener solo si es propio y verificado, luego `up`; el mando nunca mata
  a ciegas. Tras cambiar código de servidor compilado: `stop` + `up`.
- `up workspace-manager` auto-asegura `glory-pulse` (`requiere` en registro): si pulse está caído lo arranca solo (token local efímero si falta `PULSE_TOKEN`); si su puerto está ocupado por otro, sale 2 degradado con el pid ajeno, sin matar nada.
- Logs del mando en `<repo>/logs/dev-up-<id>.log` (gitignored); `C:\tmp` solo buffer.
- Verificación: `doctor --all --assert` (requiere snapshot fresco de `/api/workspace`), trampa `node scripts/dev/trampa.mjs` (9 checks: 8/9, FAIL preexistente `plugins-opencode` pendiente-onboarding).

## Tareas (kanban con TASKS como fuente única, 07AA-5)

Tab `tareas` (NavBar icono `Kanban`): columnas fijas = un repo no-ignorado
del snapshot WM (08AA-6: sin caja agregar, sin X, sin localStorage; el orden
lo fija el snapshot), movimiento de tareas solo por arrastre DnD nativo
(08AA-5: sin botones de mover, ni en el menú ni en la cabecera),
alta rápida inline por columna (Enter o `añadir` → PUT-upsert con id
espejo-TASKS), bulk+relectura vía proxy.

- Proxy backend (`src/server/tareas/rutasTareas.ts`): `GET /api/tareas/estado`
  (disponibilidad+motivo, nunca 500), `GET /api/tareas/proyectos` (sincroniza
  WM→TASKS y devuelve las columnas fijas `[{clave,nombre,legacyId}]`),
  `GET /api/tareas/proyecto?legacy_id=` (400 sin id), `POST /api/tareas/reordenar` (422 validación/duplicado,
  404 no-encontrado, 429+Retry-After en cuota, 503 sin-credenciales/red,
  502 servidor). Núcleo agnóstico vendorizado en `src/server/tareas/nucleo/`
  (pin `tasks-core@<hash>` + `PIN.md` con cómo re-vendorizar; prohibido `file:`).
- Sincronización pura WM→TASKS (`src/server/tareas/sincronizar-proyectos.ts`,
  puro e inyectable): empareja por `payload.wmClave` exacto y crea con
  `PUT /api/projects/:legacy_id` (`{nombre:id-WM, payload:{wmClave:clave}}`,
  id `Date.now()*1000+resto`) solo los proyectos que falten; secuencial,
  nunca borra ni renombra; sin `wmClave` (demos) = sin columna, intactos.
- Sesión D1: el backend guarda `TASKS_EMAIL`/`TASKS_PASSWORD` de su propio
  entorno (jamás al front ni a git), login programático contra TASKS
  (`session_id` HttpOnly + `csrf_token`/`x-csrf-token`), re-login con lock
  al caducar. Sin credenciales el tab degrada a `sin-credenciales` con
  reintentar (nunca datos falsos).
- Activar: esas dos vars SOLO entran reiniciando el backend 8787 (hecho el
  2026-10-07 con autorización del usuario: `tsx watch src/` relanzado idéntico
  con `TASKS_EMAIL`/`TASKS_PASSWORD` admin local; verificado
  `disponible:true` + ciclo proxy con datos). OJO: cualquier reinicio del
  8787 sin esas vars devuelve el tab a `sin-credenciales` (`stop` rehúsa 8787
  por protegido y el mando no inyecta env en caliente; `env` del registro
  solo aplica a hijos que `up` lanza).
- Stack permanente TASKS (repo `PROYECTO TASKS`, fuera del mando: sin entrada
  en registro): backend `127.0.0.1:4190` (binario
  `.runtime/target/debug/glory-backend.exe`) + Vite `4191`, BD
  `glory_backend_local`. Arranque/restart SOLO vía
  `.freebuff/start-permanente.ps1` (idempotente; watchdog
  `watchdog-permanente.ps1` cada 15 s + tarea `task-app-permanente` solo
  logon); rebuild `CARGO_TARGET_DIR=.runtime/target cargo build --bin
  glory-backend` (el exe en curso bloquea el linker: parar el backend
  primero; el watchdog relanza el viejo en ~15 s: pausarlo durante el build).
  OJO: el fetch global (undici) NUNCA habla con el 4190 (`bad port` por
  Fetch-spec): producción usa `node:http` (`transporte-tareas.ts`).

## Bloqueos conocidos (2026-10-01, fuera de este repo)

- ~~`PROYECTO TASKS` no compila: dependencia ajena `glory-harness-core` (E0753).~~
  Obsoleto 2026-10-07: compila y corre (rebuild+restart permanente 4190
  verificado con F1 en vivo 13/13).
- Puerto `5173` ocupado por opencode-propio mientras esté abierto: frontends en 5173 no arrancan hasta cerrarlo.
- Primera compilación Rust en frío tarda varios minutos; es la máquina compilando, no el mando.
