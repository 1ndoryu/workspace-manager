# Plan: la consola reporta los errores reales que sentinel detecta por proyecto

> Estado: propuesto · Autor: Buffy · Fecha: 2026-08-29
> Fuentes reales leídas: `PanelConsola.tsx`, `server/scanner/gate.ts`,
> `server/scanner/workspace.ts`, `server/cache.ts`, `server/configArea.ts`,
> `shared/types.ts`, `server/index.ts`, y el CLI real del runtime sentinel 0.7.4.

## 1. Objetivo

La consola debe mostrar, agrupados por proyecto, los **hallazgos reales** que
`sentinel analyze` detecta al analizar cada repo (reglas activadas, severidad,
archivo, mensaje y sugerencia), **sin consumir recursos**:

- análisis **a demanda** con un botón (en configuración) y
- opcionalmente un **auto-escaneo periódico** configurable (por defecto APAGADO),
- ambos **eficientes**: sin re-analizar lo que no cambió, en cola serial para no
  saturar la CPU, con caché por proyecto, y nada se ejecuta con la app cerrada.

La consola actual solo deriva problemas del *snapshot* (sin git/push/gate/config
por esquema). Esto agrega una fuente nueva y costosa (spawn de `sentinel
analyze`) que hay que **aislar y cachear** para que el escaneo raíz del area
(~2.6 s) no la arrastre.

## 2. Hallazgo decisivo (verificado contra el runtime 0.7.4)

`sentinel analyze --workspace <ruta> --format json` (bin real
`node out/cli/index.js`) es la puerta de los hallazgos. Salida JSON:

```jsonc
{
  "schemaVersion": "1",
  "tool": { "name": "glory-sentinel", "version": "0.7.4" },
  "severityCounts": { "error": 0, "warning": 11, "information": 0, "hint": 1 },
  "totalArchivos": 55,
  "entries": [
    { "ruta": "C:\\...\\store.ts", "findings": [
       { "ruleId": "large-interface-isp", "message": "Interface con 11 campos...",
         "severity": "hint", "range": {"start":{"line":12,"character":0}, ...},
         "source": "Code Sentinel", "suggestion": "Divide el contrato...",
         "confidence": 0.6, "analyzerVersion": "sentinel-core-0.4" } ] }
  ]
}
```

- **Costo real medido**: 127 ms para Glory-Laminal (55 archivos). Es un spawn
  de process de node; para un repo grande será más, pero es acotado (in-memory).
- **Gate de elegibilidad**: solo proyectos con `gate.puerta === 'sentinel'`
  (o `sentinel !== 'none'`/`qualityTools`). Los de puras carpetas o `cargo` se
  saltan (no tienen `sentinel analyze`).
- **Nunca en el escaneo raíz**: `escanearWorkspace` NO lanza `analyze`.
  El análisis vive en un estado separado, servido por otro endpoint.

## 3. Decisions de diseño (para no consumir recursos)

1. **Servidor es el dueño de la ejecución** (spawn de sentinel), el cliente es
   "tonto" (pide y muestra). El análisis es server-side igual que `doctor`.
2. **Caché por proyecto, invalidada por cambio real** (no por calendario):
   key = `clave + branch + HEAD + version sentinel`. Si el repo no cambió de
   HEAD y sentinel no cambió de versión y el resultado ya está fresco → se
   sirve cacheado, **sin spawn**.
3. **Cola serial con single-flight**: máximo 1 spawn a la vez, con rehuso de
   análisis en vuelo (si ya se está analizando X, quien lo pide se suscribe al
   mismo). Evita picos de CPU al escanear N repos.
4. **Auto-escaneo opt-in y solo con la app abierta**: el disparador vive en el
   **cliente** (timer del store), que llama al server. Con la app cerrada no
   hay timer → **cero recursos**. El server además valida intervalo mínimo por
   proyecto (frescura) para no re-analizar sin cambios.
5. **Resultados en memoria + disco opcional**: un mapa `clave → {versión,
   fuente, analizadoEn, resumen, hallazgos}` análogo a `snapshotMemoria`. Se
   persiste en `data/cache/analisis.json` para arranque instantáneo.
6. **Timeout y truncado**: spawn con timeout (p. ej. 60 s), salida cortada,
   y ante fallo se marca el proyecto como `error` con mensaje (no rompe nada).
7. **Sin hardcode**: la clasificación por severidad y el filtrado salen del
   JSON real; ninguna capa del UI cambia por añadir una rule.

## 4. Modelo de datos

En `shared/types.ts`:

```ts
export interface HallazgoSentinel {
  ruleId: string;
  mensaje: string;
  severidad: 'error' | 'warning' | 'information' | 'hint';
  archivo: string;        // ruta relativa o absoluta
  linea: number | null;
  sugerencia?: string;
}

export interface AnalisisSentinel {
  clave: string;                 // proyecto al que pertenece
  version: string;               // versión de sentinel que analizó
  fuente: 'runtime' | 'estatico' | null;
  estado: 'ok' | 'conHallazgos' | 'error';
  analizadoEn: string;
  resumen: { [sev: string]: number };
  hallazgos: HallazgoSentinel[]; // desnormalizado y acotado (top N / por severidad)
}
```

