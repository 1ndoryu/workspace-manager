# PLAN — Editor de reglas de gate dirigido por esquema (no por el JSON)

> Feature del front v2 de **workspace-manager**. Reemplaza el editor de gate actual
> (`EditorJson`, que aplana **lo que ya hay** en el JSON) por un editor dirigido por un
> **esquema canónico**: muestra TODAS las opciones válidas, permite agregar las que
> faltan, y marca lo que no es válido. No depende de cómo quede construido el JSON.
>
> Fecha: 2026-08-29 · Estado: **propuesto** · Stack: TypeScript puro + pnpm (mismo que el proyecto)

---

## 1. Problema

El editor actual deriva las opciones de las **claves que existen** en el JSON (aplane
recursivo ciclando `Object.keys`). Eso tiene un fallo estructural:

Los archivos de gate (`sentinel.config.json`, `varsense.config.json`, etc.) los **construyen
los agentes** (o `sentinel init`), y los agentes **se equivocan**:

- omiten opciones que deberían estar (`portableBoundaries`, `runtime.minimumVersion`, una regla…);
- escriben claves con typos (`excludePaterns`, `primarayBranch`, `seviridad`…);
- usan el tipo incorrecto (`primaryBranch: 42`, `enabled: "si"`).

Con el enfoque actual **eso es invisible**: si la opción no está, no aparece; si está mal
escrita, aparece como una opción más "válida". No hay manera de saber qué falta ni qué está mal.

## 2. Objetivo

Un editor **dirigido por un esquema canónico** por archivo:

1. **Lista todas las opciones válidas** del archivo (conjunto cerrado + reglas dinámicas).
2. Por cada opción: si **existe** en el JSON muestra su **valor**; si **falta** muestra la
   opción "fantasma" con un botón **agregar** que la inserta con su **valor por defecto**.
3. **Valida** cada opción presente: tipo correcto, valores permitidos (enums), y marca
   **claves desconocidas** (typos) sugiriendo la clave válida más probable.
4. No depende de cómo esté construido el JSON: el universo de opciones sale del esquema,
   no del documento.

## 3. Esquema canónico (la fuente de "todas las opciones")

La fuente de verdad es el **runtime de sentinel v0.7.4** (instalado en
`C:\Users\Owner\AppData\Local\GlorySentinel\versions\0.7.4`), no una lista inventada:

### 3.1 `sentinel.config.json` — `out/core/config.d.ts` (`SentinelConfigFile`)

Extraje ya el esquema real (comento los campos):

| Ruta | Tipo | Nota |
|---|---|---|
| `schemaVersion` | `number` | |
| `mode` | `string` | |
| `project.primaryBranch` | `string` | rama de integración |
| `includePatterns` | `string[]` | |
| `excludePatterns` | `string[]` | |
| `directoryExceptions` | `string[]` | |
| `rules` | `Record<ruleId, { habilitada?: bool; severidad?: 'error'\|'warning'\|'information'\|'hint' }>` | índice por id de regla |
| `portableBoundaries` | `{ dom?: string[]; window?: string[]; services?: string[]; loggerModules?: string[] }` | |
| `gate` | `{ command?: string[]; taskIdRequired?: bool }` | |
| `guard.directCommands` | `Record<string, string[]>` | `npmScripts`, `npxTools`, `cargoSubcommands`, `tools`… |
| `runtime` | `{ minimumVersion?: string; protocolVersion?: number; lockFile?: string }` | |
| `analyzers.sentinel` | `{ enabled?: bool; profile?: string; config?: SentinelConfigFile \| string }` | `config` es **recursivo** |
| `analyzers...config` | recursión completa | los sub-analizadores pueden re-anidar el mismo esquema |

### 3.2 Reglas (índice `rules`) — `out/config/defaultRules.js`

Catálogo estático real de ids (14, extraído):
```
at-generico-php        barras-decorativas      catch-vacio
css-adhoc-button-style emoji-en-codigo         eval-prohibido
git-add-all            hardcoded-secret        inline-style-prohibido
innerhtml-variable     php-supresor-at         sqlx-query-as-sin-macro
sqlx-query-sin-macro   todo-pendiente
```
- `SeveridadRegla = 'error' | 'warning' | 'information' | 'hint'`
- `ConfigReglaUsuario = { habilitada?: boolean; severidad?: SeveridadRegla }`
- El registro efectivo se obtiene de `obtenerTodasLasReglas()` en runtime; el editor muestra
  el catálogo **completo** (aunque el id no esté en el JSON) para poder "agregar" cada regla.

