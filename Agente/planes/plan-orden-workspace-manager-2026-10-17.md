# Plan — Poner workspace-manager en orden (2026-10-17)

Encargo de la usuaria. **Objetivo:** dejar workspace-manager coherente, correcto y agnóstico:
sin problemas reales abiertos, sin incoherencias con el taller de la VPS 89, sin falsos
positivos, sin hardcodeo, con análisis que cubra también los `.mjs`, con SOLID verificado, con
README y con los planes terminados y organizados.

**Punto de partida medido** (`GET /api/consola/problemas`, 2026-10-17T09:35Z): **440** problemas
repartidos en `sentinel` 350, `vulnerabilidad` 65, `salud` 20, `sinPush` 2, `sinCommit` 2,
`taller` 1. De los 440, **solo 2 son de workspace-manager**; el grueso está en RESTAURANTE (259),
KAMPLES (121), MN (13), NAKOMI (10) y PROYECTO TASKS (10).

## Decisiones de la usuaria (2026-10-17)

- **Alcance: todo el tablero**, por bloques y por proyecto; primero workspace-manager y las
  herramientas, después RESTAURANTE y KAMPLES.
- **`.mjs`: se arregla el núcleo de `glory-sentinel`** (mapeo de extensión y normalización en la
  comprobación de `aplicaA`) **más** el `sentinel.config.json` de workspace-manager.
- **Planes: se revisan uno a uno**, pero con criterio: son de agosto-septiembre y el área ha
  cambiado mucho, así que solo se salva lo que siga siendo una mejora importante o un pendiente
  que sume; el resto se archiva.
- **El nav ajeno de `src/v2/ui/menu/` (17AA-1) se adopta y se termina.**

## Diagnóstico (causa, no síntoma)

| # | Frente | Causa raíz | Dónde |
|---|---|---|---|
| 1 | `.mjs` sin analizar | El config sobrescribe `includePatterns` sin `**/*.mjs`, y `languageIdForFile` no mapea `.mjs` → `plaintext`, así que ninguna regla casa por `aplicaA`. La regla existe: `lineCounter.ts:208` da techo 300 a `.mjs` y cita `doctor.mjs` por su nombre. | `sentinel.config.json:23`, `core/language.ts:3`, `staticAnalyzer.ts:47,74` |
| 2 | Falsos positivos | Cinco defectos de herramienta distintos (ver Bloque B). | `vulnerabilidades-parseo.ts`, `estiloInline.ts`, `cssParser.ts`, `tokenRules.ts`, `analisisRapido` |
| 3 | Incoherencia con la 89 | De los seis proyectos del taller, **solo KAMPLES declara `analisisEn: "dev89"`**; los otros cinco se analizan en el portátil, contra AGENTS §7. Además `modoAnalisis` cae a `'local'` por defecto. | `registro.json`, `src/server/gate/remoto.ts:71` |
| 4 | Hardcodeo | `TALLER_HOST = 'dev89'` con `host` disponible en `taller.json`; la ruta del área repetida 9 veces; listas de proyectos dentro de `scripts/quality*`. | `src/server/taller/estado.ts:25`, `scripts/quality-sync.mjs:46` |
| 5 | SOLID | `scripts/dev/doctor.mjs` con 2255 líneas y `remoto.mjs` con 1043; `src/server/gate/` con 12 archivos (máx 10). | — |

## Bloques

Cada bloque se cierra con sus tests, su entrada en `Agente/completados/tareas-2026-10-17.md` y
su commit. El orden importa: **A y B van antes que C**, porque cambian lo que el tablero mide.

- **A — `.mjs` en Sentinel. HECHO (2026-10-17).** Causa doble: `includePatterns` propio no listaba
  `**/*.mjs` (esa clave **reemplaza** los defaults, no fusiona) y `languageIdForFile` no mapeaba
  `.mjs`, así que el documento llegaba como `plaintext` y toda regla lo descartaba por `aplicaA`.
  `ba6d9c7` (11-oct) había hecho solo la mitad: los defaults y el techo de 300 líneas de
  `lineCounter.ts`, que llevaba desde entonces siendo código muerto. Arreglado en el núcleo con
  `extensionCanonica` en `core/language.ts`, aplicada en `staticAnalyzer.ts` y `portableRules.ts`.
  glory-sentinel `d99f4c5`, versión 0.7.25, suite **881 passing / 0 failing**, certificado
  (`origen=ejecutada`). Pin propagado a 16 manifiestos.
  **Delta medido:** workspace-manager pasa de **2 a 16 hallazgos**; los 14 nuevos son de `.mjs`
  y 13 son reales. La excepción es `todo-prosa-sin-marcador` sobre `doctor.mjs:1630`, que casa
  la palabra española «todo» → pasa a B.
