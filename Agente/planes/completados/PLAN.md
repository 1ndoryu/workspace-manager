# PLAN — workspace-manager

> Gestor del área de trabajo: control de proyectos, estado Git/Sentinel/VarSense/roadmap,
> mapa isométrico de la estructura y gestión de AGENTS.md y skills.
>
> Fecha: 2026-08-28 · Estado: **activo** · Stack: TypeScript puro + pnpm

---

## 1. Objetivo

Una herramienta **rápida, eficiente y sencilla** para gestionar todo lo que hay en
`C:\Users\Owner\OneDrive\Documentos\area-trabajo`:

- Saber **qué proyectos existen** y su **estado real** (Git, Sentinel, VarSense, roadmap, pendientes).
- Visualizar la estructura del área de trabajo con un **mapa isométrico minimalista**.
- Gestionar **AGENTS.md** (global y por proyecto) y las **skills globales** (`~/.agents/skills`).
- **Full TypeScript**: un solo lenguaje, sin servidores pesados, sin framework de más.

## 2. Decisiones de arquitectura

| Decisión | Elección | Por qué |
|---|---|---|
| Lenguaje | **TypeScript puro (Node 24 + ESM)** | Full TS de punta a punta, rápido de arrancar, sin compilador extra |
| Runtime | **Node 24** (ya instalado, v24.13.0) | Coherente con DEEPSEEK-HARNESS (`engines.node ^22.19 \|\| >=24`) |
| Package manager | **pnpm 11** (ya instalado) | Es el estándar de la casa en proyectos TS |
| Frontend | **Vite + React + TS** (mismo stack que `PROYECTO TASKS/frontend`) | Dev server instantáneo, HMR, build estático desplegable |
| Tipografía | **Departure Mono** (self-hosted, copiada de `task`) | Fuente monoespaciada única, igual que el proyecto task |
| Vistas | **SVG renderizado en React** (mapa isométrico con transform 3D→2D) | Sin dependencia de librería de mapas: ligero, control total, minimalista |
| Lector de estado | **Escaneo del sistema de archivos + `git` CLI** (no libgit2) | Sin binarios nativos, funciona en cualquier entorno, cero deps pesadas |
| Persistencia | **Caché JSON en `data/`** con re-escaneo incremental | Arranque instantáneo + datos frescos on-demand |
| Gate | **Sentinel/VarSense del área** (mismo patrón que los demás repos) | Integración con el flujo existente |
| Backend HTTP | **Node `http` nativo o Express mínimo** dentro de Vite | API JSON mínima para el estado; sin framework de más |

> **Principio**: sin base de datos, sin Docker, sin binarios compilados, sin monorepo
> innecesario. Un proceso Node sirve API + estático. Todo lo demás son lecturas del
> filesystem y de `git`.

## 3. Estructura de carpetas del proyecto

```text
area-trabajo/workspace-manager/
├── AGENTS.md                      # reglas locales (gate, rama, wrappers)
├── PLAN.md                        # este documento
├── roadmap.md                     # trabajo abierto del propio proyecto
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── src/                           # FULL TS
│   ├── server/
│   │   ├── index.ts               # servidor HTTP: sirve API + build estático
│   │   ├── scanner/
│   │   │   ├── workspace.ts       # detecta proyectos (git / no-git, worktrees)
│   │   │   ├── git.ts             # rama, remoto, dirty, ahead/behind, submodules
│   │   │   ├── gate.ts            # sentinel.lock / quality-tools / varsense / doctor
│   │   │   ├── roadmap.ts         # parsea roadmap.md (pendientes, IDs)
│   │   │   └── agents.ts          # lee AGENTS.md y skills globales
│   │   ├── cache.ts               # caché JSON + incremental
│   │   └── routes.ts              # endpoints REST
│   ├── client/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── IsoMap/            # mapa isométrico SVG
│   │   │   │   ├── IsoMap.tsx
│   │   │   │   ├── tiles.ts       # proyección isométrica (x,y) → (screen)
│   │   │   │   └── ProjectNode.tsx
│   │   │   ├── ProjectList/       # tabla de proyectos + estado
│   │   │   ├── ProjectDetail/     # detalle: git, gate, roadmap, pendientes
│   │   │   ├── RoadmapView/
│   │   │   ├── AgentsManager/     # AGENTS.md por proyecto + skills globales
│   │   │   └── ui/                # componentes atómicos del sistema de diseño
│   │   ├── hooks/
│   │   │   ├── useWorkspace.ts    # estado global del workspace (zustand)
│   │   │   ├── useProjects.ts
│   │   │   └── usePolling.ts      # refresco periódico del estado
│   │   └── styles/
│   │       ├── variables.css      # tokens de diseño (colores, tamaños)
│   │       └── app.css
│   └── shared/
│       └── types.ts               # tipos comunes (Proyecto, EstadoGit, EstadoGate…)
└── data/                          # caché generada (gitignore)
```

