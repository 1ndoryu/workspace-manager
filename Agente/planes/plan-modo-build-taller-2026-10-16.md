# Plan — Modo `build` por defecto y adelgazamiento del disco del taller (`16AA-18`, `16AA-19`)

**Estado:** en ejecución. **Próximo paso:** D1 (disco).
**Fecha:** 2026-10-16. **Decide:** la usuaria (encargo del 2026-10-16).
**Ámbito:** `workspace-manager` (taller) + cambios pequeños en WANDORIUS y MN-Inmobiliaria.
**Revisado:** tres revisiones adversariales (diseño, disco, ejecución). Este documento ya incorpora
sus correcciones; las que desmienten afirmaciones previas van marcadas **[corregido]**.

Dos objetivos en un documento porque comparten motivo (la 89 va justa) pero **se ejecutan por
separado**: `16AA-19` es el disco (§8–§10) y `16AA-18` el modo `build` (§1–§7). El disco va
primero: es independiente y libera RAM de trabajo para las pruebas del modo build.

**No son independientes en los recursos**, aunque sí en el diseño: comparten el lock de
`cm-heavy`, el snapshot único del gate (`data/gate-inicio/workspace-manager.json`) y el
`roadmap.md`. Por eso hay **un commit por fase** y el gate se toma una vez en D0 y se reutiliza
mientras el árbol no cambie.

**Decisiones de la usuaria (2026-10-17):** D1 se ejecuta (con checklist, §11); `_obsoleto/` **se
conserva**; y **las seis fichas remotas quedan en `build`**, MN incluida — lo que mete en alcance
el cambio de camino público de MN (`/rust` → `/`).

---

# Parte I — `16AA-19`: adelgazar el disco

## 8. Objetivo de `16AA-19`

Adelgazar la 89 **sin que el ciclo editar→compilar→ver se alargue**. Todo lo que sigue está medido
en la 89 el 2026-10-16. Lo que costaría tiempo está separado en §8.4 (medida M2) y **no se hace
por defecto**.

### 8.1 Inventario medido

`/dev/sda1` ext4, 96 GB, **78 usados, 18–19 libres**.

| Qué | Tamaño | ¿Regenerable? | Nota |
|---|---|---|---|
| Caché de build de BuildKit | **24,24 GB** | sí | 170 entradas, **0 activas**, 23,89 GB reclamables |
| `/var/tmp/glory-target` (targets de cargo) | **23 GB** | sí | **8** directorios; KAMPLES_main solo son **14 GB** |
| `~/.cargo/registry` | 2,4 GB | sí | `src` 2,0 GB + `cache` 260 MB + `index` 75 MB |
| `node_modules` (9 sitios) | 2,1 GB | sí | 205–575 MB por front |
| `~/.npm` | 1,4 GB | sí | caché de descargas |
| `~/.rustup` (toolchains) | 735 MB | no | |
| `/usr` | 4,9 GB | no | |
| swapfile | 4 GB | no | RAM de emergencia |
| `~/taller/_obsoleto/` | 138 MB | **no** | copia de un workspace previo, **sin `.git`** — **se conserva** |
| `/var/lib/apt/lists` | 205 MB | sí | |
| `/var/log` · journald · snap · `/var/cache/apt` | 93 · 21 · 0,3 MB · 60 KB | — | ya limpios (M7) |

### 8.2 Los dos techos del taller: uno inerte, el otro brutal

**[corregido]** El diagnóstico anterior («los dos están inertes») era falso en la mitad. Son dos
fallos opuestos:

- **BuildKit — inerte, y miente en el log.** `cm-sweep:109` ejecuta `docker buildx prune -f
  --max-used-space 12GB --filter "until=168h"` y escribe «caché de build <= 12 GB y > 168 h
  podada» en **cada** pasada, mientras `docker system df` da **24,24 GB**. El `if` solo mira el
  código de salida. En el código de BuildKit (`cache/manager.go`, `pruneOnce`) el `--filter`
  decide *qué* entra en el conjunto a borrar y `--max-used-space` solo fija el umbral al que hay
  que llegar: si el filtro deja pocos candidatos, el bucle termina antes del umbral y devuelve
  éxito. Y el techo que de verdad manda es otro: `docker buildx inspect --bootstrap` muestra
  **4 reglas de GC ya activas**, con `Max Used Space: 71.71GiB`, `Reserved: 9.31GiB` y `Min Free
  Space: 18.63GiB`. Los 24,24 GB caben de sobra bajo 71,71 GiB, por eso no se toca nada.
  M5 no es «añadir GC» —ya hay— sino **bajar ese techo**.
- **Targets — funciona, y es todo-o-nada.** `purgar_targets 25` sí se dispara. El log de
  `cm-sweep` del 2026-10-16 lo prueba: purgas a las 16:01 (`restaurante_main`), 20:01
  (`workspace-manager_main`, `RESTAURANTE_main`, `glory-harness_linux`), 23:01 (`KAMPLES_tauri`) y
  23:39 (`KAMPLES_win_base`, `KAMPLES_win_todo`), y dos pasadas (21:00, 22:00) omitidas con
  «cm-heavy tiene el lock». **[corregido]** El problema es *cómo* purga: `en_uso()` decide por el
  mtime más reciente del árbol entero, así que un proyecto que se toca cada dos días conserva sus
  14 GB íntegros (intermedios muertos incluidos) y **uno vivo que no se tocó pierde el target
  completo** —así cayeron `workspace-manager_main` y `RESTAURANTE_main`, que ahora pagarán
  compilación completa en su próximo `up`. Un techo no hace nada; el otro destruye trabajo.
  M1 existe justo para dar una opción quirúrgica y que el bruto dispare menos.

### 8.3 El caso KAMPLES: 7,9 GB de caché incremental que no sirve

`KAMPLES_main` es **14 GB**: `debug/incremental` **7,9 GB**, `debug/deps` 5,3 GB, `build` 78 MB. En
`deps` hay `rlib` 3,06 GB, `rmeta` 1,24 GB, **`.dwo` 0,84 GB** y **5 binarios `glory_backend` de
210 MB** (1,05 GB en copias del mismo ejecutable).

`incremental` son **52 directorios** (`glory_backend-*` 31, `glory_rs-*` 12, `rescatar-*` 9), de
~700 MB cada uno, y **49 se crearon el 2026-10-16** — varios por pares, a las 22:14, 22:36, 22:50,
23:08. No son restos viejos: cargo crea uno nuevo cada vez que cambia el hash de los parámetros de
compilación y **no borra ninguno**. Con 52 conjuntos distintos, la caché se paga en disco (7,9 GB)
sin llegar a acertar. **La causa de que el hash cambie no está identificada**, solo el hecho; M1 lo
limpia, pero si vuelve a cambiar se acumularán otra vez (por eso M1 deja un contador, §8.6).

