# Plan: gate dinámico y escalable (reglas vivas + esquema versionado)

> Estado: propuesto · Autor: Buffy · Fecha: 2026-08-29
> Fuente real: runtime sentinel **0.7.4** fijado (`GlorySentinel/versions/0.7.4/out/`).
> Relación con planes previos: cierra la pregunta abierta de `PLAN-reglas-completas-tabs.md`
> (§3, catálogo estático) que dejamos votada. El usuario pidió *"planifica hacerlo dinámico
> todo, incluyendo las configuraciones, enfoque en la escalabilidad"*.

## 1. Qué es genuinamente dinámico y qué no (dato real, no suposición)

Antes de planificar toqué el runtime 0.7.4. Esto es lo que **existe** y lo que **no existe**:

| Dato | Fuente en el runtime | ¿Derivable en tiempo de ejecución? |
|---|---|---|
| **Catálogo de reglas** (105) y su severidad | `out/config/ruleRegistry.js`: `obtenerTodasLasReglas()`, `obtenerIdsReglas()`, `obtenerSeveridadRegla()`, `REGISTRO[]` | **SÍ.** Son datos/JS ejecutables; se pueden leer y llamar desde el server. |
| **Default `habilitada` por regla** | `registerRule(…, habilitadaDefault)` (2 de 105 false) | **SÍ.** Idem, vía el registro en runtime. |
| **Esquema de `sentinel.config.json`** | `out/core/config.d.ts` (interface TS) + `config.js` (solo `validateSentinelConfig`, validación imperativa) | **NO.** No hay JSON Schema, ni comando de introspección, ni datos declarativos: el conocimiento es *compile-time* (tipos). |
| **Esquema de `varsense.config.json`** | — (verificado: sin binario en AppData/Local) | **NO.** Solo fuente fiable: los 3 configs reales → curación. |

### Conclusión de diseño (honesta y escalable)

No tratamos dos datos distintos como uno solo. Arquitectura en **dos capas por nivel de dinamismo**:

1. **Reglas: vivas en el server** — leemos el runtime instalado y servimos el catálogo por API. Se acaban los snapshots congelados del 0.7.4; al subir sentinel el catalogo cambia solo.
2. **Esquemas de config: contratos versionados** — el esquema sigue siendo la adaptación (capa de curación tipada) porque el runtime no lo expone en runtime. Lo que SÍ hacemos escalable es: una **fuente canónica versionada** (el `.d.ts` del runtime), un **generador** que la sincroniza contra la curación, un **registro de proveedores** por herramienta que cambia de fuente sin tocar el editor, y **detección de desalineación** (versión runtime vs versión del esquema) que avisa cuando hay que regenerar.

```
                    ┌──────────────────────────────────────────────┐
  herramientas      │  proveedor sentinel   proveedor varsense      │
  del gate          │  ─────────────────────────────────────       │
                    │  · localiza runtime (AppData/versions/<M>)    │
                    │  · reglas  : REGISTRO/obtenerTodasLasReglas   │
                    │  · esquema : cura tipado + generador .d.ts    │
                    └──────────────────────────────────────────────┘
                                      │  getReglas() · getEsquema()
                                      ▼
                     ┌──────────────────────────────────────────────┐
  capa compartida    │  ProveedorGate<Tipo>  (interfaz única)        │
  (shared/gate)      │  · cache por versión · fallback estático      │
                     │  · detección de desalineación                │
                     └──────────────────────────────────────────────┘
                                      │
                     ┌─────────────────────────┬────────────────────┐
                     ▼                         ▼                    ▼
              server (scanner)          API /gate/dinamico     editor (cliente)
              diag + consola            sirve reglas vivas     consume por API
```

## 2. Principios de escalabilidad (lo que guía cada decisión)