## 4. Modelo de datos (núcleo)

```ts
// src/shared/types.ts (esquema conceptual)
type Proyecto = {
  id: string;                  // nombre de carpeta normalizado
  ruta: string;                // ruta absoluta
  esGit: boolean;
  tipo: 'repo' | 'worktree' | 'carpeta' | 'submodulo-padre';
  git?: EstadoGit;
  gate?: EstadoGate;
  roadmap?: ResumenRoadmap;
  agents?: ResumenAgents;
};

type EstadoGit = {
  rama: string;                // rama actual (o 'DETACHED')
  remoto: string | null;       // origin URL
  ramaPrimaria: string;        // la que declare el proyecto (no asumir 'main')
  dirty: boolean;              // árbol con cambios sin commit
  ahead: number; behind: number;
  submódulos: string[];        // glory-rs, tools/sentinel, tools/varsense…
  ultimoCommit: { hash: string; fecha: string; mensaje: string };
};

type EstadoGate = {
  declarado: boolean;          // sentinel.lock.json / quality-tools.json presentes
  sentinel: 'config' | 'lock' | 'none';
  varsense: boolean;           // varsense.config.json presente
  doctor?: string;             // salida resumida de `sentinel doctor`
  gateDisponible: boolean;     // readyForGate aproximado
  puerta: 'sentinel' | 'cargo' | 'none';  // GLORYPORT usa cargo fmt/clippy/test
};

type ResumenRoadmap = {
  pendientes: number;
  activos: number;
  ids: string[];               // IDs de tareas abiertas (esquema del proyecto)
  resumen: string;
};

type ResumenAgents = {
  tieneAgentsMd: boolean;
  reglas: string[];            // nombres de reglas
  skills: string[];            // skills referenciadas
};
```

## 5. Escáner de workspace (comportamiento clave)

- **Detección de proyectos**: carpetas de primer nivel. Es Git si existe `.git`
  (carpeta **o archivo**, porque `RESTAURANTE` es un worktree cuyo `.git` es un archivo
  que apunta a `WANDORIUS/.git/worktrees/...`).
- **Worktrees**: si `.git` es un archivo, se marca `tipo: 'worktree'` y se resuelve el
  repo padre para no duplicar estado.
- **Recursividad controlada**: en `TRABAJOS CLIENTES/` se baja un nivel (contiene
  `ONG AGAPE` que sí es repo). El resto de carpetas no-git se listan como `carpeta`.
- **Estados que NO se asumen**: la rama primaria se lee de la config del proyecto
  (`AGENTS.md` / `sentinel.config.json`), nunca se infiere `main`.
- **Submódulos**: se detectan vía `.gitmodules` y se reportan como estado, no se
  escanean como proyectos independientes.
- **Ignorados**: `.archivado/`, `.freebuff/`, `node_modules`, `C:\tmp`, `.sentinel/worktrees`.

## 6. Interfaz minimalista (vistas)

### 6.1 Mapa isométrico (pantalla principal)
- **Proyección isométrica propia** (SVG): cada proyecto es un tile/volumen en una
  cuadrícula con efecto 3D (2:1). Se dibuja con `<polygon>` y transform CSS/SVG.
- Color por **estado**: 🟢 limpio · 🟡 dirty/ahead · 🔴 gate rojo o errores · ⚪ no-git/carpeta.
- Click en un tile → detalle del proyecto. Hover → tooltip con rama y dirty.
- Zoom/pan ligero (wheel + drag) dentro del contenedor SVG.