- **B — Falsos positivos de herramienta.** Evidencia recogida el 2026-10-17.
  - **B1 · CVSS. HECHO (`fa3edc8`).** `cargo audit` no emite `severity`: el aviso RUSTSEC trae
    `cvss` como **vector de texto** y el parser leía `cvss.severity`, así que caía en el `low`
    por defecto de `sev()`. El tablero pasa de `{low:58, high:7}` a
    `{critical:7, high:14, moderate:11, low:33}`: estaba ocultando 7 críticos y 14 altos, entre
    ellos `zip` RUSTSEC-2026-0369 (9.1) y RUSTSEC-2026-0367 (7.3) en siete proyectos. `cvss.ts`
    (nuevo) implementa la fórmula base 3.1; `HallazgoVulnerabilidad` conserva `id` y `titulo` (4
    avisos distintos de `rustls` se pintaban como 4 líneas idénticas) y marca `sinSeveridad` en
    vez de rellenar con `low`. El test de cargo usaba una forma **imaginada** (`severity:
    'medium'` dentro del advisory, que RUSTSEC no emite) y por eso pasaba con el camino roto.
  - **B2 · `cssInlineReact`/`cssInlineScript`. HECHO (`623f56c` en `varsense`).** Ambos
    recorrían `document.getText()` crudo, así que un `style={}` **dentro de un comentario**
    contaba como CSS inline. Los 2 de NAKOMI (`CarruselShowcase.tsx:73`,
    `SeccionGaleriaServicio.tsx:29`) son la misma frase de un comentario que explica el propio
    detector. `enmascararComentarios.ts` (nuevo) sustituye comentarios por espacios de igual
    longitud —offsets y líneas siguen valiendo— y cubre `/* */` y `//` respetando cadenas,
    templates y apóstrofos de texto JSX. **Witness:** 4 fallos antes, 10/10 después.
  - **B3 · `propiedadProhibida`: NO es falso positivo.** La premisa «marca `var(--token)`» era
    falsa: compara el **nombre** de la propiedad (`cssParser.ts:398`). Los 7 de RESTAURANTE son
    `box-shadow`, que su propio `varsense.config.json:62-68` declara prohibida
    (`PlanoOcupacion.css:91`, `PlanoSala.css:119`). **Pasa a I como problema real**; no se toca
    la regla.
  - **B4 · `tokenDetection.duplicate.excludeTokens`: la clave no existe.** Solo se lee
    `unused.excludeTokens` (`config.ts:180,217` → `tokenRules.ts:250`); el bloque `duplicate`
    (`tokenRules.ts:184-247`) no consulta exclusiones y el tipo (`config.ts:39`) no la declara.
    Los 41 `token-duplicate` de RESTAURANTE son el puente shadcn/Tailwind repitiendo valor por
    diseño. **Decisión de la usuaria:** implementar la clave o aceptar los duplicados.
  - **B5 · `excepciones-varsense.json`: artefacto huérfano. HECHO (`13A-1`).** Existía en 7
    proyectos (7,5 KB cada uno, 2026-09-11) adjudicando ~49 `token-duplicate`, 39 `token-unused` y
    6 `claseHuerfana`; **ningún programa lo lee** (barrido de `excepciones-varsense` en
    `*.ts,*.mjs,*.js,*.cjs,*.rs,*.json` sobre toda el área: 0 coincidencias; solo aparece en `.md`
    y en dos `.gitignore`). El único registro de excepciones que sí se consume es
    `config/quality-excepciones.json`. El de RESTAURANTE se borró con la decisión de la usuaria y
    el de workspace-manager —que seguía *tracked*, y por tanto era lo que impedía publicar el
    repo— se borró igual. Recuperable desde el historial.
  - **Añadido por A:** `todo-prosa-sin-marcador` casa «todo» en prosa española (`doctor.mjs:1630`,
    «todo verde = 0»); la regla busca el marcador inglés `TODO` y necesita contexto para no leer
    el artículo español.
