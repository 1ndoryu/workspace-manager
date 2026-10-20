/* Clasificación de los problemas de un proyecto: git, gate y trabajo abierto del roadmap.
 * Pura: recibe el Proyecto ya leído por el servidor y devuelve sus entradas. */
import type { Proyecto } from '../../types.js';
import type { Entrada, Problema } from './consola-tipos.js';

/* Trabajo abierto del roadmap (D8), una entrada por tarea. [por que] Antes los
 * pendientes iban en su propio contador y no aparecian en la consola: la usuaria
 * pidio que fueran un tipo de problema mas, listables y filtrables como los demas
 * (2026-10-20). Sin seriedad: es trabajo por hacer, no un defecto. */
function entradasPendientes(p: Proyecto): Entrada[] {
  return (p.roadmap?.tareas ?? []).map((t) => ({
    categoria: 'pendiente' as const,
    motivo: `${t.id} — ${t.titulo.trim()}`,
    seriedad: null,
  }));
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
    entradas.push(...entradasPendientes(p));
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
    // [por que] Sin remoto no hay nada que empujar: igual que el gate (sincronizacion.ts),
    // solo cuentan los commits pendientes de subir. Avisar «sin remoto» era falso positivo.
    if (p.git.ahead > 0) {
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

  /* Al final: primero lo que hay que corregir, despues el trabajo abierto. */
  entradas.push(...entradasPendientes(p));

  if (entradas.length === 0) return null;
  return { p, entradas };
}
