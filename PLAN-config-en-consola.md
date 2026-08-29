# PLAN — Errores/advertencias de la config (sentinel/varsense) en la consola

> Feature del front v2 de **workspace-manager**. Extiende el editor por esquema (P0–P1 ya
> hechas, `EditorEsquema` + `schemas/`) para que el **diagnóstico de la config del gate**
> (opciones faltantes, valor con tipo incorrecto, clave desconocida) **se reporte también en la
> consola de problemas del panel inferior**, con severidad (error / advertencia / silencio).
>
> Fecha: 2026-08-29 · Estado: **propuesto** · Stack: TypeScript (server node + cliente React, pnpm)

---

## 1. Problema

Hoy el diagnóstico por opción existe **solo dentro del editor** (`EditorEsquema` + `diagnosticar`
de `src/v2/schemas/types.ts`): una opción faltante, mal tipada o con typo se marca en la UI del
detalle. Pero la **consola** del panel inferior (que es donde el usuario mira los problemas del
workspace agrupados por proyecto) **no ve nada** de eso:

- La consola se alimenta del **snapshot** (server) vía `problemasDe(p)` en `PanelConsola.tsx`,
  que solo usa campos derivados (`esGit`, `git.remoto/ahead`, `gate.declarado/sentinel/varsense`).
- El server (`estadoGate` en `scanner/gate.ts`) **solo comprueba existencia** de los archivos
  `sentinel.config.json` / `varsense.config.json`; **no lee su contenido**.
- El `diagnosticar` y los esquemas (`sentinelConfig.ts`, `reglas.ts`) están en `src/v2/` (cliente)
  y **no son importables** desde `src/server/` por estar escritos para React.

Resultado: el usuario tiene que abrir proyecto por proyecto y mirar el editor para enterarse de
que un agente omitió `project.primaryBranch`, escribió `excludePaterns`, o puso `includePatterns: 42`.
**Nada de eso llega a la consola.**

## 2. Objetivo

Que la consola reporte, **por proyecto**, las incoherencias de `sentinel.config.json` y
`varsense.config.json` con tres niveles de severidad:

| Severidad | Cuándo | GUI |
|---|---|---|
| **error** | opción **requerida** faltante, **o** algún valor con tipo incorrecto (malTipo, enum inválido), **o** clave desconocida (typo) | fila problema + badge, cuenta en filtro |
| **advertencia** | opción **recomendada** faltante | fila problema + badge, cuenta en filtro |
| *(silencio)* | opción **opcional / no importante** faltante | no reporta nada |

Un valor incorrecto **siempre** es `error`, sin importar si la opción era opcional (el usuario fue
explícito: "o esté mal un valor o algo → error").

## 3. Clasificación de severidad por opción (schemas)

Para saber si una opción que **falta** es error/warning/na, cada hoja del esquema necesita una
etiqueta de necesidad. Se extiende `OpcionValor` (hoy en `src/v2/schemas/types.ts`):

```ts
type Necesidad = 'requerida' | 'recomendada' | 'opcional';
interface OpcionValor {
  ...
  necesidad: Necesidad;        // nuevo (por defecto 'opcional')
}
```

El `diagnosticar` se amplía: a cada `Fila` tipo `faltante` se le adjunta la necesidad de la hoja,
y a `malTipo`/`desconocida` se les asigna severidad `error`. Queda una función pura
`severidadDe(fila): 'error' | 'advertencia' | null`.

### 3.1 `sentinel.config.json` — clasificación (en `schemas/sentinelConfig.ts`)

Tomada del `core/config.d.ts` real (v0.7.4) y del uso real en el área:

- **requeridas** (del contrato del gate, fallan si faltan): `schemaVersion`, `mode`,
  `project.primaryBranch`, `includePatterns`, `excludePatterns`, `directoryExceptions`, `rules`
  (como índice, aunque puede estar vacío).
- **recomendadas**: `runtime.minimumVersion`, `runtime.protocolVersion`, `runtime.lockFile`,
  `portableBoundaries` (y su interior: `dom/window/services/loggerModules`),
  `guard.directCommands` (con `npmScripts/npxTools/cargoSubcommands/tools`),
  `analyzers.sentinel.enabled`, `analyzers.sentinel.profile`.
- **opcionales** (no reportan): `gate.command`, `gate.taskIdRequired`, y las opciones profundas
  del `config` recursivo que no encajen en las categorías anteriores.

> Precisión de "requerida" se confirma al implementar leyendo los marcadores `?` del `.d.ts`
> (no-`?` ⇒ requerida; `?` ⇒ recomendada/opcional según contexto). No se inventan campos.