- **C — Problemas reales de workspace-manager.** Partía de 16 tras A y **queda en 2**.
  Cerrado en cuatro tandas:
  - `da9adf4` (doctor.mjs), `222085a` (remoto.mjs) y `1af4b01` (reorganización de
    `scripts/dev/` por dominio: 20 → 8 en la raíz): resuelven los `limite-lineas` de
    `doctor.mjs` (1716 efectivas, con sus niveles 2–4) y `remoto.mjs` (814), y el
    `directorio-abarrotado` de `scripts/dev/`. Los módulos nuevos viven en
    `scripts/dev/{proyecto,taller,doctor,remoto}/`; `dev.mjs` sigue siendo la única entrada.
  - `01c8ffa`: `bump.mjs` (460) partido en `scripts/quality/bump/` (9 módulos) y las cuatro
    auditorías movidas a `scripts/quality/auditoria/`, lo que además quita el
    `directorio-abarrotado` de `scripts/quality/` (11 → 7).
  - `8073bcf`: `gate/vulnerabilidades/` (parseo + CVSS) y `shared/consola/`, que quitan los
    `directorio-abarrotado` de `src/server/gate/` (14 → 9) y `src/shared/` (11 → 9). Aquí
    entró también el `import-muerto` de `bump/cli.mjs`, que quedó muerto al separar la
    propagación del CLI.
  - `381f815`: **regresión propia**, no hallazgo del tablero. Al mover `gate.mjs` a
    `scripts/dev/proyecto/`, su `RAIZ` —que se calcula contando carpetas— pasó a resolver
    `scripts/`, así que `--inicio` escribía el snapshot en `scripts/data/gate-inicio/` y
    `--cierre` habría comparado contra una base vacía. El test no podía detectarlo porque
    comparaba contra el propio `RAIZ`; ahora se ancla al `package.json` del repo.
  - **Los `import-muerto` de `agregado-8787.mjs` y `sync-gate-schema.mjs` ya no aparecen** en
    el análisis del 2026-10-17T14:27Z; no consta arreglo explícito, así que se dieron por
    resueltos al mover/reescribir esos archivos.
  - ~~El backend escucha en `0.0.0.0:8787`~~: **descartado, era una lectura mía errónea** —
    `0.0.0.0:0` es la columna de dirección remota de `netstat`, no el bind; el backend escucha
    en `127.0.0.1:8787` (`index.ts:235`), correcto.
  - **Quedan 2**, y son el falso positivo de B (ver más abajo): `limite-lineas` en
    `doctor.test.mjs` (516) y `remoto.test.mjs` (398). No se trocean: la regla mide «este
    módulo debería partirse por responsabilidad» y un archivo de tests se parte por casos.
    Se corrige la regla, no el síntoma.
- **D — Coherencia con el taller. CASI TODO YA ESTABA; el resto, HECHO (`8fdaa9b`).**
  Lo que el diagnóstico de partida daba por pendiente resultó estar resuelto, y se comprobó
  ejecutando `modoAnalisisEn` contra la config real (no leyendo código):
  - `TALLER_HOST`: ya no existe. `estado.ts:25` lee `hostTaller()` de `taller.json` desde un
    cambio anterior; el literal `'dev89'` solo sobrevive en el comentario que explica por qué se
    quitó.
  - `analisisEn` en las fichas: **no hace falta**. `modoAnalisisEn` cae a `host` + `modoPorDefecto`
    de `taller.json` (que ya es `"remoto"`), así que los seis proyectos del taller —MN-Inmobiliaria,
    NAKOMI, PROYECTO TASKS, WANDORIUS, RESTAURANTE y KAMPLES— ya resuelven a `taller` sin declarar
    nada. Añadir la clave a cinco fichas habría sido configuración redundante que hay que mantener.
  - `modoAnalisis` «por defecto local»: falso. Lo decide `modoPorDefecto`, no un literal.
  - **Lo único que quedaba era real:** `vulnerabilidades.ts` corría el audit de npm/pnpm en el
    portátil aunque el proyecto fuera del taller. Ver E1.
