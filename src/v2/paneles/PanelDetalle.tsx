/* Panel lateral izquierdo con el detalle del proyecto seleccionado.
 * [por que] El usuario pidio que al seleccionar una caja NO aparezca un
 * \"cuadro\" sobre ella, sino un panel lateral con la misma estetica de caja
 * del mapa (monocromo, wireframe). La seleccion es estado global del store. */
import { useState } from 'react';
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../../shared/types.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import { estadoProyecto } from '../estado.js';
import { verticesParedDer, verticesParedIzq, verticesTecho } from '../mapa/tiles.js';
import './paneles.css';

/* Cubo decorativo de la cabecera: la MISMA caja iso del mapa (mismas
 * funciones de vertices) en una celda cualquiera. Asi el panel \"es una caja\n * igual que el mapa\". */
const CUBO = {
  paredDer: verticesParedDer(0, 0),
  paredIzq: verticesParedIzq(0, 0),
  techo: verticesTecho(0, 0),
};

const ETIQUETA_ESTADO: Record<string, string> = {
  repo: 'repo limpio',
  dirty: 'repo con cambios',
  gate: 'repo con gate',
  carpeta: 'carpeta (no git)',
};

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
      filas.push({ k: 'último commit', v: `${c.hash.slice(0, 7)} · ${c.mensaje}` });
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
  if (a.estado === 'ok') {
    partes.push('sentinel sin hallazgos');
  } else if (s.length > 0) {
    const sev: string[] = [];
    if (sError) sev.push(`${sError} error${sError === 1 ? '' : 'es'}`);
    if (sWarning) sev.push(`${sWarning} warning${sWarning === 1 ? '' : 's'}`);
    if (sInfo) sev.push(`${sInfo} info`);
    if (sHint) sev.push(`${sHint} hint${sHint === 1 ? '' : 's'}`);
    partes.push(`sentinel: ${sev.join(' · ') || 'sin detalle'}`);
  } else if (a.varsense && s.length === 0) {
    /* Solo hallazgos de varsense: no decir 'sentinel sin hallazgos' como si
     * el analisis entero estuviera limpio. */
    partes.push('sentinel sin hallazgos');
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

export function PanelDetalle() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const escanearUno = useWorkspaceStore((s) => s.escanearUno);
  const analisis = useWorkspaceStore((s) => s.analisis);
  /* Auditoria de dependencias por proyecto (plan 308A-4 V1): boton 'Auditar
   * ahora' en el detalle, homologo a 'escanea ahora'. [por que] La accion
   * auditarUno del store y el endpoint ya existian pero el boton por proyecto
   * del plan nunca se habia cableado (quedaba solo 'auditar todo' global). */
  const auditarUno = useWorkspaceStore((s) => s.auditarUno);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  const [escanneando, setEscaneando] = useState(false);
  const [auditando, setAuditando] = useState(false);

  if (!snapshot || !seleccionadoId) return null;
  const proyecto = snapshot.proyectos.find((p) => p.id === seleccionadoId);
  if (!proyecto) return null;

  const estado = estadoProyecto(proyecto);
  const analisisProy = analisis[proyecto.clave];
  const resumen = resumenAnalisis(analisisProy);
  const auditoriaProy = vulnerabilidades[proyecto.clave];
  const resumenAudit = resumenAuditoria(auditoriaProy);

  return (
    <aside className="panelCaja panelDetalle" aria-label={`Detalle de ${proyecto.id}`}>
      <header className="panelCajaCabecera">
        <svg className="panelCajaCubo" viewBox="-19 -21 38 31" aria-hidden="true">
          <polygon points={CUBO.paredDer} />
          <polygon points={CUBO.paredIzq} />
          <polygon points={CUBO.techo} />
        </svg>
        <div className="panelCajaTitulo">
          <div className="panelCajaNombre" title={proyecto.id}>
            {proyecto.id}
          </div>
          <div className="panelCajaSubtitulo">{ETIQUETA_ESTADO[estado]}</div>
        </div>
        <button
          type="button"
          className="panelCajaCerrar"
          onClick={() => seleccionar(null)}
          aria-label="Cerrar detalle"
          title="Cerrar detalle"
        >
          ×
        </button>
      </header>
      <dl className="panelDetalleLista">
        {filasProyecto(proyecto).map((f) => (
          <div className="panelDetalleFila" key={f.k}>
            <dt>{f.k}</dt>
            <dd>{f.v}</dd>
          </div>
        ))}
      </dl>

      {/* Analisis real de sentinel (plan A2): solo si el proyecto usa sentinel.
       * El boton dispara escanearUno(clave); el server rehusa lo fresco por
       * branch+HEAD+version sin re-spawn. */}
      {proyecto.gate?.puerta === 'sentinel' && (
        <div className="panelDetalleScan" aria-label="Análisis de sentinel">
          <button
            type="button"
            className="excBoton"
            disabled={escanneando}
            onClick={() => {
              setEscaneando(true);
              void escanearUno(proyecto.clave).finally(() => setEscaneando(false));
            }}
          >
            {escanneando ? 'analizando…' : 'escaneá ahora'}
          </button>
          {resumen && (
            <div className="panelDetalleScanMeta" title={analisisProy?.analizadoEn}>
              {resumen}
            </div>
          )}
        </div>
      )}

      {/* Auditoria de dependencias (plan 308A-4 V1): boton por proyecto.
       * El server rehusa lo fresco por hash-del-lockfile sin re-auditar. */}
      <div className="panelDetalleScan" aria-label="Auditoría de dependencias">
        <button
          type="button"
          className="excBoton"
          disabled={auditando}
          onClick={() => {
            setAuditando(true);
            void auditarUno(proyecto.clave).finally(() => setAuditando(false));
          }}
        >
          {auditando ? 'auditando…' : 'auditá ahora'}
        </button>
        {resumenAudit && (
          <div className="panelDetalleScanMeta" title={auditoriaProy?.analizadoEn}>
            {resumenAudit}
          </div>
        )}
      </div>
    </aside>
  );
}
