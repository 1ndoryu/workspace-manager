# Plan: que TODOS los valores se vean, incluidos los por defecto aunque no estén en el JSON

> Estado: **en curso (F0–F3 implementadas)** · Autor: Buffy · Fecha: 2026-08-29
> Fuente real usada: `src/shared/gate/esquema.ts`, `src/shared/gate/sentinel.ts`,
> `src/shared/gate/varsense.ts`, `src/v2/EditorEsquema.tsx`, `src/shared/gate/etiquetas.ts`.
> Depende de: PLAN-config-en-consola.md (severidad) y PLAN-editor-reglas-por-esquema.md (editor plano).

---

## 1. Problema que ataca

Hoy, en el editor por esquema, una opción **faltante** se muestra solo como:

```
Analizadores › Sentinel › Configuración › Analizadores        + agregar
```

- No muestra **qué valor va a insertar** el botón (el default del esquema).
- El default existe en el esquema (`default`, o `defaultValorDe` por tipo), pero es invisible.
- Caso concreto del usuario: `config` (recursivo) es un grupo; aunque "falta", el esquema
  define un objeto con defaults en sus hojas. El editor solo delata la ausencia; no expone
  la foto completa de "qué pasaría si agrego esto".

**Impacto:** el usuario no puede predecir el documento resultante, ni revisar/editar un
default antes de insertarlo, ni ver de un vistazo la config completa del gate.

---

## 2. Objetivo (Definición de Done)

1. Toda opción que **falte** en el JSON muestra su **valor por defecto** de forma visible
   (no solo el botón `+ agregar`).
2. Las opciones **presentes** siguen igual (input/switch/tags con su valor real).
3. El editor permite **ver/editar el default antes de insertarlo** (p. ej. un mini-form
   en la fila o un placeholder dentro del control), sin JSON crudo.
4. Los defaults provienen **del esquema canónico**, no de una lista hardcodeada en el UI.
5. La construcción de defaults es **segura ante objetos recursivos** (`config` se anida a
   sí mismo): no reventar la pila ni generar grupos infinitos al "agregar".
6. Se mantiene el diseño plano aprobado (fila por ruta, 11px, sin `:hover`, monocromo).
7. La consola (server) y el editor (cliente) **siguen compartiendo** la misma fuente de
   verdad de `esquema.ts`; no se duplica lógica.

---

## 3. Diagnóstico del estado actual

| Archivo | Rol | Qué ya da | Qué falta |
|---|---|---|---|
| `shared/gate/esquema.ts` | NodoEsquema + `defaultValorDe` + `defaultDe` | El default por hoja y por grupo existe | `defaultDe` de un grupo recursivo devuelve `{}` (guarda de ciclos) y **no expone las hojas** para editar |
| `shared/gate/sentinel.ts` / `varsense.ts` | Esquemas canónicos | Defaults en hojas (`num`, `text`, `bool`, `enumX`) | — |
| `v2/EditorEsquema.tsx` | Editor | Rama `'faltante'` con botón `+ agregar` que inserta `fila.default` | No renderiza ni permite editar ese default |
| `v2/shared/gate/etiquetas.ts` | Traducción | Nombres/descripciones por segmento | — |

**Hallazgos de la revisión de lógica:**

- **R1 (ciclos):** `defaultDe` usa `visto` para cortar recursión y devuelve `{}` al
  reencontrar un nodo. Correcto para **insertar**, pero **inservible para revisar**: un
  grupo recursivo "falta" como `{}` silencioso. Hay que reportar qué contiene (sus hojas
  con defaults) sin caer en infinito.
- **R2 (profundidad):** `diagnosticar` corta la clasificación de *faltantes* en
  `PROFUNDIDAD_CLASIFICAR = 3` (evita ruido en la consola). Pero **el editor no debería
  ocultar opciones por profundidad**: el usuario quiere ver TODO el árbol, aunque un
  faltante profundo no genere error. Hoy `faltanteNecesidad` si eleva profundidad baja a
  'opcional'; la *fila* aún se emite (bien), pero al revisar defaults de un grupo recursivo
  profundo el árbol se siente incompleto si solo se muestra hasta cierto nivel.
- **R3 (default por hoja vs grupo):** las hojas tienen default; los grupos no "valen"
  por sí mismos — valen sus hojas. El concepto de "default de un grupo" ha de ser **expandible**,
  no un blob JSON.