### 3.3 Otros archivos

- `sentinel.lock.json`: manifest simple (`schemaVersion`, `generatedBy`, `analyzers.{nombre}.{enabled,version,commit}`).
  Es de solo lectura/regeneración; se puede ofrecer en estados (no editar a mano en P0, ver P3).
- `quality-tools.json`, `varsense.config.json`: mismo patrón; sus esquemas se fijan como conjuntos
  de opciones **curados** en `src/v2/schemas/*.ts` tomando como base la documentación/código del
  runtime. Si no hay fuente canónica fiable, se declaran esos archivos como "solo lectura en P0".

### 3.4 Representación del esquema (código)

```ts
// src/v2/schemas/types.ts
type OpcionValor = { tipo: 'string'|'number'|'boolean'|'stringArray'|'enum';
                     valores?: string[];            // para 'enum'
                     default?: ValorJson;           // valor a insertar al "agregar"
                     descripcion?: string };
type NodoEsquema = OpcionValor
  | { objeto: Record<string, NodoEsquema> }         // grupo (se aplane por ruta)
  | { mapa: NodoEsquema }                          // Record<string, T> (reglas/guard.directCommands)
  | { listaDe: NodoEsquema };                       // array de objetos

// src/v2/schemas/sentinelConfig.ts  — NodoEsquema tipado con las opciones del §3.1
// src/v2/schemas/reglas.ts          — catálogo de ids + severidad + categoria
// src/v2/schemas/lock.ts|qualityTools.ts|varsense.ts
```

No son strings sueltos en los componentes; cada archivo tipa con `NodoEsquema` (datos, no lógica).

## 4. Modelo de "estado de una opción" (diagnóstico)

Al cargar un archivo, el editor calcula por cada hoja del esquema:

```
presente (valido)      -> muestra el valor; marca ✓
presente (MAL tipo)    -> muestra el valor con badgete ⚠ tipo; sugerencia a corregir
faltante               -> fila atenuada + boton "agregar" (inserta default)
```
Y en paralelo, toda clave del JSON que **no** mapea al esquema:
```
clave desconocida      -> fila roja/atenuada "desconocida: <clave>" + sugerencia de la
                          clave esquema más cercana (distancia de edición) si hay una parecida
```

- Los typos comunes (`excludePaterns`) se detectan porque **no existen** en el esquema → salen
  marcados y con sugerencia a `excludePatterns`.
- Las opciones omitidas (p. ej. `runtime.protocolVersion`) salen como **faltantes** → agregables.

## 5. Front: de `EditorJson` a `EditorEsquema`

- Se conserva el patrón visual ya aprobado: **opciones planas, una fila por ruta** (`ruta › … › hoja`),
  fila vertical (ruta arriba / control abajo), switch/input/tags, fuente 11px, sin hover.
- Cambios:
  - La fuente de filas pasa de `Object.keys(jso)` a **recorrer `NodoEsquema`** (grupo→ruta, mapa→el
    índice real presente + las claves canónicas faltantes para el mapa, p. ej. ids de reglas).
  - Cada fila lleva un **indicador de estado** (✓ / ⚠ / +agregar / ✗ desconocida) según §4.
  - Al escribir, se sigue recorriendo el **mismo** `value` del JSON (componente controlado), para que
    el guardado preserve lo desconocido no tocado.
- Componentes de control (`ControlSimple`, `TagLista`) se reutilizan; se añade `ControlEnum` (select
  mono) para las opciones `enum` (severidad, profile) y el botón "agregar".

## 6. Server (cambios mínimos)

- Se mantienen `GET/POST /api/proyecto/gate` y la **validación JSON antes de escribir** (ya existe).
- **No** cambia el contrato de guardado.
- Opcional (no bloqueante): un endpoint `GET /api/proyecto/gate/esquema` que devuelva la versión del
  runtime y permita al front decidir qué conjunto de reglas usar. En P0 basta con los esquemas
  estáticos en `src/v2/schemas/`.

