/* Dominio git: estado del repo, sincronizacion con el upstream y cambios locales.
 * [por que] Lo consumen el escaner git y la tab repos; aislado para que cambios
 * de sync no toquen el resto del contrato. */
export interface EstadoGit {
  rama: string;
  remoto: string | null;
  ramaPrimaria: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  submodulos: string[];
  /* Cambios locales contados por tipo: staged (indice), unstaged (arbol de
   * trabajo) y untracked. [por que] El plan pide que 'cambios sin commitear'
   * sea un problema visible en la consola y distinga staged/unstaged/untracked. */
  cambios: { staged: number; unstaged: number; untracked: number };
  /* Worktrees registrados por git cuyo directorio o metadata gitdir ya no
   * existe (prunables). [por que] Detectar arboles huerfanos sin borrar nada:
   * el escaner solo reporta; la limpieza requiere autorizacion explicita. */
  worktreesOrfanos: string[];
  ultimoCommit: {
    hash: string;
    fecha: string;
    mensaje: string;
  } | null;
}

/* Resumen de un commit para el detalle de sincronizacion de la tab repos:
 * hash completo (el cliente recorta), fecha ISO y primera linea. */
export interface CommitResumen {
  hash: string;
  fecha: string;
  mensaje: string;
}

/* Un lado del sync contra el upstream: commits + stat agregado. [por que]
 * El diff --shortstat resume archivos/inserciones/borrados en una linea para
 * la cabecera plegable; la lista de commits muestra que se va a subir/traer. */
export interface LadoSync {
  commits: CommitResumen[];
  archivos: number;
  inserciones: number;
  borrados: number;
}

/* Archivo con cambios sin commitear: ruta tal cual la da el porcelain y
 * estado derivado de las columnas XY (X=indice, Y=arbol de trabajo). */
export interface ArchivoLocal {
  ruta: string;
  estado: 'staged' | 'unstaged' | 'untracked' | 'mixto';
}

/* Archivos con cambios sin commitear + diffs para el lateral de la tab
 * repos (GET /api/repos/archivos?clave=, 299A-4, copiado de proyecto-ejemplo):
 * entradas = estado XY crudo (2 chars del porcelain) + ruta destino;
 * diffStaged = `diff --cached`, diffUnstaged = `diff` + untracked como
 * `diff --no-index -- /dev/null <ruta>`. Solo lectura. */
export interface EntradaCambio {
  estado: string;
  ruta: string;
}

export interface ArchivosRepo {
  clave: string;
  entradas: EntradaCambio[];
  diffStaged: string;
  diffUnstaged: string;
  truncado: boolean;
}

/* Detalle de sincronizacion de un repo (GET /api/repos/detalle?clave=).
 * salientes = @{upstream}..HEAD (por subir), entrantes = HEAD..@{upstream}
 * (por traer). Cálculo local sin fetch (ver pie en el cliente). */
export interface DetalleRepoSync {
  clave: string;
  sinUpstream: boolean;
  salientes: LadoSync;
  entrantes: LadoSync;
  locales: { archivos: ArchivoLocal[]; truncado: boolean };
}
