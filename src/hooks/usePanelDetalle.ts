/* Hook del PanelDetalle: detalle del proyecto seleccionado + resumenes.
 * [por que] Extraido de PanelDetalle (299A-11 Bloque D): el componente
 * renderiza, el hook posee el acceso al store y los resumenes derivados. */
import { useWorkspaceStore } from './useWorkspace.js';
import { estadoProyecto } from '../v2/estado.js';
import { useEscanear } from './useEscanear.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../shared/types.js';
import { hashCorto } from '../shared/format.js';

function filasProyecto(p: Proyecto): { k: string; v: string }[] {
  const filas: { k: string; v: string }[] = [
    { k: 'ruta', v: p.ruta },
    { k: 'tipo', v: p.tipo },
  ];
  if (p.esGit && p.git) {
    filas.push({ k: 'rama', v: p.git.rama });
    filas.push({ k: 'rama primaria', v: p.git.ramaPrimaria });
    if (p.git.remoto) filas.push({ k: 'remoto', v: p.git.remoto });
    filas.push({ k: 'estado', v: p.git.dirty ? 'dirty' : 'limpio' });
    if (p.git.ahead || p.git.behind) {
      filas.push({ k: 'commits', v: `${p.git.ahead} ahead · ${p.git.behind} behind` });
    }
    if (p.git.submodulos.length > 0) {
      filas.push({ k: 'submódulos', v: p.git.submodulos.join(', ') });
    }
    const c = p.git.ultimoCommit;
    if (c) {
      filas.push({ k: 'último commit', v: `${hashCorto(c.hash)} · ${c.mensaje}` });
      filas.push({ k: 'fecha', v: c.fecha });
    }
  } else {
    filas.push({ k: 'git', v: 'no es repo' });
  }
  if (p.gate) {
    filas.push({ k: 'gate', v: p.gate.declarado ? `declarado (${p.gate.puerta})` : 'no declarado' });
    if (p.gate.declarado) {
      filas.push({ k: 'sentinel', v: p.gate.sentinel });
      filas.push({ k: 'varsense', v: p.gate.varsense ? 'sí' : 'no' });
      filas.push({ k: 'doctor', v: p.gate.doctor ?? '—' });
    }
  }
  if (p.roadmap) {
    filas.push({ k: 'roadmap', v: `${p.roadmap.pendientes} pendientes · ${p.roadmap.activos} activos` });
    if (p.roadmap.resumen) filas.push({ k: 'resumen', v: p.roadmap.resumen });
  }
  if (p.agents) {
    filas.push({ k: 'agents.md', v: p.agents.tieneAgentsMd ? 'sí' : 'no' });
    if (p.agents.reglas.length > 0) filas.push({ k: 'reglas', v: `${p.agents.reglas.length}` });
    if (p.agents.skills.length > 0) filas.push({ k: 'skills', v: `${p.agents.skills.length}` });
  }
  if (p.padre) filas.push({ k: 'padre', v: p.padre });
  return filas;
}

/* Resumen corto de un analisis para la fila del detalle. Desde la fase G el
 * analisis fusiona sentinel + varsense (hallazgos tagueados por fuente): se
 * muestran ambos conteos, y si solo hay hallazgos de varsense el estado 'ok'
 * no debe decir 'sentinel sin hallazgos' (hay hallazgos, de la otra tool). */