### 3.2 `varsense.config.json` — esquema curado del uso real

No hay binario/schema de varsense instalado en el sistema (verificado: no existe en
`AppData/Local`). El esquema se cura **de los 3 `varsense.config.json` reales** del área
(PROYECTO TASKS, RESTAURANTE, WANDORIUS), que son la única fuente fiable. Heurística:

- **núcleo (en los 3):** `variableFiles`, `includePatterns`, `excludePatterns`,
  `scanAllFiles`, `hardcodedDetection` (+ `enabled`/`severity`/`properties`/`allowedValues`).
- **recomendadas (en 2 de 3):** `inlineDetection`, `tokenDetection.duplicate`,
  `tokenDetection.unused`, `bannedProperties`, `orphanClassDetection` (+ `minClassLength`,
  `excludeClassPatterns`).
- **opcionales:** cualquier clave de extensión nueva no listada.

> Al implementar, leer los 3 y generalizar; el esquema cae en `schemas/varsense.ts` con misma
> forma que `sentinelConfig.ts`. Se documenta la fuente (3 configs reales) en el propio archivo.

## 4. Arquitectura (localización del diagnóstico)

El diagnóstico debe correr **en el server** (durante el escaneo) para que llegue al snapshot y a
la consola sin dependencias frágiles. Para eso:

1. **Mover la parte no-React a `src/shared/gate/`:**
   - `src/v2/schemas/types.ts` → `src/shared/gate/esquema.ts` (modelo + `diagnosticar` +
     `severidadDe` + utilidades de ruta que ya no usan React: `setRuta/borrarRuta/defaultDe` se
     quedan con el editor, ver §6).
   - `src/v2/schemas/sentinelConfig.ts` → `src/shared/gate/sentinel.ts`.
   - `src/v2/schemas/reglas.ts` → `src/shared/gate/reglas.ts`.
   - Nuevo `src/shared/gate/varsense.ts`.
   - `EditorEsquema.tsx` y `PanelConfig.tsx` pasan a importar desde `src/shared/gate/`. Los
     `schemas/` de `src/v2` se eliminan (sin duplicación).
   Esto da un único modelo compartido (mismo contrato que ya aplica `src/shared/types.ts`).

2. **Server, scanner de gate** (`scanner/gate.ts`): además de `estadoGate` (existencia), agregar
   `diagnosticarGate(ruta)` que:
   - lee `sentinel.config.json` y `varsense.config.json` (si existen) con `readFileSync` (puro,
     validado; mismo patrón que `leerSentinelLock`),
   - corre `diagnosticar(esquema, json)`,
   - filtra a `severidadDe(fila) != null`,
   - devuelve `ProblemaGate[] = { archivo, ruta, severidad, mensaje }`.

3. **Tipo compartido** en `shared/types.ts`:

   ```ts
   interface ProblemaGate { archivo: '%sentinel.config%' | '%varsense%' | ...; ruta: string; severidad: 'error' | 'advertencia'; mensaje: string }
   interface Proyecto { ...; gateProblemas?: ProblemaGate[] }   // nuevo
   ```

   El `Proyecto.gate` existente conserva su forma (no rompe el editor).

## 5. Consola (`PanelConsola.tsx`)

- `problemasDe(p)` suma, para cada `p.gateProblemas` con severidad `error` o `advertencia`,
  un motivo y un badge. Categoría nueva **`config`**:
  - `config` error cuando hay algún `error`;
  - `config` warning cuando hay warnings y cero errores.
- Filtro nuevo **`config`** en `FILTROS` (además de `todos/sinGit/sinPush/gate`).
- Badge con severidad (monocromo, coherente con la UI, **sin hover**): p. ej. `config:error`
  y `config:warn`.
- El clic en la fila sigue seleccionando el proyecto **y** abre su config (reusar `abrirMenuContextual`
  o un nuevo accessor), como ya hace para los motivos actuales.
- El detalle (qué opción y por qué) se muestra como motivo, p. ej.:
  `sentinel.config › includePatterns: valor debe ser lista de strings` (malTipo),
  `sentinel.config › excludePaterns: clave desconocida, ¿era excludePatterns?`,
  `sentinel.config › project.primaryBranch: falta (obligatorio)`.

## 6. Editor: reutilización y consistencia

- `EditorEsquema` sigue mostrando TAMBIÉN los `agregar` de opciones opcionales (para poder
  completarlas a mano) — el silencio es solo en la consola, no en el editor.
