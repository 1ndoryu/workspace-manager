---
name: dev-bootstrap
description: Arrancar, detener o comprobar cualquier proyecto del área con el mando dev de workspace-manager. Usar cuando el usuario quiera levantar, parar, ver el estado o ver los logs de un proyecto (MN-Inmobiliaria, NAKOMI, WANDORIUS, PROYECTO TASKS, gloryapi, etc.).
---

# Dev-bootstrap

Operas los 17 proyectos del área con el mando `dev`. Todo desde `workspace-manager/` en Windows PowerShell.

## Comandos

```text
node scripts/dev/dev.mjs doctor --all            # ver todo (exit 0 verde / 2 degradado / 1 sensor roto)
node scripts/dev/dev.mjs up "<id>"               # arrancar (nunca mata procesos ajenos a ciegas)
node scripts/dev/dev.mjs status ["<id>"]         # estado sin tocar nada
node scripts/dev/dev.mjs stop "<id>"             # parar (solo listeners propios verificados)
node scripts/dev/dev.mjs logs "<id>" [--cola N] # logs (defecto 50, tope 200)
node scripts/dev/dev.mjs open "<id>"            # mostrar URLs con nombre (http://<slug>.localhost:<puerto>)
```

Los `<id>` válidos están en `scripts/dev/registro.json` (p. ej. `MN-Inmobiliaria`, `NAKOMI`, `WANDORIUS`, `PROYECTO TASKS`, `glory-pulse`, `gloryapi`).

## Flujo ante "arranca X"

0. Requisito: el backend del manager (`http://127.0.0.1:8787`) debe responder; si no, levántalo con `npm run server` (ligero, sin compilación pesada) y espera a que escuche el 8787. Sin backend usa `--snapshot-file` con snapshot fresco (`GET /api/workspace?forzar=1`); sin ninguno, el mando rehúsa a ciegas (es lo correcto).
1. `status "X"`: si ya está arriba, dilo y termina (no dupliques procesos).
2. Si está caído, `up "X"`. Primera vez en frío compila Rust (minutos): avisa, no lo mates.
3. Si `up` rehúsa (exit 1) o deriva (exit 2), lee el motivo y repórtalo tal cual; no fuerces ni mates a ciegas.
4. Verifica con `status` + `Get-NetTCPConnection -LocalPort <puerto> -State Listen`.

## Prohibido

- Matar o tocar `8787/5174/5175` y procesos de opencode-propio (la app del usuario).
- `up --all` o arrancar varios Rust a la vez (thrash de compilación). Uno por vez.
- Editar `scripts/quality-sync.mjs` y `sentinel.lock.json.bak` (ruido ajeno sin commitear).
- Tocar código de otros repos para que algo arranque (p. ej. `glory-harness-core`).

## Bloqueos conocidos (decirlos, no esconderlos)

- `PROYECTO TASKS`: no compila por `glory-harness-core` E0753 (ajeno). Su `up` fallará hasta que se arregle allí.
- Puerto `5173` ocupado por opencode-propio mientras esté abierto: frontends en 5173 esperan.