function resumenAnalisis(a: AnalisisSentinel | undefined): string | null {
  if (!a) return null;
  if (a.estado === 'error') return `análisis falló${a.error ? `: ${a.error}` : ''}`;
  /* Conteo de sentinel = hallazgos con fuente sentinel (o sin fuente, cache
   * vieja pre-G). [por que] `a.resumen` ya suma ambas tools desde la fase G. */
  const s = a.hallazgos.filter((h) => h.fuente !== 'varsense');
  const sError = s.filter((h) => h.severidad === 'error').length;
  const sWarning = s.filter((h) => h.severidad === 'warning').length;
  const sInfo = s.filter((h) => h.severidad === 'information').length;
  const sHint = s.filter((h) => h.severidad === 'hint').length;
  const partes: string[] = [];
  /* [por que] 039A-4: el conteo solo acredita si dice con qué binario se
   * midió (versión + commit del provisionPath propio cuando lo hay). */
  const etiqueta = `sentinel v${a.version}${a.commitCli ? `@${a.commitCli}` : ''}`;
  if (a.estado === 'ok') {
    partes.push(`${etiqueta} sin hallazgos`);
  } else if (s.length > 0) {
    const sev: string[] = [];
    if (sError) sev.push(`${sError} error${sError === 1 ? '' : 'es'}`);
    if (sWarning) sev.push(`${sWarning} warning${sWarning === 1 ? '' : 's'}`);
    if (sInfo) sev.push(`${sInfo} info`);
    if (sHint) sev.push(`${sHint} hint${sHint === 1 ? '' : 's'}`);
    partes.push(`${etiqueta}: ${sev.join(' · ') || 'sin detalle'}`);
  } else if (a.varsense && s.length === 0) {
    /* Solo hallazgos de varsense: no decir 'sentinel sin hallazgos' como si
     * el analisis entero estuviera limpio. */
    partes.push(`${etiqueta} sin hallazgos`);
  }
  if (a.varsense) {
    const r = a.varsense.resumen;
    const sev: string[] = [];
    if (r.error) sev.push(`${r.error} error${r.error === 1 ? '' : 'es'}`);
    if (r.warning) sev.push(`${r.warning} warning${r.warning === 1 ? '' : 's'}`);
    if (r.information) sev.push(`${r.information} info`);
    if (r.hint) sev.push(`${r.hint} hint${r.hint === 1 ? '' : 's'}`);
    partes.push(`varsense v${a.varsense.version}: ${sev.join(' · ') || 'sin hallazgos'}`);
  }
  return partes.join(' · ') || null;
}

/* Resumen corto de una auditoria de dependencias para la fila del detalle. */
function resumenAuditoria(a: AnalisisVulnerabilidades | undefined): string | null {
  if (!a) return null;
  if (a.estado === 'error') return `auditoría falló${a.error ? `: ${a.error}` : ''}`;
  if (a.estado === 'noAuditable') return `no auditables${a.error ? ` (${a.error})` : ''}`;
  if (a.estado === 'ok') return `${a.gestor ?? 'deps'} sin vulnerabilidades`;
  const { critical, high, moderate, low } = a.resumen;
  const partes: string[] = [];
  if (critical) partes.push(`${critical} crític${critical === 1 ? 'a' : 'as'}`);
  if (high) partes.push(`${high} alta${high === 1 ? '' : 's'}`);
  if (moderate) partes.push(`${moderate} moderada${moderate === 1 ? '' : 's'}`);
  if (low) partes.push(`${low} baja${low === 1 ? '' : 's'}`);
  return `auditoría: ${partes.join(' · ') || 'sin detalle'}`;
}

export function usePanelDetalle() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const analisis = useWorkspaceStore((s) => s.analisis);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  const dev = useWorkspaceStore((s) => s.dev);
  const devOcupado = useWorkspaceStore((s) => s.devOcupado);
  const accionDev = useWorkspaceStore((s) => s.accionDev);
  const { ocupado: escaneando, escanearProyecto } = useEscanear();

  const proyecto = snapshot && seleccionadoId
    ? (snapshot.proyectos.find((p) => p.id === seleccionadoId) ?? null)
    : null;

  const analisisProy = proyecto ? analisis[proyecto.clave] : undefined;
  const auditoriaProy = proyecto ? vulnerabilidades[proyecto.clave] : undefined;
  /* Entrada del mando dev con botones (05AA-4): solo si tiene id
   * (bajo-mando, deriva o parado; sin-boton/no-aplica no operan). */
  const devInfo = proyecto ? (dev?.proyectos.find((d) => d.clave === proyecto.clave) ?? null) : null;

  return {
    proyecto,
    seleccionar,
    estado: proyecto ? estadoProyecto(proyecto) : '',
    filas: proyecto ? filasProyecto(proyecto) : [],
    devInfo: devInfo?.id ? devInfo : null,
    devOcupado,
    accionDev,
    resumen: resumenAnalisis(analisisProy),
    resumenAudit: resumenAuditoria(auditoriaProy),
    analizadoEn: analisisProy?.analizadoEn,
    auditoriaEn: auditoriaProy?.analizadoEn,
    escaneando,
    escanearProyecto,
  };
}