Extender `Proyecto` con `analisis?: AnalisisSentinel` (opcional, para que el
snapshot no lo exija) y `ConfigWorkspace`:

```ts
export interface ConfigWorkspace {
  version: number;               // subir a 2
  ignorados: string[];
  scan?: {                        // nueva sección (ausente => apagado, igual a hoy)
    automatico: boolean;          // por defecto false
    intervaloMin: number;         // default 30
    pedirSoloProblemas?: boolean; // filter severidad < warning al pedir, opcional
  };
}
```

## 5. Capa server — `src/server/gate/analizador.ts` (nuevo módulo)

- `analizarProyecto(ruta, clave)`: verifica elegibilidad (gate sentinel);
  calcula la key de frescura (branch + HEAD + versión), consulta la caché y,
  si está fresca, devuelve sin spawn; si no, `execFileSync('node',
  [rutaSentinelCli, 'analyze', '--workspace', ruta, '--format', 'json'])` con
  timeout; normaliza a `AnalisisSentinel`; escribe en caché.
- `analizarTodo(config, proyectos)`: itera solo los elegibles, **en cola
  serial** (una promesa encadenada), rehusando lo fresco y los vuelos en curso.
- `leerAnalisis(clave)`: sirve el resultado cacheado o `null` (para pedir solo
  por el **count** en la cabecera sin volcar todos los hallazgos).
- Cache por `versión+mtime` del runtime + `HEAD` (reusa la lógica de
  `proveedor.ts` para localizar el bin y `semverSort`).
- Reusa `RAIZ_VERSIONS` / localización del bin ya hechas en `proveedor.ts`.

Endpoints en `index.ts`:

- `POST /api/gate/analizar` → body `{ clave, forzar? }`: analiza UN proyecto y
  devuelve su `AnalisisSentinel` (usa a demanda el botón).
- `POST /api/gate/analizar-todo` → analiza/actualiza solo los elegibles y
  devuelve los resúmenes (usa el auto-timer del cliente).
- `GET /api/gate/analisis?clave=` → resultado cacheado (otro cliente/consola
  para counts sin re-analizar).

## 6. Configuración y botón — `PanelConfig.tsx` + `configArea.ts`

- `leerConfigArea`/`guardarConfigArea` normalizan la nueva sección `scan`
  (ausente ⇒ apagado; no rompe configs v1).
- Endpoint `POST /api/config/scan` (o ampliar `/api/config` con `op: 'scan'`)
  para leer/escribir `{ automatico, intervaloMin }`.
- En el **PanelConfig** (y un botón de acción en la cabecera de la consola):
  - switch "análisis automático cada X min" + input numérico de intervalo;
  - botón **"Escaneá ahora"** → llama `POST /api/gate/analizar-todo` (o por
    proyecto) y refresca; feedback de progreso (en curso / última vez).
- Persistencia en `data/workspace.config.json` (mismo archivo que `ignorados`).

## 7. Consola — `PanelConsola.tsx`

- Nueva categoría de filtro **`sentinel`** ("análisis") que lista los proyectos
  con `analisis.estado !== 'ok'`, **agrupados por proyecto** (igual que hoy) y
  cada hallazgo en su propia línea: `[severidad] archivo:línea — regla — mensaje`
  (con badge de severidad y la sugerencia en tooltip/título).
- La cabecera cuenta por severidad (`errores/warnings`) para que "todos" refleje
  el total real sin duplicar con las otras categorías. **Conteo (decisión del
  usuario 2026-08-29):** la categoría `sentinel` lleva su propio total por
  severidad, **separado** del total que mezcla sin-git/push/gate/config: el
  total de la cabecera NO suma hallazgos de analyze dentro de "todos" (un
  `hint`/`information` no es un problema de configuración y mezclarlo es ruido).
  Cada filtro conserva su conteo.
- Marca visual: un proyecto con hallazgos `error` cuenta como error en el badge
  `sentinel`; `warning/information/hint` como advertencia (mismo patrón que la
  categoria `config`).
- La consola se entera del análisis por dos vías: (a) si el snapshot ya lo trae
  (cuando se re-escanea tras un `analizar-todo`), o (b) un `fetch` puntual a
  `/api/gate/analisis` tras escanear, fusionando en el store.

## 8. Store — `useWorkspace.ts`

- Estado `analisis: Record<string, AnalisisSentinel>` + acciones:
  `escanearTodo()`, `escanearUno(clave)`, `configurarScan(cfg)`, `fusionarAnalisis(...)`.
