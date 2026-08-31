/* Consola de problemas del workspace (panel inferior).
 * [por que] El usuario pidio una consola para ver problemas con filtros:
 * todos, sin git, sin push, sin sentinel o con sentinel/varsense
 * desactualizado. La clasificacion se deriva del snapshot, sin llamada extra
 * al server. */
import { useMemo, useState } from 'react';
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../../shared/types.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './paneles.css';

type Categoria = 'sinGit' | 'sinCommit' | 'sinPush' | 'gate' | 'config' | 'sentinel' | 'huerfano' | 'vulnerabilidad';

/* Severidad real del hallazgo de sentinel (analyze); solo la categoria
 * 'sentinel' la usa. El badge del proyecto y de la linea deriva de aqui. */
type SeveridadSentinel = 'error' | 'warning' | 'information' | 'hint';

const SEV_ETIQUETA: Record<SeveridadSentinel, string> = {
  error: 'error',
  warning: 'warning',
  information: 'info',
  hint: 'hint',
};

interface Entrada {
  categoria: Categoria;
  motivo: string;
  /* Severidad real del problema. Solo la categoria 'config' distingue
   * error/advertencia; el resto es null (no aplica). */
  seriedad: 'error' | 'advertencia' | null;
  /* Severidad del hallazgo de sentinel (analyze), p. ej. error/warning/information/
   * hint. Null salvo en la categoria 'sentinel'. */
  sentinelSeveridad?: SeveridadSentinel;
  /* Severidad de la vulnerabilidad de dependencias (critical/high/moderate/low).
   * Null salvo en la categoria 'vulnerabilidad'. */
  vulnSeveridad?: SeveridadVuln;
}

/* Severidad de una vulnerabilidad de dependencias (npm/pnpm/cargo audit). */
type SeveridadVuln = 'critical' | 'high' | 'moderate' | 'low';

/* Un proyecto con sus problemas. Cada problema (Entrada) es una linea
 * individual: el CONTEO es por entrada, no por proyecto, porque un proyecto
 * puede tener varios (p. ej. 5 opciones mal de config). Las categorias de
 * badges se derivan de las entradas (unicas). */
interface Problema {
  p: Proyecto;
  entradas: Entrada[];
}

/* Clasifica un proyecto; null si no tiene ningun problema.
 * [por que] Las carpetas (no git) solo cuentan como "sin git": no tienen
 * sentido las categorias de push/gate sobre ellas. Los problemas de la CONFIG
 * del gate (sentinel/varsense) vienen del server (snapshot): opciones
 * requeridas faltantes o valores con tipo incorrecto -> error; recomendadas
 * faltantes -> advertencia; opcionales faltantes -> se silencian (no llegan). */
function problemasDe(p: Proyecto): Problema | null {
  const entradas: Entrada[] = [];

  if (!p.esGit) {
    entradas.push({ categoria: 'sinGit', motivo: 'no es repo git', seriedad: null });
    return { p, entradas };
  }

  if (p.git) {
    /* Cambios sin commitear: un problema visible por proyecto (dirty). */
    if (p.git.dirty) {
      const c = p.git.cambios;
      entradas.push({
        categoria: 'sinCommit',
        motivo: c.staged > 0 || c.unstaged > 0 || c.untracked > 0
          ? `cambios sin commitear (${c.staged} staged, ${c.unstaged} unstaged, ${c.untracked} untracked)`
          : 'cambios sin commitear',
        seriedad: null,
      });
    }
    /* Arboles huerfanos: worktrees registrados pero sin directorio/gitdir.
     * [por que] El plan pide detectarlos como problema SIN borrar nada; la
     * limpieza es aparte y con autorizacion. */
    for (const wt of p.git.worktreesOrfanos) {
      entradas.push({ categoria: 'huerfano', motivo: `worktree huerfano: ${wt}`, seriedad: null });
    }
    if (!p.git.remoto) {
      entradas.push({ categoria: 'sinPush', motivo: 'sin remoto configurado', seriedad: null });
    } else if (p.git.ahead > 0) {
      entradas.push({ categoria: 'sinPush', motivo: `${p.git.ahead} commit(s) sin push`, seriedad: null });
    }
  }

  const g = p.gate;
  if (!g?.declarado) {
    entradas.push({ categoria: 'gate', motivo: 'sin sentinel/varsense declarado', seriedad: null });
  } else {
    if (g.sentinel === 'lock') {
      entradas.push({ categoria: 'gate', motivo: 'sentinel: solo lock, sin config', seriedad: null });
    }
    if (!g.varsense) {
      entradas.push({ categoria: 'gate', motivo: 'varsense ausente', seriedad: null });
    }
  }

  /* Problemas de la config del gate (sentinel/varsense). */
  for (const c of p.gateProblemas ?? []) {
    entradas.push({ categoria: 'config', motivo: c.mensaje, seriedad: c.severidad });
  }

  if (entradas.length === 0) return null;
  return { p, entradas };
}