- **Sin hardcode de datos en el editor ni en la UI.** El editor descubre qué mostrar desde lo que le llega (reglas del proveedor, esquema del proveedor). Agregar un esquema/proveedor NO toca el componente.
- **Despacho por fuente, no por if/else en el editor.** `eficazDe`/`diagnosticar` ya despachan por forma del nodo; agregamos una forma (p. ej. proveedor) o mejor: el nodo **ya resuelto** por el server, para que el cliente sea tonto (ver §5, movemos la resolución server-side).
- **Cache con invalidación por versión**, no cron ni escaneo pesado en cada request. La resolución de runtime es barata con `readdir` de `versions/` + lectura de `REGISTRO`, pero hay que cachear el parseo del módulo JS (import pesado) y re-validar solo cuando cambia la versión o el mtime.
- **Fallback tolerante a fallos.** Si el runtime no está instalado, la versión cambió y no hay esquema emparejado, o el import del módulo falla → el proveedor cae al dato estático embebido y lo **reporta** (observación en consola, no excepción). Nunca romper el árbol por ausencia de runtime.
- **Una fuente de verdad por versión.** `sentinel.lock.json`/versión fijada → ruta concreta `versions/<v>/out`. El proveedor deriva qué versión usar de la misma regla que hoy (la versión fijada); si hay varias, usa la más alta estable y avisa.

## 3. Reglas vivas (fase R1) — el 80% del valor

**Proveedor `sentinel-ruleRegistry`** (nuevo, server-side):

- `scripts`/`src/gate/proveedor.ts` (o `src/server/gate/`):
  - `localizarRuntime()`: `readdir` de `AppData/Local/GlorySentinel/versions/*` → elige versión (fijada / más alta estable).
  - `cargarCatalogo(runtime)`: importa dinámicamente `out/config/ruleRegistry.js`, llama `obtenerTodasLasReglas()` + `obtenerIdsReglas()`, y extrae el default de `habilitada` (ya lo hicimos a mano; esto lo automatiza). Devuelve `ReglaCatalogo[]` con `id/nombre/categoria/severidad/habilitada`.
  - Cache: `Map<version, { escaneadoEn, catalogo }>` + revalidación por mtime del `ruleRegistry.js`.
  - Fallback: si algo falla → `REGLAS` estático embebido (el del 0.7.4) y `fuente: 'estatica'`.

**API nueva** `GET /api/gate/reglas` → `{ version, fuente, categorias, reglas }`.

**Editor**: `SeccionReglas` consume las reglas desde el store (ya se le pasan), no importa el array estático. Cambiarlo para que `useWorkspace` haga fetch de `/api/gate/reglas` una vez (cache en el store). Si el fetch falla, usa el estático embebido como ya hoy.

### Cuándo deja de doler
- Subida de sentinel a 0.8 con 2 reglas nuevas → aparecen solas en los tabs.
- Una regla desactivada por defecto nueva → aparece apagada sola.
- Queda documentada la regla de negocio: el *snapshot* deja de ser fuente, el *runtime* lo es.

## 4. Esquema versionado (fase E1) — el esquema NO se deriva en runtime

Como el runtime no expone schema en runtime, escalamos la **curation** con contratos:

1. **Registro de proveedores `src/shared/gate/proveedores.ts`**: `Map<string, ProveedorGate>` con `sentinel` y `varsense`. Interfaz única:
   ```ts
   interface ProveedorGate {
     tipo: 'sentinel' | 'varsense';
     esquema(): NodoEsquema;
     versionReferencia(): string;          // versión del runtime contra el que se curó
     runtimeInstalado(): string | null;    // versión real detectada
     reglas(): ReglaCatalogo[];            // vivas o estáticas según proveedor
   }
   ```
   El editor **despacha por proveedor**, no sabe de JSON/schemas internos.

2. **Generador de sincronización `scripts/sync-gate-schema.mjs`**: cuando sube la versión de sentinel, lee el `config.d.ts` del nuevo runtime y **compara** contra la curación actual en `sentinel.ts` (claves/objetos que difieren). Emite un reporte de desalineación (`FALTAN: x · SOBRAN: y · CAMBIO: z`) y, con `--aplicar`, reescribe el esquema de forma determinista a partir del `.d.ts`. El `.d.ts` es chico (45 líneas) y estable → factible y acotado.

3. **Detección de desalineación en el server**: el snapshot ya conoce la versión fijada del runtime (de `sentinel.lock.json` o `doctor`). El proveedor compara `versionReferencia()` vs `runtimeInstalado()`. Si difieren → **observación en la consola** (`esquema sentinel: curado contra 0.7.4, runtime 0.8.0 — ejecutar sync-gate-schema`), no un error que rompa nada.

4. **Varsense**: sin runtime, su proveedor es 100% curación + `versionReferencia: '—'`. Cuando aparezca un binario/schema real, solo se implementa su método `reglas()`/reesquema: el editor no cambia.

## 5. "Dinámico todo" sin romper SOLID ni el alcance sin tocar