- **E — SOLID y agnóstico.** Partir `doctor.mjs` y `remoto.mjs` por responsabilidad (ya hecho en
  C); un módulo único de rutas del área en vez de 9 literales; sacar de `scripts/quality*` las
  listas de proyectos que duplican `registro.json`.
  - **E2 — Proveedor sustituible y esquemas en un registro. HECHO (`403ccdd`).** Dos fallos que
    se veían juntos en el editor de config:
    - **ISP/LSP.** `ProveedorGate` obligaba a declarar `reglas()` y `versionReferencia()`, y
      varsense no tiene ni catálogo de reglas propio ni versión de curación: las cumplía con un
      degenerado (`[]` y `'—'`). Como el contrato obligaba a mentir, el consumidor se lo saltaba
      ramificando por tipo (`rutasGate.ts`: `tipo === 'sentinel' ? reglasGate().reglas : []`).
      Ahora son opcionales y `'—'` pasa a `null`: quien no las tiene no las declara, y quien
      consume recibe cero reglas sin saber de qué herramienta se trata.
    - **OCP.** La correspondencia herramienta → esquema y herramienta → archivo de config estaba
      escrita a mano en cuatro cadenas de `? :` (cliente y server): añadir una herramienta
      obligaba a tocar los cuatro sitios. Ahora vive en `shared/gate/esquemas.ts`, que es la mitad
      **estática** del proveedor: existe para cuando el server no responde (el bundle del cliente
      lleva el esquema embebido) y para mapear el nombre del archivo, que el proveedor no conoce.
    - **Testigo** (`proveedor.test.ts`, 3 casos): los dos proveedores se consumen igual, el que no
      tiene catálogo no se distingue del que lo tiene, y el registro estático cubre los mismos
      tipos y archivos que los proveedores registrados. El positivo del barrido son los dos
      proveedores: un bucle sobre cero entradas no habría probado nada.
    - **Verificado:** type-check limpio; 422 tests TS y 181 `.mjs` en verde; `vite build` ok; en
      vivo `GET /api/gate/dinamico` da sentinel 121 reglas con referencia 0.7.19 y varsense 0
      reglas con `versionReferencia: null`.
  - **E1 — El audit corre en la 89 para los tres gestores. HECHO (`8fdaa9b`).** `cargo-remoto.ts`
    pasa a `auditoria-remota.ts` y generaliza el envío por gestor: npm y pnpm solo necesitan
    manifiestos y lockfiles, cargo sigue necesitando los `.rs` y los hermanos de `path`. Cada gestor
    tiene su árbol en `/var/tmp` (antes uno por proyecto: el segundo `rm -rf` habría borrado el del
    primero en WANDORIUS, que tiene npm y cargo). Sin taller, con `taller.json` ilegible o si el
    envío falla, cae a local. De paso centraliza `gestor === 'cargo'`, que estaba repartido en tres
    cadenas (SOLID §3 de la auditoría). **Medido:** audits remotos npm 0,61 s y cargo 0,75 s; el
    coste del forzado (~37 s) son los `cargo tree -i` de la comprobación de alcanzabilidad, uno por
    hallazgo, no el transporte. La llamada cacheada son 5,7 s, y ese tiempo es el `snapshotArea(true)`
    de la ruta, no el audit.
  - **E3 — Resto de la auditoría SOLID: qué se corrige y qué se deja a propósito.** La auditoría
    pasó los 12 hallazgos; además de los dos de E2 y el OCP de `gestor === 'cargo'` (que se cerró
    en E1), quedan:
    - **Se corrige, con el agnóstico (E4):** los literales de ruta y de proyecto (hallazgos de
      hardcodeo) — `C:\Users\usuario` en `conformidad.ts` y `rutasVps.ts`, la ruta de
      `coolify-manager-rs`, `limpiador-pc` en `doctor/sistema/rust.mjs`, la lista de 18 proyectos
      de `quality-sync.mjs`, los puertos del tablero y de `cierre.mjs`, `BIN_LEGACY`, y
      `statfsSync('C:/')`.
    - **Se corrige, con el rendimiento (F7):** `analizador.ts` mezcla persistencia, caché en
      memoria, single-flight, normalización de formato y caída a remoto/local en dos funciones
      largas; se parte por responsabilidad al perfilar, que es cuando se sabe qué trozo pesa.
    - **Se deja como está, a propósito:**
      - **D — I/O concreto sin punto de inyección** (`estado.ts`, `scanner/git.ts`,
        `scanner/gate.ts`, `salud/recoger.ts`, `remoto.ts`): son *adaptadores*, y su oficio es
        exactamente llamar al sistema. Inyectarles un lector de ficheros no los haría
        sustituibles en ningún escenario real —nadie los va a usar contra otro sistema de
        ficheros— y añadiría una capa por función. Donde sí hay lógica que merece test se inyecta
        ya (`agente.ts` recibe `fetchImpl` y `ahora`, `historial.ts` recibe `ruta` y `ahora`,
        `detectarLockfiles` recibe `existe`), que es el criterio correcto: **se inyecta lo que
        tiene decisiones, no lo que tiene llamadas**. `remoto.test.ts` lo dice en su cabecera:
        «sin SSH ni mutagen: eso se prueba en la ejecución real», y así se hizo (E1).
      - **S — funciones largas de los `.mjs` del doctor** (`lanzar.mjs`, `clasificar.mjs`) y
        `bump/propagacion.mjs`: son guiones lineales de arranque y clasificación, sin estado
        compartido ni ramas que se puedan reordenar. Partirlos daría funciones de una llamada. Los
        `.ts` largos que sí mezclan responsabilidades se parten (arriba).
      - **L/O — `TipoGate` como unión cerrada:** es lo que permite que el registro de E2 sea
        exhaustivo y que el compilador avise si falta una herramienta. Abrirlo a `string` cambiaría
        un error de compilación por un `undefined` en ejecución. El punto de extensión ya no es el
        tipo: es añadir una línea al registro.
  - **E4 — Agnóstico: lo nuestro, fuera del repo. HECHO (`c76079e`).** El criterio de la usuaria es
    que el repo se publique **tal cual** y aun así funcione con nuestra config, que es privada y vive
    fuera. Lo que se hizo, y las tres decisiones que se tomaron a propósito, al final de este bloque.
    Inventario, por gravedad:
    1. **Datos nuestros en archivos versionados** (lo único que impide publicar hoy):
       `scripts/quality-sync.mjs` lleva la lista de ~18 proyectos del área con sus rutas, y
       `scripts/quality/excepciones.json` está *tracked* con nuestras excepciones. Los dos son
       configuración, no código: van a `config/` (ya ignorado) con su `*.example.json` en
       `config/ejemplos/`, que es el patrón que el repo ya usa para `registro` y `taller`. Sin el
       archivo, el script degrada a «no hay consumidores que sincronizar» en vez de fallar.
    2. **Rutas personales y de nuestra área** en código: `C:\Users\usuario` en
       `conformidad.ts:243,245` y `rutasVps.ts:192`, la ruta del checkout de `coolify-manager-rs`
       (`rutasVps.ts:51`), `BIN_LEGACY = 'C:\tmp\bin\coolify-manager.exe'` (`vps/puente.ts:16`),
       `statfsSync('C:/')` (`salud/recoger.ts:190`). Todas salen de la config o de `os.homedir()`
       y de la raíz del área ya resuelta.
    3. **Nombres y puertos nuestros incrustados:** `limpiador-pc` en `doctor/sistema/rust.mjs`,
       `['glory-harness']` en `bump/ajustes.mjs`, `PUERTOS_TABLERO = [5175, 8787, 4173]`
       (`guardian/operacion/seguridad.ts`) y `PUERTOS_PROTEGIDOS = [5174, 5175, 8787]`
       (`scripts/dev/proyecto/cierre.mjs`). Los puertos del tablero son de nuestro despliegue:
       van a la config con los valores actuales como defecto documentado.
    4. **Un módulo único de rutas del área** en vez de los literales repetidos: es lo que hace que
       el punto 2 se arregle en un sitio y no en nueve.

    **Cómo quedó.** Los puntos 1 y 4 ya estaban de antes (`scripts/quality-sync.mjs` lee
    `config/quality-consumidores.json` y degrada a «no hay consumidores que declarar»;
    `src/shared/rutas.ts` + `scripts/shared/rutas.mjs` son el módulo único). El punto 2 salió con
    `raizTemporales()`, `RAIZ_REPO` y el área como carpeta padre. El punto 3 se resolvió así:

    - **Puertos** (`src/shared/puertos.ts` + gemelo `.mjs`): dueño único del dato, valores actuales
      como defecto y `WS_*` para moverlos. Estaban escritos a mano en catorce sitios, y el guardián
      protegía 5175/8787/4173 mientras el doctor protegía 8787/5174/5175. De paso apareció un fallo
      latente: el defecto del dev server era **5174**, el puerto de opencode-propio, así que
      `npm run dev` a secas chocaba y, con `strictPort`, moría.
    - **Papeles del área** (`config/area.json`, privado, con ejemplo versionado): qué proyecto hace
      de motor de calidad, gestor de despliegues y limpiador, y quién queda fuera del bump. Sin el
      fichero no se rompe nada: cada papel ausente desactiva su función y lo dice con el remedio
      (`avisoSinPapel`); la guarda del centinela **falla cerrada** (503), que es lo correcto para un
      endpoint que exime.
    - **Quién es el tablero: por ruta, no por nombre.** `esMando` lo calcula el servidor
      (`scanner/workspace.ts`) comparando con `RAIZ_REPO` y lo consume la clasificación compartida,
      que no puede mirar el sistema de archivos. Para la regla L1 el nombre viaja como dato
      (`nombreMando`), no como literal.

    **Tres decisiones, para que se lean como deliberadas y no como olvidos:**

    1. **`Agente/` queda fuera del alcance de E4.** Es nuestra documentación de trabajo (planes,
       completados, historial), no código del producto: se versiona a propósito y no es «datos
       nuestros en archivos versionados» en el sentido del punto 1. Si algún día se publica el repo,
       esa carpeta se decide aparte.
    2. **`scripts/quality/certificacion.mjs` conserva su espacio de caché** (`glory-sentinel` /
       `GlorySentinel`): es el *namespace* del motor de calidad, no una ruta nuestra, y
       `GLORY_CERT_CACHE` es su override documentado. Cambiarlo rompería la caché de quien ya lo
       tiene montado sin ganar agnosticidad.
    3. **`PATRON_OPENCODE_PROPIO` y `PUERTO_OPENCODE` (5174) se quedan como constantes
       documentadas:** nombran una app de **terceros** (la que no se debe tocar), no un proyecto
       nuestro. No son configuración del área.

    **Extra que apareció al auditar:** la prueba de `quality-sync` montaba un área con nuestros
    nombres reales *y* leía nuestra config privada, así que no pasaba en un clon. Ahora el fixture
    inventa los nombres y escribe su propia lista de consumidores.
    **Verificado:** type-check limpio, 181/181 en `.mjs`, 427/427 en TS y la trampa del doctor en
    verde con `config/registro.json` intacto (`diff` contra la copia de seguridad).
