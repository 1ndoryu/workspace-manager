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
git clone <este-repo> workspace-manager
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
| `config/area.json` | Los papeles del área: qué proyecto hace de motor de calidad, gestor de despliegues y limpiador, y quién queda fuera del bump. |
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
| `WS_OPENCODE_PORT` | Puerto de opencode-propio (ajeno, pero hay que conocerlo para no matarlo nunca). Por defecto, `5174`. |
| `WS_NOMBRE` | Nombre del tablero. Por defecto, el nombre de la carpeta del repo. |
| `WM_TMP` | Carpeta de temporales. Por defecto, `C:/tmp` en Windows y `~/tmp` en Linux. |
| `WM_TOKEN`, `WM_TOKEN_FILE` | Token de portador (ver arriba). |
| `VITE_PORT`, `VITE_HOST`, `VITE_API_PROXY_TARGET` | Puerto, interfaz y destino del front de desarrollo. Pisan a `WS_WEB_PORT`. |

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
funcionando: mapa, repos, documentos, tareas, config, y los análisis corren en
la propia máquina. Lo que se degrada es lo que necesita el servidor —arrancar
proyectos allí, sincronizar árboles, compilar— y el manager lo dice en la
interfaz en vez de fallar en silencio.

Para activarlo basta con rellenar `config/taller.json`: de ahí salen el host, el
directorio base y **dónde se analiza** cada proyecto (`modoPorDefecto`, `remoto`
por defecto). En `config/registro.json` solo hace falta `analisisEn` para el
proyecto que deba ir contra corriente.

## Pruebas

No hay `npm test`. Son dos suites, con sus comandos exactos:

```bash
npm run type-check
```

```bash
node --test "scripts/**/*.test.mjs"
```

```bash
npx tsx --test "src/**/*.test.ts"
```

## Estructura

```
src/
  server/     backend HTTP: rutas, gate, guardián, escáner, salud, tareas, vps
  shared/     utilidades compartidas entre el backend y los scripts
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
`src/shared/rutas.ts` y `scripts/shared/rutas.mjs`. Son el mismo cálculo escrito
dos veces a propósito: Node ejecuta los `.mjs` sueltos y no puede importar
TypeScript.

## Herramientas de calidad

Sentinel y VarSense son proyectos aparte. `quality-tools.json` declara de dónde
se clonan y en qué commit; `npm run quality:setup` los provisiona en
`.quality-tools/`. Si no están, el manager funciona igual: simplemente no hay
hallazgos que mostrar.

## Licencia

GPL-3.0. El texto completo está en [LICENSE](LICENSE).
