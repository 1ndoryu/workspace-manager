---
name: dev-bootstrap
description: Arrancar, detener o comprobar cualquier proyecto del área con el mando dev de workspace-manager. Usar cuando el usuario quiera levantar, parar, ver el estado o ver los logs de un proyecto registrado.
---

# Dev-bootstrap

Operas los proyectos de `config/registro.json` del área con el mando `dev`. Todo desde `workspace-manager/` en Windows PowerShell.

## Comandos

```text
Arranque doctor --all            # ver todo (exit 0 verde / 2 degradado / 1 sensor roto)
Arranque up "<id>"               # arrancar (nunca mata procesos ajenos a ciegas)
Arranque status ["<id>"]         # estado sin tocar nada
Arranque stop "<id>"             # parar (solo listeners propios verificados)
Arranque logs "<id>" [--cola N] # logs (defecto 50, tope 200)
Arranque open "<id>"            # mostrar URLs con nombre (http://<slug>.localhost:<puerto>)
Arranque alta "<id|carpeta>" [--aplicar]  # lista de alta: en seco; --aplicar crea lo mecánico en la rama alta/10aa-2
```

`Arranque` = atajo global (`%USERPROFILE%\bin\Arranque.cmd` en el PATH de usuario; hace falta terminal nueva la primera vez). Sin atajo: `node scripts/dev/dev.mjs ...` desde el repo.

Los `<id>` válidos están en `config/registro.json` (`Arranque status` los lista).

## Alta de proyecto nuevo

Añadir una entrada en `config/registro.json`. Campos admitidos (el `doctor` rechaza cualquier otro; la lista exacta es `conocidas` en `scripts/dev/doctor/ficha/validacion.mjs:50`: además de los del ejemplo, `procesosAceptados`, `reconstruir`, `auxiliares`, `comandos`, `host`, `analisisEn`, `envRemoto`, `botonRemoto`, `puertosRemotos`, `puertosLocales`, `tunelSsh`, `tunelesExtra`, `hostsPublicos`, `puertosPublicos`, `buildMode`, `modo`, `build`, `precompilar`, `dependencias`, `envTareas`, `tokenPulse` y `higieneRust`):

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
  "requiere": ["<id-del-servicio>"],
  "env": { "MI_VAR": "valor" },
  "tipoLauncher": "descripción corta del lanzador"
}
```

Reglas:

- `id` único, `ruta` relativa al repo, `dominio` con el patrón `<slug>.localhost`.
- `puertos`: nunca `8787/5174/5175` (protegidos) ni uno ya usado por otra entrada.
- `boton`: el comando exacto que levanta el proyecto; `expectedCmdline`: subcadena que lo identifica en la lista de procesos.
- `requiere`: solo si necesita otro servicio antes (p. ej. `<id-del-servicio>`); `env`: objeto string→string no vacío (p. ej. `VITE_PORT`, vars de sccache) - llega al hijo vía `envPara()`/`lanzar()`, sin reiniciar el backend.
- Sin servicio que levantar (solo docs o estático): no va en entradas, va en `noAplica` con motivo (`sin-servicio`).
- Host remoto (`host`, alias SSH de la VPS del taller): la entrada corre en esa VPS y su alta la valida `remoto.mjs` (fail-closed). `tunelSsh: false` = sin túnel SSH (dev público por Cloudflare Access, ver skill `taller-remoto`); `puertosLocales` no aplica con `tunelSsh: false`.
- Validar el alta con `Arranque doctor --all` (falla si la entrada está mal formada) y luego `status "<id>"`.
- Alta completa del proyecto (11 puntos: stack, git, README, roadmap y `Agente/`, registro, Sentinel, varsense, `quality:check`, `target-dir`, `.gitignore`, sin AGENTS/CLAUDE propios): fuente canónica, esta skill y lo que lista `Arranque alta "<id>"`. `Arranque alta "<id>"` dice qué falta; `--aplicar` crea solo lo mecánico y nunca sobrescribe ni escribe en el registro.

## Flujo ante "arranca X"

0. Requisito: el backend del manager (`http://127.0.0.1:8787`) debe responder; si no, levántalo con `npm run server` (ligero, sin compilación pesada) y espera a que escuche el 8787. Sin backend usa `--snapshot-file` con snapshot fresco (`GET /api/workspace?forzar=1`); sin ninguno, el mando rehúsa a ciegas (es lo correcto).
1. `status "X"`: si ya está arriba, dilo y termina (no dupliques procesos). `parado` = detenido normal (exit 0, no es caída): se arranca sin más trámite.
2. Si está caído, `up "X"`. Primera vez en frío compila Rust (minutos): avisa, no lo mates.
3. Si `up` rehúsa (exit 1) o deriva (exit 2), lee el motivo y repórtalo tal cual; no fuerces ni mates a ciegas.
4. Verifica con `status` + `Get-NetTCPConnection -LocalPort <puerto> -State Listen`.

## Prohibido

- Matar o tocar `5174` y procesos de opencode-propio (la app del usuario). `8787` y `5175` son del tablero: solo reiniciarlos con PID y línea de comando verificados.
- `up --all` o arrancar varios Rust a la vez (thrash de compilación). Uno por vez.
- `up <id>` enciende sus `requiere` solo si estaban caídos; si el puerto de uno está ocupado por otro proceso, sale 2 avisando el pid, sin matar.
- Editar `scripts/quality-sync/quality-sync.mjs` y `sentinel.lock.json.bak` (ruido ajeno sin commitear).
- Tocar código de otros repos para que algo arranque (p. ej. una librería compartida de otro proyecto).

## Integración de tareas (opcional)

```text
GET  /api/tareas/estado                  # {disponible, motivo} honesto
GET  /api/tareas/proyecto?legacy_id=9001 # tareas de la columna
POST /api/tareas/reordenar               # {movimientos:[{legacyId,orden,proyectoId?}]} (bulk ≤200)
```

- Solo funciona si el proyecto de tareas está configurado; si no, `disponible: false` con su motivo, nunca datos falsos.
- Credenciales en `logs/.tareas-env` (gitignored), no en el repo. Se leen al arrancar el backend: tras editarlas, reinícialo.
- Núcleo agnóstico: `src/server/tareas/nucleo/` (pin en `PIN.md`).