- **F — README. HECHO (`13A-1`).** Reescrito contra el código, no contra el recuerdo: seis
  desmentidos. (1) El front no es 5174 sino **5175** —5174 es opencode-propio, así que el README
  mandaba a la usuaria al puerto de otra app—. (2) Faltaban dos plantillas por copiar (`area`,
  `quality-consumidores`) y una tabla (`quality-excepciones`). (3) El estado no vive «en `data/`
  dentro del repo» sino en `<área>/data/`, fuera: es lo que permite publicar el repo tal cual.
  (4) `analisisEn: "dev89"` ya no hace falta (lo decide `modoPorDefecto` del taller) y el README lo
  pedía. (5) Faltaban `WS_WEB_PORT`, `WS_PREVIEW_PORT`, `WS_OPENCODE_PORT`, `WS_NOMBRE` y `WM_TMP`;
  sobraba «no hay `engines`» (se añadió). (6) El front v1 no es el que se sirve: `v2` sí.
  **Verificado de verdad:** con un directorio limpio y **solo las cinco plantillas** el backend
  arranca y sirve `/api/workspace` y `/api/consola/problemas` (401 sin token, 200 con él).
- **G — Planes.** Revisar los 24 `PLAN-*.md` de la raíz y los 5 de `Agente/planes/`, uno a uno;
  crear `Agente/documentacion/`; archivar lo terminado y lo que ya no sume.
