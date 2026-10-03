# workspace-manager — AGENTS.md

Tablero del área: frontend React+Vite + backend Node que muestra estado, consola y gate por proyecto.

- Puertos: backend `8787` (`npm run server`), frontend `5175` (`npm run dev -- --port 5175 --strictPort`). `5174` es opencode-propio: no tocar.
- Comandos: `npm run type-check`, `npm run build`, `npm run check`. API `http://127.0.0.1:8787`.

## Mando `dev` (arrancar/parar/ver cualquier proyecto del área)

Fuente: `scripts/dev/` (`dev.mjs` dispatcher, `doctor.mjs` sensores, `acciones.mjs`, `registro.json`, `trampa.mjs`). Skill: `skills/dev-bootstrap/SKILL.md`.

```text
kamples doctor --all            # estado honesto de todo (exit 0 verde / 2 degradado / 1 sensor roto)
kamples up "<id>"               # arrancar un proyecto (ya-arriba / arrancado / rehusado, nunca mata a ciegas)
kamples status ["<id>"]         # estado + salud sin tocar nada
kamples stop "<id>"             # detiene solo listeners propios verificados (PID revalidado <500 ms antes)
kamples logs "<id>" [--cola N]  # últimas líneas (defecto 50, tope 200)
kamples open "<id>"             # imprime URLs con nombre (http://<slug>.localhost:<puerto>), sin abrir nada
```

`kamples` = atajo global (`C:\Users\Owner\bin\kamples.cmd` en el PATH de usuario, terminal nueva para verlo). Canónico sin atajo: `node scripts/dev/dev.mjs ...` desde este repo.

Reglas:

- Requisito: `status/up/stop/logs` hablan con el backend (`http://127.0.0.1:8787`, `npm run server`); sin backend, `--snapshot-file` con snapshot fresco (`GET /api/workspace?forzar=1`). Sin ninguno, el mando rehúsa a ciegas.
- Los id son los de `scripts/dev/registro.json` (10 entradas + 7 `noAplica` = 17/17). Cada entrada tiene `dominio` (`<slug>.localhost`: pulse, inmobiliaria, nakomi, tareas, wandorius, gloryapi, laminal, coolify, harness, workspace). El navegador lo resuelve solo a tu PC, sin tocar `hosts` ni pedir administrador; el probe verifica el servicio con cabecera `Host` = dominio (Node/SO no resuelven `*.localhost`, solo el navegador). Si en el navegador ves `127.0.0.1`, fue arranque artesanal; si ves el nombre, pasó por el mando. Sin entrada no hay mando: `status`/`up` lo dicen, no inventan.
- Exit codes: `0` verde, `2` degradado/deriva (visible en consola, nunca verde ambiguo), `1` instrumento roto o uso rehusado.
- Protegidos: `8787/5174/5175` y procesos de opencode-propio — jamás matarlos ni tocar sus puertos.
- Sin `up --all`: N `cargo build` en paralelo saturan la máquina. Uno por vez.
- Logs del mando en `<repo>/logs/dev-up-<id>.log` (gitignored); `C:\tmp` solo buffer.
- Verificación: `doctor --all --assert` (requiere snapshot fresco de `/api/workspace`), trampa `node scripts/dev/trampa.mjs` (7/7).

## Bloqueos conocidos (2026-10-01, fuera de este repo)

- `PROYECTO TASKS` no compila: dependencia ajena `glory-harness-core` (E0753). Su `up` falla hasta que se arregle allí.
- Puerto `5173` ocupado por opencode-propio mientras esté abierto: frontends en 5173 no arrancan hasta cerrarlo.
- Primera compilación Rust en frío tarda varios minutos; es la máquina compilando, no el mando.
