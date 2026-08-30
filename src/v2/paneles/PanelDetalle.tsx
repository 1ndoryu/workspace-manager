/* Panel lateral izquierdo con el detalle del proyecto seleccionado.
 * [por que] El usuario pidio que al seleccionar una caja NO aparezca un
 * \"cuadro\" sobre ella, sino un panel lateral con la misma estetica de caja
 * del mapa (monocromo, wireframe). La seleccion es estado global del store. */
import { useState } from 'react';
import type { AnalisisSentinel, Proyecto } from '../../shared/types.js';
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

/* Resumen corto de un analisis para la fila del detalle. */
function resumenAnalisis(a: AnalisisSentinel | undefined): string | null {
  if (!a) return null;
  if (a.estado === 'error') return `análisis falló${a.error ? `: ${a.error}` : ''}`;
  if (a.estado === 'ok') return 'sentinel sin hallazgos';
  const { error, warning, information, hint } = a.resumen;
  const partes: string[] = [];
  if (error) partes.push(`${error} error${error === 1 ? '' : 'es'}`);
  if (warning) partes.push(`${warning} warning${warning === 1 ? '' : 's'}`);
  if (information) partes.push(`${information} info`);
  if (hint) partes.push(`${hint} hint${hint === 1 ? '' : 's'}`);
  return `sentinel: ${partes.join(' · ') || 'sin detalle'}`;
}

export function PanelDetalle() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const escanearUno = useWorkspaceStore((s) => s.escanearUno);
  const analisis = useWorkspaceStore((s) => s.analisis);
  const [escanneando, setEscaneando] = useState(false);

  if (!snapshot || !seleccionadoId) return null;
  const proyecto = snapshot.proyectos.find((p) => p.id === seleccionadoId);
  if (!proyecto) return null;

  const estado = estadoProyecto(proyecto);
  const analisisProy = analisis[proyecto.clave];
  const resumen = resumenAnalisis(analisisProy);

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
    </aside>
  );
}
