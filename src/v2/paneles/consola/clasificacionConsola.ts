/* Clasificacion pura de problemas del workspace para la consola.
 * [por que] Salio de PanelConsola.tsx: el componente debe quedar solo con JSX
 * (regla componente-sin-hook-glory) y esta clasificacion se deriva del snapshot
 * sin llamada extra al server, asi que vive como funciones puras testeables. */
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../../../shared/types.js';

export type Categoria = 'sinGit' | 'sinCommit' | 'sinPush' | 'gate' | 'config' | 'sentinel' | 'huerfano' | 'vulnerabilidad';

/* Severidad real del hallazgo de sentinel (analyze); solo la categoria
 * 'sentinel' la usa. El badge del proyecto y de la linea deriva de aqui. */
export type SeveridadSentinel = 'error' | 'warning' | 'information' | 'hint';

export interface Entrada {
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
export type SeveridadVuln = 'critical' | 'high' | 'moderate' | 'low';

/* Un proyecto con sus problemas. Cada problema (Entrada) es una linea
 * individual: el CONTEO es por entrada, no por proyecto, porque un proyecto
 * puede tener varios (p. ej. 5 opciones mal de config). Las categorias de
 * badges se derivan de las entradas (unicas). */
export interface Problema {
  p: Proyecto;
  entradas: Entrada[];
}

/* Clasifica un proyecto; null si no tiene ningun problema.
 * [por que] Las carpetas (no git) solo cuentan como "sin git": no tienen
 * sentido las categorias de push/gate sobre ellas. Los problemas de la CONFIG
 * del gate (sentinel/varsense) vienen del server (snapshot): opciones
 * requeridas faltantes o valores con tipo incorrecto -> error; recomendadas
 * faltantes -> advertencia; opcionales faltantes -> se silencian (no llegan). */
export function problemasDe(p: Proyecto): Problema | null {
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
  /* [por que] Los exentos (sinGate) siguen visibles pero no generan "sin
   * gate": sin el flag serian indistinguibles de proyectos sin gate. */
  if (!g?.declarado && !g?.exentoGate) {
    entradas.push({ categoria: 'gate', motivo: 'sin sentinel/varsense declarado', seriedad: null });
  } else if (g?.declarado) {
    if (g.sentinel === 'lock') {
      entradas.push({ categoria: 'gate', motivo: 'sentinel: solo lock, sin config', seriedad: null });
    }
    if (!g.varsense && !g.varsenseOpcional) {
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
export function problemasSentinelDe(p: Proyecto, a: AnalisisSentinel | undefined): Problema | null {
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
export function problemasVulnerabilidadDe(
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
export function categoriasDe(pr: Problema): Categoria[] {
  const orden: Categoria[] = ['sinGit', 'sinCommit', 'sinPush', 'gate', 'config', 'sentinel', 'vulnerabilidad', 'huerfano'];
  return orden.filter((c) => pr.entradas.some((e) => e.categoria === c));
}

/* Ruta relativa de un proyecto respecto a la raiz del area, para abrir su
 * carpeta en el navegador de archivos. Fuera del area devuelve ''. */
export function rutaRelativa(raiz: string | undefined, rutaAbs: string): string {
  if (!raiz) return '';
  const base = raiz.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = rutaAbs.replace(/\\/g, '/');
  if (r === base) return '';
  if (r.startsWith(base + '/')) return r.slice(base.length + 1);
  return '';
}
