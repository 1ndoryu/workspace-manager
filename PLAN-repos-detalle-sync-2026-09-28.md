> Pedido del usuario: en repos, ver los cambios que se van a subir (y traer),
> todo compacto, que se minimice/maximice, con UN SOLO repositorio maximizado
> a la vez. Plan visual fácil de entender: archivos, commits, cambios por traer.

## 1. Diseño visual (una sola cosa maximizada)

```text
repos (12) · 9 con remoto · 3 con push pendiente        [⟳ recargar]
────────────────────────────────────────────────────────
  coolify-manager-rs   main   ↑2 ↓0   ~3        [github]   ← fila 1 línea
┌ workspace-manager    main   ↑25 ↓0  ~4        [github] ┐ ← clic: SE ABRE,
│  ▲ POR SUBIR (25) · 25 commits · 14 archivos +1.204 −88│   el resto sigue
│    27ccd68  28-09  289A-4+289A-5: cierre HECHO…        │   en 1 línea
│    60150a8  …      …                        [+22 más]  │
│  ▼ POR TRAER — al día ✓                               │
│  ▼ SIN COMMITEAR (4) · +12 −3                         │
│      M  roadmap.md                                    │
│      M  PLAN-…md                                      │
└───────────────────────────────────────────────────────┘
  gloryapi             main    ·      limpio             [github]
```

- **Acordeón estricto:** una sola `expandida: string | null`. Clic en otra fila
  cambia el foco; clic en la abierta la cierra. Nunca dos maximizados.
- **3 secciones plegables dentro del detalle** (estado local, default abierto
  solo si tiene contenido): `▲ POR SUBIR`, `POR TRAER`, `SIN COMMITEAR`.
  Cada cabecera resume en 1 línea (conteos + stat) para no abrir a ciegas.
- **Listas acotadas:** commits máx 25 visibles + `+N más`; archivos máx 100 +
  `+N más`. Nada de scroll infinito dentro del detalle.
- **Carga bajo demanda:** el detalle se pide solo al abrir (`GET
  /api/repos/detalle?clave=`), con estado `cargando…` y caché por clave en
  memoria del componente (re-pide tras `⟳ recargar` del snapshot).
- **Identidad v2:** monocromo, tokens `--v2-*`, sin color literal; `↑↓~`
  texto (los símbolos ya existen en la fila).

## 2. Contrato

- `GET /api/repos/detalle?clave=<clave>` → 404 si no existe / no es git.
  Solo lectura: `log`, `diff --shortstat`, `status --porcelain`. Sin fetch,
  sin push, sin stage (el push lo hace el usuario en su terminal).
- Límites: 50 commits por lado (`--max-count`), 200 archivos locales.
  Timeout git 10 s (el del scanner); el endpoint responde aunque un lado
  falle (lado = `{commits: [], stat: null, error?: string}`).
- Tipos nuevos en `shared/types.ts`: `CommitResumen {hash, fecha, mensaje}`,
  `LadoSync {commits, archivos, inserciones, borrados}`, `ArchivoLocal
  {ruta, estado: 'staged'|'unstaged'|'untracked'|'mixto'}`, `DetalleRepoSync
  {clave, salientes, entrantes, locales: {archivos, stat}, sinUpstream}`.

## 3. Fases

- **F1 backend:** `scanner/git.ts: detalleSync(ruta)` (3 comandos por lado +
  porcelain) + `server/rutasRepos.ts` (resuelve por `clave` desde el
  snapshot, patrón `rutasGate.ts:40-44`) + registro en `index.ts:140-143`.
- **F2 frontend:** `v2/repos/apiRepos.ts` (fetch + caché) + `DetalleRepo.tsx`
  (3 secciones plegables) + `PanelRepos.tsx` (acordeón + badge `~N` en fila)
  + CSS en `paneles.css` (clases `reposDetalle*`, reutilizar fila).
- **F3 verificación:** `type-check` exit 0; `curl` al endpoint en vivo
  (workspace-manager: 25 salientes); captura de la tab repos con un repo
  abierto; roadmap HECHO + commit sin push.

## 4. Límites honestos

- `ahead/behind` del snapshot son contra el último fetch local: si el remoto
  avanzó sin fetch, "al día" es mentira local. El detalle lo indica con
  `desde caché`-style: pie `calculado en local, sin fetch`.
- Sin upstream (`behind/ahead` 0 y sin remoto): secciones de subir/traer
  muestran `sin upstream` en vez de listas vacías.

## 5. Cierre (2026-09-28)

- F1+F2 implementados + `type-check` exit 0. Endpoint en vivo:
  `GET /api/repos/detalle?clave=workspace-manager` → 200, 25 salientes
  (top `27ccd68`), 0 entrantes, 10 locales, `truncado:false`.
- Bug real cazado en la verificación: `git()` hacía `.trim()` completo y
  comía el espacio inicial de la PRIMERA línea del porcelain → primera
  entrada con ruta truncada (`oadmap.md`) y estado cambiado a staged, y
  `contarCambios` la contaba como staged. Fix en la raíz:
  `scanner/git.ts:62` `.trim()` → `.trimEnd()` (ningún llamador depende del
  trim inicial; verificado por grep). Re-verificado en vivo: `roadmap.md` /
  `unstaged`.
- Bloqueo operativo: backend 8787 corría código anterior a `rutasRepos.ts`
  (PID 19832, sin watch) → 404. Con autorización explícita del usuario
  (`encárgate tú`, que levanta §4 para este caso) se detuvo y se relanzó
  como `tsx watch` (PID 14320); el fix posterior entró por el propio watch.
  Incidencias del relanzamiento: `Start-Process npm` falla (`%1 no es una
  aplicación Win32 válida`, hay que lanzar vía `cmd /c` o `node`
  + `tsx/dist/cli.mjs`); el harness mató la shell de sondeo pero el server
  destacado sobrevivió (verificar `C:\tmp\wm-server2.log` +
  `GET /api/proyectos`).
- Tab repos en vivo (5174): 15 grupos acordeón; workspace-manager expandido
  muestra POR SUBIR (25 commits · 43 archivos +3187 −634), POR TRAER
  (vacío) y SIN COMMITEAR (10 archivos, `roadmap.md` presente).
- Incidencia vite: el HMR sirvió un transform a medias (state nuevo, mapa
  viejo); se resolvió tocando el mtime + recarga dura (sin matar el
  proceso 9872).
