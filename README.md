# workspace-manager

Tablero y mando para un **área de trabajo**: una carpeta que contiene varios
proyectos independientes (cada uno con su repositorio Git).

Escanea esa carpeta y reúne, en una sola interfaz web:

- **Mapa** de los proyectos del área, con su estado de Git.
- **Repos**: ramas, cambios sin commitear, sincronización.
- **Documentos**: `AGENTS.md`, `roadmap.md` y los planes de cada proyecto.
- **Tareas**: la cola de trabajo en curso.
- **Sentinel**: hallazgos de Sentinel y VarSense por proyecto, con línea base y
  comparación entre cierres.
- **Guardián**: política de comandos permitidos y plantillas por stack.
- **Consola**: problemas agregados de todo el área.
- **PC** y **VPS**: estado de la máquina local y de los servidores declarados.
- **Taller**: arranque, parada y logs de los proyectos en un servidor remoto.
- **Navegador**: los devs publicados, dentro del propio tablero.
- **Config**: editor de la config privada, con esquema.

Lo que no es el taller corre en tu máquina. Lo que sale de ella es lo que tú
declares: el taller de `config/taller.json` (por SSH, hacia un servidor tuyo), el
túnel de Cloudflare si publicas devs, y las consultas de los gestores al auditar
dependencias.

## Requisitos

- **Node.js 24 o superior** (`engines` en `package.json`). Con versiones
  anteriores algunos módulos (`import.meta.dirname`) no existen.
- Las dependencias npm (`npm ci`).

