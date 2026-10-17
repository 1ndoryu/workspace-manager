# PLAN — Excepciones y configuración por proyecto

> Feature del front v2 de **workspace-manager**: página de excepciones (proyectos
> ignorados) + menú contextual global por proyecto + configuración avanzada de
> sentinel/varsense por proyecto.
>
> Fecha: 2026-08-29 · Estado: **en curso (P0–P3 implementadas, P4 pendiente)** · Stack: TypeScript puro + pnpm (mismo que el proyecto)

---

## 1. Objetivo

El escáner hoy lista **todo lo que parece proyecto** del área, y meter una carpeta
no deseada a mano en el código es frágil (p. ej. `3D/01 no es un proyecto`). Queremos:

1. **Ignorar proyectos desde la UI** y ver/editarlos en una **página de excepciones**.
2. Un **menú contextual global** (clic derecho) sobre un proyecto — en la lista, en
   el mapa, en la consola — con una opción **"configurar"**.
3. **Configuración por proyecto**, con la opción de ignorar y, cuando exista, ver y
   controlar las **reglas de sentinel y varsense** (editar sus archivos de config).

## 2. Identificador de proyecto (clave)

Hoy `id` es el **nombre de carpeta** (`01`, `data`, `RESTAURANTE`). Eso **ambigüo**:
`3D/01` y un hipotético raíz `01` chocarían, y "ignorar 01" no diría cuál. Usamos la
**ruta relativa al área** como clave única con separador `/`:

- `RESTAURANTE`            → clave `RESTAURANTE`
- `TRABAJOS CLIENTES/ONG AGAPE` → clave `TRABAJOS CLIENTES/ONG AGAPE`
- `3D/01`                 → clave `3D/01`

Se deriva de `proyecto.ruta` menos `snapshot.raiz` (normalizada a `/`). Sirve para
ignorar (independiente del nombre) y para el menú contextual.

## 3. Persistencia de la configuración

Un único JSON durable en la propia área (la app ya escribe la caché ahí):

```text
<area>/data/workspace.config.json
```

```jsonc
{
  "version": 1,
  "ignorados": ["3D/01", "data"],          // claves ignoradas (no aparecen como proyectos)
  "proyectos": {
    "Glory-Laminal": { "notas": "" }        // reservado: overrides/notas por proyecto
  }
}
```

- La **leye el escáner** al inicio y **filtra** los ignorados del snapshot.
- Se **escribe** vía endpoints; re-escaneo best-effort (patrón ya usado en guardados).
- Queda fuera de git (`data/` ya está en `.gitignore` del área).

## 4. Modelo y tipos

```ts
// shared/types.ts — se agregan
interface ConfigWorkspace {
  version: number;
  ignorados: string[];                     // claves (rutas relativas)
}
// SnapshotWorkspace suma:
config: ConfigWorkspace;

// Proyecto suma una clave derivada:
clave: string;                             // ruta relativa al área, "/" separado
```

## 5. Server (endpoints)

| Endpoint | Método | Qué hace |
|---|---|---|
| `/api/config` | POST | `{ op:'ignorar'\|'quitar', clave }` → escribe `workspace.config.json` y re-escanea |
| `/api/proyecto/gate?id=<clave>` | GET | estado gate (`EstadoGate`) + contenidos de los archivos que existan (`sentinel.config.json`, `sentinel.lock.json`, `quality-tools.json`, `varsense.config.json`) |
| `/api/proyecto/gate?id=<clave>` | POST | `{ archivo, contenido }` → valida JSON y escribe uno de esos 4 archivos (whitelist, resuelto desde snapshot) |

**Seguridad** (mismo patrón que `/api/agentes` y `/api/skills`):
- La config siempre se escribe en la ruta fija `<raiz>/data/workspace.config.json`.
- Los archivos de gate se resuelven por `proyecto.ruta` + **nombre whitelist**; nunca se
  acepta un path del cliente (anti-traversal).
- Antes de escribir un archivo de gate se **parsea JSON**: si es inválido se rechaza con
  toast de error (no se rompe el gate de un proyecto).

## 6. Menú contextual global

Nuevo componente `MenúContextual` + estado en el store (zustand):

```ts
menuContextual: { x: number; y: number; clave: string } | null;
```

- Se abre con `onContextMenu` (clic derecho) en:
  - filas de **`PanelLista`** (cada `listaFila`)
  - **cajas del mapa** (`MapaV2`)
  - cabeceras de grupo de la **consola** (`PanelConsola`) — extra
- Estilos monocromo, se cierra con clic fuera / Escape / scroll.
- Ítems:
  - **Configurar** → `setPanelCentral('config')` + `setProyectoAConfigurar(clave)`.
  - **Ignorar / Dejar de ignorar** → `POST /api/config op:ignorar|quitar`, toast, re-escaneo.
