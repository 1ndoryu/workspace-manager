/* Clasificacion pura de problemas del workspace para la consola.
 * [por que] Vive en shared para que la use el cliente (consola) y el servidor
 * (ruta /api/consola/problemas, 07AA-1 F1): una sola clasificacion en ambos
 * lados, sin tuberia paralela. Solo tipos de shared/types.js y shared/dev.js;
 * sin DOM ni Node, para importar desde cualquier entry. */
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from './types.js';
import type { InformeDev } from './dev.js';

export type Categoria = 'sinGit' | 'sinCommit' | 'sinPush' | 'gate' | 'config' | 'sentinel' | 'huerfano' | 'vulnerabilidad' | 'dev';

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
  /* Id de la entrada del registro del mando dev (F3: el tablero lo usa para
   * up/stop/logs/open). Solo en entradas 'dev' con entrada (bajo-mando o
   * deriva); sin-boton/no-aplica y el resto de categorias no lo llevan.
   * `parado` (05AA-4) no genera entrada: detenido normal no va en
   * problemas; se opera desde el detalle (clic en la caja). */
  devId?: string | null;
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
    if (!g.varsense && !g.varsenseOpcional && !g.sinEstilos) {
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
    motivo: `${h.paquete} (${h.origen ?? v.gestor})${h.rango ? ` — ${h.rango}` : ''}`,
    seriedad: h.severidad === 'critical' || h.severidad === 'high' ? 'error' : 'advertencia',
    vulnSeveridad: h.severidad,
  }));
  return { p, entradas };
}

/* Vigilancia dev de un proyecto (F0b): sin-boton/deriva del informe del doctor
 * mas los huerfanos atribuidos a su clave. Cada estado es una entrada propia
 * en la categoria 'dev'; los huerfanos reviven la categoria 'huerfano' (estaba
 * en el union y el filtro pero problemasDe nunca la emitia). [por que] El
 * informe viaja en el store (useWorkspace.dev, servido por /api/dev/estado);
 * la consola lo deriva igual que sentinel/vulnerabilidades, sin tuberia
 * paralela. Los fallos del sensor y del fetch se pintan en la fila del propio
 * manager (fail-loud: si la vigilancia falla, se ve donde vive). */
export function problemasDevDe(
  p: Proyecto,
  dev: InformeDev | null,
  devError: string | null,
): Problema | null {
  const entradas: Entrada[] = [];
  const esMando = p.id === 'workspace-manager';
  if (devError && esMando) {
    entradas.push({ categoria: 'dev', motivo: `dev: vigilancia no disponible: ${devError}`, seriedad: 'error' });
  }
  const info = dev?.proyectos.find((d) => d.clave === p.clave);
  if (info?.estado === 'sin-boton') {
    entradas.push({ categoria: 'dev', motivo: `dev sin botón: ${info.motivo}`, seriedad: 'advertencia' });
  } else if (info?.estado === 'deriva') {
    entradas.push({ categoria: 'dev', motivo: `dev deriva: ${info.motivo}`, seriedad: 'error', devId: info.id });
  } else if (info?.estado === 'bajo-mando' && info.id) {
    /* [por que] F3: el tablero ofrece operar lo que el mando gestiona
     * (arrancar/ver, detener, logs): sin esta linea lo sano seria invisible
     * y el usuario no sabria que hay mando. Seriedad null (no es problema). */
    entradas.push({ categoria: 'dev', motivo: `dev bajo mando: ${info.motivo}`, seriedad: null, devId: info.id });
  }
  /* [05AA-4] `parado` no entra: detenido normal, nada que ver en problemas. */
  if (dev?.errorSensor && esMando) {
    entradas.push({ categoria: 'dev', motivo: `dev: sensor falló: ${dev.errorSensor}`, seriedad: 'error' });
  }
  for (const h of dev?.huerfanos ?? []) {
    if (h.clave !== p.clave) continue;
    const quien = h.exe ? (h.exe.split(/[\\/]/).pop() ?? h.exe) : `pid ${h.pid}`;
    entradas.push({
      categoria: 'huerfano',
      motivo: `puerto ${h.puerto} ocupado por ${quien} (pid ${h.pid})${h.verificado ? '' : ' NO-VERIFICADO'}`,
      seriedad: 'advertencia',
    });
  }
  if (entradas.length === 0) return null;
  return { p, entradas };
}

/* Huerfanos sin proyecto atribuible (clave null): grupo sintetico solo para
 * la consola. [por que] Fail-loud: un listener desconocido en el area debe
 * verse aunque ningun exe/cmd apunte a un proyecto; inventar un Proyecto real
 * mentiria, asi que este grupo NUNCA participa en seleccion ni menu (el hook
 * lo ignora por clave ''). */
export function problemaHuerfanosSinProyecto(dev: InformeDev | null): Problema | null {
  if (!dev) return null;
  const solos = dev.huerfanos.filter((h) => h.clave == null);
  if (solos.length === 0) return null;
  const entradas: Entrada[] = solos.map((h) => {
    const quien = h.exe ? (h.exe.split(/[\\/]/).pop() ?? h.exe) : `pid ${h.pid}`;
    return {
      categoria: 'huerfano' as const,
      motivo: `puerto ${h.puerto} sin proyecto: ${quien} (pid ${h.pid})${h.verificado ? '' : ' NO-VERIFICADO'}`,
      seriedad: 'advertencia' as const,
    };
  });
  return {
    p: { id: '(puertos sin proyecto)', clave: '', ruta: '', esGit: false, tipo: 'carpeta' },
    entradas,
  };
}

/* Categorias unicas de un proyecto (para sus badges), en orden fijo. */
export function categoriasDe(pr: Problema): Categoria[] {
  const orden: Categoria[] = ['sinGit', 'sinCommit', 'sinPush', 'gate', 'config', 'sentinel', 'vulnerabilidad', 'huerfano', 'dev'];
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
