---
name: dev-bootstrap
description: Arrancar, detener o comprobar cualquier proyecto del área con el mando dev de workspace-manager. Usar cuando el usuario quiera levantar, parar, ver el estado o ver los logs de un proyecto (MN-Inmobiliaria, NAKOMI, WANDORIUS, PROYECTO TASKS, gloryapi, etc.).
---

# Dev-bootstrap

Operas los 17 proyectos del área con el mando `dev`. Todo desde `workspace-manager/` en Windows PowerShell.

## Comandos

```text
Arranque doctor --all            # ver todo (exit 0 verde / 2 degradado / 1 sensor roto)
Arranque up "<id>"               # arrancar (nunca mata procesos ajenos a ciegas)
Arranque status ["<id>"]         # estado sin tocar nada
Arranque stop "<id>"             # parar (solo listeners propios verificados)
Arranque logs "<id>" [--cola N] # logs (defecto 50, tope 200)
Arranque open "<id>"            # mostrar URLs con nombre (http://<slug>.localhost:<puerto>)
```

`Arranque` = atajo global (`C:\Users\Owner\bin\Arranque.cmd` en el PATH de usuario; hace falta terminal nueva la primera vez). Sin atajo: `node scripts/dev/dev.mjs ...` desde el repo.

Los `<id>` válidos están en `scripts/dev/registro.json` (p. ej. `MN-Inmobiliaria`, `NAKOMI`, `WANDORIUS`, `PROYECTO TASKS`, `glory-pulse`, `gloryapi`).

## Alta de proyecto nuevo

Añadir una entrada en `scripts/dev/registro.json`. Campos admitidos (el `doctor` rechaza cualquier otro):

```json
{
  "id": "mi-proyecto",
  "ruta": "../mi-proyecto",
  "dominio": "miproyecto.localhost",
  "boton": [["npm", "run", "dev"]],
  "puertos": [31xx],
  "healths": [{ "puerto": 31xx, "ruta": "/health", "esperaJson": true }],
  "timeoutMs": 3000,
  "arranqueMs": 180000,
  "expectedCmdline": "mi-proyecto",
  "requiere": ["glory-pulse"],
  "env": { "MI_VAR": "valor" },
  "tipoLauncher": "descripción corta del lanzador"
}
```

Reglas:

- `id` único, `ruta` relativa al repo, `dominio` con el patrón `<slug>.localhost`.
- `puertos`: nunca `8787/5174/5175` (protegidos) ni uno ya usado por otra entrada.
- `boton`: el comando exacto que levanta el proyecto; `expectedCmdline`: subcadena que lo identifica en la lista de procesos.
- `requiere`: solo si necesita otro servicio antes (p. ej. `glory-pulse`); `env`: objeto string→string no vacío (p. ej. `VITE_PORT`, vars de sccache) — llega al hijo vía `envPara()`/`lanzar()`, sin reiniciar el backend.
- Sin servicio que levantar (solo docs o estático): no va en entradas, va en `noAplica` con motivo (`sin-servicio`).
- Validar el alta con `Arranque doctor --all` (falla si la entrada está mal formada) y luego `status "<id>"`.

## Flujo ante "arranca X"

0. Requisito: el backend del manager (`http://127.0.0.1:8787`) debe responder; si no, levántalo con `npm run server` (ligero, sin compilación pesada) y espera a que escuche el 8787. Sin backend usa `--snapshot-file` con snapshot fresco (`GET /api/workspace?forzar=1`); sin ninguno, el mando rehúsa a ciegas (es lo correcto).
1. `status "X"`: si ya está arriba, dilo y termina (no dupliques procesos). `parado` = detenido normal (exit 0, no es caída): se arranca sin más trámite.
2. Si está caído, `up "X"`. Primera vez en frío compila Rust (minutos): avisa, no lo mates.
3. Si `up` rehúsa (exit 1) o deriva (exit 2), lee el motivo y repórtalo tal cual; no fuerces ni mates a ciegas.
4. Verifica con `status` + `Get-NetTCPConnection -LocalPort <puerto> -State Listen`.

## Prohibido

- Matar o tocar `8787/5174/5175` y procesos de opencode-propio (la app del usuario).
- `up --all` o arrancar varios Rust a la vez (thrash de compilación). Uno por vez.
- `up workspace-manager` enciende pulse solo si estaba caído (`requiere: ["glory-pulse"]`); con el 3000 ocupado por otro sale 2 avisando el pid, sin matar.
- Editar `scripts/quality-sync.mjs` y `sentinel.lock.json.bak` (ruido ajeno sin commitear).
- Tocar código de otros repos para que algo arranque (p. ej. `glory-harness-core`).

## Bloqueos conocidos (decirlos, no esconderlos)

- `PROYECTO TASKS`: no compila por `glory-harness-core` E0753 (ajeno). Su `up` fallará hasta que se arregle allí.
- Puerto `5173` ocupado por opencode-propio mientras esté abierto: frontends en 5173 esperan.