Nada más es obligatorio. Todo lo demás es opcional y, si falta, el manager
arranca igual y solo se degrada la función que lo necesita (ver
[Funciona con o sin taller](#funciona-con-o-sin-taller)).

## Puesta en marcha

```bash
git clone https://github.com/1ndoryu/workspace-manager.git
cd workspace-manager
npm ci

# Plantillas de la config privada: cópialas y ajústalas a tu máquina.
mkdir -p config
cp config/ejemplos/area.example.json                 config/area.json
cp config/ejemplos/registro.example.json             config/registro.json
cp config/ejemplos/taller.example.json               config/taller.json
cp config/ejemplos/guard-plantillas.example.json     config/guard-plantillas.json
cp config/ejemplos/quality-consumidores.example.json config/quality-consumidores.json

npm run server   # backend, por defecto en 127.0.0.1:8787
npm run dev      # front, por defecto en 127.0.0.1:5175
```

Requisitos: Node 24 o superior y Git (cada proyecto del área es un repositorio).
Sin `config/taller.json` el análisis corre en esta máquina y lo dice con un aviso: sirve para
un clon recién hecho, sin servidor. Con taller configurado, los proyectos analizan en el taller
salvo que el registro diga `analisisEn: "local"`; ver «Funciona con o sin taller».

Para producción: `npm run build` compila el front; `npm run build:server` compila el
backend a `dist-server/` y `npm run server:compilado` lo arranca. `npm run build:app`
hace las dos cosas en el taller y además compila el `.exe` de escritorio.

Abre `http://127.0.0.1:5175`. El front hace proxy de `/api` al backend e inyecta
el token de portador en el proxy, así que el navegador nunca lo ve.

El manager asume que vive **dentro** del área: la carpeta que lo contiene es el
área, y sus hermanas son los proyectos. Si prefieres otra disposición, define
`WS_AREA_ROOT`.

### Autenticación

El backend exige un token de portador en todas las rutas que lanzan procesos.
Se genera solo, la primera vez, en `~/.workspace-manager/token` (32 bytes
aleatorios, `0600`), fuera del repo y del área. Para usar otro:

- `WM_TOKEN`: el token en una variable de entorno.
- `WM_TOKEN_FILE`: la ruta de otro fichero con el token.

## Configuración

### Privada (no se versiona)

Vive en `config/` y está en `.gitignore`, porque lleva rutas de tu máquina y la
lista de tus proyectos. Las plantillas con la forma esperada están en
`config/ejemplos/`.

| Fichero | Qué declara |
|---|---|
| `config/registro.json` | Un registro por proyecto: `id`, `ruta`, puertos, botón, comandos, healthchecks, y si el análisis corre en remoto (`analisisEn`). |
| `config/taller.json` | El taller remoto: `host` SSH, `dirRemotoBase`, intérprete de Node (`nodeRemoto`), binario de Mutagen (`sync.binario`), bases de datos (`proyectos.<id>.basedatos`) y el bloque `devPublico` (zona, cuenta y túnel de Cloudflare) si publicas devs. |
| `config/guard-plantillas.json` | La plantilla del Guardián: qué listas de comandos añadir a cada proyecto según su stack. La pestaña Guardián la edita. |
| `config/area.json` | Los papeles del área: qué proyecto hace de motor de calidad, gestor de despliegues y limpiador, quién queda fuera del bump, y las URLs del servicio de métricas (`pulseUrl`, `pulseTallerUrl`). `despliegueBin` solo hace falta si el ejecutable que instala ese proyecto no se llama como su carpeta. |
| `config/quality-consumidores.json` | A qué proyectos se propagan los cambios de las herramientas de calidad. |
| `config/quality-excepciones.json` | Excepciones de calidad aceptadas a mano, por regla y ubicación. Lo escribe el flujo de auditoría; no hay plantilla. |

Si falta alguna, el proceso que la necesita falla temprano diciéndote de qué
plantilla copiarla. Cada papel de `area.json` que falte **desactiva solo su
función** y lo dice con el remedio; nada más se rompe.

### Versionada

| Fichero | Qué declara |
|---|---|
| `sentinel.config.json`, `varsense.config.json` | Reglas y alcance de las dos herramientas de calidad. |
| `quality-tools.json` | De dónde se provisionan Sentinel y VarSense y en qué commit. |
| `sentinel.lock.json` | Huella del runtime de calidad en uso. |

### Estado

La caché y el estado de la aplicación cuelgan de `<área>/data/`, fuera del repo, que
es lo que permite publicarlo tal cual. Dos módulos (el historial de recursos y la
ejecución de PC) escriben todavía en `data/` del repo, que está en `.gitignore`.

- `data/workspace.config.json`: proyectos ignorados, exentos de gate y el
  escaneo automático. Lo escribe la propia aplicación.
- `data/cache/workspace.json`: el último escaneo del área, para arrancar sin
  volver a recorrerla.
- `data/cache/analisis.json`: la caché de los análisis, por proyecto.

Las dos cachés son descartables: borrarlas solo cuesta volver a escanear y
analizar. Ninguna de las dos se sirve nunca si el dato dejó de ser fresco
(rama, commit o versión de la herramienta cambiados).

### Variables de entorno

| Variable | Para qué |
|---|---|
| `WS_AREA_ROOT` | Dónde está el área. Por defecto, la carpeta padre de este repo. |
| `WS_CONFIG_ROOT` | Dónde está la config privada. Por defecto, `config/` dentro del repo. |
| `WS_SKILLS_ROOT` | Carpeta de skills del agente. Por defecto, `~/.agents/skills`. |
| `WS_PORT` | Puerto del backend. Por defecto, `8787`. |
| `WS_WEB_PORT` | Puerto del front del tablero. Por defecto, `5175`. |
| `WS_PREVIEW_PORT` | Puerto de `vite preview`. Por defecto, `4173`. |
| `WS_AJENO_PORT` | Puerto de opencode-propio (ajeno, pero hay que conocerlo para no matarlo nunca). Por defecto, `5174`. |
| `WS_NOMBRE` | Nombre del tablero. Por defecto, el nombre de la carpeta del repo. |
| `WS_REPOS_PARALELO` | Cuántos `git` corren a la vez al escanear. Por defecto, `4`; un valor no válido cae a 4. Medición en [docs/rendimiento.md](docs/rendimiento.md). |
| `WS_GIT`, `WS_NPM`, `WS_SSH`, `WS_TAR` | Ejecutable de cada herramienta, si no es el del `PATH`. |
| `WM_TMP` | Carpeta de temporales. Por defecto, `C:/tmp` en Windows y `~/tmp` en Linux. |
| `WM_API` | URL base de la API del tablero (p. ej. un túnel). Por defecto, `http://127.0.0.1:<WS_PORT>`. |
| `WM_TOKEN`, `WM_TOKEN_FILE` | Token de portador (ver arriba). |
| `LIMPIADOR_BIN` | Ruta del binario del limpiador de PC. Por defecto, `data/bin/limpiador.exe`, o el nombre del papel `limpiador` de `area.json`. |
| `VPS_REFRESH_MS` | Refresco del estado VPS del backend, en ms. Por defecto, `0` (desactivado). |
| `PULSE_URL`, `PULSE_TOKEN` | Servicio de métricas del área (pestaña VPS). La URL también puede venir de `pulseUrl` en `config/area.json`; sin ninguna, la pestaña dice «sin configurar». |
| `PULSE_TALLER_URL`, `PULSE_TALLER_TOKEN` | Igual, para el pulse del taller (por su túnel). La URL también puede venir de `pulseTallerUrl`; el token, del `.env` del proyecto que declara `tokenPulse` en su ficha. |
| `VITE_PORT`, `VITE_HOST`, `VITE_API_PROXY_TARGET` | Puerto, interfaz y destino del front de desarrollo. Pisan a `WS_WEB_PORT`. |

#### Scripts del taller remoto

Los scripts de `scripts/remoto/` corren **en el propio taller**, no en el portátil.
Sus valores por defecto son los que usa un taller nuevo; para otro taller, defínelos
como variable de entorno antes de ejecutar el script.

| Variable | Script | Por defecto |
|---|---|---|
| `TALLER_USUARIO` | `provision-89.sh` | `dev` |
| `TALLER_HOME` | `provision-89.sh` | `/home/$TALLER_USUARIO` |
| `CM_TARGET_BASE` | `provision-89.sh`, `cm-sweep.sh` | `/var/tmp/glory-target` |
| `CM_QUALITY_BASE` | `cm-sweep.sh` | `/var/tmp/glory-quality` |
| `CM_SCCACHE_DIR` | `provision-89.sh` | `/var/cache/sccache` |
| `CM_SWEEP_CASA` | `cm-sweep.sh` | `$HOME` del usuario que barre |

Los nombres `glory-target` y `glory-quality` son contrato con Sentinel y con los scripts del
taller: los comparten el manager, `provision-89.sh` y `cm-sweep.sh`. Se mantienen a propósito,
porque renombrarlos obliga a reconstruir la caché del taller una vez y toca scripts de otros proyectos.

La carpeta de herramientas de calidad (`dirRemotoHerramientas` en `config/taller.json`,
por defecto `/var/tmp/glory-quality`) queda fuera del directorio que sincroniza
Mutagen: son artefactos, no código fuente.

## Uso

Todo el mando es un solo script, y se llama directo (si tienes un lanzador corto
en el PATH que lo reenvíe, es lo mismo):

```bash
node scripts/dev/dev.mjs <subcomando> [args]
```

| Subcomando | Qué hace |
|---|---|
| `doctor [id] [--all]` | Clasifica el estado de cada proyecto y señala incoherencias. |
| `up <id>` | Arranca o verifica un proyecto. |
| `stop <id>` | Lo detiene. |
| `status [id]` | Estado actual. |
| `logs <id>` | Cola del registro. |
| `open <id>` | Imprime las URLs. |
| `problemas` | Consola agregada de todo el área. |
| `gate <id> --inicio\|--cierre` | Guarda la línea base de hallazgos o compara contra ella. `--cierre` además corre el autogate (`comandos.gate` de la ficha) en el taller; sin orden se omite con aviso. Si el autogate ejecuta pruebas de VS Code en Linux, su `comandos.gate` debe fijar `DISPLAY` (p. ej. `DISPLAY=:99 TMPDIR=/var/tmp npm run quality:check` en el taller; el ejemplo `config/ejemplos/registro.example.json` lo muestra en `proyecto-1`). |
| `cierre <id>` | Puerta de cierre de una tarea. |
| `alta <id\|carpeta>` | Lista de alta de un proyecto nuevo (en seco salvo `--aplicar`). |
| `comandos <id>` | Imprime el contrato de comandos del proyecto. |
| `artefactos [--json]` | Qué proyecto consume el artefacto compilado de otro, y si está al día. |

### Artefactos entre proyectos

Un proyecto puede **empotrar** el artefacto de compilación de otro: por ejemplo, un escritorio
mete el `frontend/dist` de su web dentro del `.exe`. Eso se declara en la ficha del consumidor
(campo `consumeArtefacto` de `config/registro.json`, que no se versiona) y el manager avisa cuando
queda por detrás, para que el cambio de un proyecto no deje viejo el producto de otro en silencio:

```json
"consumeArtefacto": {
  "proyecto": "mi-proyecto",
  "ruta": "frontend/dist",
  "producto": "x86_64-pc-windows-msvc/release/proyecto-e.exe",
  "instalado": "<RUTA_DEL_AREA>/Apps/mi-escritorio/proyecto-e.exe"
}
```

`ruta` es lo consumido, relativa al proyecto consumido; `producto`, lo producido, relativo al
`target` remoto del consumidor; `instalado` es opcional (la copia fuera del taller, en el portátil)
y solo sirve para comprobar que lo instalado es lo compilado. Se comparan hechos que ya existen, sin
sello propio: el archivo **más nuevo del árbol** consumido contra el `mtime` del producto (no el
`mtime` del directorio, que Vite no toca) y el `sha256` del producto contra el del instalado.
Veredictos: `al-dia`, `desactualizado` (el producto no embebe lo nuevo), `sin-producto`,
`sin-instalar`, `instalado-distinto`, `sin-dato`. `doctor` lo suma como aviso (exit 2, degradado) y
la consola lo muestra en el proyecto consumidor. **No reconstruye ni instala solo.**

## Funciona con o sin taller

El manager distingue dos papeles, y esa separación es el eje del diseño:

- **Local (donde corre el manager):** editar, revisar y mandar. Ligero.
- **Taller (opcional, un servidor al que entras por SSH):** compilar, probar y
  ejecutar. Lo pesado.

Sin `config/taller.json`, o con el taller apagado, todo lo local sigue
funcionando: mapa, repos, documentos, tareas y config. El análisis de los proyectos
**corre en esta máquina mientras no haya taller configurado**, con un aviso visible para que
nadie lo confunda con un análisis en el taller. Con taller configurado, el análisis va al
taller por defecto y, si no responde, queda en error con el motivo (`sin VPS configurada`,
`el taller no respondió`): no baja al portátil, porque el portátil edita y lo pesado va al
taller.

Para activarlo basta con rellenar `config/taller.json` (host y directorio base). Dónde
se analiza cada proyecto lo marca `config/registro.json`: solo `analisisEn: "local"`
fuerza el análisis en el portátil; cualquier otro caso, incluido el `host` del taller,
va al taller.

## Pruebas

`npm run test` (suite del servidor y los scripts) y `npm run type-check` van **al taller
remoto** cuando hay uno configurado: el portátil edita y lo pesado va a la máquina del taller.
Los scripts `quality:*:test` pasan por `scripts/dev/ejecutar-tests.mjs`, que manda el comando
al taller. **Sin taller configurado corren en este equipo y lo dicen**, para que un clon
recién hecho pueda probarse sin servidor.

La única excepción con taller es `--local`, para una emergencia en la que el taller no esté
disponible. Hay que pedirlo a mano y dejar nota en el registro de tareas.

El mismo flag existe en el análisis (`problemas` y `gate --inicio|--cierre`).
Con `--local` el análisis corre en este equipo, muestra un aviso y **no se lee ni se
guarda en caché**, para que un dato de emergencia no pase por análisis normal. Sin taller
también analiza aquí, con su aviso: el análisis nunca se queda sin respuesta.

```bash
npm run type-check
```

```bash
npm run quality:sync:test
```

Las suites completas usan `node --test` (`scripts/**/*.test.mjs`) o `npx tsx --test`
(`src/**/*.test.ts`), y se lanzan igual, a través del ejecutor.

## App de escritorio (Tauri 2)

El tablero también se entrega como `.exe` de Windows: el front va empotrado y Rust lo sirve desde
`127.0.0.1:<puerto libre>` haciendo de proxy de `/api` (inyecta el token; el front no cambia). Usa
el backend que ya corre y sólo levanta el suyo si no hay ninguno.

```
npm run build:app     # front + servidor en el taller, y cargo xwin (vía run-cargo.mjs → rcargo.mjs)
```

El `.exe` sale en el taller (`…/x86_64-pc-windows-msvc/release/workspace-manager.exe`) y se instala en
`%USERPROFILE%/Apps/WorkspaceManager/`. El patrón completo —servidor local, ciclo del backend,
enlaces externos, build, artefacto— está en
`Agente/documentacion/arquitectura/patron-app-escritorio-tauri-2026-10-21.md` (local, fuera del repo
público).

## Estructura

```
src/
  server/     backend HTTP: rutas, gate, guardián, escáner, salud, tareas, vps
              y `plataforma/` (raíces, puertos, binarios y papeles del área: lo que
              lee el entorno o el disco)
  shared/     tipos y utilidades puras, sin E/S: lo que puede importar el front
  v2/         front: mapa y paneles (React). Es el que se sirve.
  hooks/ styles/ assets/   apoyo del front v2 (hooks, CSS y fuentes)
src-tauri/    app de escritorio (Tauri 2): servidor local, proxy y ventana
scripts/
  dev/        mando de desarrollo (dev.mjs y sus módulos)
  quality/    provisionado de Sentinel y VarSense
  remoto/     taller remoto
  shared/     raíces del sistema de archivos para los scripts
config/       config privada (no versionada) + ejemplos
```

Las dos mitades —backend y scripts— comparten la derivación de rutas en
`src/server/plataforma/rutas.ts` y `scripts/shared/rutas.mjs`. Son el mismo cálculo escrito
dos veces a propósito: Node ejecuta los `.mjs` sueltos y no puede importar
TypeScript.

## Herramientas de calidad

Sentinel y VarSense son proyectos aparte, **opcionales**. `quality-tools.json` declara de
dónde se clonan y en qué commit (son los repos upstream); `npm run quality:setup` los
provisiona en `.quality-tools/`. Si no están —o no tienes acceso a esos repos— el manager
funciona igual: el análisis de ese proyecto aparece como **error de datos con su motivo**,
nunca como limpio, y el resto de paneles no depende de ellos.

## Datos personales

`scripts/dev/privacidad/privacidad.mjs` busca rutas de usuario, IPs, tokens y los términos
privados de cada área antes de comitear. Los términos privados (hosts, nombres de
máquina) van en `config/privacidad.local.json`, que no se versiona; sin ese fichero
el detector sigue con las reglas genéricas. Una línea con `privacidad:ignorar` es una
excepción explícita y visible.

```bash
npm run privacidad
```

Para que corra en cada commit, `npm install` activa el hook versionado en `.githooks/`
(script `prepare`, `scripts/dev/privacidad/activar-hooks.mjs`; fuera de un repo Git no hace nada).
Si no has instalado dependencias, actívalo a mano una vez por clon:

```bash
git config core.hooksPath .githooks
```

`npm run privacidad:historial` revisa también el historial. Un dato que ya está en un
commit no se quita sin reescribir la historia, así que esa limpieza va aparte y con copia
de seguridad.

## Licencia

GPL-3.0. El texto completo está en [LICENSE](LICENSE).