- **R4 (no hardcode en UI):** el editor no debe saber qué clave es cuál. Precisa de un
  mecanismo **genérico** derivado de `NodoEsquema`.

---

## 4. Diseño propuesto (genérico, sin hardcode)

### 4.1 Núcleo en `shared/gate/esquema.ts` — "resolver el default expandible"

Añadir a `NodoEsquema` la capacidad de producir, para una opción faltante, no un valor
crudo sino una **configuración efectiva a nivel de hoja**:

```
eficazDe(nodo, ruta): FilaDefault
```

- Para una **hoja** (`OpcionValor`): un `default` simple (ya existe).
- Para un **objeto**: la lista de sus hijos (cada uno con su propia ruta y default), sin
  aplanar ciclos infinitos. Se marca el nodo que cerraría el ciclo con `… (recursivo)`.
- Para un **mapa/mapaCatalogo**: los ids del catálogo que faltan, cada uno con su default;
  sin inventar claves.
- Para un **listaDe**: un item `[]` (no se expande).

Esto reutiliza `Object.keys(nodo.objeto)` y el catálogo ya declarado en el esquema — **sin
hardcode de claves en el UI**.

### 4.2 Render de una fila faltante en `EditorEsquema.tsx`

La fila `faltante` pasa de "solo botón" a:

```
Analizadores › Sentinel › Configuración › Analizadores   [+]  (se insertará …)
```

1. Un botón **`+ agregar`** (inserta el default, como hoy) → `fila.default`.
2. Bajo la etiqueta, un desplegable **"ver default"** que expande un **mini-form genérico**
   usando el mismo `Control`/`TagLista`/`ControlEnum` que ya renderiza las opciones presentes.
   Así el usuario **ve y edita** el default antes/después de agregar, sin JSON crudo.
3. En objetos recursivos, el mini-form muestra las **hojas alcanzables** con su default y
   marca `… (recursivo)` en el nodo que se repite, en vez de aplanar al infinito.

### 4.3 Persistencia de "agregar"

- `+ agregar` inserta el **default expandido y editado** en la ruta, usando `setRuta`
  (controlado, preservando claves desconocidas no tocadas) — ya implementado.
- El default por hoja viene de `defaultValorDe`; el de grupos de `eficazDe`. **Nada nuevo
  en el server**: el guardado actual (POST config) no cambia.

---

## 5. Fases de implementación

- **F0 (núcleo):** implementar `eficazDe` en `shared/gate/esquema.ts` con guarda de
  ciclos y sin cambiar la firma de `diagnosticar`. Añadir tipos `DefaultExpandido`.
- **F1 (componente):** en `EditorEsquema.tsx`, la rama `'faltante'` reusa `Control` para
  un mini-form colapsable "ver default". Sin hardcode; recibe un `NodoEsquema` por fila
  (habrá que enriquecer `Fila` de tipo `faltante` con el nodo, no solo `default`).
- **F2 (recursión visible):** en el mini-form de un objeto recursivo, marcar `… (recursivo)`
  en el nodo que cierra el ciclo; listar hojas del primer nivel. Verificar con `sentinel.config.json`.
- **F3 (editar antes de agregar):** estado local en la fila para editar el default y luego
  insertarlo; `setRuta` mantiene control. Botón único de guardado (reutiliza el actual).
- **F4 (verificación):** `pnpm type-check`, revisar en preview contra `sentinel.config.json`
  de Glory-Laminal y `varsense.config.json` de RESTAURANTE. **No dejar `.json` modificados**
  (los tests de insertar en estado del navegador, no a disco).

---

## 6. Revisión de SOLID, evitar hardcode y escalabilidad

### 6.1 SOLID (punto por punto)

- **S — Single Responsibility:** `esquema.ts` conoce el árbol de opciones y su default
  (`eficazDe`). `EditorEsquema.tsx` solo *renderiza* `NodoEsquema`/`Fila`. Etiquetas viven
  aparte (`etiquetas.ts`). Separación ya correcta; F0/ F1 la mantienen.
- **O — Open/Closed:** añadir un nuevo esquema (php, sql…) o un nuevo tipo de hoja no
  debe tocar el editor ni `diagnosticar`; solo declarar el nodo en el esquema. `eficazDe`
  despacha por la *forma* del nodo (`tipo`/`objeto`/`mapa`/`mapaCatalogo`/`listaDe`), así
  un nodo nuevo se soporta sin retocar el render.