KAMPLES es además el único de los seis con perfil propio distinto:

```toml
# KAMPLES/Cargo.toml:160
[profile.dev]
opt-level = 0
debug = 1                          # los otros cinco: "line-tables-only"
debug-assertions = true
overflow-checks = true
incremental = true
codegen-units = 256
split-debuginfo = "unpacked"       # los otros cinco: "packed" o sin declarar
```

**[corregido]** `opt-level = 0`, `debug-assertions`, `overflow-checks`, `incremental = true` y
`codegen-units = 256` **son los valores por defecto de cargo en dev**: declararlos no cambia nada.
Lo único que de verdad desvía son **`debug = 1`** (vs `line-tables-only`) y **`split-debuginfo =
"unpacked"`**, que es el que produce los 840 MB de `.dwo` y arrastra un defecto conocido de rustc
(rust-lang/rust#161824): desde 1.88 acumula `*.rcgu.o` sin límite. `packed` es lo correcto en
Linux, y los otros cinco ya lo usan.

### 8.4 Medidas, con su coste declarado

| # | Medida | Ganancia medida | Coste de tiempo |
|---|---|---|---|
| **M1** | Podar `debug/incremental/*` conservando los **2 más recientes por crate**, en los 8 targets | **8,0 GB** (KAMPLES 6,64 + MN 1,36) | **ninguno** |
| **M2** | ~~Alinear `[profile.dev]` de KAMPLES (`debug = "line-tables-only"`, `split-debuginfo = "packed"`)~~ | ~~~0,8 GB de `.dwo`~~ → **~0,3 GB medidos** | **descartada**: no paga el rebuild (D3) |
| **M3** | Purgar el target de rama muerta `MN-Inmobiliaria_16aa-9-f3-tools` | 1,5 GB | ninguno |
| **M4** | ~~Purgar `_obsoleto/`~~ | — | **descartada** (la usuaria decidió conservarla) |
| **M5** | **Bajar** el techo de la caché de BuildKit a 12 GB en `/etc/docker/daemon.json` | 24,24 GB → ~12 GB | **bajo** — ver abajo |
| **M6** | Corregir la línea mentirosa de `cm-sweep` y comprobar el resultado real, no el código de salida | — | ninguno |
| **M7** | `journalctl --vacuum-size`, `apt-get clean`, `docker image prune`, purga por mtime, `cm-local/*` | 0 | **ya lo hace `cm-sweep`**; se deja igual |

**M1 + M3 + M5 = ~22 GB** (78 → ~56 GB usados, 18 → ~40 GB libres), sin coste de tiempo.

**[corregido] M2 no es gratis.** Cambiar `[profile.dev]` cambia el *fingerprint* de todo el grafo:
el próximo build de KAMPLES recompila entero. Y los `.dwo` viejos no se borran solos —cargo nunca
poda artefactos antiguos—, así que el disco **crece** hasta que se hace un `cargo clean` explícito.
Por eso M2 va en fase propia (D3), **después** de M1, y con su coste a la vista.

**[corregido] M5 es la única que toca el build de imágenes.** Con el driver `docker` la política va
en `/etc/docker/daemon.json`, bajo `"builder": {"gc": {"policy": [{"maxUsedSpace": "12GB"}]}}`
(en `daemon.json` los filtros usan un solo `=`, no `==`). Necesita **reiniciar dockerd**, que es
root (`ssh root@192.0.2.10`, clave disponible). El reinicio es barato **hoy** porque
`live-restore=false` y hay **0 contenedores en marcha** (los 5 de Coolify están Exited y postgres
es un proceso nativo en 5432) — pero eso mismo hace que su ganancia hoy sea baja: nadie está
construyendo imágenes. Se hace ahora precisamente porque es el momento sin coste. Copia previa de
`daemon.json` obligatoria (§9).

**Hecho el 2026-10-17 — con un tropiezo que hay que dejar escrito.** La política aplicada es una
sola regla sin filtros: `reservedSpace: 9.313GiB`, `maxUsedSpace: 12GB`, `minFreeSpace: 18.63GiB`.
El primer intento metió tres valores en `filter` (`type=source.local`, `type=exec.cachemount`,
`type=source.git.checkout`) y **dockerd no arrancó**: `error initializing buildkit: filters expect
only one value` → `Start request repeated too quickly`. **`dockerd --validate` dijo «configuration
OK» y no lo detectó**: la validación del JSON no valida la semántica de la política de GC. El
`filter` de una regla admite **exactamente un** valor; con tres, se cae BuildKit entero. Recuperar
exige `systemctl reset-failed docker.service` antes del `restart` (el unit queda en *failed* y
`restart` no basta). Resultado medido: caché **19,57 → 13,15 GB** en el propio arranque de dockerd
(y estable ahí tras 3 min), techo efectivo 12 GiB en `GC Policy rule#0`, disco **65 → 59 GB
usados**. La GC ya muerde; lo que queda por encima del techo (~0,25 GiB) es lo que BuildKit no
puede desalojar. **M5 es lo único del plan que puede dejar el taller sin Docker: no se repite sin
la copia y sin `reset-failed` a mano.**

### 8.5 Lo que se descartó, medido

- **`incremental = false`**: ahorra disco pero encarece cada recompilación de edición, que es justo
  el ciclo que se quiere proteger. Se ataca la acumulación (M1), no la función.
- **`_obsoleto/` (M4)**: descartada por decisión de la usuaria (2026-10-17). Son 138 MB y no hay
  rollback: no es un repo git.
- **journald, apt, snap**: ya limpios o ruido — 21 MB, 60 KB y 348 KB.
- **Bloques reservados de ext4**: `Reserved block count` ya es **0**.
- **`fstrim.timer`**: ya activo, y en disco virtual no devuelve espacio al invitado.
- **swapfile (4 GB)**: es la RAM de emergencia; no se toca.
- **`sccache`**: mantiene su propia caché aparte; mueve el problema, no lo resuelve.
- **`split-debuginfo = "unpacked"`** ya está descartado como *opción*: no encoge nada y acumula
  `*.rcgu.o` (rust-lang/rust#161824). Es lo que M2 quita.
- **Deduplicación por hardlinks/`duperemove`**: descartada por riesgo (reflink no está en ext4 y la
  operación es intrusiva) y porque M1–M5 ya dan la ganancia sin tocar datos.
- **pnpm** para `node_modules`: compra un 2,7 % del disco (2,1 GB en total) y vale por velocidad de
  instalación, no por espacio. Tarea aparte, no aquí.

### 8.6 Fases de `16AA-19`

**D0 — Base.** Registrar `16AA-19` en `roadmap.md` (hecho); `Arranque gate "workspace-manager"
--inicio`. Sin cambios de código.

**D1 — Podar incremental y targets muertos.** M1 + M3, con el checklist de §11.
*DoD:* `du -sh /var/tmp/glory-target` baja ≥ 9 GB; `Arranque up "KAMPLES"` posterior compila y
arranca; se guarda el **recuento de directorios `incremental` por crate** antes y después, para
tener la línea base del contador de §8.3.

**D2 — Techo real de BuildKit.** Copia de `/etc/docker/daemon.json`; `"builder": {"gc":
{"policy": [{"maxUsedSpace": "12GB"}]}}`; reinicio de dockerd; `docker system df` antes y después.
*DoD:* la caché baja al techo y **se queda** ahí tras la siguiente pasada de `cm-sweep`.

**D3 — Perfil de KAMPLES (con coste).** `[profile.dev]` de KAMPLES con `debug =
"line-tables-only"` y `split-debuginfo = "packed"`; `cargo clean` del target de KAMPLES; rebuild
completo una vez y cronometrado; `Arranque gate "KAMPLES" --inicio`/`--cierre`; commit en KAMPLES.
*DoD:* sin `.dwo` nuevos en `deps`; el binario arranca; gate sin hallazgos nuevos.

**D4 — `cm-sweep` honesto.** Separar el techo del filtro de BuildKit y comprobar el resultado real
(contar bytes antes/después), no el código de salida; añadir el contador de directorios
`incremental` por crate al log.
*DoD:* el log solo afirma lo que ha pasado; una ejecución sobre una caché ya podada lo dice sin
mentir.

**D5 — Cierre.** `Arranque gate "workspace-manager" --cierre`; `Arranque cierre "workspace-manager"
--tarea 16AA-19`; entrada en `Agente/completados/tareas-2026-10-17.md`; actualizar
`taller-remoto-vps89-2026-10-14.md` y el roadmap.

### 8.7 Riesgos de `16AA-19`

- **M1 borra caché que cargo podría reusar.** Se mitiga conservando los 2 más recientes por crate:
  lo que se borra es de conjuntos de parámetros que ya no se piden. Peor caso: un rebuild
  incremental lento, una vez.
- **M2 cambia cómo se compila KAMPLES.** Compila igual o más rápido, pero `debug = 1` da más
  detalle en el depurador que `line-tables-only`. Si hace falta depurar KAMPLES a fondo, se sube
  temporalmente.
- **M5 reinicia dockerd.** Sin contenedores en marcha hoy; si la usuaria levanta Coolify antes, el
  reinicio espera.
- **La causa de los 52 directorios no está identificada.** M1 los limpia; D4 deja el contador para
  ver si vuelven, en vez de una limpieza silenciosa que oculte el problema.
- **`cm-sweep` corre cada hora** y puede volver a purgar targets vivos mientras se trabaja. No se
  toca su umbral en este plan (sería otra decisión); se anota como observación.

---

# Parte II — `16AA-18`: modo `build` por defecto

## 1. Objetivo de `16AA-18`

Que `Arranque up "<id>"` levante cada proyecto como lo hace producción —front construido a `dist/`
y servido por el propio backend Rust— en vez de `vite` en modo desarrollo. El modo `dev` sigue
existiendo y es opcional; **el defecto pasa a ser `build`**. **[2026-10-17] Las seis fichas remotas
migran, MN incluida.**

Por qué: en dev cada proyecto residente cuesta 190–690 MB de RAM, y casi todo es el `vite`
(150–650 MB) más su wrapper `npm` (~50 MB); el backend Rust son 10–40 MB. En producción ese `vite`
no existe. Medido el 2026-10-16 en la 89: con MN-Inmobiliaria y RESTAURANTE arriba quedaban
6150 MB disponibles, justo en el suelo de `cm-heavy` (6144 MB), así que no se podía compilar sin
parar devs. Con `build`, los 6 proyectos del taller caben arriba a la vez y el suelo sigue holgado.

## 2. Lo que ya está medido (no se supone)

| Dato | Valor | Cómo |
|---|---|---|
| Rebuild del front, MN | 11,5 s total | `time npm run build` |
| — del cual type-check | **9,3 s** | `time npx tsc -b --force` (frío) |
| — del cual bundling | 1,6 s | `time npx vite build` |
| `dist` resultante | 1,6 MB | `du -sh frontend/dist` |
| Coste RAM por proyecto, dev | 190–690 MB | `ps -eo rss` agrupado por proyecto |
| Coste RAM backend solo | 38 MB (MN) | el proceso `glory-backend` en marcha |
| Baseline del sistema (docker, postgres, opencode, VNC, mutagen) | ~1,5 GB | `free -m` sin devs |
| `dist` en el `ignorar` de Mutagen | **sí** | `taller.json:13` |

## 3. Diseño

### 3.1 El modo vive en la ficha

Campo nuevo `modo` en cada entrada de `scripts/dev/registro.json`:

- `"build"` → el backend sirve `frontend/dist`. **Se cae el `vite`**, no los auxiliares.
- `"dev"` (o ausente, hasta F8) → lo de hoy: `vite` + backend, HMR.

**[corregido] El defecto inicial es `dev`, no `build`.** El plan anterior decía «ausente =
`build`», y eso **rompía las seis fichas del taller**: `validarHostRemoto` exige
`botonRemoto.length === puertosRemotos.length`, y en build hay un puerto menos, así que `up`
habría respondido «rehusado» a los seis. La inversión del defecto es **lo último** (F8).

**[corregido] «Build» no significa «un solo puerto»: significa «sin `vite`».** MN lo demuestra: su
sesión tmux también aloja el conector de Cloudflare (puerto 20241) que sirve **dos** hostnames
públicos, el suyo y `rest-dev.wandori.us`. Un build que borrase ese botón tumbaría RESTAURANTE. Por
eso el bloque `build` declara **sus propios puertos y botones**, tantos como haga falta.

**[corregido] Una sola lista de botones no puede expresar los dos modos.** Como
`botonRemoto`/`puertosRemotos` están alineados por índice y validados por longitud, se añade un
bloque `build` **junto** a ellos, sin tocar los existentes:

```json
{
  "puertosRemotos": [3001, 5183],
  "botonRemoto":    [["env","PORT=3001","cargo","run","--bin","glory-backend"], ["npm","run","dev"]],
  "healths":        [{"puerto":3001,"ruta":"/api/health","esperaJson":true}, {"puerto":5183,"ruta":"/"}],

  "modo": "build",
  "build": {
    "puertos": [3001],
    "boton":   [["env","PORT=3001","STATIC_DIR=frontend/dist","cargo","run","--bin","glory-backend"]],
    "healths": [{"puerto":3001,"ruta":"/","esperaJson":false,"marcador":"<div id=\"root\">"}],
    "construirFront": [["env","VITE_API_URL=","npm","--prefix","frontend","run","build"]]
  }
}
```

`validarHostRemoto` valida el bloque que corresponda al modo efectivo: en `build`,
`build.boton.length === build.puertos.length`; en `dev`, la regla de hoy intacta. Una ficha sin
bloque `build` no puede pasar a `modo: "build"` — el doctor lo dice en claro.

Y en `Arranque up "<id>"` dos banderas que lo sobrescriben **para esa sesión** sin tocar la ficha:
`--dev` y `--build`.

### 3.2 Dos pasos de construcción, con frenos distintos

Hoy `precompilar` es una lista de argv que corre **bajo `cm-heavy`** (suelo de 6144 MB,
`MemoryMax=4G`). El build del front no necesita nada de eso: son ~200 MB y 11,5 s. Meterlo en el
mismo saco tendría un efecto perverso: sin 6 GB libres no se podría ni reconstruir el front, aunque
el binario Rust ya estuviera compilado.

Por eso se separan, con dos campos y dos nombres explícitos:

```json
"precompilar":    [["cargo", "build", "--bin", "glory-backend"]],      // bajo cm-heavy
"construirFront": [["npm", "--prefix", "frontend", "run", "build"]]    // sin cm-heavy
```

`construirFront` vive dentro de `build` y solo se usa en modo `build`. Se ejecuta **después** de
`precompilar` y **antes** de arrancar. Si falla, `up` aborta: nunca se arranca con un `dist` viejo.
Es **obligatorio** en el bloque `build`: el doctor lo exige. Aunque la ficha ya declare
`comandos.build` (KAMPLES lo hace), no se hereda — `comandos.*` es un texto de shell y partirlo para
sacarle el argv es frágil (comillas, `&&`, `env VAR=`); el argv se declara explícito.

### 3.3 Dónde está el front y con qué URL, por proyecto

El nombre de la variable que dice al backend dónde servir cambia según el proyecto, y la URL de la
API se **hornea en el build** (en dev la resolvía el proxy de vite, que en build no existe). Las
rutas son **relativas** (`frontend/dist`): el comando corre con `cwd` = la réplica.

| Proyecto | Variable | URL horneada | Puertos en build | Cambios extra |
|---|---|---|---|---|
| KAMPLES | `STATIC_DIR` | **`/`** | 3001 | — |
| NAKOMI | `STATIC_DIR` | relativo (`''`) | 3103 | no heredar `env.VITE_API_URL` |
| PROYECTO TASKS | `FRONTEND_DIST` | **`/`** | 4190 | no heredar `VITE_API_PROXY_TARGET`; **`base: '/'` en el vite** (con `'./'` las rutas de cliente anidadas resolvían los assets contra su directorio y la página salía en blanco) |
| WANDORIUS | `FRONTEND_DIST` | relativo (`''`) | 3104 | **router**: no sirve estático (F4) |
| RESTAURANTE | `STATIC_DIR` | relativo (`''`) | 3105 | ingress `rest-dev` 5182 → 3105 |
| MN-Inmobiliaria | `STATIC_DIR` | relativo (`''`) | 3110 + **20241** (conector) | **front**: fallback a `localhost` (F5); ingress `mn-dev` 5199 → 3110 |

KAMPLES y PROYECTO TASKS necesitan `/` explícito porque su código cae a `localhost` cuando la
variable está vacía (`KAMPLES/src/api/axios-instance.ts:5` y el equivalente en TASKS).

**[corregido] Las seis no deben heredar `entrada.env` en el build del front.** NAKOMI
(`VITE_API_URL: "http://localhost:3103"`), WANDORIUS (`http://localhost:3104`) y PROYECTO TASKS
(`VITE_API_PROXY_TARGET`) llevan en `env` la URL del proxy de dev. `vite build` **hornea** esa
variable en el bundle, y `localhost` no existe desde el navegador del portátil: el front quedaría
apuntando a ninguna parte. Regla: **el build del front recibe solo los `env K=V` escritos en su
propio argv de `construirFront`**, nunca `entrada.env` ni las claves `VITE_DEV_*`/`VITE_DEMO_*` de
`envRemoto`.

**[corregido] MN: el plan anterior decía «URL horneada `/rust`» y era falso.** `/rust` **no existe
en el backend**: es un prefijo que solo vive en el proxy de vite
(`frontend/vite.config.ts:40-43`), que lo reescribe a `/`. El backend anida su API en `/api`
(`src/handlers/mod.rs:288`), y el front, cuando `VITE_API_URL` falta o está vacío, cae a
`http://127.0.0.1:3110` (`frontend/src/data/inmuebles/api.ts:13`,
`frontend/src/data/chat/cliente-chat.ts:37`) — una URL que no existe desde el navegador del
portátil. Detalle importante: **el SPA ya se sirve hoy en `/`**; lo que vive bajo `/rust` es solo la
API. Así que migrar MN exige dos cosas: (a) cambiar el fallback del front a relativo, y (b)
re-apuntar el ingress de `mn-dev.wandori.us` de `:5199` (vite) a `:3110` (backend).

### 3.4 Lo que no cambia

`node_modules` sigue haciendo falta en la 89 (el build del front lo usa), así que **el disco no
mejora por esto**: la ganancia es toda de RAM. `npm ci`, la BD, el túnel SSH, `doctor`, `gate` y
`cierre` siguen igual. El front se sigue construyendo en la 89, nunca en el portátil (AGENTS §1).

## 4. Huecos que este plan cierra explícitamente

1. **Credenciales de dev horneadas en el bundle.** MN tiene `VITE_DEV_EMAIL`/`VITE_DEV_PASSWORD` y
   NAKOMI y WANDORIUS `VITE_DEMO_EMAIL`/`VITE_DEMO_PASSWORD`. `vite build` **lee los mismos `.env`**
   y los incrusta: en modo build esas claves **no se inyectan**.
   **[corregido] No basta con no llamar a `contenidoEnvFrontend`.** Mutagen ignora `.env*`, así que
   un `frontend/.env.local` escrito por un `up` anterior **persiste en la 89** y `vite build` lo
   leería igual. En modo build, `up` **borra** `frontend/.env.local` (`rm -f`) antes de construir.
2. **`dist` obsoleto o ausente.** Si `construirFront` falla, `up` aborta en claro. Si `dist` no
   existe al arrancar, `up` falla con un mensaje que nombra `construirFront`.
   **[corregido] Y falta el caso «ya estaba arriba»:** `upRemoto:732` devuelve `ya-arriba` **antes**
   de `prepararRemoto`, así que un proyecto en marcha nunca reconstruía el front. En modo build, la
   rama `ya-arriba` ejecuta igualmente `construirFront` antes de responder.
3. **La sonda no debe confundirse.** En build, `/` lo sirve el backend: el health debe comprobar que
   devuelve el `index.html` de la SPA, no un 200 del fallback de la API.
   **[corregido] `sondear` hoy solo mira `statusCode === 200`** (`doctor.mjs:786-809`), así que la
   comprobación no existe: hay que implementarla. Se añade `healths[].marcador` (cadena que debe
   aparecer en el cuerpo) a `sondear`, a la validación de `healths` y a la lista `conocidas`.
4. **WANDORIUS no sirve estático.** Su `src/config/mod.rs:22,46` ya declara `frontend_dist`
   (`FRONTEND_DIST`, por defecto `frontend/dist`) pero el router (`src/handlers/mod.rs:284-295`) solo
   monta `/api` y `/swagger-ui`: la variable está declarada y sin usar. Hay que engancharla con el
   mismo `ServeDir` + fallback que los otros cinco. Va con su `gate --inicio`/`--cierre` y su commit
   en el repo de WANDORIUS.
5. **MN no sirve bien la API en build.** Su front cae a `http://127.0.0.1:3110` cuando
   `VITE_API_URL` está vacío (§3.3). El fallback pasa a relativo (`''`), que en dev no se usa (ahí
   `contenidoEnvFrontend` escribe `/rust`) y en build resuelve contra el mismo origen. Va con su
   gate y su commit en el repo de MN-Inmobiliaria.
6. **El túnel cambia de forma** donde lo haya. Pasa de 2 reenvíos a 1. `tunelEsNuestro` ya exige los
   marcadores exactos, así que un túnel viejo se detecta como ajeno y se recrea solo — cubierto por
   un test existente (`remoto.test.mjs:163`).
7. **`contenidoEnvFrontend` deja de tener un uso claro.** En modo dev escribe el `.env` del front;
   en build, escribir ese `.env` es justo lo que hornearía las credenciales. Se conserva para dev y
   **no se llama en build** (y se borra el residuo, punto 1).
8. **`Arranque logs` / `open` / `status`** con menos puertos: menos ruido, mismo contrato.
9. **`doctor.mjs:200`** — la lista `conocidas` debe admitir `modo`, `build` y `marcador`, o el
   doctor marcaría deriva en toda ficha migrada.
10. **El conector de Cloudflare es compartido.** El de MN sirve `mn-dev.wandori.us` **y**
    `rest-dev.wandori.us`; si MN se para, RESTAURANTE se cae (ya documentado en
    `taller-remoto-vps89-2026-10-14.md`). Con las dos en build sigue igual, pero ahora ambos
    ingress apuntan a backends. Se mantiene el reparto actual y se anota como riesgo (§6); dar a
    RESTAURANTE su propio conector es una tarea aparte.

## 5. Fases de `16AA-18`

**F0 — Base.** ✅ 2026-10-17 Registrar `16AA-18` en `roadmap.md`; `Arranque gate "workspace-manager" --inicio`.

**F1 — Contrato del modo, sin cambiar comportamiento.** ✅ 2026-10-17 `modo` (defecto `dev`) y bloque `build` en
la ficha; validación del bloque del modo efectivo en `validarHostRemoto`; `marcador` en `healths`;
las tres claves nuevas en `conocidas`; tests en `scripts/dev/remoto.test.mjs`.
*DoD:* `node --test "scripts/**/*.test.mjs"` en verde; **ninguna ficha existente cambia de
comportamiento**.

**F2 — `remoto.mjs`.** ✅ 2026-10-17 `up` en build: borra `frontend/.env.local`, ejecuta `construirFront` tras
`precompilar` y antes de arrancar; aborta si falla o si falta `dist`; no inyecta `entrada.env` ni
`VITE_DEV_*`/`VITE_DEMO_*`; la rama `ya-arriba` también reconstruye.
*DoD:* tests de los cinco casos (build ok, build falla, falta `dist`, `ya-arriba` reconstruye, dev
no cambia) en verde.

**F3 — `Arranque`.** ✅ 2026-10-17 `up --dev` / `up --build` como override de sesión; `status`/`logs`/`open`
coherentes con menos puertos.
*DoD:* la ayuda de `dev.mjs` documenta las banderas; `--dev` sobre una ficha en build levanta los
dos puertos de hoy.

**F4 — WANDORIUS sirve estático.** ✅ 2026-10-17 Enganchar `frontend_dist` al router; tests del proyecto; gate
`--inicio`/`--cierre`; commit en WANDORIUS.
*DoD:* `GET /` devuelve el `index.html` de la SPA y una ruta anidada también; gate sin hallazgos
nuevos.

**F5 — MN sirve su API en build.** ✅ 2026-10-17 Fallback del front a relativo; gate `--inicio`/`--cierre`;
commit en MN-Inmobiliaria.
*DoD:* con `VITE_API_URL` vacío el front llama a `/api/...` del mismo origen; gate sin hallazgos
nuevos.

**F6 — Alta de las seis en modo build.** ✅ 2026-10-17 Fichas (bloque `build` + `modo`), `Arranque up` de cada
una, verificación real de `/` **y de una ruta anidada** (200 y el marcador), y medida de RAM con
las seis arriba.
*DoD:* las seis arrancan y sirven su SPA; `cm-heavy true` sale 0 con las seis arriba; consumen
menos que el baseline de hoy con dos.

**F7 — Camino público.** ✅ 2026-10-17 `mn-dev.wandori.us` → `:3110` y `rest-dev.wandori.us` → `:3105` con
`publicar-host.mjs … --aplicar` (dry-run primero); `PUBLIC_BASE_URL` de MN sin `/rust`.
*DoD:* las dos URLs cargan la SPA tras el login de Access y su API responde por el mismo origen.

**F8 — Invertir el defecto.** ✅ 2026-10-17 `modo` ausente pasa a `build`; test que fija la semántica.
*DoD:* `up` de una ficha sin `modo` levanta en build.

**F9 — Reglas, docs y cierre.** ✅ 2026-10-17 AGENTS §2 y §12; `taller-remoto-vps89-2026-10-14.md`;
`historial-agents-md.md`; `AGENTS.md` sincronizado a la 89; `Arranque gate --cierre`; `Arranque
cierre --tarea 16AA-18`; entrada en `Agente/completados/tareas-2026-10-17.md`.
*DoD:* un agente que lea solo AGENTS sabe que el defecto es build, cómo pedir dev y por qué.

**F10 — Coherencia de las skills con el taller real (pedido por la usuaria el 2026-10-17).** ✅ 2026-10-17
Repaso de **todas** las skills del índice de AGENTS §11 (`supervisor`, `supervisor-thinking`,
`supervisor-review`, `code-analysis`, `taller-remoto`, `coolify-deployment`, `coolify-manager`,
`workspace-manager`, `build-artefactos`, `sentinel`, `sentinel-inspection`, `sentinel-repair`,
`varsense`, `quality-gate-setup`, `lab-opencode`, `pc-control`, `glory-pulse-ops`,
`google-auth-glory`, `pdf-academico`, `conducta-global`, `publicar-inmuebles`, `whatsapp-gateway`),
no solo las que toca este plan: comprobar que lo que afirman sigue siendo cierto desde que se
implantó el taller de la 89, porque una skill vieja es una trampa (se lee antes que el doc).
Qué se contrasta, skill por skill: comandos que ya no existen o cambiaron de forma; el modo `build`
por defecto y `--dev`; `cm-heavy`, `cm-sweep` y sus techos; el reparto laptop/89; las BD; el dev
público por Cloudflare; y el gate. Método: por cada skill, listar sus afirmaciones operativas
(comandos, rutas, puertos, umbrales) y **ejecutar o leer la fuente** que las respalda; nada se da
por bueno «porque suena bien». Se corrigen las que estén mal, se anota lo dudoso y se sincronizan
las copias laptop ↔ 89 (AGENTS §11).
*DoD:* tabla de las 22 skills con veredicto (correcta / corregida / obsoleta y por qué); las
correcciones aplicadas en las dos copias; y ninguna skill afirmando algo que el taller ya no hace.

#### F10 — Veredicto de las 22 skills (2026-10-17)

Cómo se comprobó: por cada skill se listaron sus afirmaciones operativas (comandos, rutas, puertos,
umbrales) y se contrastaron con la fuente real —`dev.mjs`, `remoto.mjs`, `registro.json`,
`taller.json`, el wrapper del binario y los docs del taller—. Después se barrió el índice entero con
`grep` por las clases de afirmación que este plan invalida (modo `dev`/`build` por defecto, ruta del
binario de `coolify-manager`, sesiones de Mutagen, puertos de MN, toolchain de Rust del laptop): los
resultados vacíos son el testigo de que no queda ninguna otra. Las ocho corregidas se aplicaron en
las dos copias y se verificaron por `md5sum` (22/22 idénticas).

| Skill | Veredicto | Por qué |
|---|---|---|
| `supervisor` | correcta | Sin afirmaciones del taller; lo operativo es conducta del agente. |
| `supervisor-thinking` | correcta | Igual: método, no taller. |
| `supervisor-review` | correcta | Igual. |
| `code-analysis` | correcta | Sin referencias operativas al taller. |
| `taller-remoto` | **corregida** | Tres cosas: las sesiones de Mutagen eran dos (hoy una por proyecto, seis, más `taller-opencode-4096`); **no mencionaba el modo `build` por defecto ni `--dev`**, siendo la skill del taller; y el `exit 75` solo citaba el disco (hoy también el suelo de RAM, `MIN_MB=4608`). Se añadió `--repuntar` al pasar una ficha a `build`. |
| `coolify-deployment` | **corregida** | Afirmaba un binario en `C:\tmp\glory-target\coolify-manager\release\` (inexistente) y una «excepción a Rust en la 89» con `cargo build --release` en el laptop: el laptop no tiene toolchain desde el 2026-10-16. Ahora: binario `C:\Users\usuario\bin\coolify-manager.exe`, reconstrucción por `workspace-manager\scripts\actualizar-coolify-manager.ps1` (compila en la 89 con `cargo-xwin`). |
| `coolify-manager` | **corregida** | Cinco puntos con la ruta vieja: el diagrama, el «path absoluto universal», la sección de workspace y compilación, el atajo `cm` y las referencias. Mismo error de fondo que `coolify-deployment`: la herramienta **se ejecuta** en el laptop pero **compila** en la 89. |
| `workspace-manager` | **corregida** | Describía `Arranque up` sin decir que el modo por defecto es `build` ni que existe `--dev`: es la skill del mando, así que la omisión es la trampa. Se añadió, con `Arranque status`/`comandos` para leer el modo efectivo. |
| `build-artefactos` | correcta | Sin referencias operativas al taller. |
| `sentinel` | correcta | El gate y sus comandos siguen siendo los mismos; no afirma nada del modo. |
| `sentinel-inspection` | correcta | Igual. |
| `sentinel-repair` | correcta | Igual. |
| `varsense` | correcta | Igual. |
| `quality-gate-setup` | correcta | Documenta el tooling de calidad **del proyecto** (`npm run quality:*`), no el taller: no contradice nada. No dice dónde corre `cargo`; eso lo manda AGENTS §2. |
| `lab-opencode` | correcta | Habla de la lab y de `opencode-propio`, que no cambian. |
| `pc-control` | correcta | Sin referencias operativas al taller. |
| `glory-pulse-ops` | **corregida** | Mandaba usar `C:\tmp\glory-target\coolify-manager\debug\coolify-manager.exe` «porque el de `C:\Users\usuario\bin\` no tiene el molde rust-image»: ese directorio ya no existe y el molde (`config/templates/rust-image-stack.yaml`) se resuelve desde la ruta de `-c`, no vive en el binario. Se pasó al canónico, comprobado con `health -n pulse` (http_ok/app_ok). Queda anotado comprobar que el molde se comporta igual que con el build viejo. |
| `google-auth-glory` | correcta | Sin relación con el taller. |
| `pdf-academico` | correcta | Sin relación con el taller. |
| `conducta-global` | **corregida** | Terminaba en un encabezado colgando —«COPIAR Y PEGAR REGLAS Y USO DE SKILLS EN LOS AGENTS.MD GENERADOS»— sin cuerpo: choca con que hay un único `AGENTS.md` del área y está prohibido crear uno por proyecto. Se sustituyó por la regla vigente. |
| `publicar-inmuebles` | **corregida** | El panel de mejora llega a `/api/mejora` por el proxy de Vite: eso es modo `dev`. En `build` —el defecto— el front lo sirve el backend Rust en `:3110`, que no tiene esa ruta, así que el túnel inverso al 3122 tampoco sirve. Se documentó la limitación y la salida (`up --dev`, o darle al Rust un proxy al 3122: pendiente en el roadmap de MN). |
| `whatsapp-gateway` | **corregida** | La lista de puertos daba `:5199` como «front dev» sin más; ahora dice que solo existe con `--dev` y que `:3110` sirve también el front compilado. |

**Fuera de estas 22:** la afirmación de `publicar-inmuebles` sobre el panel de mejora destapó un
hueco de producto, no de skill: en modo `build` el panel no tiene backend. Va al roadmap de
MN-Inmobiliaria (proxy `/api/mejora` → `127.0.0.1:3122` en el Rust, o levantar MN con `--dev` para
usarlo), no a este plan.

## 6. Riesgos de `16AA-18`

- **HMR fuera del camino por defecto.** Es el precio aceptado; por eso `--dev` existe. Si acaba
  siendo incómodo para el trabajo de UI, se revisa con datos.
- **El `up` se alarga** ~11,5 s (el build del front) más lo que tarde cargo. Con targets calientes
  es tolerable; en frío ya tardaba minutos. Y el `ya-arriba` reconstruye siempre.
- **Un proyecto puede no servir bien su SPA** (rutas profundas → 404). Se comprueba en F6 con una
  ruta anidada, no solo con `/`.
- **El conector compartido** (§4.10): parar MN tumba `rest-dev`. Pre-existente; se anota.
- **F7 toca infraestructura pública** (ingress de dos hostnames). Va con dry-run previo y
  verificación real; autorizado por la usuaria el 2026-10-17.
- **Ficha con dos formas** es más superficie de validación. Se compensa con tests.

## 7. Fuera de alcance

- **`tsc-rs` (github.com/pingdotgg/ts-rust)**, el port a Rust del compilador de TypeScript. Se
  revisó a petición de la usuaria: **no acelera `vite build` (1,6 s) ni `cargo build`**, solo el
  type-check, que es justo los 9,3 s que dominan el rebuild. Sería un sustituto de `tsc` con
  supuesta ganancia de 2–3× sobre tsc 7 (y mucho más sobre el tsc 6 JS que usan estos proyectos: MN
  tiene typescript 6.0.3). Pero es **experimental**, está fijado a un TS 7.1-dev, el propio autor
  avisa de problemas en monorepos (`rootDir`/TS6059) —que es lo que son estos proyectos— y no se
  mete un compilador así en el gate. Se propone **evaluarlo aparte, en un solo proyecto y sin tocar
  el gate**, como tarea propia si la usuaria quiere.
- **Conector propio para RESTAURANTE** (§4.10): tarea aparte.
- Desplegar los proyectos sin `Dockerfile` (NAKOMI, WANDORIUS): no es de este plan.
- Bajar el suelo de `cm-heavy` o ampliar la VPS: con build deja de hacer falta.

---

## 9. Rollback

- **F1–F3, F8:** revertir el commit en `workspace-manager`. Sin `modo` en las fichas, todo vuelve al
  comportamiento de hoy.
- **F4:** revertir el commit en WANDORIUS; el router vuelve a montar solo `/api` y `/swagger-ui`.
- **F5:** revertir el commit en MN-Inmobiliaria; el fallback vuelve a `http://127.0.0.1:3110`.
- **F6:** quitar el bloque `build` de las fichas (un commit).
- **F7:** `publicar-host.mjs mn-dev.wandori.us --puerto 5199 --aplicar` y `rest-dev.wandori.us
  --puerto 5182 --aplicar` devuelven los ingress a vite (requiere que el modo dev vuelva a estar
  activo).
- **D1:** los targets se regeneran con el próximo `up`. No hay copia y no hace falta: son
  artefactos de build, el código está en git.
- **D2:** copia de `/etc/docker/daemon.json` en `/var/tmp/cm-sweep-respaldo/`; restaurar y reiniciar
  dockerd.
- **D3:** revertir el commit en KAMPLES y recompilar.
- **D4:** `cm-sweep.sh` vive versionado en `workspace-manager/scripts/remoto/`; revertir el commit y
  `ssh root@192.0.2.10 'install -m 755 … /usr/local/sbin/cm-sweep'`.

## 10. Reservado a la usuaria — resuelto el 2026-10-17

1. **D1 (podar ~8 GB de `incremental`): autorizado.** Se ejecuta con el checklist de §11.
2. **M4 (`_obsoleto/`): descartado.** Se conserva.
3. **MN a build y su camino público `/rust` → `/`: autorizado.** Va en F5 y F7.

---

## 11. Checklist de ejecución

### D1 — podar incremental y targets muertos ✅ 2026-10-17

**Antes**
- [x] Línea base: 74 GB usados / **23 GB libres**; `/var/tmp/glory-target` 24 GB.
- [x] Contador por crate anotado; sin compilación en marcha.

**Durante**
- [x] Borrados, por cada crate de cada `debug/incremental`, todos menos los 2 de mtime más reciente.
- [x] Borrado `/var/tmp/glory-target/MN-Inmobiliaria_16aa-9-f3-tools` (rama muerta, verificada
      ausente del repo antes de tocarla).
- [x] No se tocó `/var/tmp/glory-target/PROYECTO` ni ningún `debug/deps`.

**Después**
- [x] **9,36 GB liberados** (7,86 de incremental + 1,5 del target muerto). `/var/tmp/glory-target`
      24 → **15 GB**; disco 74/23 → **65 GB usados / 31 GB libres**.
- [x] Directorios por crate: KAMPLES 52 → **6**, MN 22 → **10**.
- [x] Verificado con compilación y arranque reales: `Arranque up "KAMPLES" --sin-bd` en 32 s con
      probe verde (3001, 5183); `Arranque up "MN-Inmobiliaria" --sin-bd` en 36 s con probe verde
      (3110, 5199, 20241).
- **Corrección a §8.3:** los directorios `incremental` **no** los crea cada compilación —una
  compilación de verificación no añadió ninguno—, sino cada **cambio del hash de parámetros**
  (p. ej. `RUSTC_WRAPPER` presente o ausente según la antigüedad de la sesión tmux). Por eso D4
  acota el contador en vez de confiar en que se estabilice.

### D2 — techo de BuildKit ✅ 2026-10-17
- [x] Copia de `/etc/docker/daemon.json` en `/var/tmp/cm-sweep-respaldo/daemon.json.2026-10-17`.
- [x] `docker system df` antes: **19,57 GB** de caché, techo efectivo 71,71 GiB.
- [x] Política aplicada (una sola regla, **sin** `filter`): `reservedSpace 9.313GiB`,
      `maxUsedSpace 12GB`, `minFreeSpace 18.63GiB`.
- [x] Reiniciar dockerd → `active`, server 29.9.0, `GC Policy rule#0` con `Max Used Space: 12GiB`.
- [x] Después: caché **13,15 GB**, estable tras 3 min; disco 65 → **59 GB usados / 37 G libres**.
- [ ] A las 24 h: `docker system df` — la caché debe seguir ≤ ~13 GB, no volver a 20+.
- **Tropiezo:** el primer intento con 3 valores en `filter` tumbó dockerd (`filters expect only one
  value`); `--validate` no lo detecta; recuperar exige `systemctl reset-failed docker.service`.

### D3 — perfil de KAMPLES ❌ DESCARTADA, medida el 2026-10-17

No se ejecuta: **la premisa de M2 era falsa y el coste no se paga.** Medido con `rustc 1.99.0`
sobre una fuente generada de 801 líneas, sumando **todos** los bytes de salida (incluidos los
`.dwo`), que es lo que M2 decía ahorrar:

| `debug` | `split-debuginfo` | bytes | `.dwo` |
|---|---|---|---|
| `1` | `unpacked` (hoy en KAMPLES) | 1.089.718 | 1 |
| `1` | `packed` | 1.046.830 | 0 |
| `line-tables-only` | `packed` | 1.030.318 | 0 |
| `line-tables-only` | `unpacked` | 1.056.694 | 1 |

El cambio completo ahorra **5,45 %**, no 0,8 GB. Sobre los 6,1 GB de `deps` de KAMPLES son ~0,3 GB,
y `packed` en su mayor parte **reubica** el DWARF en vez de eliminarlo (por eso el `.dwo` de 0,98 GB
no se recupera entero). Los dos argumentos que sostenían la fase caen además uno a uno:

- **`debug = 1` no difiere de `line-tables-only` en bytes** (1.046.830 vs 1.030.318, 1,6 %): rustc
  mapea ambos al mismo nivel de LLVM. Alinear KAMPLES con los otros cinco no gana nada por sí solo.
- **El defecto que lo justificaba no ocurre aquí:** `find` da **0 ficheros `*.rcgu.o`** en el target
  de KAMPLES, así que rust-lang/rust#161824 no está mordiendo con rustc 1.99.

Y el coste sigue siendo el declarado: cambiar `[profile.dev]` cambia el *fingerprint* del grafo
entero, con `cargo clean` y rebuild completo. ~0,3 GB a cambio de invalidar 6 GB de `deps` no es un
buen negocio cuando D1+D2 ya han liberado 15,8 GB. Se deja el perfil de KAMPLES como está; el plan
de 05AA-1 (`[profile.dev]` adelgazado) sigue siendo el sitio donde decidirlo si alguna vez el
`.dwo` importa.

### D4 — `cm-sweep` honesto ✅ 2026-10-17

- [x] **Techo y filtro, separados.** `podar_docker` ya no pasa `--filter until=168h`: el techo es un
      presupuesto y BuildKit elige por LRU. El filtro de antigüedad solo elegía *candidatos* y, si
      dejaba pocos, el bucle salía antes del techo y devolvía 0 igual. La antigüedad la gobierna la
      política de GC de dockerd. Se eliminó la variable `BUILDX_H`, que ya no significa nada.
- [x] **Bytes reales, no el código de salida.** Se mide la caché con `docker system df --format
      '{{json .}}'` antes y después y se registran los dos números. Prueba de que el log anterior
      mentía: entre el 2026-10-17 00:00 y las 08:00 escribió «caché de build <= 12 GB … podada»
      **nueve veces** con la caché entre 19 y 24 GB.
- [x] **Contador de `incremental` por crate, y algo mejor que un contador:** `limpiar_incremental`
      acota los **dos niveles** —`<crate>-<hash>` (uno por configuración de compilación) y las
      carpetas de sesión dentro de cada uno— conservando los 2 más recientes de cada nivel. Bajo el
      lock de `cm-heavy`, así que nunca pisa un build en marcha. Primer pase: 26 sesiones podadas,
      **0,87 GB** (KAMPLES 1,37 → 0,74 GB; MN 0,56 → 0,32 GB).
- [x] **Aviso útil:** solo se avisa si la caché se pasa del techo más de un 15 %. BuildKit deja un
      residuo que no puede desalojar (medido: 13,15 GB frente a un techo de 12 GB), y un aviso que
      salta cada hora no avisa de nada.
- [x] Desplegado con `cm-sweep --instalar` y **ejecutado de verdad** en la 89; `cm-sweep.timer`
      activo cada hora.
- **Nota de unidades:** el log de docker usa ahora `gbsi()` (GB decimal, como `docker system df`)
  y no `gb()` (GiB). Antes la misma línea mezclaba las dos y «12,25 GB (techo 12 GB)» parecía un
  error sin serlo.

### D5 — cierre del disco
- [ ] `Arranque gate "workspace-manager" --cierre`; `Arranque cierre "workspace-manager" --tarea 16AA-19`.
- [ ] Entrada en `Agente/completados/tareas-2026-10-17.md`; roadmap y doc del taller al día.

### F1–F9 — modo build
- [x] **F1** contrato del modo (`modo`, `build`, `marcador`, `conocidas`) + tests.
- [x] **F2** `remoto.mjs` (borra `.env.local`, `construirFront`, `ya-arriba`, sin heredar `env`) + tests.
- [x] **F3** banderas `--dev` / `--build` en `Arranque up`.
- [x] **F4** WANDORIUS sirve estático + gate + commit.
- [x] **F5** MN fallback relativo + gate + commit.
- [x] **F6** las seis fichas en build; `up` y verificación de `/` y ruta anidada; medida de RAM.
- [x] **F7** ingress `mn-dev` → 3110 y `rest-dev` → 3105 (dry-run, luego `--aplicar`); `PUBLIC_BASE_URL` sin `/rust`.
- [x] **F8** invertir el defecto a `build`.
- [x] **F9** docs, AGENTS, `Arranque cierre --tarea 16AA-18`.
- [x] **F10** repaso de las 22 skills del índice (AGENTS §11): 8 corregidas, 14 correctas; tabla de
  veredicto abajo y las dos copias (laptop y 89) idénticas por `md5sum`.

**Lo que apareció al ejecutar y no estaba en el plan** (commits `543e6bb`, `0cedf8f`, `8ace145`
en `workspace-manager` y `0fb5dc3` en PROYECTO TASKS):

- **`publicar-host.mjs` no sabía mover un host ya publicado** y el cambio de modo lo necesita (el
  mismo `mn-dev` pasa de 5199 a 3110). Se añadió `--repuntar`, explícito, porque sin bandera un
  host con otro destino debe seguir siendo un error.
- **El cambio de modo dejaba huérfanos**: la sesión tmux del modo que se deja seguía viva (se
  nombran por puerto) y el túnel ssh viejo tiene un reenvío de más, así que `tunelEsNuestro` lo
  rechazaba — y rechazarlo no lo mata, con lo que ocupaba el puerto local que el `up` nuevo
  necesitaba. Y `stop` solo barría si el modo efectivo usaba túnel: al publicar MN por Cloudflare
  (`tunelSsh: false`) sus dos ssh de dev quedaban invisibles ocupando 3110 y 5199.
- **PROYECTO TASKS necesitaba `base: '/'` en el vite**: con `'./'`, una ruta de cliente anidada
  resolvía los assets contra su directorio, el SPA fallback devolvía el HTML con 200 y la página
  salía en blanco sin error de red.
- **MN servía 404 en `/`**: al binario le faltaba `STATIC_DIR=frontend/dist` en el `boton` de build.