### 6.2 Lista de proyectos
- Tabla compacta: nombre · tipo · rama · dirty · ahead/behind · gate · roadmap (nº pendientes).
- Filtros por estado y búsqueda. Orden por prioridad de trabajo.

### 6.3 Detalle de proyecto
- Pestañas: **Git** (rama, remoto, ahead/behind, últimos commits, submódulos) ·
  **Gate** (sentinel/varsense/cargo, doctor) · **Roadmap** (pendientes parseados con IDs) ·
  **AGENTS.md** (reglas activas).

### 6.4 Gestión de AGENTS.md y skills
- Vista **AGENTS.md**: lista todos los `AGENTS.md` del área (global + por proyecto),
  con estado (existe / falta), y editor en modo lectura del contenido.
- Vista **Skills**: lista las skills globales de `~/.agents/skills` con su descripción
  y estado de uso; permite abrirlas/leerlas (edición vía VS Code).

## 7. Fases de implementación

| Fase | Contenido | Verificable por |
|---|---|---|
| **F0 · Bootstrap** | Carpeta + `package.json` + `tsconfig` + `vite` + `pnpm install` | `pnpm dev` arranca |
| **F1 · Escáner** | `workspace.ts` + `git.ts` + `cache.ts` + tests del scanner | Tests + JSON de salida correcto con los 13 repos reales |
| **F2 · API** | `routes.ts` + `server/index.ts` sirviendo `/api/*` + estático | `curl /api/workspace` devuelve datos reales |
| **F3 · Mapa isométrico** | Proyección isométrica + `IsoMap` + tiles por estado | Mapa renderizado en navegador con los proyectos |
| **F4 · Vistas** | Lista, detalle, roadmap parseado | Navegación completa entre vistas |
| **F5 · Gate + Agents** | `gate.ts` (sentinel doctor ligero), `agents.ts`, gestión AGENTS.md/skills | Estado de gate por proyecto + editor AGENTS |
| **F6 · Pulido** | Polling, caché, estados vacíos/error, responsive, contraste | Revisión visual final + gate del proyecto |

## 8. Pruebas y verificación

- **Scanner**: tests de unidad con fixtures (repo normal, worktree `.git`-archivo,
  carpeta no-git, submódulos). Caso positivo + negativo.
- **API**: smoke test de endpoints con datos reales.
- **Frontend**: `tsc --noEmit`; pruebas de los hooks de parseo (roadmap, gate) si aplican.
- **Verificación real**: abrir el navegador, comprobar mapa + detalle + filtros
  (según AGENTS.md global: "valida el comportamiento real, no solo que compile").
- **Suite pesada**: solo al cierre, con objetivo concreto (regla `no-heavy-suites`).

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `git` CLI lenta en muchos repos | Caché JSON incremental + re-escaneo por proyecto y por demanda |
| Worktrees (`.git` archivo) mal detectados | Tratamiento explícito en el scanner con tests de fixture |
| `sentinel doctor` costoso por proyecto | Ejecutar bajo demanda (detalle), no en el escaneo inicial; resumir salida |
| Rama primaria distinta de `main` | Leerla de `AGENTS.md`/`sentinel.config.json`, nunca asumirla |
| Mapa isométrico recargado | SVG propio, sin librería; proyección 2:1 en `tiles.ts` testeada |
| Carpetas no-git como `3D`, `DOCS` | Se listan como `carpeta`, ignorables desde la UI |

## 10. Definición de Done (DoD)

1. `pnpm dev` levanta servidor + UI sin errores.
2. El escáner detecta los 13 repos reales + worktrees + submódulos correctamente (tests).
3. El mapa isométrico renderiza los proyectos con color por estado.
4. Las vistas de lista, detalle, roadmap y gate muestran datos reales del workspace.
5. La gestión de AGENTS.md y skills globales funciona (leer + abrir).
6. Caché funciona: segundo arranque instantáneo con datos del último escaneo.
7. Gate del proyecto (Sentinel/VarSense) pasa al cerrar, con evidencia reproducible.
8. Roadmap del proyecto actualizado y tarea registrada en `Agente/completados/`.