## 7. Decisiones abiertas (a confirmar antes de P3+)

1. **Reglas dinámicas**: además de las 14 estáticas hay reglas gestionadas por analizadores
   (phpAnalyzer, sqlAnalyzer…). ¿Mostramos el catálogo completo del runtime (vía `obtenerTodasLasReglas`)
   o solo la lista curadada? → Recomendación: catálogo curado + botón editables para ids libres.
2. **`config` recursivo de `analyzers…`**: el esquema real lo anida (mismo tipo en niveles). ¿Se
   mapea recursivamente (con ruta larga) o se colapsa bajo "analyzers › sentinel › config", tratando su
   interior como las opciones top ya conocidas? → Recomendación: recursivo, ruta completa.
3. **`varsense.config.json` / `quality-tools.json`**: ¿los editamos a mano (P3) u ofrecemos estados de
   solo lectura? Depende de si hay fuente canónica fiable para sus opciones. Propongo editar por
   esquema si existe, solo-lectura si no.
4. **Semántica de "agregar"**: inserta el **default del esquema** (recomendado) o una cáscara vacía.

## 8. Fases de implementación (orden verificable)

| Fase | Contenido | Verificable por |
|---|---|---|
| **P0 · Esquemas + diagnóstico** | `schemas/types.ts`, `SentinelConfigFile` (del `.d.ts` real), catálogo de reglas, función `diagnosticar(esquema, json) → {valido, malTipo, faltante, desconocido, sugerencia}` con tests unitarios | casos: typos (`excludePaterns`), tipo mal, opción omitida → salen clasificados |
| **P1 · Editor por esquema** | `EditorEsquema` (en vez de `EditorJson`) con filas por ruta, indicadores ✓/⚠/✗, botones **agregar** (inserta default) | abrir `Glory-Laminal/sentinel.config.json`: opción omitida aparece como faltante y "agregar" la inserta; typo sale marcado con sugerencia |
| **P2 · Integración en `PanelConfig`** + estados vacíos + toasts | `PanelConfig` usa `EditorEsquema`; persistencia; estilo de indicadores | guardar conserva lo bueno y corrige una opción agregada; `tsc --noEmit` |
| **P3 · Otros archivos** | `lock.ts` (estado), `qualityTools.ts`, `varsense.ts` según decisión §7.3 | abrir un proyecto con cada archivo y ver sus opciones completas |
| **P4 · Pulido y reglas dinámicas** | catálogo completo reglas, validación de severidad, edición de ids libres, limpieza | mapa de reglas muestra todas y permite agregar/quitar ids |

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Esquema incompleto/obsoleto vs runtime | Fijar versión (0.7.4); script de extracción documentado en el plan (§3); revisión al actualizar sentinel |
| Guardar una opción "agregada" rompe el gate real | Validación JSON previa (ya existe); los defaults vienen del esquema real |
| Claves desconocidas se pierden al guardar | El editor sigue controlado sobre el `value` del JSON; lo desconocido no tocado se preserva |
| Reglas dinámicas desbalanceadas | Catálogo curado + ids libres editables; método server para listar `obtenerTodasLasReglas()` como opción |
| Sobrecargar la UI con muchas opciones | Opciones planas + agrupar por ruta (ya decidido); opción "mostrar faltantes" colapsable |

## 10. Definición de Done (DoD)

1. El editor deja de depender de las claves del JSON: el universo sale de `src/v2/schemas/*.ts`.
2. Una opción **faltante** aparece atenuada con botón **agregar** que la inserta con su default.
3. Una clave **con typo** no existe en el esquema → sale como "desconocida" con sugerencia de la
   clave válida más cercana.
4. Una opción con **tipo incorrecto** sale marcada ⚠ y es corregible (select/input/tags).
5. Los indicadores ✓/⚠/✗/agregar son monocromos y coherentes con el resto de la UI (sin hover).
6. `tsc --noEmit` pasa; tests unitarios de `diagnosticar` en P0; verificación real en preview.
7. Guardar sigue validando JSON y conserva las claves desconocidas no tocadas.