/* Hallazgos de sentinel de un proyecto (si ya se analizo y hay algo). Cada
 * hallazgo es una entrada propia en la categoria 'sentinel'. [por que] La
 * consola se entera del analisis por el store (resultado de escanearUno/Todo);
 * NO mezcla estos hallazgos con 'todos' (decision del usuario: el total de la
 * cabecera no suma analyze; cada filtro conserva su conteo). Desde la fase G
 * el analisis fusiona varsense: los hallazgos con `fuente: 'varsense'` se
 * etiquetan en la linea para distinguir la tool que los emitio. */
function problemasSentinelDe(p: Proyecto, a: AnalisisSentinel | undefined): Problema | null {
  if (!a || a.estado !== 'conHallazgos' || a.hallazgos.length === 0) return null;
  const entradas: Entrada[] = a.hallazgos.map((h) => ({
    categoria: 'sentinel',
    /* [por que] el prefijo permite distinguir la tool que emitio el hallazgo
     * (fase G: el analisis fusiona sentinel + varsense) sin tocar el render. */
    motivo: `${h.fuente === 'varsense' ? '[varsense] ' : ''}${h.archivo || p.id}${h.linea != null ? `:${h.linea}` : ''} — ${h.ruleId} — ${h.mensaje}`,
    seriedad: h.severidad === 'error' ? 'error' : 'advertencia',
    sentinelSeveridad: h.severidad,
  }));
  return { p, entradas };
}

/* Vulnerabilidades de dependencias de un proyecto (308A-4). Cada hallazgo es
 * una entrada propia en la categoria 'vulnerabilidad'. El server resuelve el
 * lockfile/gestor; aqui solo se enlistan los paquetes afectados. Los proyectos
 * 'noAuditable' (sin lockfile o cargo-audit ausente) NO generan problema. */
function problemasVulnerabilidadDe(
  p: Proyecto,
  v: AnalisisVulnerabilidades | undefined,
): Problema | null {
  if (!v || v.estado !== 'conHallazgos' || v.hallazgos.length === 0) return null;
  const entradas: Entrada[] = v.hallazgos.map((h) => ({
    categoria: 'vulnerabilidad',
    motivo: `${h.paquete} (${v.gestor})${h.rango ? ` — ${h.rango}` : ''}`,
    seriedad: h.severidad === 'critical' || h.severidad === 'high' ? 'error' : 'advertencia',
    vulnSeveridad: h.severidad,
  }));
  return { p, entradas };
}

/* Categorias unicas de un proyecto (para sus badges), en orden fijo. */
function categoriasDe(pr: Problema): Categoria[] {
  const orden: Categoria[] = ['sinGit', 'sinCommit', 'sinPush', 'gate', 'config', 'sentinel', 'vulnerabilidad', 'huerfano'];
  return orden.filter((c) => pr.entradas.some((e) => e.categoria === c));
}

const FILTROS: { clave: 'todos' | Categoria; etiqueta: string }[] = [
  { clave: 'todos', etiqueta: 'todos' },
  { clave: 'sinGit', etiqueta: 'sin git' },
  { clave: 'sinCommit', etiqueta: 'sin commit' },
  { clave: 'sinPush', etiqueta: 'sin push' },
  { clave: 'gate', etiqueta: 'sentinel/varsense' },
  { clave: 'config', etiqueta: 'config' },
  { clave: 'sentinel', etiqueta: 'análisis' },
  { clave: 'vulnerabilidad', etiqueta: 'vulnerabilidades' },
  { clave: 'huerfano', etiqueta: 'huérfanos' },
];

const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  sinGit: 'sin git',
  sinCommit: 'sin commit',
  sinPush: 'sin push',
  gate: 'sentinel',
  config: 'config',
  sentinel: 'análisis',
  vulnerabilidad: 'vulnerabilidades',
  huerfano: 'huérfano',
};