- **H — Nav ajeno (17AA-1).** Terminar el recorte del nav, probarlo en el navegador y commitearlo
  aparte.
- **I — RESTAURANTE y KAMPLES.** Los 259 y 121 hallazgos, por bloques, tras cerrar las
  herramientas (A y B cambian el recuento).
- **J — El arreglo no llega a los demás consumidores (nuevo, de A).** 11 de 16 fichas declaran
  `includePatterns` propio sin `**/*.mjs`, así que la mitad del arreglo solo vale para
  workspace-manager. La causa es la semántica de la clave: **reemplaza** los defaults en vez de
  fusionarlos (`config.ts:229`), de modo que cada ficha congeló una copia de los defaults de su
  fecha. Un merge ciego no vale: `glory-agent`, `glory-pulse`, `GLORYPORT` y `limpiador-pc`
  listan 3 patrones a propósito (proyectos Rust sin JS) y `RESTAURANTE`/`NAKOMI`/`PROYECTO TASKS`/
  `WANDORIUS` acotan a `frontend/**` y `scripts/**`. `analyzers.sentinel.profile` está declarado
  en el tipo pero ningún código lo lee: es una clave muerta, no un preset. **Decisión pendiente
  de la usuaria.**

- **K — Rendimiento medido.** Perfilar antes de optimizar; nada a ojo.
  - **K1 — La verificación de alineación del gate. HECHO (`e4adf45`).** Perfilado con el endpoint
    en marcha: `GET /api/gate/sincronizacion` tardaba **20,7 s** (min 20193, max 20948, mediana de
    3) y el informe de alineación solo, 24–33 s. `GIT_TRACE2` dio la causa: **580 procesos git
    para 8 checkouts distintos**, ninguno de trabajo real. (1) La consulta se repetía por
    consumidor —20 consumidores sobre los mismos checkouts compartidos pedían 162 veces
    `merge-base --is-ancestor` del mismo pin contra las mismas refs—: el script es de solo lectura,
    así que la misma consulta sobre el mismo checkout se responde una vez (memo por cwd+args).
    (2) `estaPublicado` preguntaba ref a ref, un proceso git por tag, y un pin no publicado obliga
    a recorrer las ~29 tags: `for-each-ref --contains` responde lo mismo en una llamada.
    (3) `remotoUpstream` gastaba dos viajes al remoto por checkout; un `ls-remote` sin filtros trae
    HEAD y tags juntos. **Resultado: 54 procesos, 8,4 s el informe, salida JSON idéntica byte a
    byte** (diff contra `HEAD`: sin diferencias), endpoint forzado 20,7 → 10,8 s.
    Además el informe se cachea 60 s en memoria: abrir la pestaña Gate pasa de 10,8 s a **13 ms**,
    y el botón «verificar alineación» manda `forzar=1` y salta la caché (un informe viejo servido
    indefinidamente sería peor que no tener caché, por eso caduca). El comentario de la ruta decía
    «corrida barata»: por creerlo no se cacheaba. Medidor reutilizable: `C:/tmp/wm-perf/mide.mjs`.
  - **K2 — Hecho (17AA-2):** perfilado el escaneo raíz con el mismo medidor. La causa no era el
    bucle ni el disco: era **pedirle a git lo que se puede leer del filesystem**. `estadoGit`
    gastaba 6–7 procesos por repo (uno por cada pregunta: rama, remoto, ahead/behind, cambios,
    worktrees) y `detectarGit` preguntaba `rev-parse --is-inside-work-tree` en cada carpeta sin
    `.git` (16 carpetas × 37 ms = **594 ms** solo en eso).
    (1) `estadoGit` ahora usa **dos** procesos: `status --porcelain --branch` trae de una vez la
    rama, el upstream, el ahead/behind y el estado de los archivos; y un `log -1` para el último
    commit. El remoto se lee de `.git/config` (con caída a `git remote get-url origin` si el
    config lleva `include` o `url`), y `worktree list` se salta cuando no existe
    `<commondir>/worktrees`, porque sin worktrees secundarios no puede haber huérfanos.
    (2) `detectarGit` resuelve el `.git` en el filesystem (enlace → `realpath`, fichero →
    `gitdir:`, y si no, camina hacia arriba buscando `.git`): **594 ms → 4–5 ms**.
    **Resultado: el escaneo raíz pasa de 8.957 ms y 142 procesos git a ~2.400 ms y 41 procesos
    propios** (3,7×), con `detectarGit: 32/32` y `estadoGit: 20/20` respuestas idénticas a la
    implementación vieja sobre las carpetas reales del área. Lo que queda (2,3 s) es `git status`
    mismo sobre OneDrive (~117 ms por repo, 96 % del escaneo) y ya solo se paga al refrescar de
    verdad, porque `/api/workspace` sirve caché en memoria y en disco si no se pide `forzar=1`.
    **No se hizo, a propósito:** caché por mtime (la frescura no es fiable) y escáner asíncrono
    (paralelizar `git status` sobre OneDrive no acelera; lo satura). De paso: el `snapshotArea`
    duplicado en `index.ts` se eliminó (era una segunda fuente de verdad del mismo escaneo) y
    `analizador.ts` se partió por responsabilidad según E3 (`analisis/almacen.ts` guarda,
    `analisis/reporte.ts` traduce formato, `analizador.ts` lanza y decide dónde corre).