Movimiento clave para escalar esta capa: **la resolución del esquema pasa al server y el cliente consume JSON por API.**

Hoy `diagnosticarGate` (server) y `EditorEsquema` (cliente) importan el MISMO `shared/gate/*`. Para que el esquema sea versionable y dinámico sin recompilar el cliente en cada cambio:

- **Nueva API** `GET /api/gate/dinamico?clave=…&tool=sentinel` → devuelve `{ version, fuente, esquema: NodoEsquema (serializable), reglas }`.
- **diagnosticarGate** se mantiene server-side (ya es), pero resuelve `esquema` desde el proveedor (no import estático).
- **Editor**: `PanelConfig` carga el esquema+reglas de esa API (una fetch al abrir), en lugar de importar `ESQUEMA_SENTINEL`/`ESQUEMA_VARSENSE` estáticos. El nodo que llega es serializable (puro data: tipos/campos/necesidad → válido como `NodoEsquema` porque esa unión es data pura). El diagnóstico del server y el del editor siguen usando la MISMA `diagnosticar()` del módulo compartido contra el MISMO esquema.

Esto cumple "todo dinámico" dentro de lo que el runtime permite: **reglas 100% vivas; esquemas servidos y versionados por el server** (dejan de estar fijos en el bundle del cliente). Cuando el runtime gane un schema declarativo, solo cambia el proveedor de `sentinel`, ninguna otra capa.

## 6. Decisiones ya tomadas (§7 del contexto) que se respetan

- Diseño plano: una fila por opción, switch/input/tags, fuente 11px, **sin :hover**.
- Reglas curadas + ids libres editables: el editor sigue permitiendo ids fuera del catálogo (tab "Desconocidas"), aunque ahora vengan del runtime.
- Varsense/quality-tools solo-editables-via-esquema cuando haya fuente canónica fiable; VRs quedan en texto de estado hasta que aparezca runtime.
- Guardado controlado (`setRuta` sigue controlando escribir sobre el JSON real), validando antes de escribir y preservando claves desconocidas.
- **No inventar opciones/reglas**: todo sale del proveedor (runtime) o del `.d.ts`/configs reales vía generador.

## 7. Fases de implementación (orden)

| Fase | Qué | Entrega verificable |
|---|---|---|
| **R1** | Proveedor de reglas vivas + API `/gate/reglas` + editor consume por fetch | type-check; preview muestra 105 con severidad/habilitada reales; subir el `.json` de un proyecto NO debe dejar el `sentinel.config.json` de Glory-Laminal modificado |
| **R2** | Cache por versión/mtime + fallback estático + observación en consola si falla | Matar runtime → editor cae a estático sin romper; console muestra "fuente estática" |
| **E1** | `proveedores.ts` + API `/gate/dinamico` + `PanelConfig` consume esquema por fetch | type-check; preview: config de Glory-Laminal y varsense de RESTAURANTE idénticos a hoy pero servidos por API |
| **E2** | `sync-gate-schema.mjs` generador + detección de desalineación | Script compara `.d.ts` 0.7.4 vs curación → 0 difs; cambiar versión → reporte claro |
| **E3** | Proveedor varsense "curación pura" + doc de cómo añadir un proveedor nuevo | README/AGENTS.md corto: "para añadir herramienta: implementar ProveedorGate y registrarla" |

## 8. Alcance / no alcance (para que no se desborde)

- **Sí:** reglas vivas, server como dueño del esquema/reglas, registro de proveedores, generador de sincronización, detección de desalineación, fallback.
- **No:** parser de TypeScript genérico (el generador solo lee `config.d.ts` de sentinel, que es un archivo conocido y chico); búsqueda por texto de reglas (futuro); cambios al motor `diagnosticar` (ya despacha por forma).
- **No deja:** ningún `*.json` real modificado; el editor sigue escribiendo vía `setRuta` validando.

## 9. Verificación

- `pnpm type-check` en cada fase.
- Preview: reglas vivas (versión + fuente en cabecera), esquema servido por API, varsense de RESTAURANTE y sentinel de Glory-Laminal se ven como hoy.
- Fallback: simular runtime ausente → editor usa estático sin crash, consola/tarjeta avisa.
- Desalineación: al cambiar la versión fijada, la consola observa "regenerar esquema".
- `sentinel.config.json` de Glory-Laminal y `varsense.config.json` de RESTAURANTE intactos tras cada prueba (`git status` de esos repos vacío).