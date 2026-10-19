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

Todo corre en tu máquina y no habla con ningún servicio de terceros: lo único
que sale de ella es lo que tú declares en `config/taller.json`, por SSH, hacia un
servidor tuyo.

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
Sin `config/taller.json`, o con `modoPorDefecto` distinto de `remoto`, todo corre en la
propia máquina; ver «Modo sin VPS».

Para producción: `npm run build` compila el front; `npm run build:server` compila el
backend a `dist-server/` y `npm run server:compilado` lo arranca.

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
| `config/taller.json` | El taller remoto: host SSH, directorio base, intérprete de Node, binario de Mutagen, bases de datos y el bloque `devPublico` (zona, cuenta y túnel de Cloudflare) si publicas devs. |
| `config/guard-plantillas.json` | La plantilla del Guardián: qué listas de comandos añadir a cada proyecto según su stack. La pestaña Guardián la edita. |
| `config/area.json` | Los papeles del área: qué proyecto hace de motor de calidad, gestor de despliegues y limpiador, y quién queda fuera del bump. `despliegueBin` solo hace falta si el ejecutable que instala ese proyecto no se llama como su carpeta. |
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

Nada de esto vive dentro del repo: todo cuelga de `<área>/data/`, que es lo que
hace que el repo se pueda publicar tal cual.

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
| `CM_SWEEP_CASA` | `cm-sweep.sh` | `/home/usuario` |

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
| `gate <id> --inicio\|--cierre` | Guarda la línea base de hallazgos o compara contra ella. |
| `cierre <id>` | Puerta de cierre de una tarea. |
| `alta <id\|carpeta>` | Lista de alta de un proyecto nuevo (en seco salvo `--aplicar`). |
| `comandos <id>` | Imprime el contrato de comandos del proyecto. |

## Funciona con o sin taller

El manager distingue dos papeles, y esa separación es el eje del diseño:

- **Local (donde corre el manager):** editar, revisar y mandar. Ligero.
- **Taller (opcional, un servidor al que entras por SSH):** compilar, probar y
  ejecutar. Lo pesado.

Sin `config/taller.json`, o con el taller apagado, todo lo local sigue
funcionando: mapa, repos, documentos, tareas, config, y el análisis de los
proyectos que corren en el portátil. Los proyectos de taller (`analisisEn:
taller` en el registro, o `modoPorDefecto: remoto`) **no se analizan en el
portátil**: su análisis, su doctor y su arranque quedan con el motivo
(`sin taller configurado`, `el taller no respondió`) en vez de caer en silencio
en la máquina local. Es a propósito: el portátil edita, y lo pesado va a la 89.

Para activarlo basta con rellenar `config/taller.json`: de ahí salen el host, el
directorio base y **dónde se analiza** cada proyecto (`modoPorDefecto`, `remoto`
por defecto). En `config/registro.json` solo hace falta `analisisEn` para el
proyecto que deba ir contra corriente.

## Pruebas

No hay `npm test`. Los tests y el type-check corren **solo en el taller remoto**, nunca
en el portátil: el portátil edita y lo pesado va a la máquina del taller. Los scripts
`quality:*:test` pasan por `scripts/dev/ejecutar-tests.mjs`, que manda el comando al
taller. Sin taller configurado el comando falla con un error claro en vez de ejecutarse
en local.

La única excepción es `--local`, para una emergencia en la que el taller no esté
disponible. Hay que pedirlo a mano y dejar nota en el registro de tareas.

```bash
npm run type-check
```

```bash
npm run quality:sync:test
```

Las suites completas usan `node --test` (`scripts/**/*.test.mjs`) o `npx tsx --test`
(`src/**/*.test.ts`), y se lanzan igual, a través del ejecutor.

## Estructura

```
src/
  server/     backend HTTP: rutas, gate, guardián, escáner, salud, tareas, vps
              y `plataforma/` (raíces, puertos, binarios y papeles del área: lo que
              lee el entorno o el disco)
  shared/     tipos y utilidades puras, sin E/S: lo que puede importar el front
  v2/         front: mapa y paneles (React). Es el que se sirve.
  components/ hooks/ styles/ assets/   front v1, conservado por si hay que revertir
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

Sentinel y VarSense son proyectos aparte. `quality-tools.json` declara de dónde
se clonan y en qué commit; `npm run quality:setup` los provisiona en
`.quality-tools/`. Si no están, el manager funciona igual, pero el análisis de
ese proyecto aparece como **error de datos con su motivo**, nunca como limpio.

## Licencia

GPL-3.0. El texto completo está en [LICENSE](LICENSE).