- Se selecciona también el proyecto (igual que clic izquierdo).

## 7. Nueva página central "config"

Se suma a los paneles centrales del nav (`NavBar` → nueva pestaña `config`, icono lucide
`Settings`). Como `docs`, dos zonas: lista + contenido.

**7.1 Lista — "excepciones"**: los proyectos ignorados guardados. Cada fila:
- clave (`3D/01`, `data`)
- botones **quitar** (deja de ignorar → re-escanea) y **configurar**
- si una clave ya no existe en disco se marca como "no existe".

**7.2 Contenido — configuración del proyecto** (el del menú contextual o el elegido):
- **Identidad**: clave, ruta absoluta, tipo; toggle **ignorado** (ignorar / dejar de ignorar).
- **Gate** (solo si aplica): badges de estado (declarado, sentinel config/lock/none,
  varsense sí/no, puerta). Y un **editor JSON** por cada archivo de config existente
  (`sentinel.config.json`, `sentinel.lock.json`, `quality-tools.json`, `varsense.config.json`)
  con botón **guardar** (mismo patrón que el editor de documentos + toasts).

> **Definición honesta de "controlar sus reglas":** editar el JSON de source of truth
> (analyzers.sentinel.enabled, profile, include/excludePatterns, guard.directCommands…).
> Es el control real y de bajo riesgo (JSON validado). Controles estructurados (toggles
> por regla) se pueden sumar después como evolución.

## 8. Store y front

- `useWorkspace.ts`: `PanelCentral` gana `'config'`; se agregan `proyectoAConfigurar` y
  las acciones `abrirMenuContextual/cerrarMenuContextual`, `ignorarProyecto(clave, bool)`.
  La visibilidad del panel central `config` persiste en localStorage igual que `ui`.
- `mapa`/`lista`/`consola`: añadir `onContextMenu`.
- `PanelConfig`: nueva página (excepciones + config del proyecto + editor gate).
- `MenúContextual`: componente reutilizable renderizado en `AppV2`.

## 9. Fases de implementación (orden verificable)

| Fase | Contenido | Verificable por |
|---|---|---|
| **P0 · Base** | Config en `types.ts`; `leer/guardar` config; el escáner filtra ignorados; `POST /api/config` | `curl` de `/api/workspace`: ignorar `3D/01` lo saca de `proyectos`; `curl /api/config` lo refleja |
| **P1 · Menú contextual** | Store + `MenúContextual` + gancho en lista/mapa/consola | Clic derecho abre el menú en los 3 sitios y se cierra fuera |
| **P2 · Página config** | Nueva pestaña `config` en nav; lista de excepciones; toggle ignorar; panel de proyecto | Navegar a `config`, ignorar/quitar desde ahí, lista actualizada |
| **P3 · Gate por proyecto** | `GET/POST /api/proyecto/gate`; editor JSON de archivos de gate en la página config | Leer `sentinel.config.json` de `Glory-Laminal`, editar y guardar (toast); archivo escrito en disco con JSON válido |
| **P4 · Pulido** | Toasts en todos los flujos, estados vacíos, persistencia tras recarga, contraste | Recarga conserva config; `tsc --noEmit` sin errores; verificación en preview |

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Claves ambiguas (`01`) | Clave = ruta relativa; unidad única a prueba de nombres repetidos |
| Editar config JSON rompe un gate real | JSON validado antes de escribir; se rechaza con toast si es inválido |
| Config escrita en el área (fuera de workspace-manager) | Es la misma zona donde el escáner lee; ruta fija; se preserva entre arranques |
| Re-escaneo inconsistente tras ignorar | Escribir config → `forzar=1` re-escaneo → la lista/mapa reflejan al instante |
| Ignorar por error no reversible | `quitar` en la página de excepciones; la config es editable |

## 11. Definición de Done (DoD)

1. `data/workspace.config.json` se lee/alimenta correctamente; ignorar un proyecto lo saca
   de mapa/lista/consola y aparece en la página de excepciones.
2. Clic derecho en lista, mapa y consola abre el menú; "configurar" y "ignorar" funcionan.
3. La página `config` lista las excepciones y permite quitarlas; muestra la config de un
   proyecto con su gate.
4. El gate de un proyecto muestra su estado y permite editar (JSON validado) sus archivos
   de config existentes, con toast de éxito/error.
5. Toda la UI es monocroma (blanco/negro, sin radios ni sombras, Departure Mono).
6. `tsc --noEmit` pasa; verificación funcional real en preview; sin restos de depuración.
7. No toca los archivos reales de gate sin garantías: write validado y re-evaluable.