- **L — Liskov:** `NodoEsquema` y sus variantes deben comportarse igual frente a
  `diagnosticar`/`eficazDe`/`setRuta`. Cuidado (R3): el `default` de una *hoja* es un valor;
  el de un *objeto* ha de ser una lista expandible. No mezclar ambos conceptos en un mismo
  tipo para no violar L.
- **I — Interface Segregation:** `Fila` (faltante) hoy lleva `default` pero no el `nodo`.
  Si el render necesita el árbol para el mini-form, añadir solo lo necesario a ese variante
  (`nodo: NodoEsquema`), no inflar la interfaz `Fila` completa. Mantener `Fila` como unión
  discriminada (ya lo es) y no fundir variantes.
- **D — Dependency Inversion:** `EditorEsquema` depende de la abstracción `NodoEsquema`,
  no de `ESQUEMA_SENTINEL` concreto (ya inyectado vía prop `esquema`). `sentinel.ts`/`varsense.ts`
  son dependencias `seleccionadas` por `PanelConfig`; el editor no las conoce. Mantener.

### 6.2 Evitar hardcode

- El catálogo de claves del mini-form sale de `Object.keys(nodo.objeto)` o del `catalogo`
  de un `mapaCatalogo` — **no hay lista fija en el UI**.
- Las traducciones viven en el diccionario `at-generico-php …`/segmentos; el editor solo
  usa `nombreDeRuta`/`rutaDetalle` con fallback al segmento técnico.
- No se duplica `PROFUNDIDAD_CLASIFICAR` como constante suelta: si se ajusta, se cambia en
  `esquema.ts` y consola/editor la leen de ahí.

### 6.3 Escalabilidad

- **Docena de esquemas:** `PanelConfig` ya selecciona esquema por archivo; `eficazDe` no
  depende del archivo, así nuevos gates no requieren cambios en `EditorEsquema`.
- **Árboles profundos/recursivos:** la guarda de ciclos de `eficazDe` evita aplanar al
  infinito; el render colapsa por defecto y expande bajo demanda (lazy) para no montar
  miles de nodos a la vez.
- **Consola → editor:** por ahora 1:1 (click en consola abre editor). Si más adelante se
  quiere vincular fila/opción, `Fila` lleva `ruta` ya; añadir un `onsaltar(ruta)` en el
  render es aditivo (O).
- **Rendimiento:** `diagnosticar` se llama por render; si un esquema crece mucho, memoizar
  `filas` por `[esquema, value]` (useMemo). Opcional en F4 si el preview muestra lentitud.

---

## 7. Decisiones abiertas (se marcan, no se implementan sin confirmar)

- **D1 — ¿Expandir default por defecto o bajo demanda?** Recomendado: **colapsado por
  defecto** (la fila muestra un botón "ver default"), para no ensuciar la pantalla con
  cientos de filas. Si prefieres todo visible siempre, se cambia el estado inicial en F1.
- **D2 — Edición del default antes de insertar:** recomiendo permitir **editar** en el
  mini-form y que `+ agregar` inserte lo editado. Alternativa: ver solo lectura. Preguntar
  solo si no te gusta el flujo live-edit.
- **D3 — Objetos recursivos (`config`):** mostrar las **hojas del primer nivel** con su
  default y marcar `… (recursivo)`. Si quieres un árbol expandible a N niveles con tope,
  es más código y más probable que rompa; no lo recomiendo como v1.
- **D4 — Alcance del mini-form:** aplicar solo a la fila `faltante` (minimal). No tocar
  el render de opciones presentes, que ya funciona.

---

## 8. Verificación

- `pnpm type-check` (tsc --noEmit) sin errores.
- Preview contra `sentinel.config.json` de Glory-Laminal: una fila faltante muestra su
  default expandible y `+ agregar` la inserta con ese valor; nodos recursivos muestran
  `… (recursivo)`.
- Preview contra `varsense.config.json` de RESTAURANTE: el editor sigue sin romperse.
- Los `.json` reales quedan sin modificar tras las pruebas (insertar solo en estado del navegador).
- Los 3 archivos `PLAN-*.md` quedan referenciados en el roadmap; nada hardcodeado en el UI.