## Criterio de hecho

Cero problemas reales abiertos y cero falsos positivos pendientes; ninguna incoherencia con el
taller de la 89; los `.mjs` analizados con el mismo rigor que el resto; SOLID cumplido, sin
hardcodeo, con README; planes terminados y organizados.

## Estado

**Cerrado:** A (glory-sentinel `d99f4c5` + pin en 16 manifiestos), B1 (`fa3edc8`, CVSS),
B2 (`623f56c` en varsense, `cssInline*`), **C (los 14 problemas reales de workspace-manager;
el tablero pasa de 16 a 2, y los 2 que quedan son el falso positivo de B6)**.

**Bloque en curso:** G (planes). **Hecho además:** D, que
resultó estar casi todo resuelto de antes y se cerró con el audit remoto (`8fdaa9b`), la parte
de SOLID de E (`403ccdd`, E2 + la disposición del resto en E3), el agnóstico (`c76079e`, E4), el
rendimiento entero (K1 `e4adf45`: la verificación de alineación, 20,7 s → 10,8 s
forzado y 13 ms cacheada; K2 `c322e0c`: el escaneo raíz, 8.957 ms → ~2.400 ms), el README
(`13A-1`, bloque F) y B5 (el artefacto huérfano, fuera del repo).
**Próximo paso:** los planes (bloque G) y, después, el cierre de los falsos positivos.
**Falsos positivos pendientes (van al final, por encargo):** B4
(`tokenDetection.duplicate.excludeTokens`) y B6
(el `limite-lineas` de los archivos de test, que es lo único que le queda al tablero de
workspace-manager). **Pendiente de decisión de la usuaria:** J (semántica de `includePatterns`).
**Pendiente de la usuaria, no del plan:** la licencia del repo (es público y sin licencia los
derechos quedan reservados por defecto).

### B6 · `limite-lineas` sobre archivos de test (falso positivo, al final)

`obtenerLimiteArchivo` da a un arnés de test de Rust (`/tests/`, `_test.rs`) un techo de **1000**
líneas —con el comentario `[FP-S4 11-09-2026]`, es decir, ya se reconoció una vez que el techo de
producción no aplica ahí— pero a `.test.ts`/`.test.mjs` les da el techo de módulo de producción
(**300**). La regla busca módulos que deberían partirse *por responsabilidad*; un archivo de test
se parte *por casos* y ya lleva secciones. Es la misma situación que el precedente de Rust, sin
resolver en JS. Afecta a `doctor.test.mjs` (516) y `remoto.test.mjs` (398), y a cualquier test
largo de los otros consumidores.