- Disparador del auto: `setInterval`/`setTimeout` en el store que, **solo si la
  app está abierta** y `config.scan.automatico === true`, llama
  `escanearTodo()` cada `intervaloMin` (y respeta single-flight; no lanza si
  uno ya está en curso). Se limpia al desmontar.
- **Botón "Escaneá ahora" (decisión del usuario 2026-08-29): doble alcance —**
  desde el **detalle de un proyecto** (`PanelDetalle`) dispara `escanearUno(clave)`
  (re-analiza solo ese repo); en **consola/config** una acción global "Escaneá
  todo" llama `escanearTodo()` (recorre el workspace con la cola serial).

## 9. Fases y verificación

| Fase | Qué | Entrega verificable |
|---|---|---|
| **A0** | `analizador.ts`: analiza UN proyecto (caché por branch+HEAD+versión, elegibilidad, timeout, normalizado) | `pnpm type-check`; `curl -X POST /api/gate/analizar {"clave":"Glory-Laminal"}` devuelve `AnalisisSentinel` con `resumen` y `hallazgos` reales; segunda llamada = `fuente:cache` sin re-analizar (misma HEAD) |
| **A1** | Endpoints `analizar`/`analizar-todo`/`analisis` + cola serial server-side | dos llamadas simultáneas a `analizar-todo` no spawn en paralelo (single-flight); worktree limpio de `.json` reales |
| **A2** | Config `scan` (switch + intervalo) en `PanelConfig` + botón "Escaneá todo" global + botón por proyecto en `PanelDetalle` | persistir en `data/workspace.config.json` (sección `scan`); preview: el botón dispara y aparece progreso; consola muestra los findings de Glory-Laminal |
| **A3** | Categoría `sentinel` en `PanelConsola` + conteo por severidad | preview: Glory-Laminal lista sus 11 warnings + 1 hint reales agrupados, sin duplicar conteo; filtro 'sentinel' aísla |
| **A4** | Auto-escaneo periódico (timer cliente + frescura server) | con `scan.automatico=true` e `intervaloMin=1`, la consola se actualiza sola en ~1 min **solo con la app abierta**; cierra la app → no hay spawns (`netstat`/log sin actividad) |
| **R** | Revisión SOLID/escalabilidad/rendimiento (sección 10) | documentar limitaciones reales |

> **Revisión R (2026-08-30):** un barrido `analizar-todo` corría cada lote con
> `execFileSync`, BLOQUEANDO el event loop y dejando sin responder snapshot,
> config y doctor durante segundos. Se migró a ejecución **asíncrona** en `execFile`
> (`correrSentinel`) con cola serial por `await` en `analizarTodo`, y single-flight
> real por **promesa compartida** (`enVuelo: Map<clave, Promise>`); el `analizar`
> y `analizar-todo` del servidor ahora hacen `await`. Verificado: el event loop
> responde durante un spawn forzado de Glory-Laminal (11 warning + 1 hint en 519 ms).
> La caché sigue siendo por `clave` (acotada por nº de proyectos, cada uno con su
> hallazgos tope de 500); `persistir()` escribe best-effort y no tumbar el análisis.

## 10. Revisión integrada (principios)

- **Single Responsibility**: `analizador.ts` = runner+caché+frescura; el
  snapshot raíz no sabe de `analyze` (no se acopla al escaneo de 2.6 s).
- **Open/Closed**: añadir un esquema o rule no toca el UI (la consola despacha
  por `severidad`, no por `ruleId` hardcodeado); elegibilidad por `puerta`
  igual que hoy.
- **Interface segregation / despacho**: `AnalisisSentinel` desnormalizado y
  plano (sin anidar `entries`) para que la consola no conozca el formato real
  de sentinel (aísla cambios del runtime).
- **Fallback tolerante a fallos**: sin runtime o spawn fallido → `estado:
  'error'` con mensaje, y `fuente` informa; **nunca rompe** el snapshot ni la
  consola.
- **Límites de recursos**: timeout por spawn, salida truncada, caché por
  HEAD/versión, cola serial, auto-scan opt-in y solo en client abierto.
  Medir `--format json` por repo grande antes de habilitar el default del
  intervalo (default conservador 30 min, apagado por defecto).
- **Lin1 seguridad**: spawn con `execFileSync` sin shell (mismo patrón que
  `doctorSentinel`, args como array, nunca concatenar la ruta del workspace en
  un string de shell).

## 11. Alcance / no alcance

- **Sí**: análisis real por proyecto, caché inteligente, cola serial,
  configuración de auto-escaneo e intervalo, botón manual en configuración,
  categoría `sentinel` en la consola.
- **No (futuro/documentado)**: interactuar con los hallazgos (deshabilitar una
  rule desde la consola — eso es edición de reglas, otro frente); análisis
  diferencial por `git diff` (solo `--files-from`) ; LSP incremental; notificaciones
  al sistema; varsense (no tiene runtime que lo respalde).
- **No deja**: ningún `*.json` real de proyecto modificado; solo el
  `data/` del manager (config + caché de análisis).