- `setRuta/borrarRuta/defaultDe` viven con el editor (React), **no** se mueven a shared (evitan
  arrastrar dependencias innecesarias al server). En shared solo van lo que el server necesita:
  modelo + `diagnosticar` + `severidadDe`.
- `PanelConfig` / `EditorEsquema` dejan de usar `schemas.ts` de `v2` y usan los de `shared`.
  La severidad de cada fila en el editor se puede pintar (borde/marca) usando la misma
  `severidadDe`, de modo que editor y consola coinciden siempre.

## 7. Decisiones abiertas (a confirmar)

1. **Semántica de severidad** (lo más importante): la frase "las opciones que son opciones serán
   advertencias, las que no son importantes y opcionales no reportan nada" se interpretó como una
   escala **requerida→error / recomendada→advertencia / opcional→silencio**. Confirmar.
2. **Mover esquemas a `src/shared`**: toca imports de `EditorEsquema`/`PanelConfig`. Alternativa:
   duplicar el diagnóstico en server (no recomendada, dos fuentes de verdad). Recomendado: mover.
3. **varsense sin binario**: el esquema se cura de los 3 configs reales (fuente de verdad = uso
   real). Si aparece un binario/schema de varsense después, se repinea a él.
4. **Qué se muestra al hacer clic** en una fila `config`: seleccionar + abrir config del proyecto
   (recomendado) o solo seleccionar.
5. **Alcance del `config` recursivo** de sentinel: ¿se diagnostica también lo profundo
   (`analyzers › sentinel › config › …`) o solo nivel raíz del proyecto? Recomendado: solo raíz en
   primera iteración (los sub-configs son archivos o ramas anidadas poco frecuentes).

## 8. Fases de implementación (orden verificable)

| Fase | Contenido | Verificable por |
|---|---|---|
| **C0 · Compartir esquemas + severidad** | mover a `src/shared/gate/`; `Necesidad` en `OpcionValor`; `severidadDe`; importar desde el editor (borrar `v2/schemas`) | `tsc --noEmit`; editor sigue abriendo `sentinel.config.json` con 14 reglas |
| **C1 · varsense esquema** | `shared/gate/varsense.ts` curado de los 3 configs reales | abrir RESTAURANTE/WANDORIUS y ver sus opciones en el editor (agregar/faltar) |
| **C2 · Server diagnostica** | `diagnosticarGate(ruta)` en `scanner/gate.ts`; `gateProblemas` en `Proyecto`; leer ambos archivos | `GET /api/escaneo`: un proyecto con `excludePaterns`/tipo mal sale con `error`; uno sin `project.primaryBranch` sale con `error`; varsense sin núcleo → error/recomendada → warning |
| **C3 · Consola** | categoría `config`, filtro, badges, motivo con detalle de la opción | ver en consola el problema del proyecto; clic abre su config |
| **C4 · Pulido** | coincidir editor↔consola por `severidadDe`; revisar perfiles; limpieza | editor marca lo mismo que la consola; `tsc --noEmit`; sin `:hover` |

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Clasificar mal una opción (requerida vs opcional) | `Necesidad` se fija por opción en el esquema y se revisa contra el `.d.ts` real y los 3 configs; barata de ajustar |
| Mover esquemas rompe el editor | Los módulos movidos son puros (sin React); solo cambian imports; `tsc --noEmit` como gate |
| varsense sin schema fiable | Esquema curado documentado con las 3 fuentes reales; si llega binario, se repinea |
| Consola ruidosa (opciones opcionales) | severidad silencio para opcional; solo se cuentan error/warning |
| Server lee mucho contenido en cada escaneo | Solo 2 archivos pequeños por proyecto; igual que ya se hace `readFileSync` de locks y git |

## 10. DoD

1. Una opción **requerida faltante** o un **valor mal tipado / enum inválido / clave desconocida**
   en `sentinel.config.json` o `varsense.config.json` **aparece como error** en la consola.
2. Una opción **recomendada faltante** aparece como **advertencia**.
3. Una opción **opcional / no importante faltante** **no reporta nada** en la consola.
4. La consola agrupa por proyecto (ya lo hace) y tiene un **filtro `config`** con conteo.
5. Un **valor incorrecto es error siempre**, incluso si la opción era opcional.
6. Editor y consola coinciden (misma `severidadDe`); el editor conserva el diseño plano
   (fila/ruta, 11px, sin `:hover`).
7. `tsc --noEmit` pasa; verificado en preview contra los archivos reales (Glory-Laminal sentinel +
   RESTAURANTE varsense), sin modificar sus `.json` (solo lectura en el scan).