/* Ruta relativa de un proyecto respecto a la raiz del area, para abrir su
 * carpeta en el navegador de archivos. Fuera del area devuelve ''. */
function rutaRelativa(raiz: string | undefined, rutaAbs: string): string {
  if (!raiz) return '';
  const base = raiz.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = rutaAbs.replace(/\\/g, '/');
  if (r === base) return '';
  if (r.startsWith(base + '/')) return r.slice(base.length + 1);
  return '';
}

export function PanelConsola() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const analisis = useWorkspaceStore((s) => s.analisis);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const irAArchivos = useWorkspaceStore((s) => s.irAArchivos);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const [filtro, setFiltro] = useState<'todos' | Categoria>('todos');

  const problemas = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos.map(problemasDe).filter((x): x is Problema => x !== null);
  }, [snapshot]);

  /* Hallazgos de sentinel por proyecto (solo de los ya analizados). Viven en
   * su propio filtro 'análisis', y su conteo SI entra en el total 'todos'
   * (decision del usuario: la cabecera debe sumar lo que detecta el análisis). */
  const problemasSentinel = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos
      .map((p) => problemasSentinelDe(p, analisis[p.clave]))
      .filter((x): x is Problema => x !== null);
  }, [snapshot, analisis]);

  /* Vulnerabilidades por proyecto (308A-4 V1). Tambien viven en su propio
   * filtro 'vulnerabilidades' y su conteo entra en el total 'todos'. */
  const problemasVuln = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos
      .map((p) => problemasVulnerabilidadDe(p, vulnerabilidades[p.clave]))
      .filter((x): x is Problema => x !== null);
  }, [snapshot, vulnerabilidades]);

  /* 'todos' fusiona los problemas regulares con los hallazgos de sentinel y
   * las vulnerabilidades AGRUPADOS por proyecto (un proyecto con varias
   * categorias sale una sola vez con sus entradas combinadas y sus badges). */
  const problemasTodo = useMemo(() => {
    const porProyecto = new Map<string, Problema>();
    const poner = (pr: Problema) => {
      const ex = porProyecto.get(pr.p.ruta);
      if (ex) {
        /* [por que] Nunca mutar los objetos de 'problemas'/'problemasSentinel':
         * si `ex` fuese el objeto original y le hiciéramos push, la mutación
         * persistiría entre renders (ese useMemo no se recalcula si el
         * snapshot no cambia) y CADA escaneo volvería a añadir otra capa de
         * entradas (1408 -> 2789 -> 4170...). Se crea un objeto nuevo con
         * entradas combinadas, no se toca el original. */
        porProyecto.set(pr.p.ruta, { p: ex.p, entradas: [...ex.entradas, ...pr.entradas] });
      } else {
        porProyecto.set(pr.p.ruta, { p: pr.p, entradas: [...pr.entradas] });
      }
    };
    problemas.forEach(poner);
    problemasSentinel.forEach(poner);
    problemasVuln.forEach(poner);
    return [...porProyecto.values()];
  }, [problemas, problemasSentinel, problemasVuln]);

  const visibles = useMemo(() => {
    if (filtro === 'sentinel') return problemasSentinel;
    if (filtro === 'vulnerabilidad') return problemasVuln;
    if (filtro === 'todos') return problemasTodo;
    /* Cada filtro renderiza SOLO sus entradas: al filtrar por una categoria
     * no deben verse las lineas de otras categorias del mismo proyecto.
     * [por que] antes devolviamos el grupo completo y se colaban lineas de
     * config/sin-push/analisis al filtrar por sentinel-varsense o la inversa. */
    return problemas
      .map((pr) => ({ p: pr.p, entradas: pr.entradas.filter((e) => e.categoria === filtro) }))
      .filter((pr) => pr.entradas.length > 0);
  }, [problemas, problemasSentinel, problemasVuln, problemasTodo, filtro]);

  /* El conteo es por PROBLEMA individual (entradas), no por proyecto.
   * [por que] Un proyecto puede agrupar varias lineas; contarlo como 1
   * hacía que el total no coincidiera con las lineas visibles al abrir.
   * 'todos' suma las entradas regulares + los hallazgos de sentinel;
   * 'sentinel' suma solo sus hallazgos (su propio filtro). */
  const contar = (clave: 'todos' | Categoria): number => {
    if (clave === 'sentinel') {
      return problemasSentinel.reduce((n, pr) => n + pr.entradas.length, 0);
    }
    if (clave === 'vulnerabilidad') {
      return problemasVuln.reduce((n, pr) => n + pr.entradas.length, 0);
    }
    if (clave === 'todos') return problemasTodo.reduce((n, pr) => n + pr.entradas.length, 0);
    return problemas.reduce((n, pr) => n + pr.entradas.filter((e) => e.categoria === clave).length, 0);
  };

  /* Severidad que pinta el badge del proyecto en la categoria 'sentinel':
   * error si algun hallazgo es error; si no, advertencia (warning/info/hint). */
  const severidadProyectoSentinel = (pr: Problema): 'error' | 'warn' =>
    pr.entradas.some((e) => e.sentinelSeveridad === 'error') ? 'error' : 'warn';

  /* Badge del proyecto en la categoria 'vulnerabilidad': error si hay algun
   * paquete critical/high; si no, advertencia (moderate/low). */
  const severidadProyectoVuln = (pr: Problema): 'error' | 'warn' =>
    pr.entradas.some((e) => e.vulnSeveridad === 'critical' || e.vulnSeveridad === 'high')
      ? 'error'
      : 'warn';

  if (!snapshot) return null;

  return (
    <aside className="panelConsola" aria-label="Consola de problemas">
      <header className="panelConsolaCabecera">
        <span className="panelConsolaTitulo">problemas ({contar('todos')})</span>
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            type="button"
            className={`panelConsolaFiltro${filtro === f.clave ? ' panelConsolaFiltro--activo' : ''}`}
            onClick={() => setFiltro(f.clave)}
            aria-pressed={filtro === f.clave}
          >
            {f.etiqueta} ({contar(f.clave)})
          </button>
        ))}
      </header>
      <div className="panelConsolaContenido">
        {visibles.length === 0 ? (
          <div className="consolaVacio">sin problemas en esta categoría</div>
        ) : (
          visibles.map((pr) => (
            /* [por que] Problemas AGRUPADOS por proyecto: cabecera con el
             * nombre (clic = seleccionar) y cada motivo en su propia linea
             * debajo, indentada con borde izquierdo. Antes todo iba en una
             * sola fila con badges y motivo a la derecha. */
            <div className="consolaGrupo" key={pr.p.id}>
              <button
                type="button"
                className={`consolaFila${pr.p.id === seleccionadoId ? ' consolaFila--seleccionada' : ''}`}
                onClick={() => {
                  seleccionar(pr.p.id);
                  /* Abrir la carpeta del proyecto en el navegador de archivos. */
                  irAArchivos(rutaRelativa(snapshot?.raiz, pr.p.ruta));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  abrirMenuContextual({ x: e.clientX, y: e.clientY, id: pr.p.id, clave: pr.p.clave });
                }}
                title={pr.p.ruta}
              >
                <span className="consolaFilaNombre">{pr.p.id}</span>
                {categoriasDe(pr).map((c) => {
                  let severidadBadge = '';
                  if (c === 'config') {
                    severidadBadge = pr.entradas.some(
                      (e) => e.categoria === 'config' && e.seriedad === 'error',
                    )
                      ? '--error'
                      : '--warn';
                  } else if (c === 'sentinel') {
                    severidadBadge = `--${severidadProyectoSentinel(pr)}`;
                  } else if (c === 'vulnerabilidad') {
                    severidadBadge = `--${severidadProyectoVuln(pr)}`;
                  }
                  return (
                    <span key={c} className={`consolaFilaBadge${severidadBadge}`}>
                      {ETIQUETA_CATEGORIA[c]}
                    </span>
                  );
                })}
              </button>
              <ul className="consolaMotivos">
                {pr.entradas.map((e, i) => (
                  <li
                    key={`${e.motivo}-${i}`}
                    className={`consolaMotivo${e.seriedad ? ` consolaMotivo--${e.seriedad === 'error' ? 'error' : 'warn'}` : ''}`}
                  >
                    {e.sentinelSeveridad ? (
                      <span className={`consolaSeveridad consolaSeveridad--${e.sentinelSeveridad}`}>
                        {SEV_ETIQUETA[e.sentinelSeveridad]}
                      </span>
                    ) : null}
                    {e.vulnSeveridad ? (
                      <span className={`consolaSeveridad consolaSeveridad--${e.vulnSeveridad}`}>
                        {e.vulnSeveridad}
                      </span>
                    ) : null}
                    {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
